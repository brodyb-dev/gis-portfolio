# Data QC

Generated 2026-11-07 19:47 by `etl/qc_report.py` (checks in `db/qc/qc_functions.sql`).

## Core tables

Every `core` table must have rows, valid non-empty geometry in EPSG:26915, and no features outside the study boundary (by interior point, 1 m tolerance).

| Table | Rows | Geometry | SRID | Null | Empty | Invalid | Outside | Result |
|---|--:|---|---|--:|--:|--:|--:|---|
| `core.buildings` | 500,066 | MULTIPOLYGON | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.counties` | 2 | MULTIPOLYGON | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.flood_display` | 6,833 | POLYGON | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.flood_zones` | 6,386 | POLYGON | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.hydro_areas` | 972 | POLYGON | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.hydro_lines` | 2,102 | LINESTRING | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.osm_transit` | 3,044 | POINT | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.rail_lines` | 1,719 | LINESTRING | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.roads` | 198,208 | LINESTRING | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.study_boundary` | 1 | MULTIPOLYGON | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.transit_routes` | 45 | MULTILINESTRING | 26915 | 0 | 0 | 0 | 0 | PASS |
| `core.transit_stops` | 3,716 | POINT | 26915 | 0 | 0 | 0 | 0 | PASS |

**12 of 12 core tables pass.**

## Basemap tables (display only)

The `basemap` schema holds reference layers built by `etl/10_context.py` for the maps only:
river and lake polygons, parks, place names, landmarks, and road and river labels. They are
cartographic context and are never used in an analysis. `basemap.hydro_context` extends about
15 km past the study boundary on purpose, so both banks of the Mississippi and Missouri are
drawn. These tables get the same row, geometry and SRID checks, but the boundary test isn't
applied. The Outside column is shown for information only.

| Table | Rows | Geometry | SRID | Null | Empty | Invalid | Outside | Result |
|---|--:|---|---|--:|--:|--:|--:|---|
| `basemap.hydro_context` | 2,279 | POLYGON | 26915 | 0 | 0 | 0 | 1346 | PASS |
| `basemap.landmarks` | 19 | POINT | 26915 | 0 | 0 | 0 | 0 | PASS |
| `basemap.parks` | 471 | POLYGON | 26915 | 0 | 0 | 0 | 0 | PASS |
| `basemap.places` | 183 | POINT | 26915 | 0 | 0 | 0 | 0 | PASS |
| `basemap.river_labels` | 6 | POINT | 26915 | 0 | 0 | 0 | 3 | PASS |
| `basemap.road_labels` | 1,310 | LINESTRING | 26915 | 0 | 0 | 0 | 0 | PASS |

**6 of 6 basemap tables pass.**

## Key facts

| Check | Value |
|---|---|
| Study area | 1528 km2 |
| Buildings with a height value | 94.3% |
| Buildings by source | Microsoft ML Buildings 395383, OpenStreetMap 104683 |
| Road network length (km, all classes) | 25867 |
| Walkable / drivable ways | 193429 / 113992 |
| GTFS feed service dates | 20261102 to 20261129 |
| GTFS sample weekday (stop departures, route weekday_trips) | 2026-11-11 (Wed) |
| Weekday trips per route (min / median / max) | 24 / 60 / 168 |
| Transit stops with weekday service | 3716 of 3716 |
| Flood zone area by class (km2) | 100-yr 232.7, 500-yr 27.9, levee 53.0 |
| Flood zones as % of land, river channels excluded | 100-yr 13.0, 500-yr 1.9, all zones 18.4, levee 3.6 |

## Notes
- **Clipping.** Lines and polygons in `core` are cut at the study boundary. Buildings are the
  exception: they're kept whole and assigned by an interior point (`ST_PointOnSurface`), so a
  footprint on the county line is counted once and never split. The `basemap` reference layers
  are not part of this rule (see above).
- **Datum shift.** osm2pgsql (PROJ 9) had no NAD83 grid file, so OSM data was transformed with
  PROJ's fallback WGS84 to NAD83 operation, accurate to about 1 m. Other sources were
  transformed by GDAL/PostGIS. Differences are about 1 m, which is below the analyses' resolution.
- **FEMA geometry.** NFHL polygons were requested with ~1 m server-side generalization
  (`maxAllowableOffset` 0.00001 degrees) so the service would not time out on river polygons.
- **Flood classes.** FEMA's 100-yr and 500-yr zones don't overlap. "500-yr exposure" in the
  analyses means 100-yr + 500-yr. `levee` is Zone X behind a levee (accredited or not).
- **GTFS departures** (per stop) and `weekday_trips` (per route, both directions) count trips
  on one sample Wednesday (the first Wednesday at least 7 days into the feed), so overlapping
  service periods are not double-counted. Metro codes MetroLink as route_type 2; it's labeled
  `rail`.
- **NHD** came from the USGS staged HUC8 GeoPackages (the NHD map service was returning 504s).
  The load checks that the HUC8 outlines cover the whole study area.
