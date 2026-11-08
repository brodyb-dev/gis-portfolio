-- Read-only roles for the web services (M5). etl/09_web_roles.py runs this after creating the
-- roles with passwords from .env.
--
--   tiles_reader  pg_tileserv connects as this role. pg_tileserv publishes every table it can
--                 read, so the grants below ARE the list of published map layers.
--   api_reader    The FastAPI app. It reads the network and the summary views and runs
--                 analysis.isochrones(); it publishes nothing on its own.
--
-- Both roles start from nothing: no access to raw, no write access anywhere.

REVOKE ALL ON SCHEMA public FROM tiles_reader, api_reader;
-- Start each run from no table access, so a layer dropped from the list below is unpublished.
REVOKE ALL ON ALL TABLES IN SCHEMA core, analysis, net FROM tiles_reader, api_reader;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'qc') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA qc FROM tiles_reader, api_reader;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO tiles_reader, api_reader;  -- PostGIS and pgRouting live here

-- Map layers ---------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA core, analysis, qc TO tiles_reader;
GRANT SELECT ON
    core.study_boundary, core.counties, core.buildings, core.roads, core.rail_lines,
    core.transit_stops, core.transit_routes, core.flood_zones, core.hydro_areas,
    core.hydro_lines, core.hydro_context, core.parks, core.places, core.landmarks,
    core.road_labels, core.river_labels,
    analysis.hex_buildings, analysis.hex_network, analysis.hex_transit,
    analysis.building_transit, analysis.flood_buildings, analysis.flood_roads,
    analysis.flood_stops,
    qc.net_dead_ends, qc.net_unnoded_crossings, qc.net_overlaps, qc.net_islands,
    qc.net_oneway_traps
TO tiles_reader;
-- Function layers (02_tile_functions.sql).
REVOKE ALL ON FUNCTION core.roads_z(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.roads_z(integer, integer, integer) TO tiles_reader;
REVOKE ALL ON FUNCTION core.flood_z(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.flood_z(integer, integer, integer) TO tiles_reader;

-- API ----------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA core, analysis, net, qc TO api_reader;
GRANT SELECT ON net.edges, net.vertices, core.study_boundary,
    analysis.transit_access_summary, analysis.flood_summary, analysis.building_transit,
    analysis.hex_network, analysis.hex_buildings, core.counties,
    qc.net_dead_ends, qc.net_unnoded_crossings, qc.net_overlaps, qc.net_islands,
    qc.net_oneway_traps
TO api_reader;
GRANT EXECUTE ON FUNCTION analysis.isochrones(float8, float8, text, int[]) TO api_reader;

-- Keep a runaway request from tying up the database.
ALTER ROLE tiles_reader SET statement_timeout = '15s';
ALTER ROLE api_reader SET statement_timeout = '15s';
