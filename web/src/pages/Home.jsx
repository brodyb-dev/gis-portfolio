import { Link } from 'react-router-dom';
import { PROFILE, REPO_URL } from '../config.js';
import { FLOOD, ISO, RAMP } from '../map/palette.js';

const FEATURED = [
  { to: '/transportation', title: 'Walking to transit', colors: RAMP.teal,
    text: 'Straight-line buffers overstate who lives within a ¼-mile walk of transit by about a third. This map walks the real streets.' },
  { to: '/flood', title: 'Flood exposure', colors: [FLOOD.levee, FLOOD['500-yr'], FLOOD['100-yr'], '#16426e'],
    text: 'Buildings, road miles and transit stops in FEMA’s 100- and 500-year floodplains and behind the levees.' },
  { to: '/buildings', title: 'Building density', colors: RAMP.brick,
    text: 'Half a million building footprints summarized into ⅓-mile hexagons by count, ground coverage and height.' },
];

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">GIS portfolio · St. Louis City + County</p>
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
            <span className="card-ramp" aria-hidden="true">
              {f.colors.map((c) => <span key={c} style={{ background: c }} />)}
            </span>
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

      <section className="contact">
        <h2>Contact</h2>
        <p>
          {PROFILE.name} · <a href={`mailto:${PROFILE.email}`}>{PROFILE.email}</a>
          {PROFILE.links.map((l) => <span key={l.href}> · <a href={l.href} target="_blank" rel="noreferrer">{l.label}</a></span>)}
        </p>
      </section>
    </div>
  );
}
