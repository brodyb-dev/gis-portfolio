import { useEffect, useState } from 'react';
import { API_URL } from './config.js';

export async function getJSON(path, params) {
  const url = new URL(path, API_URL);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : `request failed (${r.status})`;
    throw new Error(detail);
  }
  return body;
}

/** Fetch an API path once; returns { data, error }. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let live = true;
    getJSON(path)
      .then((data) => live && setState({ data, error: null }))
      .catch((error) => live && setState({ data: null, error }));
    return () => { live = false; };
  }, [path]);
  return state;
}

export const fmt = {
  int: (v) => Math.round(v).toLocaleString('en-US'),
  pct: (v, d = 1) => `${Number(v).toFixed(d)}%`,
  num: (v, d = 1) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }),
};

// The database measures in meters (EPSG:26915); the site shows US units.
export const FT_PER_M = 3.28084;
export const M_PER_MI = 1609.344;
export const SQMI_PER_KM2 = 1 / 2.589988;
export const SQFT_PER_M2 = 10.76391;
/** Feet under ~1,000 ft (rounded to 10), otherwise miles. */
fmt.dist = (m) => (m < 305 ? `${fmt.int(Math.round((m * FT_PER_M) / 10) * 10)} ft` : `${fmt.num(m / M_PER_MI, 2)} mi`);
fmt.ft = (m) => `${fmt.int(m * FT_PER_M)} ft`;
fmt.mi = (m, d = 1) => `${fmt.num(m / M_PER_MI, d)} mi`;
fmt.sqmi = (km2, d = 2) => `${fmt.num(km2 * SQMI_PER_KM2, d)} sq mi`;
fmt.sqft = (m2) => `${fmt.int(m2 * SQFT_PER_M2)} sq ft`;
