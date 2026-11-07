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
