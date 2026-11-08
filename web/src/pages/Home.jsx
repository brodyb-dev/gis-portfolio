import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PROFILE, REPO_URL } from '../config.js';
import { FLOOD, ISO, RAMP } from '../map/palette.js';

// Card thumbnails live in web/public/img. BASE_URL keeps the path right if the site is served from a subfolder.
const img = (name) => `${import.meta.env.BASE_URL}img/${name}`;

// The About section. Plain data, so the JSX below stays short.
const CREDENTIALS = ['B.S. Environmental Science', 'GIS Certificate', 'LaunchCode (Java, JavaScript)'];
const SKILLS = [
  ['GIS', 'ArcGIS Pro, QGIS, PostGIS, pgRouting'],
  ['Code', 'Python (geopandas, shapely), SQL, JavaScript/React'],
  ['Web mapping', 'MapLibre GL JS, vector tiles via pg_tileserv, FastAPI'],
];

const FEATURED = [
  { to: '/transportation', title: 'Walking to transit', colors: RAMP.teal, image: img('card-transportation.png'),
    text: 'Straight-line buffers overstate how many buildings sit within a ¼-mile walk of a stop by about a third. This map walks the real streets.' },
  { to: '/flood', title: 'Flood exposure', colors: [FLOOD.levee, FLOOD['500-yr'], FLOOD['100-yr'], '#16426e'], image: img('card-flood.png'),
    text: 'Buildings, road miles and transit stops in FEMA’s 100- and 500-year floodplains and behind the levees.' },
  { to: '/buildings', title: 'Building density', colors: RAMP.brick, image: img('card-buildings.png'),
    text: 'Half a million building footprints summarized into ⅓-mile hexagons by count, ground coverage and height.' },
];

/** A map thumbnail for a card, or the page's color ramp if the image is missing or fails to load. */
function CardThumb({ image, colors }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return <img className="card-img" src={image} alt="" loading="eager" onError={() => setFailed(true)} />;
  }
  return (
    <span className="card-ramp" aria-hidden="true">
      {colors.map((c) => <span key={c} style={{ background: c }} />)}
    </span>
  );
}

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">Gateway Atlas · St. Louis, mapped by Brody G.</p>
        <h1>Spatial analysis of St. Louis, built from the database up</h1>
        <p className="lede">
          These web maps are built on a PostGIS database I put together from public data: OpenStreetMap, Overture buildings, Metro transit,
          FEMA flood zones and USGS hydrography. Each analysis is SQL you can read, and you can click the map to run an isochrone.
        </p>
        <div className="hero-iso" aria-hidden="true">
          {[15, 10, 5].map((m) => <span key={m} style={{ '--c': ISO[m], '--s': `${m / 15}` }} />)}
        </div>
      </section>

      <section className="cards" aria-label="Featured maps">
        {FEATURED.map((f) => (
          <Link key={f.to} to={f.to} className="card">
            <CardThumb image={f.image} colors={f.colors} />
            <h2>{f.title}</h2>
            <p>{f.text}</p>
            <span className="card-go">Open map →</span>
          </Link>
        ))}
      </section>

      <section className="about">
        <h2>How it's built</h2>
        <p>
          A Python ETL pipeline loads and clips every source into PostgreSQL/PostGIS in a meter-based projection. pgRouting turns
          the street network into a routable graph, and the analyses run as SQL. pg_tileserv serves the results as vector tiles,
          a small FastAPI service computes isochrones on demand, and MapLibre draws everything with a custom style.
          See <Link to="/methods">Methods</Link> or the <a href={REPO_URL} target="_blank" rel="noreferrer">code on GitHub</a>.
        </p>
      </section>

      <section className="about about-me" aria-labelledby="about-heading">
        <h2 id="about-heading">About</h2>
        <p className="about-line">{PROFILE.name} · GIS analyst · St. Louis area</p>
        <p>
          I'm a GIS analyst working in charting, with a background in environmental science. I build spatial data
          pipelines and web maps with Python, SQL and open-source tools. Gateway Atlas is a self-directed project
          on public data for St. Louis City and County.
        </p>
        <ul className="credentials">
          {CREDENTIALS.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <dl className="skills">
          {SKILLS.map(([group, tools]) => (
            <div key={group}>
              <dt>{group}</dt>
              <dd>{tools}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="contact">
        <h2>Contact</h2>
        <p>
          {PROFILE.name} · <a href={`mailto:${PROFILE.email}`}>{PROFILE.email}</a>
        </p>
      </section>
    </div>
  );
}
