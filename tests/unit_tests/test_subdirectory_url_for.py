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
"""url_for emission for Superset.* endpoints under subdirectory deployments.

Flask-AppBuilder's BaseView auto-derives `route_base` from the class name,
which used to mount every `@expose` route on `Superset` under `/superset/...`.
Combined with `AppRootMiddleware` stripping `/superset` from `PATH_INFO` and
setting `SCRIPT_NAME=/superset`, werkzeug's `MapAdapter.build` produced
doubled URLs (`/superset/superset/...`) on every `url_for(..., _external=True)`
call into that namespace — and the routes themselves became unreachable at
request time because the in-rule `/superset` prefix no longer matched the
post-strip PATH_INFO.

`Superset.route_base = ""` mounts the routes at the root so the appRoot
applies exactly once (via SCRIPT_NAME / basename). These tests pin both
branches: no SCRIPT_NAME and SCRIPT_NAME=`/superset`.
"""

from flask import url_for


def test_dashboard_permalink_url_has_no_route_prefix_without_script_name(
    app_context: None,
) -> None:
    """Under root deployment, the permalink route lives at /dashboard/p/<key>/.

    The auto-derived `/superset` prefix on the `Superset` view class is gone;
    the route is now mounted at the root path so url_for returns a single,
    prefix-free URL.
    """
    from flask import current_app

    with current_app.test_request_context("/"):
        url = url_for("Superset.dashboard_permalink", key="abc123")
        assert url == "/dashboard/p/abc123/"


def test_dashboard_permalink_url_carries_single_script_name_prefix(
    app_context: None,
) -> None:
    """Under subdirectory deployment, url_for emits exactly one prefix.

    AppRootMiddleware sets SCRIPT_NAME=/superset on every inbound request
    once APPLICATION_ROOT is configured. url_for prepends SCRIPT_NAME to the
    rule, so the emitted URL is `/superset/dashboard/p/<key>/` — a single
    prefix, not the previous `/superset/superset/dashboard/p/<key>/`.
    """
    from flask import current_app

    with current_app.test_request_context(
        "/",
        environ_overrides={"SCRIPT_NAME": "/superset"},
    ):
        url = url_for("Superset.dashboard_permalink", key="abc123")
        assert url == "/superset/dashboard/p/abc123/"


def test_welcome_url_carries_single_script_name_prefix(
    app_context: None,
) -> None:
    """Spot-check a second route to confirm the fix is not endpoint-specific.

    The `brand.path` regression in the QA findings traced to
    `url_for("Superset.welcome", _external=True)` returning the doubled
    `/superset/superset/welcome/`. Pinning a single-prefix expectation for
    welcome guards against a regression that reintroduces the auto-derived
    route_base on the Superset class.
    """
    from flask import current_app

    with current_app.test_request_context(
        "/",
        environ_overrides={"SCRIPT_NAME": "/superset"},
    ):
        url = url_for("Superset.welcome")
        assert url == "/superset/welcome/"


def test_dashboard_permalink_external_url_is_single_prefixed(
    app_context: None,
) -> None:
    """`url_for(..., _external=True)` is the shape the permalink API serves.

    Pin the external (scheme://host included) variant explicitly — that is
    the value that ends up on the user's clipboard via
    `superset/dashboards/permalink/api.py` and must carry one application
    root segment, not two.
    """
    from flask import current_app

    with current_app.test_request_context(
        "/",
        environ_overrides={"SCRIPT_NAME": "/superset"},
    ):
        url = url_for("Superset.dashboard_permalink", key="abc123", _external=True)
        assert url.endswith("/superset/dashboard/p/abc123/")
        assert "/superset/superset/" not in url


def test_explore_permalink_url_is_single_prefixed(app_context: None) -> None:
    """ExplorePermalinkView previously hard-coded route_base = "/superset".

    The `superset/explore/permalink/api.py` endpoint serves the clipboard URL
    via `url_for("ExplorePermalinkView.permalink", _external=True)`. Under
    SCRIPT_NAME=/superset that combination doubled to
    `/superset/superset/explore/p/<key>/`. Mirroring the Superset.route_base=""
    decision pins the single-prefix shape and prevents the doubled emission
    from regressing.
    """
    from flask import current_app

    with current_app.test_request_context(
        "/",
        environ_overrides={"SCRIPT_NAME": "/superset"},
    ):
        url = url_for("ExplorePermalinkView.permalink", key="abc123", _external=True)
        assert url.endswith("/superset/explore/p/abc123/")
        assert "/superset/superset/" not in url


def test_tag_views_urls_are_single_prefixed(app_context: None) -> None:
    """TagModelView and TaggedObjectsModelView previously hard-coded
    `route_base = "/superset/tags"` / `/superset/all_entities"`.

    Mirroring the Superset.route_base="" decision, the rule is now
    `/tags/` / `/all_entities/` and `url_for` under SCRIPT_NAME=/superset
    must carry the prefix exactly once.
    """
    from flask import current_app

    with current_app.test_request_context(
        "/",
        environ_overrides={"SCRIPT_NAME": "/superset"},
    ):
        assert url_for("TagModelView.list") == "/superset/tags/"
        assert url_for("TaggedObjectsModelView.list") == "/superset/all_entities/"


def test_dashboard_model_url_has_no_route_prefix() -> None:
    """`Dashboard.url` / `Dashboard.get_url` previously hard-coded
    `/superset/dashboard/<id>/` as a string literal.

    After `Superset.route_base = ""` the backend rule is `/dashboard/<id>/`,
    so the literal was wrong on both root deployments (no matching rule) and
    on subdirectory deployments (downstream callers re-applied the app root
    and produced doubled paths in DashboardList row hrefs, ultimately leading
    to the user-visible discard-edit 404). The method now returns a
    prefix-free relative URL that downstream `ensureAppRoot`-aware helpers
    can prepend exactly once.
    """
    from superset.models.dashboard import Dashboard

    assert Dashboard.get_url(11) == "/dashboard/11/"
    assert Dashboard.get_url(11, "births") == "/dashboard/births/"
