# Serving Check

Generated 2026-11-07 19:50 by `scripts/m5_verify.py` against the services started by `scripts/start.ps1` (pg_tileserv at http://127.0.0.1:7800, API at http://127.0.0.1:8000).

## Checks

| Check | Value | Result |
|---|---|---|
| pg_tileserv publishes exactly the planned layers | 30 of 30; missing none, extra none | PASS |
| Every layer returns a non-empty tile | 30 of 30 | PASS |
| Every sample tile renders in under 2 s | slowest 0.58 s | PASS |
| pg_tileserv allows the website origin (CORS) | http://localhost:5173 | PASS |
| API health | 200 ok | PASS |
| /stats/flood has buildings and road miles for the 100-yr and 500-yr zones (criterion 7) | 100-yr: 6,680 bldgs, 169.9 mi, 500-yr (includes 100-yr): 13,267 bldgs, 284.0 mi, Behind levee: 2,680 bldgs, 140.5 mi | PASS |
| /stats/transit-access has both measures and the difference (criterion 6) | 1/4 mile: 42.5% vs. 28.9% (+32.1%); 1/2 mile: 65.1% vs. 52.1% (+20.1%) | PASS |
| /stats/buildings and /stats/network return the City and County metrics and QC counts | 500,066 buildings in 2 areas; 48,417 intersections; 1,962 near misses | PASS |
| Isochrones return 3 nested polygons at every test point | 10 of 10 | PASS |
| 15-min walk isochrone over HTTP in under 3 s (criterion 5) | slowest 0.22 s over 5 uncached calls | PASS |
| A repeated drive request is served from the cache | cached=True, 8 ms | PASS |
| Bad isochrone requests get a clear 4xx error | outside the study area: 400, East St. Louis, IL (inside bbox, outside counties): 400, more than 400 m from a street: 400, unknown mode: 422, drive longer than 30 min: 422, non-numeric minutes: 422 | PASS |
| API allows the website origin (CORS) | http://localhost:5173 | PASS |
| `tiles_reader` is read-only and can't see raw data | 3 of 3 write/raw probes denied | PASS |
| `api_reader` is read-only and can't see raw data | 3 of 3 write/raw probes denied | PASS |

**15 of 15 checks pass.**

## Vector tile layers (pg_tileserv)

One sample tile per layer over downtown St. Louis (flood buildings over the River des Peres in University City). Dense layers are tested at zoom 14, where the web maps start drawing them.

| Layer | Tile z/x/y | HTTP | KB | Seconds |
|---|---|---|---|---|
| `analysis.building_transit` | 14/4087/6283 | 200 | 36 | 0.08 |
| `analysis.flood_buildings` | 14/4081/6281 | 200 | 24 | 0.03 |
| `analysis.flood_roads` | 10/255/392 | 200 | 292 | 0.05 |
| `analysis.flood_stops` | 10/255/392 | 200 | 10 | 0.01 |
| `analysis.hex_buildings` | 10/255/392 | 200 | 283 | 0.15 |
| `analysis.hex_network` | 10/255/392 | 200 | 192 | 0.15 |
| `analysis.hex_transit` | 10/255/392 | 200 | 193 | 0.15 |
| `basemap.hydro_context` | 10/255/392 | 200 | 36 | 0.11 |
| `basemap.landmarks` | 10/255/392 | 200 | 1 | 0.01 |
| `basemap.parks` | 10/255/392 | 200 | 26 | 0.04 |
| `basemap.places` | 10/255/392 | 200 | 6 | 0.00 |
| `basemap.river_labels` | 10/255/392 | 200 | 0 | 0.00 |
| `basemap.road_labels` | 10/255/392 | 200 | 42 | 0.01 |
| `core.buildings` | 14/4087/6283 | 200 | 59 | 0.05 |
| `core.counties` | 10/255/392 | 200 | 2 | 0.01 |
| `core.flood_z` | 10/255/392 | 200 | 33 | 0.32 |
| `core.flood_zones` | 10/255/392 | 200 | 256 | 0.58 |
| `core.hydro_areas` | 10/255/392 | 200 | 18 | 0.04 |
| `core.hydro_lines` | 10/255/392 | 200 | 31 | 0.01 |
| `core.rail_lines` | 10/255/392 | 200 | 74 | 0.02 |
| `core.roads` | 14/4087/6283 | 200 | 285 | 0.08 |
| `core.roads_z` | 10/255/392 | 200 | 111 | 0.07 |
| `core.study_boundary` | 10/255/392 | 200 | 0 | 0.01 |
| `core.transit_routes` | 10/255/392 | 200 | 30 | 0.02 |
| `core.transit_stops` | 10/255/392 | 200 | 204 | 0.03 |
| `qc.net_dead_ends` | 10/255/392 | 200 | 707 | 0.10 |
| `qc.net_islands` | 10/255/392 | 200 | 38 | 0.03 |
| `qc.net_oneway_traps` | 10/255/392 | 200 | 12 | 0.01 |
| `qc.net_overlaps` | 10/255/392 | 200 | 0 | 0.02 |
| `qc.net_unnoded_crossings` | 10/255/392 | 200 | 1 | 0.00 |

Tile URL pattern: `http://localhost:7800/{layer}/{z}/{x}/{y}.pbf`. Layer metadata (properties, bounds) is at `/{layer}.json`.

## Isochrones (API)

`GET /isochrone?lon=..&lat=..&mode=walk|drive&minutes=5,10,15`. Seconds are measured by this script over HTTP and include JSON encoding. The API caches the last 256 responses by snapped start vertex.

| Start | Mode | Seconds | Cached | Snap m | 5 min km² | 10 min km² | 15 min km² | Shape |
|---|---|---|---|---|---|---|---|---|
| Downtown St. Louis | walk | 0.22 | no | 8.5 | 0.292 | 1.287 | 2.997 | ok |
| Downtown St. Louis | drive | 2.59 | no | 14.8 | 29.314 | 129.198 | 334.186 | ok |
| Central West End | walk | 0.06 | no | 47.8 | 0.251 | 1.234 | 2.767 | ok |
| Central West End | drive | 2.97 | no | 47.8 | 39.069 | 201.693 | 445.929 | ok |
| Clayton | walk | 0.04 | no | 78.1 | 0.088 | 0.459 | 1.882 | ok |
| Clayton | drive | 3.46 | no | 78.1 | 37.225 | 204.231 | 557.256 | ok |
| Florissant | walk | 0.02 | no | 20.1 | 0.255 | 1.069 | 2.576 | ok |
| Florissant | drive | 2.53 | no | 20.1 | 44.175 | 217.354 | 437.09 | ok |
| Kirkwood | walk | 0.03 | no | 13.8 | 0.247 | 1.133 | 2.558 | ok |
| Kirkwood | drive | 3.08 | no | 13.8 | 37.45 | 222.288 | 577.489 | ok |

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /isochrone` | GeoJSON FeatureCollection, one polygon per band (largest first), plus the snapped `start` point |
| `GET /stats/flood` | Buildings, road miles and transit exposed per FEMA zone |
| `GET /stats/transit-access` | Straight-line vs. network access at 1/4 and 1/2 mile, and the median detour ratio |
| `GET /stats/buildings` | Buildings, density, coverage and median height for City and County |
| `GET /stats/network` | Street network metrics and network QC finding counts |
| `GET /health` | `{"status": "ok"}` when the database answers |
| `GET /docs` | Interactive API docs (FastAPI) |

