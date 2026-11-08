-- Function tile layers for pg_tileserv. etl/09_web_roles.py runs this before the grants.
--
-- core.roads as a plain table layer sends every street at every zoom: about 2.9 MB for one
-- zoom-10 tile around downtown, where the map only draws highways and major roads. This
-- function sends only the classes the basemap draws at each zoom (see web/src/map/basemap.js):
--
--   z <= 10   motorway, trunk, primary
--   z 11-12   + secondary, tertiary
--   z 13      + local
--   z >= 14   everything (service roads from 14, paths and tracks from 15)
--
-- pg_tileserv publishes any function taking (z, x, y integer) and returning bytea that the role
-- can execute; it is served at /core.roads_z/{z}/{x}/{y}.pbf.

CREATE OR REPLACE FUNCTION core.roads_z(z integer, x integer, y integer)
RETURNS bytea AS $$
    WITH env AS (
        SELECT ST_TileEnvelope(z, x, y) AS web,
               ST_Transform(ST_TileEnvelope(z, x, y, margin => 256.0 / 4096), 26915) AS utm
    ),
    rows AS (
        SELECT ST_AsMVTGeom(ST_Transform(r.geom, 3857), env.web, 4096, 64, true) AS geom,
               r.road_class
        FROM core.roads r, env
        WHERE r.geom && env.utm
          AND (z >= 14
               OR r.road_class IN ('motorway', 'trunk', 'primary')
               OR (z >= 11 AND r.road_class IN ('secondary', 'tertiary'))
               OR (z >= 13 AND r.road_class = 'local'))
    )
    SELECT ST_AsMVT(rows, 'core.roads_z') FROM rows WHERE geom IS NOT NULL;
$$ LANGUAGE sql STABLE PARALLEL SAFE;

COMMENT ON FUNCTION core.roads_z IS 'Roads by zoom: only the classes the basemap draws at each zoom.';

-- core.flood_display (FEMA zones merged by type) still carries survey-level detail: ~500 KB for
-- one zoom-9 tile. This function simplifies to about a quarter pixel at each zoom below 14 and
-- drops slivers smaller than a few pixels, so the low-zoom flood map loads fast. From zoom 14
-- the full geometry is sent. Served at /core.flood_z/{z}/{x}/{y}.pbf.
CREATE OR REPLACE FUNCTION core.flood_z(z integer, x integer, y integer)
RETURNS bytea AS $$
    WITH env AS (
        SELECT ST_TileEnvelope(z, x, y) AS web,
               ST_Transform(ST_TileEnvelope(z, x, y, margin => 64.0 / 4096), 26915) AS utm,
               40075016.7 / (2 ^ z) / 1024 AS px   -- meters per pixel on a 1024-px tile
    ),
    rows AS (
        SELECT ST_AsMVTGeom(
                   ST_Transform(CASE WHEN z >= 14 THEN f.geom
                                     ELSE ST_SimplifyPreserveTopology(f.geom, env.px) END, 3857),
                   env.web, 4096, 64, true) AS geom,
               f.flood_class, f.fld_zone, f.zone_subty
        FROM core.flood_display f, env
        WHERE f.geom && env.utm
          AND (z >= 14 OR ST_Area(f.geom) > 4 * env.px * env.px)
    )
    SELECT ST_AsMVT(rows, 'core.flood_z') FROM rows WHERE geom IS NOT NULL;
$$ LANGUAGE sql STABLE PARALLEL SAFE
   -- Runs as its owner so tiles_reader needn't read core.flood_display directly (which would
   -- also publish it as a second, unsimplified layer).
   SECURITY DEFINER SET search_path = core, public;
