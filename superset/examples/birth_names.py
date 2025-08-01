# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
import logging
import textwrap
from typing import Union

import pandas as pd
from flask import current_app
from sqlalchemy import DateTime, inspect, String
from sqlalchemy.sql import column

from superset import db, security_manager
from superset.connectors.sqla.models import SqlaTable, SqlMetric, TableColumn
from superset.models.core import Database
from superset.models.dashboard import Dashboard
from superset.models.slice import Slice
from superset.sql.parse import Table
from superset.utils import json
from superset.utils.core import DatasourceType

from ..utils.database import get_example_database  # noqa: TID252
from .helpers import (
    get_slice_json,
    get_table_connector_registry,
    merge_slice,
    misc_dash_slices,
    read_example_data,
    update_slice_ids,
)

logger = logging.getLogger(__name__)


def gen_filter(
    subject: str, comparator: str, operator: str = "=="
) -> dict[str, Union[bool, str]]:
    return {
        "clause": "WHERE",
        "comparator": comparator,
        "expressionType": "SIMPLE",
        "operator": operator,
        "subject": subject,
    }


def load_data(tbl_name: str, database: Database, sample: bool = False) -> None:
    pdf = read_example_data("examples://birth_names2.json.gz", compression="gzip")

    # TODO(bkyryliuk): move load examples data into the pytest fixture
    if database.backend == "presto":
        pdf.ds = pd.to_datetime(pdf.ds, unit="ms")
        pdf.ds = pdf.ds.dt.strftime("%Y-%m-%d %H:%M%:%S")
    else:
        pdf.ds = pd.to_datetime(pdf.ds, unit="ms")
    pdf = pdf.head(100) if sample else pdf

    with database.get_sqla_engine() as engine:
        schema = inspect(engine).default_schema_name

        pdf.to_sql(
            tbl_name,
            engine,
            schema=schema,
            if_exists="replace",
            chunksize=500,
            dtype={
                # TODO(bkyryliuk): use TIMESTAMP type for presto
                "ds": DateTime if database.backend != "presto" else String(255),
                "gender": String(16),
                "state": String(10),
                "name": String(255),
            },
            method="multi",
            index=False,
        )
    logger.debug("Done loading table!")
    logger.debug("-" * 80)


def load_birth_names(
    only_metadata: bool = False, force: bool = False, sample: bool = False
) -> None:
    """Loading birth name dataset from a zip file in the repo"""
    database = get_example_database()
    with database.get_sqla_engine() as engine:
        schema = inspect(engine).default_schema_name

    tbl_name = "birth_names"
    table_exists = database.has_table(Table(tbl_name, schema))

    if not only_metadata and (not table_exists or force):
        load_data(tbl_name, database, sample=sample)

    table = get_table_connector_registry()
    obj = db.session.query(table).filter_by(table_name=tbl_name, schema=schema).first()
    if not obj:
        logger.debug(f"Creating table [{tbl_name}] reference")
        obj = table(table_name=tbl_name, schema=schema)
        db.session.add(obj)

    _set_table_metadata(obj, database)
    _add_table_metrics(obj)

    slices, _ = create_slices(obj)
    create_dashboard(slices)


def _set_table_metadata(datasource: SqlaTable, database: "Database") -> None:
    datasource.main_dttm_col = "ds"
    datasource.database = database
    datasource.filter_select_enabled = True
    datasource.fetch_metadata()


def _add_table_metrics(datasource: SqlaTable) -> None:
    # By accessing the attribute first, we make sure `datasource.columns` and
    # `datasource.metrics` are already loaded. Otherwise accessing them later
    # may trigger an unnecessary and unexpected `after_update` event.
    columns, metrics = datasource.columns, datasource.metrics

    if not any(col.column_name == "num_california" for col in columns):
        col_state = str(column("state").compile(db.engine))
        col_num = str(column("num").compile(db.engine))
        columns.append(
            TableColumn(
                column_name="num_california",
                expression=f"CASE WHEN {col_state} = 'CA' THEN {col_num} ELSE 0 END",
            )
        )

    if not any(col.metric_name == "sum__num" for col in metrics):
        col = str(column("num").compile(db.engine))
        metrics.append(SqlMetric(metric_name="sum__num", expression=f"SUM({col})"))

    for col in columns:
        if col.column_name == "ds":  # type: ignore
            col.is_dttm = True  # type: ignore
            break

    datasource.columns = columns
    datasource.metrics = metrics


def create_slices(tbl: SqlaTable) -> tuple[list[Slice], list[Slice]]:
    owner = security_manager.get_user_by_id(1)
    metrics = [
        {
            "expressionType": "SIMPLE",
            "column": {"column_name": "num", "type": "BIGINT"},
            "aggregate": "SUM",
            "label": "Births",
            "optionName": "metric_11",
        }
    ]
    metric = "sum__num"

    defaults = {
        "compare_lag": "10",
        "compare_suffix": "o10Y",
        "limit": "25",
        "granularity_sqla": "ds",
        "groupby": [],
        "row_limit": current_app.config["ROW_LIMIT"],
        "time_range": "100 years ago : now",
        "viz_type": "table",
        "markup_type": "markdown",
    }

    default_query_context = {
        "result_format": "json",
        "result_type": "full",
        "datasource": {
            "id": tbl.id,
            "type": "table",
        },
        "queries": [
            {
                "columns": [],
                "metrics": [],
            },
        ],
    }

    slice_kwargs = {
        "datasource_id": tbl.id,
        "datasource_type": DatasourceType.TABLE,
    }

    logger.debug("Creating some slices")
    slices = [
        Slice(
            **slice_kwargs,
            slice_name="Participants",
            viz_type="big_number",
            params=get_slice_json(
                defaults,
                viz_type="big_number",
                granularity_sqla="ds",
                compare_lag="5",
                compare_suffix="over 5Y",
                metric=metric,
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Genders",
            viz_type="pie",
            params=get_slice_json(
                defaults, viz_type="pie", groupby=["gender"], metric=metric
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Trends",
            viz_type="echarts_timeseries_line",
            params=get_slice_json(
                defaults,
                viz_type="echarts_timeseries_line",
                groupby=["name"],
                granularity_sqla="ds",
                rich_tooltip=True,
                show_legend=True,
                metrics=metrics,
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Genders by State",
            viz_type="echarts_timeseries_bar",
            params=get_slice_json(
                defaults,
                adhoc_filters=[
                    {
                        "clause": "WHERE",
                        "expressionType": "SIMPLE",
                        "filterOptionName": "2745eae5",
                        "comparator": ["other"],
                        "operator": "NOT IN",
                        "subject": "state",
                    }
                ],
                viz_type="echarts_timeseries_bar",
                metrics=[
                    {
                        "expressionType": "SIMPLE",
                        "column": {"column_name": "num_boys", "type": "BIGINT(20)"},
                        "aggregate": "SUM",
                        "label": "Boys",
                        "optionName": "metric_11",
                    },
                    {
                        "expressionType": "SIMPLE",
                        "column": {"column_name": "num_girls", "type": "BIGINT(20)"},
                        "aggregate": "SUM",
                        "label": "Girls",
                        "optionName": "metric_12",
                    },
                ],
                groupby=["state"],
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Girls",
            viz_type="table",
            params=get_slice_json(
                defaults,
                groupby=["name"],
                adhoc_filters=[gen_filter("gender", "girl")],
                row_limit=50,
                timeseries_limit_metric=metric,
                metrics=[metric],
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Girl Name Cloud",
            viz_type="word_cloud",
            params=get_slice_json(
                defaults,
                viz_type="word_cloud",
                size_from="10",
                series="name",
                size_to="70",
                rotation="square",
                limit="100",
                adhoc_filters=[gen_filter("gender", "girl")],
                metric=metric,
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Boys",
            viz_type="table",
            params=get_slice_json(
                defaults,
                groupby=["name"],
                adhoc_filters=[gen_filter("gender", "boy")],
                row_limit=50,
                timeseries_limit_metric=metric,
                metrics=[metric],
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Boy Name Cloud",
            viz_type="word_cloud",
            params=get_slice_json(
                defaults,
                viz_type="word_cloud",
                size_from="10",
                series="name",
                size_to="70",
                rotation="square",
                limit="100",
                adhoc_filters=[gen_filter("gender", "boy")],
                metric=metric,
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Top 10 Girl Name Share",
            viz_type="echarts_area",
            params=get_slice_json(
                defaults,
                adhoc_filters=[gen_filter("gender", "girl")],
                comparison_type="values",
                groupby=["name"],
                limit=10,
                stacked_style="expand",
                time_grain_sqla="P1D",
                viz_type="echarts_area",
                x_axis_forma="smart_date",
                metrics=metrics,
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Top 10 Boy Name Share",
            viz_type="echarts_area",
            params=get_slice_json(
                defaults,
                adhoc_filters=[gen_filter("gender", "boy")],
                comparison_type="values",
                groupby=["name"],
                limit=10,
                stacked_style="expand",
                time_grain_sqla="P1D",
                viz_type="echarts_area",
                x_axis_forma="smart_date",
                metrics=metrics,
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Pivot Table v2",
            viz_type="pivot_table_v2",
            params=get_slice_json(
                defaults,
                viz_type="pivot_table_v2",
                groupbyRows=["name"],
                groupbyColumns=["state"],
                metrics=[metric],
            ),
            query_context=get_slice_json(
                default_query_context,
                queries=[
                    {
                        "columns": ["name", "state"],
                        "metrics": [metric],
                    }
                ],
            ),
            owners=[],
        ),
    ]
    misc_slices = [
        Slice(
            **slice_kwargs,
            slice_name="Average and Sum Trends",
            viz_type="mixed_timeseries",
            params=get_slice_json(
                defaults,
                viz_type="mixed_timeseries",
                metrics=[
                    {
                        "expressionType": "SIMPLE",
                        "column": {"column_name": "num", "type": "BIGINT(20)"},
                        "aggregate": "AVG",
                        "label": "AVG(num)",
                        "optionName": "metric_vgops097wej_g8uff99zhk7",
                    }
                ],
                metrics_b=["sum__num"],
                granularity_sqla="ds",
                yAxisIndex=0,
                yAxisIndexB=1,
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Num Births Trend",
            viz_type="echarts_timeseries_line",
            params=get_slice_json(
                defaults, viz_type="echarts_timeseries_line", metrics=metrics
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Daily Totals",
            viz_type="table",
            params=get_slice_json(
                defaults,
                groupby=["ds"],
                time_range="1983 : 2023",
                viz_type="table",
                metrics=metrics,
            ),
            query_context=get_slice_json(
                default_query_context,
                queries=[
                    {
                        "columns": ["ds"],
                        "metrics": metrics,
                        "time_range": "1983 : 2023",
                    }
                ],
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Number of California Births",
            viz_type="big_number_total",
            params=get_slice_json(
                defaults,
                metric={
                    "expressionType": "SIMPLE",
                    "column": {
                        "column_name": "num_california",
                        "expression": "CASE WHEN state = 'CA' THEN num ELSE 0 END",
                    },
                    "aggregate": "SUM",
                    "label": "SUM(num_california)",
                },
                viz_type="big_number_total",
                granularity_sqla="ds",
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Top 10 California Names Timeseries",
            viz_type="echarts_timeseries_line",
            params=get_slice_json(
                defaults,
                metrics=[
                    {
                        "expressionType": "SIMPLE",
                        "column": {
                            "column_name": "num_california",
                            "expression": "CASE WHEN state = 'CA' THEN num ELSE 0 END",
                        },
                        "aggregate": "SUM",
                        "label": "SUM(num_california)",
                    }
                ],
                viz_type="echarts_timeseries_line",
                granularity_sqla="ds",
                groupby=["name"],
                timeseries_limit_metric={
                    "expressionType": "SIMPLE",
                    "column": {
                        "column_name": "num_california",
                        "expression": "CASE WHEN state = 'CA' THEN num ELSE 0 END",
                    },
                    "aggregate": "SUM",
                    "label": "SUM(num_california)",
                },
                limit="10",
            ),
            owners=[owner] if owner else [],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Names Sorted by Num in California",
            viz_type="table",
            params=get_slice_json(
                defaults,
                metrics=metrics,
                groupby=["name"],
                row_limit=50,
                timeseries_limit_metric={
                    "expressionType": "SIMPLE",
                    "column": {
                        "column_name": "num_california",
                        "expression": "CASE WHEN state = 'CA' THEN num ELSE 0 END",
                    },
                    "aggregate": "SUM",
                    "label": "SUM(num_california)",
                },
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Number of Girls",
            viz_type="big_number_total",
            params=get_slice_json(
                defaults,
                metric=metric,
                viz_type="big_number_total",
                granularity_sqla="ds",
                adhoc_filters=[gen_filter("gender", "girl")],
                subheader="total female participants",
            ),
            owners=[],
        ),
        Slice(
            **slice_kwargs,
            slice_name="Pivot Table",
            viz_type="pivot_table_v2",
            params=get_slice_json(
                defaults,
                viz_type="pivot_table_v2",
                groupbyRows=["name"],
                groupbyColumns=["state"],
                metrics=metrics,
            ),
            owners=[],
        ),
    ]
    for slc in slices:
        merge_slice(slc)

    for slc in misc_slices:
        merge_slice(slc)
        misc_dash_slices.add(slc.slice_name)

    return slices, misc_slices


def create_dashboard(slices: list[Slice]) -> Dashboard:
    logger.debug("Creating a dashboard")
    dash = db.session.query(Dashboard).filter_by(slug="births").first()
    if not dash:
        dash = Dashboard()
        db.session.add(dash)

    dash.published = True
    dash.json_metadata = textwrap.dedent(
        """\
    {
        "label_colors": {
            "Girls": "#FF69B4",
            "Boys": "#ADD8E6",
            "girl": "#FF69B4",
            "boy": "#ADD8E6"
        }
    }"""
    )
    pos = json.loads(
        textwrap.dedent(
            """\
        {
          "CHART-6GdlekVise": {
            "children": [],
            "id": "CHART-6GdlekVise",
            "meta": {
              "chartId": 5547,
              "height": 50,
              "sliceName": "Top 10 Girl Name Share",
              "width": 5
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-eh0w37bWbR"
            ],
            "type": "CHART"
          },
          "CHART-6n9jxb30JG": {
            "children": [],
            "id": "CHART-6n9jxb30JG",
            "meta": {
              "chartId": 5540,
              "height": 36,
              "sliceName": "Genders by State",
              "width": 5
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW--EyBZQlDi"
            ],
            "type": "CHART"
          },
          "CHART-Jj9qh1ol-N": {
            "children": [],
            "id": "CHART-Jj9qh1ol-N",
            "meta": {
              "chartId": 5545,
              "height": 50,
              "sliceName": "Boy Name Cloud",
              "width": 4
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-kzWtcvo8R1"
            ],
            "type": "CHART"
          },
          "CHART-ODvantb_bF": {
            "children": [],
            "id": "CHART-ODvantb_bF",
            "meta": {
              "chartId": 5548,
              "height": 50,
              "sliceName": "Top 10 Boy Name Share",
              "width": 5
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-kzWtcvo8R1"
            ],
            "type": "CHART"
          },
          "CHART-PAXUUqwmX9": {
            "children": [],
            "id": "CHART-PAXUUqwmX9",
            "meta": {
              "chartId": 5538,
              "height": 34,
              "sliceName": "Genders",
              "width": 3
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-2n0XgiHDgs"
            ],
            "type": "CHART"
          },
          "CHART-_T6n_K9iQN": {
            "children": [],
            "id": "CHART-_T6n_K9iQN",
            "meta": {
              "chartId": 5539,
              "height": 36,
              "sliceName": "Trends",
              "width": 7
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW--EyBZQlDi"
            ],
            "type": "CHART"
          },
          "CHART-eNY0tcE_ic": {
            "children": [],
            "id": "CHART-eNY0tcE_ic",
            "meta": {
              "chartId": 5537,
              "height": 34,
              "sliceName": "Participants",
              "width": 3
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-2n0XgiHDgs"
            ],
            "type": "CHART"
          },
          "CHART-g075mMgyYb": {
            "children": [],
            "id": "CHART-g075mMgyYb",
            "meta": {
              "chartId": 5541,
              "height": 50,
              "sliceName": "Girls",
              "width": 3
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-eh0w37bWbR"
            ],
            "type": "CHART"
          },
          "CHART-n-zGGE6S1y": {
            "children": [],
            "id": "CHART-n-zGGE6S1y",
            "meta": {
              "chartId": 5542,
              "height": 50,
              "sliceName": "Girl Name Cloud",
              "width": 4
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-eh0w37bWbR"
            ],
            "type": "CHART"
          },
          "CHART-vJIPjmcbD3": {
            "children": [],
            "id": "CHART-vJIPjmcbD3",
            "meta": {
              "chartId": 5543,
              "height": 50,
              "sliceName": "Boys",
              "width": 3
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-kzWtcvo8R1"
            ],
            "type": "CHART"
          },
          "DASHBOARD_VERSION_KEY": "v2",
          "GRID_ID": {
            "children": [
              "ROW-2n0XgiHDgs",
              "ROW--EyBZQlDi",
              "ROW-eh0w37bWbR",
              "ROW-kzWtcvo8R1"
            ],
            "id": "GRID_ID",
            "parents": [
              "ROOT_ID"
            ],
            "type": "GRID"
          },
          "HEADER_ID": {
            "id": "HEADER_ID",
            "meta": {
              "text": "Births"
            },
            "type": "HEADER"
          },
          "MARKDOWN-zaflB60tbC": {
            "children": [],
            "id": "MARKDOWN-zaflB60tbC",
            "meta": {
              "code": "<div style=\\"text-align:center\\">  <h1>Birth Names Dashboard</h1>  <img src=\\"/static/assets/images/babies.png\\" style=\\"width:50%;\\"></div>",
              "height": 34,
              "width": 6
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID",
              "ROW-2n0XgiHDgs"
            ],
            "type": "MARKDOWN"
          },
          "ROOT_ID": {
            "children": [
              "GRID_ID"
            ],
            "id": "ROOT_ID",
            "type": "ROOT"
          },
          "ROW--EyBZQlDi": {
            "children": [
              "CHART-_T6n_K9iQN",
              "CHART-6n9jxb30JG"
            ],
            "id": "ROW--EyBZQlDi",
            "meta": {
              "background": "BACKGROUND_TRANSPARENT"
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID"
            ],
            "type": "ROW"
          },
          "ROW-2n0XgiHDgs": {
            "children": [
              "CHART-eNY0tcE_ic",
              "MARKDOWN-zaflB60tbC",
              "CHART-PAXUUqwmX9"
            ],
            "id": "ROW-2n0XgiHDgs",
            "meta": {
              "background": "BACKGROUND_TRANSPARENT"
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID"
            ],
            "type": "ROW"
          },
          "ROW-eh0w37bWbR": {
            "children": [
              "CHART-g075mMgyYb",
              "CHART-n-zGGE6S1y",
              "CHART-6GdlekVise"
            ],
            "id": "ROW-eh0w37bWbR",
            "meta": {
              "background": "BACKGROUND_TRANSPARENT"
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID"
            ],
            "type": "ROW"
          },
          "ROW-kzWtcvo8R1": {
            "children": [
              "CHART-vJIPjmcbD3",
              "CHART-Jj9qh1ol-N",
              "CHART-ODvantb_bF"
            ],
            "id": "ROW-kzWtcvo8R1",
            "meta": {
              "background": "BACKGROUND_TRANSPARENT"
            },
            "parents": [
              "ROOT_ID",
              "GRID_ID"
            ],
            "type": "ROW"
          }
        }
        """  # noqa: E501
        )
    )
    # dashboard v2 doesn't allow add markup slice
    dash.slices = [slc for slc in slices if slc.viz_type != "markup"]
    update_slice_ids(pos)
    dash.dashboard_title = "USA Births Names"
    dash.position_json = json.dumps(pos, indent=4)  # noqa: TID251
    dash.slug = "births"
    return dash
