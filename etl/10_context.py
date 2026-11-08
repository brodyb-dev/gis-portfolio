"""10 - Reference layers for the basemap: whole rivers, parks, place names and landmarks. Display only.

The analysis layers stop at the study boundary, and so did the basemap water. The county line
runs down the middle of the Mississippi and Missouri, so half of each river was drawn as blank
land. These layers give the maps context past the line.

They live in their own `basemap` schema, not `core`: they are cartographic context only, never
used in an analysis, and hydro_context deliberately extends past the study boundary, so they are
kept out of the `core` boundary QC (etl/qc_report.py lists them separately).

  basemap.hydro_context  river areas and lakes (NHD), clipped to a box ~15 km around the study
                         area instead of the boundary, so both banks of the big rivers show
  basemap.parks          OSM parks, nature reserves, golf courses and cemeteries, >= 1 ha
  basemap.places         OSM place names: municipalities (city/town/village) and neighborhoods
  basemap.landmarks      a short, hand-picked list of well-known features, located from OSM by name
  basemap.road_labels    highway route numbers and major street names, merged into long lines
  basemap.river_labels   hand-placed river name points
  core.flood_display     FEMA flood zones merged by type for fast map tiles (display only; it
                         stays in core because it is clipped like the flood zones it comes from)

Reads the cached Missouri extract from 02_osm (GDAL's OSM driver, no osm2pgsql run) and the raw
NHD tables from 06_hydro. Run 09_web_roles afterwards so pg_tileserv can read the new tables.
"""
from common import (RAW_DIR, SRID, connect, ensure_schemas, log, main_guard, ogr_to_pg, sql,
                    study_bbox_4326)

PBF = RAW_DIR / "missouri-latest.osm.pbf"
CONTEXT_BUFFER_M = 15000
BASEMAP_TABLES = ("hydro_context", "parks", "places", "landmarks", "road_labels", "river_labels")

# Landmarks: (label, kind, OSM name to look for, fallback lon, lat). The OSM match gives the
# true location (polygon interior point); the fallback is used only if the name isn't found.
LANDMARKS = [
    ("Gateway Arch", "monument", "Gateway Arch", -90.1848, 38.6247),
    ("Busch Stadium", "stadium", "Busch Stadium", -90.1928, 38.6226),
    ("Enterprise Center", "stadium", "Enterprise Center", -90.2026, 38.6268),
    ("Energizer Park", "stadium", "Energizer Park", -90.2107, 38.6312),
    ("Union Station", "landmark", "St. Louis Union Station", -90.2086, 38.6293),
    ("Old Courthouse", "landmark", "Old Courthouse", -90.1893, 38.6257),
    ("Forest Park", "park", "Forest Park", -90.2848, 38.6385),
    ("Saint Louis Zoo", "landmark", "Saint Louis Zoo", -90.2910, 38.6350),
    ("Tower Grove Park", "park", "Tower Grove Park", -90.2550, 38.6070),
    ("Missouri Botanical Garden", "landmark", "Missouri Botanical Garden", -90.2594, 38.6128),
    ("Saint Louis University", "university", "Saint Louis University", -90.2340, 38.6365),
    ("Washington University", "university", "Washington University in St. Louis", -90.3108, 38.6488),
    ("UMSL", "university", "University of Missouri - Saint Louis (UMSL)", -90.3110, 38.7090),
    ("Cathedral Basilica", "landmark", "Cathedral Basilica of Saint Louis", -90.2546, 38.6427),
    ("Lambert Airport", "airport", "St. Louis Lambert International Airport", -90.3700, 38.7487),
    ("Chain of Rocks Bridge", "landmark", "Old Chain of Rocks Bridge", -90.1760, 38.7600),
    ("Jefferson Barracks", "park", "Jefferson Barracks County Park", -90.2780, 38.5050),
    ("Creve Coeur Lake", "park", "Creve Coeur Lake Memorial Park", -90.4930, 38.7140),
    ("Laumeier Sculpture Park", "park", "Laumeier Sculpture Park", -90.4180, 38.5490),
]

# Labels for the rivers, placed by hand where the channel is wide and straight.
RIVERS = [
    ("Mississippi River", -90.1790, 38.6050),
    ("Mississippi River", -90.1450, 38.8000),
    ("Missouri River", -90.4500, 38.8250),
    ("Missouri River", -90.6450, 38.6950),
    ("Meramec River", -90.4600, 38.5150),
    ("River des Peres", -90.2620, 38.5640),
]


def main() -> None:
    conn = connect()
    ensure_schemas(conn)
    sql(conn, "CREATE SCHEMA IF NOT EXISTS basemap;")
    # Before the basemap schema existed these tables were built in core; drop any old copies.
    sql(conn, "".join(f"DROP TABLE IF EXISTS core.{t} CASCADE;" for t in BASEMAP_TABLES))
    if not PBF.exists():
        raise SystemExit(f"{PBF} is missing; run 02_osm first")
    xmin, ymin, xmax, ymax = study_bbox_4326(conn, buffer_m=1000)
    spat = ["-spat", str(xmin), str(ymin), str(xmax), str(ymax), "-spat_srs", "EPSG:4326",
            "-t_srs", f"EPSG:{SRID}", "--config", "OSM_USE_CUSTOM_INDEXING", "NO"]

    # Named polygons (parks, landmarks) and place/landmark points from the OSM extract.
    ogr_to_pg(str(PBF), "osm_context_polys", *spat, "-select",
              "osm_id,osm_way_id,name,leisure,landuse,tourism,amenity,aeroway,historic,building,"
              "man_made",
              "-where", "name IS NOT NULL OR leisure IS NOT NULL OR landuse = 'cemetery'",
              layer="multipolygons")
    ogr_to_pg(str(PBF), "osm_context_points", *spat, "-select", "osm_id,name,place,other_tags",
              "-where", "name IS NOT NULL", layer="points")
    ogr_to_pg(str(PBF), "osm_context_lines", *spat, "-select", "osm_id,name,highway,man_made,other_tags",
              "-where", "name IS NOT NULL AND (highway IS NULL OR man_made IS NOT NULL OR other_tags LIKE '%bridge%')",
              layer="lines")

    # Water past the study boundary. Raw NHD features are whole (06_hydro filters them by bbox,
    # not by clipping), so the big rivers are complete across the state line.
    sql(conn, f"""
        DROP TABLE IF EXISTS basemap.hydro_context CASCADE;
        CREATE TABLE basemap.hydro_context AS
        WITH box AS (SELECT ST_Envelope(ST_Buffer(geom, {CONTEXT_BUFFER_M})) AS g FROM core.study_boundary),
        src AS (
            SELECT 'river' AS kind, geom FROM raw.nhd_area
            UNION ALL
            SELECT CASE ftype WHEN 436 THEN 'reservoir' ELSE 'lake/pond' END, geom
            FROM raw.nhd_waterbody WHERE ftype IN (390, 436)
        )
        SELECT s.kind,
               (ST_Dump(ST_CollectionExtract(ST_Intersection(ST_MakeValid(s.geom), box.g), 3))).geom
                   ::geometry(Polygon, {SRID}) AS geom
        FROM src s, box WHERE ST_Intersects(s.geom, box.g);
        DELETE FROM basemap.hydro_context WHERE ST_Area(geom) < 1;
        ALTER TABLE basemap.hydro_context ADD COLUMN id bigserial PRIMARY KEY;
        CREATE INDEX ON basemap.hydro_context USING gist (geom);
        ANALYZE basemap.hydro_context;
    """)

    sql(conn, f"""
        DROP TABLE IF EXISTS basemap.parks CASCADE;
        CREATE TABLE basemap.parks AS
        WITH pieces AS (
            SELECT p.name,
                   CASE WHEN p.leisure = 'golf_course' THEN 'golf'
                        WHEN p.landuse = 'cemetery' OR p.amenity = 'grave_yard' THEN 'cemetery'
                        ELSE 'park' END AS kind,
                   (ST_Dump(ST_CollectionExtract(ST_Intersection(ST_MakeValid(p.geom), b.geom), 3))).geom
                       ::geometry(Polygon, {SRID}) AS geom
            FROM raw.osm_context_polys p
            JOIN core.study_boundary b ON ST_Intersects(p.geom, b.geom)
            WHERE p.leisure IN ('park', 'nature_reserve', 'golf_course')
               OR p.landuse = 'cemetery' OR p.amenity = 'grave_yard'
        )
        SELECT name, kind, round((ST_Area(geom) / 1e4)::numeric, 1) AS area_ha, geom
        FROM pieces WHERE ST_Area(geom) >= 10000;
        ALTER TABLE basemap.parks ADD COLUMN id bigserial PRIMARY KEY;
        CREATE INDEX ON basemap.parks USING gist (geom);
        ANALYZE basemap.parks;
    """)

    # Place names. Municipalities rank above neighborhoods so the map can thin labels by zoom.
    sql(conn, f"""
        DROP TABLE IF EXISTS basemap.places CASCADE;
        CREATE TABLE basemap.places AS
        SELECT DISTINCT ON (p.name, p.place) p.name, p.place,
               CASE p.place WHEN 'city' THEN 1 WHEN 'town' THEN 2 WHEN 'village' THEN 3
                            WHEN 'suburb' THEN 4 ELSE 5 END AS rank,
               ST_GeometryN(p.geom, 1)::geometry(Point, {SRID}) AS geom
        FROM raw.osm_context_points p
        JOIN core.study_boundary b ON ST_Intersects(p.geom, b.geom)
        WHERE p.place IN ('city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter')
        ORDER BY p.name, p.place, p.osm_id;
        ALTER TABLE basemap.places ADD COLUMN id bigserial PRIMARY KEY;
        CREATE INDEX ON basemap.places USING gist (geom);
        ANALYZE basemap.places;
    """)

    # Flood zones for display: FEMA's 6,000+ panel-cut polygons merged per zone type, then cut
    # into small pieces. Same areas, far fewer vertices and no internal panel edges, so the
    # flood map's tiles are a fraction of the size. Analyses still use core.flood_zones.
    sql(conn, f"""
        DROP TABLE IF EXISTS core.flood_display CASCADE;
        CREATE TABLE core.flood_display AS
        WITH merged AS (
            SELECT flood_class, fld_zone, zone_subty,
                   ST_SimplifyPreserveTopology(ST_Union(ST_MakeValid(geom)), 1) AS geom
            FROM core.flood_zones GROUP BY 1, 2, 3
        )
        SELECT flood_class, fld_zone, zone_subty,
               ST_Subdivide(ST_CollectionExtract(ST_MakeValid(geom), 3), 512)::geometry(Polygon, {SRID}) AS geom
        FROM merged;
        ALTER TABLE core.flood_display ADD COLUMN id bigserial PRIMARY KEY;
        CREATE INDEX ON core.flood_display USING gist (geom);
        ANALYZE core.flood_display;
    """)

    # Road labels: highways by route number and major streets by name, each merged into long
    # lines so a label can follow the road instead of repeating on every short OSM way.
    sql(conn, f"""
        DROP TABLE IF EXISTS basemap.road_labels CASCADE;
        CREATE TABLE basemap.road_labels AS
        WITH hw AS (
            SELECT CASE WHEN r LIKE 'I %' THEN 'interstate' WHEN r LIKE 'US %' THEN 'us'
                        ELSE 'state' END AS kind,
                   regexp_replace(regexp_replace(r, '^I ', 'I-'), '^MO ', 'MO-') AS label, geom
            FROM (SELECT trim(split_part(ref, ';', 1)) AS r, geom FROM core.roads
                  WHERE road_class IN ('motorway', 'trunk', 'primary') AND ref IS NOT NULL
                    AND NOT COALESCE(tunnel, false)) x
            WHERE r ~ '^(I|US|MO) [0-9]+'
        ),
        st AS (
            SELECT CASE WHEN road_class IN ('motorway', 'trunk', 'primary') THEN 'major'
                        ELSE 'minor' END AS kind, name AS label, geom
            FROM core.roads
            WHERE name IS NOT NULL AND road_class IN ('trunk', 'primary', 'secondary', 'tertiary')
        ),
        merged AS (
            SELECT kind, label, (ST_Dump(ST_LineMerge(ST_Collect(geom)))).geom AS geom
            FROM (SELECT * FROM hw UNION ALL SELECT * FROM st) a GROUP BY kind, label
        )
        SELECT kind, label, round(ST_Length(geom))::int AS length_m,
               ST_Simplify(geom, 5)::geometry(LineString, {SRID}) AS geom
        FROM merged WHERE ST_Length(geom) >= 400;
        ALTER TABLE basemap.road_labels ADD COLUMN id bigserial PRIMARY KEY;
        CREATE INDEX ON basemap.road_labels USING gist (geom);
        ANALYZE basemap.road_labels;
    """)

    # Landmarks: largest OSM polygon with the exact name, else a point, else the fallback.
    rows = []
    for label, kind, osm_name, lon, lat in LANDMARKS:
        hit = sql(conn, """
            SELECT ST_X(g), ST_Y(g), src FROM (
                SELECT ST_PointOnSurface(geom) AS g, 'polygon' AS src, ST_Area(geom) AS a
                FROM raw.osm_context_polys WHERE name = %(n)s
                UNION ALL
                SELECT ST_LineInterpolatePoint(ST_LineMerge(geom), 0.5), 'line', 0
                FROM raw.osm_context_lines WHERE name = %(n)s AND ST_NumGeometries(geom) = 1
                UNION ALL
                SELECT ST_GeometryN(geom, 1), 'point', -1 FROM raw.osm_context_points WHERE name = %(n)s
            ) s ORDER BY a DESC LIMIT 1""", {"n": osm_name})
        if hit:
            x, y, src = hit[0]
            rows.append((label, kind, src, f"SRID={SRID};POINT({x} {y})"))
        else:
            log(f"  landmark not found in OSM, using fallback: {osm_name}")
            rows.append((label, kind, "fallback", None, lon, lat))
    sql(conn, f"""
        DROP TABLE IF EXISTS basemap.landmarks CASCADE;
        CREATE TABLE basemap.landmarks (id serial PRIMARY KEY, name text, kind text, located_by text,
                                     geom geometry(Point, {SRID}));
        DROP TABLE IF EXISTS basemap.river_labels CASCADE;
        CREATE TABLE basemap.river_labels (id serial PRIMARY KEY, name text, geom geometry(Point, {SRID}));
    """)
    with conn.cursor() as cur:
        for r in rows:
            if r[2] == "fallback":
                cur.execute(f"INSERT INTO basemap.landmarks (name, kind, located_by, geom) VALUES "
                            f"(%s, %s, %s, ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), {SRID}))",
                            (r[0], r[1], r[2], r[4], r[5]))
            else:
                cur.execute("INSERT INTO basemap.landmarks (name, kind, located_by, geom) VALUES "
                            "(%s, %s, %s, %s::geometry)", r)
        for name, lon, lat in RIVERS:
            cur.execute(f"INSERT INTO basemap.river_labels (name, geom) VALUES "
                        f"(%s, ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), {SRID}))",
                        (name, lon, lat))
    conn.commit()

    for t in [f"basemap.{name}" for name in BASEMAP_TABLES] + ["core.flood_display"]:
        log(f"{t}: {sql(conn, f'SELECT count(*) FROM {t}')[0][0]} rows")
    log("places by type: " + ", ".join(f"{p} {n}" for p, n in sql(
        conn, "SELECT place, count(*) FROM basemap.places GROUP BY 1 ORDER BY 2 DESC")))
    log("landmarks located by: " + ", ".join(f"{s} {n}" for s, n in sql(
        conn, "SELECT located_by, count(*) FROM basemap.landmarks GROUP BY 1")))


if __name__ == "__main__":
    main_guard(main)
