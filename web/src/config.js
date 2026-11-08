// Where the services live. Override with VITE_TILES_URL / VITE_API_URL in web/.env.local.
export const TILES_URL = import.meta.env.VITE_TILES_URL || 'http://localhost:7800';
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const REPO_URL = 'https://github.com/BrucieTheG/gis-portfolio';
export const repoFile = (path) => `${REPO_URL}/blob/main/${path}`;

export const CONTACT_EMAIL = 'brodyg.maps@gmail.com';

// Contact details: a name and an email only. Nothing else personal goes on the site.
export const PROFILE = {
  name: 'Brody G.',
  email: CONTACT_EMAIL,
};

// Study area: St. Louis City + County.
export const STUDY_BOUNDS = [[-90.74, 38.383], [-90.114, 38.9]];
export const MAX_BOUNDS = [[-91.15, 38.2], [-89.7, 39.1]];

/** A vector tile source for one pg_tileserv layer, optionally limited to some properties. */
export function tileSource(layer, { properties, minzoom = 0, maxzoom = 16 } = {}) {
  const q = properties?.length ? `?properties=${properties.join(',')}` : '';
  return {
    type: 'vector',
    tiles: [`${TILES_URL}/${layer}/{z}/{x}/{y}.pbf${q}`],
    minzoom,
    maxzoom,
  };
}
