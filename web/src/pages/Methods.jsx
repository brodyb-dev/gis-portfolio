import { repoFile, REPO_URL } from '../config.js';

// When each source was captured. Update these when the data is refreshed.
const DATE_TIGER = '2024';
const DATE_OSM = 'Extract of Nov 1, 2026';
const DATE_OVERTURE = 'Release 2026-10-21.0 (downloaded Nov 2, 2026)';
const DATE_GTFS = 'Downloaded Nov 2, 2026; service Nov 2–29, 2026; sample weekday Wed, Nov 11';
const DATE_NFHL = 'Pulled Nov 2, 2026';
const DATE_NHD = 'Downloaded Nov 2, 2026';

// [layer, source, license, date, loader script]
const SOURCES = [
  ['Boundaries', 'U.S. Census Bureau TIGER/Line counties, 2024', 'Public domain', DATE_TIGER, 'etl/01_boundaries.py'],
  ['Roads, paths, rail', 'OpenStreetMap via Geofabrik (Missouri extract), loaded with osm2pgsql', 'ODbL', DATE_OSM, 'etl/02_osm.py'],
  ['Buildings', 'Overture Maps Foundation buildings theme (footprints and heights)', 'ODbL', DATE_OVERTURE, 'etl/03_buildings.py'],
  ['Transit', 'Metro St. Louis GTFS feed (stops, routes, one sample weekday of departures)', 'Metro open data terms', DATE_GTFS, 'etl/04_gtfs.py'],
  ['Flood zones', 'FEMA National Flood Hazard Layer (map service, layer 28)', 'Public domain', DATE_NFHL, 'etl/05_flood.py'],
  ['Water', 'USGS National Hydrography Dataset (HUC8 GeoPackages)', 'Public domain', DATE_NHD, 'etl/06_hydro.py'],
  ['Basemap reference: parks, place names, landmarks, whole rivers', 'OpenStreetMap (same extract, read with GDAL) and USGS NHD', 'ODbL / public domain', 'OSM extract of Nov 1, 2026; NHD downloaded Nov 2, 2026', 'etl/10_context.py'],
  ['Label font', 'Noto Sans glyphs (Protomaps basemaps-assets)', 'SIL Open Font License', '—', 'web/public/fonts/README.md'],
];
const SOURCE_COLUMNS = ['Layer', 'Source', 'License', 'Data date', 'Loader'];

const ANALYSES = [
  ['Hexagon grid', 'db/analysis/01_hex_grid.sql'],
  ['Building density and character', 'db/analysis/02_building_density.sql'],
  ['Street network metrics', 'db/analysis/03_network_metrics.sql'],
  ['Transit walk access (network vs. straight line)', 'db/analysis/04_transit_access.sql'],
  ['Isochrones', 'db/analysis/05_isochrones.sql'],
  ['Flood exposure', 'db/analysis/06_flood_exposure.sql'],
];

/** "etl/08_analyses.py" -> ["etl", "/", <wbr />, "08_analyses.py"]: a line may break after a slash, never inside a name. */
const withSlashBreaks = (path) => path.split('/').flatMap((part, i) => (i === 0 ? [part] : ['/', <wbr key={i} />, part]));

const File = ({ path }) => (
  <a href={repoFile(path)} target="_blank" rel="noreferrer"><code>{withSlashBreaks(path)}</code></a>
);

export default function Methods() {
  return (
    <article className="prose">
      <h1>Methods</h1>
      <p className="lede">
        Everything on this site is built from public data with open-source tools, and all of it is reproducible:
        one script rebuilds the database from scratch, and every analysis is plain SQL in the <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub repository</a>.
      </p>

      <h2>Study area and projection</h2>
      <p>
        St. Louis City and St. Louis County, Missouri (FIPS 29510 and 29189), about 590 square miles. Every analysis layer is clipped to
        this boundary. The basemap context layers (rivers, parks, place and road labels) extend past it for cartography only and
        aren't used in any analysis. Everything is stored in <strong>NAD83 / UTM zone 15N (EPSG:26915)</strong>, so distances and areas are measured in true meters. The site converts them to miles, feet and square miles for display.
        Layers are reprojected to Web Mercator only when tiles are drawn.
      </p>

      <h2>Data sources</h2>
      {/* On a phone each row stacks into a card; data-label supplies the column name (see styles.css). */}
      <table className="data table-stack">
        <thead><tr>{SOURCE_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {SOURCES.map(([layer, src, lic, date, path]) => (
            <tr key={layer}>
              <td data-label="Layer">{layer}</td>
              <td data-label="Source">{src}</td>
              <td data-label="License">{lic}</td>
              <td data-label="Data date">{date}</td>
              <td data-label="Loader"><File path={path} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>The whole pipeline runs from <File path="etl/run_all.py" />, using shared helpers in <File path="etl/common.py" />.</p>

      <h2>Network</h2>
      <p>
        The routable walk and drive network is built from the OpenStreetMap roads by splitting ways where they share a node, which keeps
        overpasses from joining the roads below them, and wiring the pieces with pgRouting (<File path="etl/07_network.py" />).
        Walking is 3 mph (1.34 m/s) on any walkable way. Driving uses posted speeds where tagged and road-class defaults elsewhere, with one-way streets.
      </p>

      <h2>Analyses</h2>
      <p>Each analysis is a SQL file run by <File path="etl/08_analyses.py" />, which also writes the <File path="docs/analysis-results.md" /> report.</p>
      <ul>
        {ANALYSES.map(([name, path]) => <li key={path}>{name}: <File path={path} /></li>)}
      </ul>

      <h2>Quality control</h2>
      <p>
        Data QC checks that every table has valid geometry, the expected SRID, a nonzero row count and nothing outside the study area
        (<File path="db/qc/qc_functions.sql" />, report in <File path="docs/data-qc.md" />). Network QC checks the build lost no length and
        that the main walk and drive components hold almost all of the network, then saves findings such as dead-end near misses,
        crossings with no shared node, duplicated ways, islands and one-way traps as map layers
        (<File path="etl/network_qc.py" />, report in <File path="docs/network-qc.md" />). Those findings are on the Transportation page.
      </p>

      <h2>Tools</h2>
      <ul>
        <li><strong>Database:</strong> PostgreSQL 18, PostGIS 3.6, pgRouting 4.0</li>
        <li><strong>Loading:</strong> Python, GDAL/ogr2ogr, osm2pgsql</li>
        <li><strong>Serving:</strong> pg_tileserv for vector tiles, FastAPI for live isochrones and statistics (<File path="api/main.py" />)</li>
        <li><strong>Web maps:</strong> React, Vite and MapLibre GL JS, with a basemap styled from the project's own data</li>
      </ul>

      <h2>Limits</h2>
      <ul>
        <li>Drive times are free-flow: no traffic, signals or turn penalties.</li>
        <li>Transit access counts stops with weekday service on one sample day. It doesn't weigh frequency or where the routes go.</li>
        <li>Transit access counts buildings, not people, so garages and sheds count the same as houses and apartment blocks.</li>
        <li>About 6% of Overture buildings have no height in the source, and heights come from several sources of varying accuracy.</li>
        <li>FEMA zones show regulatory flood risk, not a forecast of any particular flood.</li>
      </ul>
    </article>
  );
}
