#!/usr/bin/env python3
"""
Country Map build pipeline — Natural Earth → GeoJSON.

Replaces the legacy Jupyter notebook. Reads YAML configs from config/,
downloads pinned Natural Earth shapefiles, applies declarative transforms,
optionally runs procedural escape-hatch scripts, and writes per-worldview
GeoJSON outputs to output/.

Run with: ./build.sh  (which is just `python3 build.py` with sensible env)

This is the POC version — currently implements:
  - NE shapefile download + cache (pinned to v5.1.2)
  - Shapefile → GeoJSON conversion via mapshaper CLI
  - name_overrides.yaml application
  - One worldview (UA) at Admin 0

Future commits will add: multiple worldviews, Admin 1, flying_islands,
territory_assignments, regional_aggregations, composite_maps, simplification,
procedural/ orchestration.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

# ----------------------------------------------------------------------
# Constants / paths
# ----------------------------------------------------------------------

NE_REPO = "nvkelso/natural-earth-vector"
NE_PINNED_TAG = "v5.1.2"
NE_PINNED_SHA = "f1890d9f152c896d250a77557a5751a93d494776"
NE_RAW_URL = f"https://raw.githubusercontent.com/{NE_REPO}/{NE_PINNED_SHA}/10m_cultural"

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_DIR = SCRIPT_DIR / "config"
OUTPUT_DIR = SCRIPT_DIR / "output"
CACHE_DIR = SCRIPT_DIR / ".cache"

SHAPEFILE_EXTS = ["shp", "shx", "dbf", "prj", "cpg"]

# Worldview codes shipped by NE as suffixes on the Admin 0 file name. Empty
# string = the "Default" (ungrouped) NE editorial. The new plugin's
# documented default is "ukr".
WORLDVIEWS_ADMIN_0 = [
    "",       # Default
    "ukr",    # Ukraine — Superset's documented default
]


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ----------------------------------------------------------------------
# NE download
# ----------------------------------------------------------------------


def fetch_ne_shapefile(admin_level: int, worldview: str = "") -> Path:
    """Download (or use cached) shapefile components for one NE layer.

    Returns the path to the `.shp` file; sibling `.shx`/`.dbf`/`.prj`/`.cpg`
    files live alongside as mapshaper requires.
    """
    if admin_level == 0:
        suffix = f"_{worldview}" if worldview else ""
        basename = f"ne_10m_admin_0_countries{suffix}"
    elif admin_level == 1:
        # NE only publishes worldview-specific files at Admin 0. Admin 1
        # uses a single file with per-feature `WORLDVIEW` attributes.
        basename = "ne_10m_admin_1_states_provinces"
    else:
        raise ValueError(f"Unsupported admin_level={admin_level}")

    target_shp = CACHE_DIR / f"{basename}.shp"
    if target_shp.exists():
        return target_shp

    CACHE_DIR.mkdir(exist_ok=True)
    log(f"Downloading NE {basename} (worldview={worldview or 'default'})…")
    for ext in SHAPEFILE_EXTS:
        url = f"{NE_RAW_URL}/{basename}.{ext}"
        dest = CACHE_DIR / f"{basename}.{ext}"
        try:
            urllib.request.urlretrieve(url, dest)
        except urllib.error.HTTPError as e:
            if ext == "cpg" and e.code == 404:
                # .cpg is optional in shapefile bundles
                continue
            raise

    return target_shp


# ----------------------------------------------------------------------
# Shapefile → GeoJSON via mapshaper CLI
# ----------------------------------------------------------------------


def shp_to_geojson(shp: Path, output: Path) -> None:
    """Convert a shapefile to GeoJSON FeatureCollection.

    Also normalizes property names to lowercase: NE ships Admin 0 with
    uppercase field names (ADM0_A3, NAME_EN, ...) and Admin 1 with
    lowercase (adm0_a3, name_en, ...). All transforms downstream assume
    lowercase, so we normalize at conversion time.
    """
    if shutil.which("npx") is None:
        raise RuntimeError(
            "npx not found in PATH; mapshaper is required for shapefile conversion"
        )
    log(f"  mapshaper: {shp.name} → {output.name}")
    subprocess.run(
        ["npx", "--yes", "mapshaper", str(shp), "-o", str(output), "format=geojson"],
        check=True,
        stderr=subprocess.DEVNULL,
    )
    _normalize_property_keys(output)


def _normalize_property_keys(geojson_path: Path) -> None:
    """Lowercase all feature property keys in-place."""
    geo = json.loads(geojson_path.read_text())
    for f in geo.get("features", []):
        props = f.get("properties") or {}
        f["properties"] = {k.lower(): v for k, v in props.items()}
    geojson_path.write_text(json.dumps(geo))


def simplify_geojson(src: Path, dst: Path, percentage: float = 5.0) -> None:
    """Run mapshaper -simplify to reduce file size with topology preserved.

    Default 5% keeps recognizable country shapes while shrinking typical
    Admin 1 output ~10x. `keep-shapes` prevents tiny features (small
    islands) from being dropped entirely.
    """
    log(f"  mapshaper -simplify {percentage}% keep-shapes: {src.name} → {dst.name}")
    subprocess.run(
        [
            "npx", "--yes", "mapshaper",
            str(src),
            "-simplify", f"{percentage}%", "keep-shapes",
            "-o", str(dst), "format=geojson",
        ],
        check=True,
        stderr=subprocess.DEVNULL,
    )


# ----------------------------------------------------------------------
# Match helpers
# ----------------------------------------------------------------------


def _matches(props: dict[str, Any], conditions: dict[str, Any]) -> bool:
    """Check whether a feature's properties satisfy all conditions in match.

    Supports two value forms:
      - scalar: exact equality
      - {in: [...]}: membership in a list
    """
    for k, want in conditions.items():
        got = props.get(k)
        if isinstance(want, dict) and "in" in want:
            if got not in want["in"]:
                return False
        else:
            if got != want:
                return False
    return True


# ----------------------------------------------------------------------
# Transforms
# ----------------------------------------------------------------------


def apply_name_overrides(geo: dict, overrides: list[dict]) -> dict:
    """Apply attribute overrides from name_overrides.yaml."""
    n_applied = 0
    for entry in overrides:
        match = entry["match"]
        new_values = entry["set"]
        for feature in geo["features"]:
            props = feature["properties"]
            if _matches(props, match):
                props.update(new_values)
                n_applied += 1
    log(f"  name_overrides: applied {n_applied} field updates "
        f"across {len(overrides)} entries")
    return geo


def _translate_and_scale(
    geom: dict,
    offset: list[float],
    scale: float = 1.0,
) -> dict:
    """Translate then optionally scale a GeoJSON geometry in place.

    Pure-Python implementation — no shapely dependency. Operates on
    Polygon and MultiPolygon coordinates (the only types that appear
    in NE Admin 0/1 country geometries).

    Scale is applied around the geometry's centroid (well, its bbox
    center, which is good enough at the scales we use for visual layout
    of flying-island insets).
    """
    coords = geom["coordinates"]

    # Compute bbox center for scaling pivot.
    flat: list[list[float]] = []

    def _walk(c: Any) -> None:
        if isinstance(c[0], (int, float)):
            flat.append(c)
        else:
            for sub in c:
                _walk(sub)

    _walk(coords)
    xs = [p[0] for p in flat]
    ys = [p[1] for p in flat]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    dx, dy = offset

    def _transform_point(p: list[float]) -> list[float]:
        # Scale around centroid first, then translate.
        x = (p[0] - cx) * scale + cx + dx
        y = (p[1] - cy) * scale + cy + dy
        return [x, y]

    def _transform_recursive(c: Any) -> Any:
        if isinstance(c[0], (int, float)):
            return _transform_point(c)
        return [_transform_recursive(sub) for sub in c]

    geom["coordinates"] = _transform_recursive(coords)
    return geom


def _bbox_contains(geom: dict, nw: list[float], se: list[float]) -> bool:
    """Whether the geometry's bbox is fully contained within the [nw, se] box."""
    xs: list[float] = []
    ys: list[float] = []

    def _walk(c: Any) -> None:
        if isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        else:
            for sub in c:
                _walk(sub)

    _walk(geom["coordinates"])
    if not xs:
        return False
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    # nw = (lon_west, lat_north); se = (lon_east, lat_south)
    return (
        x_min >= nw[0]
        and x_max <= se[0]
        and y_min >= se[1]
        and y_max <= nw[1]
    )


def apply_regional_aggregations(
    geo: dict,
    config: dict,
    worldview: str,
    simplify_pct: float = 5.0,
) -> list[Path]:
    """Build one dissolved GeoJSON per (country, region_set).

    For each region_set in the config:
      1. Filter Admin 1 features to the destination country
      2. Tag each with a derived `_region_code` (and `_region_name`)
         based on either an explicit_mapping or grouping_field
      3. Write to intermediate file; mapshaper -dissolve merges by
         `_region_code` in one pass
      4. Rename `_region_code` → `iso_3166_2`, `_region_name` → `name`
         on the dissolved output

    Returns list of output paths created.
    """
    countries = config.get("countries", {})
    if not countries:
        log("  regional_aggregations: nothing to apply (config empty)")
        return []

    outputs: list[Path] = []
    wv_label = worldview or "default"

    for country_a3, rules in countries.items():
        for set_name, set_def in rules.get("region_sets", {}).items():
            country_features = [
                f for f in geo["features"]
                if f["properties"].get("adm0_a3") == country_a3
            ]

            tagged: list[dict] = []
            if "explicit_mapping" in set_def:
                em = set_def["explicit_mapping"]
                # iso_3166_2 → (region_code, region_name)
                reverse: dict[str, tuple[str, str]] = {
                    member: (rcode, rdef["name"])
                    for rcode, rdef in em.items()
                    for member in rdef["members"]
                }
                for f in country_features:
                    iso = f["properties"].get("iso_3166_2")
                    if iso in reverse:
                        rcode, rname = reverse[iso]
                        # deep copy so we don't mutate the upstream geo
                        nf = json.loads(json.dumps(f))
                        nf["properties"]["_region_code"] = rcode
                        nf["properties"]["_region_name"] = rname
                        tagged.append(nf)
            elif "grouping_field" in set_def:
                gf = set_def["grouping_field"]
                for f in country_features:
                    val = f["properties"].get(gf)
                    if val:
                        nf = json.loads(json.dumps(f))
                        nf["properties"]["_region_code"] = str(val)
                        # display name same as code unless we add a separate
                        # display-name field later (e.g. region_cod_name on NE)
                        nf["properties"]["_region_name"] = str(val)
                        tagged.append(nf)
            else:
                log(f"    {country_a3}/{set_name}: no explicit_mapping or grouping_field — skipping")
                continue

            if not tagged:
                log(f"    {country_a3}/{set_name}: no features matched mapping — skipping")
                continue

            n_groups = len({f["properties"]["_region_code"] for f in tagged})

            inter = OUTPUT_DIR / f"_pre_dissolve_{country_a3}_{set_name}_{wv_label}.geo.json"
            inter.write_text(
                json.dumps({"type": "FeatureCollection", "features": tagged})
            )

            output = OUTPUT_DIR / f"regional_{country_a3}_{set_name}_{wv_label}.geo.json"
            subprocess.run(
                [
                    "npx", "--yes", "mapshaper",
                    str(inter),
                    "-dissolve", "_region_code",
                    "copy-fields=_region_name,adm0_a3",
                    "-simplify", f"{simplify_pct}%", "keep-shapes",
                    "-o", str(output), "format=geojson",
                ],
                check=True,
                stderr=subprocess.DEVNULL,
            )
            inter.unlink()

            # Rename derived fields → standard names on the dissolved output
            dissolved = json.loads(output.read_text())
            for f in dissolved["features"]:
                p = f["properties"]
                if "_region_code" in p:
                    p["iso_3166_2"] = p.pop("_region_code")
                if "_region_name" in p:
                    p["name"] = p.pop("_region_name")
            output.write_text(json.dumps(dissolved))

            log(
                f"    {country_a3}/{set_name}: {len(tagged)} subdivisions → "
                f"{n_groups} regions → {output.name} "
                f"({output.stat().st_size:,} bytes)"
            )
            outputs.append(output)

    return outputs


def apply_territory_assignments(
    geo: dict,
    config: dict,
    admin0_geo: dict,
) -> dict:
    """Pull features from sibling Admin 0 records into a destination country.

    Operates on Admin 1 outputs only — the use cases (China + SARs,
    Finland + Åland) all pull from Admin 0 records of one country and
    add them as single Admin 1 subdivisions of another.

    `admin0_geo` must already be loaded by the caller — passed in to
    avoid re-downloading.
    """
    countries = config.get("countries", {})
    if not countries:
        log("  territory_assignments: nothing to apply (config empty)")
        return geo

    n_added = 0
    for dest_a3, rules in countries.items():
        for entry in rules.get("additions", []):
            from_spec = entry["from"]
            source_a3 = from_spec["adm0_a3"]
            source_match = from_spec.get("match", {})

            for f in admin0_geo["features"]:
                p = f["properties"]
                if p.get("adm0_a3") != source_a3:
                    continue
                if source_match and not _matches(p, source_match):
                    continue

                # Deep copy; reattach to destination country
                new_feature = json.loads(json.dumps(f))
                new_feature["properties"]["adm0_a3"] = dest_a3
                if "set" in entry:
                    new_feature["properties"].update(entry["set"])
                geo["features"].append(new_feature)
                n_added += 1
                break  # take first match per addition entry

    log(f"  territory_assignments: added {n_added} features from sibling Admin 0 records")
    return geo


def apply_flying_islands(
    geo: dict,
    config: dict,
    country_a3: str | None,
    admin_level: int,
) -> dict:
    """Apply flying_islands.yaml transforms.

    For Admin 0 outputs, `country_a3` is None and we apply each country's
    rules to features matching that adm0_a3.

    For Admin 1 outputs (per-country), `country_a3` scopes the application
    to just that country's rules.
    """
    countries = config.get("countries", {})

    n_repos = 0
    n_dropped = 0

    for a3, rules in countries.items():
        if country_a3 is not None and a3 != country_a3:
            continue

        # Repositions
        for entry in rules.get("repositions", []):
            match = entry["match"]
            offset = entry["offset"]
            scale = entry.get("scale", 1.0)
            for f in geo["features"]:
                props = f["properties"]
                if props.get("adm0_a3") != a3:
                    continue
                if not _matches(props, match):
                    continue
                f["geometry"] = _translate_and_scale(
                    f["geometry"], offset=offset, scale=scale
                )
                n_repos += 1

        # Drop outside bbox — only meaningful at Admin 1 (where each
        # feature is a single subdivision). At Admin 0 a country's
        # multi-polygon often extends to overseas territories, so the
        # bbox check would drop entire countries.
        drop = rules.get("drop_outside_bbox") if admin_level == 1 else None
        if drop:
            nw, se = drop["nw"], drop["se"]
            kept: list[dict] = []
            for f in geo["features"]:
                if f["properties"].get("adm0_a3") != a3:
                    kept.append(f)
                    continue
                if _bbox_contains(f["geometry"], nw, se):
                    kept.append(f)
                else:
                    n_dropped += 1
            geo["features"] = kept

    log(
        f"  flying_islands: repositioned {n_repos} features, "
        f"dropped {n_dropped} (outside-bbox)"
    )
    return geo


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------


def build_one(
    worldview: str,
    admin_level: int,
    name_overrides: list[dict],
    flying_islands: dict,
    territory_assignments: dict,
    regional_aggregations: dict,
) -> Path:
    """Build one (worldview, admin_level) GeoJSON. Returns the output path."""
    log(f"\nBuilding worldview={worldview or 'default'} admin_level={admin_level}")
    shp = fetch_ne_shapefile(admin_level, worldview)
    raw = OUTPUT_DIR / f"_raw_{worldview or 'default'}_admin{admin_level}.geo.json"
    shp_to_geojson(shp, raw)

    geo = json.loads(raw.read_text())
    log(f"  loaded {len(geo['features'])} features")

    geo = apply_name_overrides(geo, name_overrides)
    geo = apply_flying_islands(geo, flying_islands, country_a3=None, admin_level=admin_level)

    # territory_assignments only makes sense at Admin 1 — the additions
    # (China+SARs, Finland+Åland) inject Admin-0-sized features as
    # single subdivisions of a destination country.
    if admin_level == 1 and territory_assignments.get("countries"):
        admin0_shp = fetch_ne_shapefile(0, worldview)
        admin0_path = OUTPUT_DIR / f"_admin0_for_assignments_{worldview or 'default'}.geo.json"
        if not admin0_path.exists():
            shp_to_geojson(admin0_shp, admin0_path)
        admin0_geo = json.loads(admin0_path.read_text())
        geo = apply_territory_assignments(geo, territory_assignments, admin0_geo)
        admin0_path.unlink(missing_ok=True)

    # regional_aggregations runs at Admin 1; emits its own per-(country,set)
    # output files separate from the main worldview output.
    if admin_level == 1:
        apply_regional_aggregations(geo, regional_aggregations, worldview)

    # TODO(future): composite_maps, procedural/

    # Write transformed GeoJSON to an intermediate path, then run
    # mapshaper -simplify into the final output. Two-stage approach so
    # the Python transforms work on full-resolution geometry.
    wv_label = worldview or "default"
    transformed = OUTPUT_DIR / f"_transformed_{wv_label}_admin{admin_level}.geo.json"
    transformed.write_text(json.dumps(geo))

    final = OUTPUT_DIR / f"{wv_label}_admin{admin_level}.geo.json"
    simplify_geojson(transformed, final, percentage=5.0)

    final_size = final.stat().st_size
    pre_size = transformed.stat().st_size
    reduction = 100 * (1 - final_size / pre_size) if pre_size else 0
    log(f"  wrote {final.name} ({final_size:,} bytes, "
        f"{len(geo['features'])} features, simplified -{reduction:.0f}%)")

    raw.unlink()
    transformed.unlink()
    return final


def main() -> int:
    OUTPUT_DIR.mkdir(exist_ok=True)

    log(f"Country Map build — pinned to NE {NE_PINNED_TAG} ({NE_PINNED_SHA[:8]})")

    # Load configs
    name_overrides = yaml.safe_load(
        (CONFIG_DIR / "name_overrides.yaml").read_text()
    )["overrides"]
    flying_islands = yaml.safe_load(
        (CONFIG_DIR / "flying_islands.yaml").read_text()
    )
    territory_assignments = yaml.safe_load(
        (CONFIG_DIR / "territory_assignments.yaml").read_text()
    )
    regional_aggregations = yaml.safe_load(
        (CONFIG_DIR / "regional_aggregations.yaml").read_text()
    )
    log(f"Loaded {len(name_overrides)} name override entries")
    log(f"Loaded flying_islands rules for {len(flying_islands.get('countries', {}))} countries")
    log(f"Loaded territory_assignments rules for "
        f"{len(territory_assignments.get('countries', {}))} countries")
    n_region_sets = sum(
        len(c.get("region_sets", {}))
        for c in regional_aggregations.get("countries", {}).values()
    )
    log(f"Loaded regional_aggregations: {n_region_sets} region-sets across "
        f"{len(regional_aggregations.get('countries', {}))} countries")

    # POC scope: UA worldview, both Admin 0 and Admin 1. Future commits
    # add more worldviews (Default, and other major NE worldviews).
    targets: list[tuple[str, int]] = [
        ("ukr", 0),
        ("ukr", 1),  # Admin 1 — exercises name_overrides + per-country fly-island rules
    ]

    for worldview, admin_level in targets:
        build_one(
            worldview,
            admin_level,
            name_overrides,
            flying_islands,
            territory_assignments,
            regional_aggregations,
        )

    log("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
