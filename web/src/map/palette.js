// One palette for every map and legend, so the site reads as one cartographic system.
// The basemap is a warm, quiet "paper" so the thematic layers carry the color.

export const BASE = {
  outside: '#e4e0d6',     // land outside the study area
  land: '#f6f3ec',
  water: '#a8c6d6',
  waterLine: '#8db1c6',
  boundary: '#6f655a',
  motorway: '#b8a593',
  major: '#cdbfb0',       // trunk, primary
  minor: '#dbd1c5',       // secondary, tertiary
  local: '#e6dfd5',
  path: '#d9cfc2',
  rail: '#a39a90',
  building: '#ddd5ca',
};

// Sequential ramps, light to dark, six classes each.
export const RAMP = {
  brick: ['#fbeadb', '#f4c7a1', '#e79a6e', '#c96a43', '#9b4327', '#5f2412'],  // buildings
  teal: ['#e2f1ee', '#b3dad3', '#7cbcb3', '#479a92', '#22746e', '#0b4b47'],   // transit access
  plum: ['#f6e6f0', '#e6bcd6', '#cf8bb8', '#ad5b98', '#823777', '#511a4f'],   // overstatement
  slate: ['#e8edf2', '#c3cfdc', '#93a8c0', '#6481a2', '#3d5d82', '#1f3a5a'],  // street network
};

export const FLOOD = {
  '100-yr': '#2f6ea8',
  '500-yr': '#86b6dc',
  levee: '#b39bc8',
};

// Exposed features in each zone, drawn darker than the zone fill.
export const FLOOD_DARK = {
  '100-yr': '#16426e',
  '500-yr': '#3f77ab',
  levee: '#6b4c8c',
};

export const ISO ={ 5: '#4b2e83', 10: '#8466b5', 15: '#c4b2e0' };

export const QC = {
  dead_end: '#d48a3a',
  near_miss: '#b3261e',
  crossing: '#b3261e',
  overlap: '#7b3f99',
  island: '#2e7d5b',
  trap: '#c23b8b',
};

export const TRANSIT = { bus: '#5e6a73', MLR: '#cc0033', MLB: '#333399', stop: '#22746e' };

/** A MapLibre `step` expression mapping `value` into a ramp at the given breaks. */
export function stepColor(value, breaks, ramp) {
  const expr = ['step', value, ramp[0]];
  breaks.forEach((b, i) => expr.push(b, ramp[i + 1]));
  return expr;
}

/** Legend rows for the same classes: "< b0", "b0–b1", ..., "≥ bn". */
export function stepLegend(breaks, ramp, fmt = (v) => v) {
  return ramp.map((color, i) => ({
    color,
    label: i === 0 ? `< ${fmt(breaks[0])}`
      : i === breaks.length ? `≥ ${fmt(breaks[i - 1])}`
        : `${fmt(breaks[i - 1])} – ${fmt(breaks[i])}`,
  }));
}
