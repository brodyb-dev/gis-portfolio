// One palette for every map and legend, so the site reads as one cartographic system.
// The basemap is a warm, quiet "paper" so the thematic layers carry the color.

export const BASE = {
  // Muted, park-map tones (sage, slate blue, soft gold) kept light so thematic layers read on top.
  outside: '#e9e7e1',     // land outside the study area
  land: '#f7f6f2',
  water: '#a9c1d3',
  waterLine: '#8fadc4',
  waterLabel: '#3f5f80',
  park: '#dbe6c9',
  golf: '#e2ead3',
  cemetery: '#e3e6da',
  parkLabel: '#4d6b45',
  boundary: '#7a7268',
  motorway: '#f3d88f',    // soft gold, like the highway color on a printed city map
  motorwayCase: '#c9a24c',
  major: '#ffffff',
  majorCase: '#b8b2a8',
  minor: '#ffffff',
  minorCase: '#cdc7bd',
  local: '#ffffff',
  localCase: '#dcd6cc',
  path: '#c9c2b6',
  rail: '#9b948b',
  building: '#ddd8cf',
  label: '#3b3a36',
  labelSoft: '#6d6a63',
  halo: 'rgba(255,255,255,0.9)',
  landmark: '#a5525f',    // dusty rose, from the same printed-map palette
};

// Sequential ramps, light to dark, six classes each. ColorBrewer (Cynthia Brewer, Penn State):
// light, perceptually ordered and colorblind-safe.
export const RAMP = {
  brick: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#d95f0e', '#993404'],  // YlOrBr: buildings
  teal: ['#f0f9e8', '#ccebc5', '#a8ddb5', '#7bccc4', '#43a2ca', '#0868ac'],   // GnBu: transit access
  plum: ['#feebe2', '#fcc5c0', '#fa9fb5', '#f768a1', '#c51b8a', '#7a0177'],   // RdPu: overstatement
  slate: ['#f1eef6', '#d0d1e6', '#a6bddb', '#74a9cf', '#2b8cbe', '#045a8d'],  // PuBu: street network
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

export const ISO = { 5: '#54278f', 10: '#807dba', 15: '#bcbddc' };  // ColorBrewer Purples

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
