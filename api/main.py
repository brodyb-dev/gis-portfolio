"""FastAPI app for the analyses the map pages can't get from vector tiles (M5).

    GET /isochrone              walk or drive time bands from a point, as GeoJSON (analysis 3)
    GET /stats/buildings        building density and character, City vs. County (analysis 1)
    GET /stats/transit-access   straight-line vs. network transit access (analysis 2)
    GET /stats/network          street network metrics and network QC counts (analysis 4)
    GET /stats/flood            flood exposure summary (analysis 5)

    GET /health                 database reachable?
    GET /docs                   interactive API docs (FastAPI's Swagger UI; /openapi.json too)

Map layers come from pg_tileserv (port 7800), not from here. Run with scripts/start.ps1, or:

    .venv\\Scripts\\python -m uvicorn api.main:app --port 8000

The app connects as the read-only api_reader role (API_DB_PASSWORD in .env, created by
etl/09_web_roles.py). Interactive docs are at http://localhost:8000/docs.
"""
from __future__ import annotations

import json
import os
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.conninfo import make_conninfo
from psycopg_pool import ConnectionPool

REPO = Path(__file__).resolve().parent.parent
load_dotenv(REPO / ".env")

# Longest band allowed per mode. A 30-minute drive already reaches most of the study area.
MAX_MINUTES = {"walk": 60, "drive": 30}
MAX_BANDS = 6
CACHE_SIZE = 256
# A click farther than this from the routing network is refused rather than silently snapped to
# a distant street (about 1/4 mile).
MAX_SNAP_M = 400
ORIGINS = os.getenv("WEB_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")


def _conninfo() -> str:
    password = os.getenv("API_DB_PASSWORD")
    if not password:
        raise RuntimeError("API_DB_PASSWORD is not set; run etl/09_web_roles.py first")
    # make_conninfo quotes and escapes each value, so a password with spaces or quotes still works.
    return make_conninfo(host=os.getenv("PGHOST", "localhost"), port=os.getenv("PGPORT", "5432"),
                         dbname=os.getenv("PGDATABASE", "stl_gis"), user="api_reader",
                         password=password, application_name="gis-portfolio-api")


pool: ConnectionPool | None = None
_static: dict = {}  # summary numbers; they only change when the ETL reruns


@asynccontextmanager
async def lifespan(_: FastAPI):
    global pool
    pool = ConnectionPool(_conninfo(), min_size=1, max_size=6, open=True,
                          kwargs={"autocommit": True})
    try:
        yield
    finally:
        pool.close()


app = FastAPI(title="Gateway Atlas API", version="0.7.0", lifespan=lifespan,
              description="Live isochrones and summary statistics for the St. Louis City + "
                          "County GIS portfolio. Map layers are served by pg_tileserv.")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET"],
                   allow_headers=["*"])


def query(statement: str, params=None) -> list[tuple]:
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(statement, params)
        return cur.fetchall()


def study_bbox() -> tuple[float, float, float, float]:
    if "bbox" not in _static:
        row = query("""
            SELECT ST_XMin(b), ST_YMin(b), ST_XMax(b), ST_YMax(b)
            FROM (SELECT ST_Transform(geom, 4326)::box2d AS b FROM core.study_boundary) s""")[0]
        _static["bbox"] = tuple(float(v) for v in row)
    return _static["bbox"]


# --- isochrones ---------------------------------------------------------------------------
class _LRU(OrderedDict):
    """A small thread-safe cache of isochrone responses, keyed by snapped start vertex."""

    def __init__(self, size: int):
        super().__init__()
        self.size, self.lock = size, Lock()

    def get_item(self, key):
        with self.lock:
            if key in self:
                self.move_to_end(key)
                return self[key]
        return None

    def put(self, key, value):
        with self.lock:
            self[key] = value
            self.move_to_end(key)
            while len(self) > self.size:
                self.popitem(last=False)


_iso_cache = _LRU(CACHE_SIZE)


def _parse_minutes(text: str, mode: str) -> list[int]:
    try:
        minutes = sorted({int(m) for m in text.split(",") if m.strip()})
    except ValueError:
        raise HTTPException(422, "minutes must be a comma-separated list of whole numbers")
    if not minutes or len(minutes) > MAX_BANDS:
        raise HTTPException(422, f"give between 1 and {MAX_BANDS} bands")
    if minutes[0] < 1 or minutes[-1] > MAX_MINUTES[mode]:
        raise HTTPException(422, f"{mode} bands must be 1 to {MAX_MINUTES[mode]} minutes")
    return minutes


# One round trip that answers three questions about a click:
#   inside    is it inside the study area?
#   street_m  how far is the nearest street of the main walk/drive network (any point on it)?
#   n         the nearest network vertex, where the isochrone actually starts.
# street_m is measured to the street rather than the vertex so that a click beside a long road
# isn't refused just because the road's intersections are far apart.
SNAP_SQL = """
    WITH p AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), 26915)
                      AS geom)
    SELECT EXISTS (SELECT 1 FROM core.study_boundary b WHERE ST_Intersects(b.geom, p.geom))
               AS inside,
           (SELECT ST_Distance(e.geom, p.geom)
            FROM net.edges e JOIN net.vertices v ON v.id = e.source
            WHERE CASE WHEN %(mode)s = 'walk' THEN e.walkable AND v.in_walk_main
                       ELSE e.drivable AND v.in_drive_main END
            ORDER BY e.geom <-> p.geom LIMIT 1) AS street_m,
           n.id, ST_X(g), ST_Y(g), ST_Distance(n.geom, p.geom) AS snap_m
    FROM p
    CROSS JOIN LATERAL (
        SELECT id, geom FROM net.vertices v
        WHERE CASE WHEN %(mode)s = 'walk' THEN v.in_walk_main ELSE v.in_drive_main END
        ORDER BY v.geom <-> p.geom LIMIT 1) n
    CROSS JOIN LATERAL ST_Transform(n.geom, 4326) g"""
OUTSIDE_MSG = "Pick a point inside St. Louis City or County"
TOO_FAR_MSG = "No street within ¼ mile of that point — try clicking closer to a road"


@app.get("/isochrone", summary="Walk or drive time bands from a point")
def isochrone(lon: float = Query(..., description="Start longitude (WGS 84)"),
              lat: float = Query(..., description="Start latitude (WGS 84)"),
              mode: Literal["walk", "drive"] = "walk",
              minutes: str = Query("5,10,15", description="Comma-separated band limits")):
    """Returns a GeoJSON FeatureCollection with one polygon per band, largest first so the
    smaller bands draw on top. The start snaps to the nearest vertex of the main walk or drive
    network; `start` gives that snapped point. Drive times are free-flow (no traffic).

    Returns 400 if the point is outside St. Louis City + County, or more than 400 m from the
    nearest street of the network."""
    bands = _parse_minutes(minutes, mode)
    # Cheap prefilter: the bounding box, no database call. The real test is the boundary below.
    xmin, ymin, xmax, ymax = study_bbox()
    if not (xmin <= lon <= xmax and ymin <= lat <= ymax):
        raise HTTPException(400, OUTSIDE_MSG)

    t = time.perf_counter()
    inside, street_m, vertex, slon, slat, snap_m = query(
        SNAP_SQL, {"lon": lon, "lat": lat, "mode": mode})[0]
    if not inside:
        raise HTTPException(400, OUTSIDE_MSG)
    if street_m is None or street_m > MAX_SNAP_M:
        raise HTTPException(400, TOO_FAR_MSG)
    key = (mode, vertex, tuple(bands))
    cached = _iso_cache.get_item(key)
    if cached is None:
        rows = query("""
            SELECT band_minutes, reached_vertices, area_km2, ST_AsGeoJSON(geom, 6)
            FROM analysis.isochrones(%s, %s, %s, %s) ORDER BY band_minutes DESC""",
                     (slon, slat, mode, bands))
        features = [{"type": "Feature", "geometry": json.loads(g),
                     "properties": {"mode": mode, "minutes": m, "area_km2": round(a, 3),
                                    "reached_vertices": n}}
                    for m, n, a, g in rows]
        cached = features
        _iso_cache.put(key, features)
        from_cache = False
    else:
        from_cache = True
    return {"type": "FeatureCollection", "features": cached,
            "start": {"type": "Point", "coordinates": [round(slon, 6), round(slat, 6)]},
            "snap_distance_m": round(snap_m, 1), "mode": mode, "minutes": bands,
            "elapsed_ms": round((time.perf_counter() - t) * 1000), "cached": from_cache}


# --- summary statistics -------------------------------------------------------------------
@app.get("/stats/flood", summary="Flood exposure summary (analysis 5)")
def stats_flood():
    """Buildings, road miles and transit exposed in each FEMA zone. Road miles count streets
    (no highway=service driveways or parking aisles) and leave out bridges; the 500-yr row
    includes the 100-yr zone."""
    if "flood" not in _static:
        rows = query("""
            SELECT label, buildings, road_miles, transit_stops, transit_routes, route_miles
            FROM analysis.flood_summary ORDER BY sort""")
        _static["flood"] = {"zones": [
            {"zone": z, "buildings": b, "road_miles": round(r, 1), "transit_stops": s,
             "transit_routes": n, "transit_route_miles": round(m, 1)}
            for z, b, r, s, n, m in rows]}
    return _static["flood"]


@app.get("/stats/transit-access", summary="Transit walk access, two ways (analysis 2)")
def stats_transit_access():
    """Share of buildings within 1/4 and 1/2 mile of a stop with weekday service, measured by
    straight-line buffer and by walking the street network, and how much the buffer overstates."""
    if "transit" not in _static:
        rows = query("""
            SELECT label, meters, buildings_straight_line, buildings_network, buildings_total,
                   pct_straight_line, pct_network, pct_overstated
            FROM analysis.transit_access_summary ORDER BY meters""")
        detour, med_net, med_eucl = query("""
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY net_m / eucl_m),
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY net_m),
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY eucl_m)
            FROM analysis.building_transit WHERE eucl_m > 50""")[0]
        _static["transit"] = {
            "distances": [
                {"label": l, "meters": round(float(m), 1), "buildings_total": t,
                 "straight_line": {"buildings": s, "pct": round(float(ps), 1)},
                 "network": {"buildings": n, "pct": round(float(pn), 1)},
                 "pct_overstated": round(float(po), 1)}
                for l, m, s, n, t, ps, pn, po in rows],
            "median_detour_ratio": round(float(detour), 2),
            "median_walk_m": round(float(med_net)), "median_straight_line_m": round(float(med_eucl))}
    return _static["transit"]


@app.get("/stats/buildings", summary="Building density and character (analysis 1)")
def stats_buildings():
    """Buildings, density, footprint coverage and median height for the City and the County,
    from the 500 m hexagons (a hex counts toward the area holding its interior point)."""
    if "buildings" not in _static:
        rows = query("""
            SELECT c.namelsad, count(*), sum(bldg_count), sum(bldg_count) / sum(area_km2),
                   100 * sum(footprint_m2) / (sum(area_km2) * 1e6),
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY median_height_m)
            FROM analysis.hex_buildings x
            JOIN LATERAL (SELECT c.namelsad FROM core.counties c
                          WHERE ST_Intersects(c.geom, ST_PointOnSurface(x.geom))
                          ORDER BY c.namelsad LIMIT 1) c ON true
            GROUP BY 1 ORDER BY 1""")
        _static["buildings"] = {"areas": [
            {"area": a, "hexes": h, "buildings": int(b), "buildings_per_km2": round(d),
             "coverage_pct": round(cv, 1), "median_height_m": round(mh, 1)}
            for a, h, b, d, cv, mh in rows]}
    return _static["buildings"]


@app.get("/stats/network", summary="Street network metrics and QC findings (analysis 4)")
def stats_network():
    """Study-wide street metrics plus counts of the network QC findings (the qc.net_* layers):
    dead ends, near misses, crossings with no shared node, duplicated ways, islands and
    one-way traps."""
    if "network" not in _static:
        (inter, dead, area, km), = query("""
            SELECT sum(intersections), sum(dead_ends), sum(area_km2), sum(street_km)
            FROM analysis.hex_network""")
        # Near misses leave out dead ends cut by the study boundary, as docs/network-qc.md does.
        (dead_ends, near, boundary), = query("""
            SELECT count(*), count(*) FILTER (WHERE near_miss_m IS NOT NULL AND NOT at_boundary),
                   count(*) FILTER (WHERE at_boundary) FROM qc.net_dead_ends""")
        crossings = dict(query("SELECT kind, count(*) FROM qc.net_unnoded_crossings GROUP BY 1"))
        (overlaps, overlap_m), = query(
            "SELECT count(*), COALESCE(sum(overlap_m), 0) FROM qc.net_overlaps")
        islands = {m: {"count": n, "km": round(l / 1000, 1)}
                   for m, n, l in query("""SELECT mode, count(*), sum(length_m)
                                           FROM qc.net_islands GROUP BY 1""")}
        traps, = query("SELECT count(*) FROM qc.net_oneway_traps")[0]
        _static["network"] = {
            "metrics": {"intersections": int(inter), "dead_ends": int(dead),
                        "intersections_per_km2": round(inter / area, 1),
                        "dead_end_share_pct": round(100 * dead / (inter + dead), 1),
                        "street_km": round(km), "street_km_per_km2": round(km / area, 1)},
            "qc": {"dead_ends": dead_ends, "near_misses": near, "at_boundary": boundary,
                   "unnoded_crossings": sum(crossings.values()),
                   "unnoded_crossings_by_kind": crossings,
                   "overlaps": overlaps, "overlap_m": round(overlap_m),
                   "islands": islands, "oneway_traps": traps}}
    return _static["network"]


@app.get("/health", summary="Is the database reachable?")
def health():
    try:
        ok = query("SELECT 1")[0][0] == 1
    except Exception as e:  # report, don't crash the health check
        raise HTTPException(503, f"database unavailable: {type(e).__name__}")
    return {"status": "ok" if ok else "error"}
