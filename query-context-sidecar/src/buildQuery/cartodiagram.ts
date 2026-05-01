import { QueryFormData } from '@superset-ui/core';

import { getBuildQuery } from '../runtimeRegistry';

export default function buildCartodiagramQuery(formData: QueryFormData) {
  const {
    selected_chart: selectedChartString,
    geom_column: geometryColumn,
    extra_form_data: extraFormData,
  } = formData as QueryFormData & {
    selected_chart: string;
    geom_column: string;
    extra_form_data?: Record<string, unknown>;
  };

  const selectedChart = JSON.parse(selectedChartString);
  const vizType = selectedChart.viz_type as string;
  const chartFormData = JSON.parse(selectedChart.params) as Record<string, unknown>;

  chartFormData.extra_form_data = {
    ...(chartFormData.extra_form_data as Record<string, unknown>),
    ...(extraFormData || {}),
  };

  const groupby = Array.isArray(chartFormData.groupby)
    ? (chartFormData.groupby as string[])
    : [];
  chartFormData.groupby = [geometryColumn, ...groupby];

  const buildQuery = getBuildQuery(vizType);
  if (!buildQuery) {
    throw new Error(`Unsupported selected chart viz_type: ${vizType}`);
  }

  return buildQuery(chartFormData);
}
