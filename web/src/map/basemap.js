// A basemap drawn entirely from the project's own PostGIS layers (no third-party basemap):
// study area, parks, water, roads by class, rail, the city/county line and reference labels
// (highways, major streets, towns, neighborhoods, rivers and landmarks).
//
// Layer order, bottom to top:
//   land, parks, water  ->  'roads-anchor' (pages insert thematic fills here)
//   road casings + fills, rail, county line  ->  'top-anchor' (pages insert points/overlays)
//   labels (always on top; toggled together with the Labels button)
import { BASE } from './palette.js';
import { tileSource } from '../config.js';

// Glyphs (Noto Sans, SIL Open Font License) are served from web/public/fonts.
const GLYPHS = `${window.location.origin}${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`;
export const REGULAR = ['Noto Sans Regular'];
export const MEDIUM = ['Noto Sans Medium'];
export const ITALIC = ['Noto Sans Italic'];

const roadWidth = (base) => ['interpolate', ['exponential', 1.6], ['zoom'], 9, base * 0.35, 13, base, 17, base * 6];
const caseWidth = (base) => ['interpolate', ['exponential', 1.6], ['zoom'], 9, base * 0.35 + 0.6, 13, base + 1.4, 17, base * 6 + 2.5];
const ROUND = { 'line-cap': 'round', 'line-join': 'round' };
const HALO = { 'text-halo-color': BASE.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.3 };

// Road classes drawn as casing (outline) + fill, low to high so major roads sit on top.
const ROADS = [
  { id: 'local', classes: ['local'], minzoom: 13, base: 0.8, fill: BASE.local, casing: BASE.localCase },
  { id: 'minor', classes: ['secondary', 'tertiary'], minzoom: 11, base: 1.1, fill: BASE.minor, casing: BASE.minorCase },
  { id: 'major', classes: ['primary', 'trunk'], minzoom: 0, base: 1.5, fill: BASE.major, casing: BASE.majorCase },
  { id: 'motorway', classes: ['motorway'], minzoom: 0, base: 2, fill: BASE.motorway, casing: BASE.motorwayCase },
];

/** Layer ids of the reference labels, for the Labels toggle. */
export const LABEL_LAYERS = ['label-water', 'label-park', 'label-street-minor', 'label-street-major',
  'label-highway', 'label-neighborhood', 'label-town', 'landmark-dot', 'label-landmark'];

export function baseStyle() {
  const roadLayers = [];
  for (const r of ROADS) {
    const filter = ['in', ['get', 'road_class'], ['literal', r.classes]];
    roadLayers.push({ id: `road-${r.id}-case`, type: 'line', source: 'roads', 'source-layer': 'core.roads_z',
      minzoom: r.minzoom, filter, layout: ROUND,
      paint: { 'line-color': r.casing, 'line-width': caseWidth(r.base) } });
  }
  for (const r of ROADS) {
    const filter = ['in', ['get', 'road_class'], ['literal', r.classes]];
    roadLayers.push({ id: `road-${r.id}`, type: 'line', source: 'roads', 'source-layer': 'core.roads_z',
      minzoom: r.minzoom, filter, layout: ROUND,
      paint: { 'line-color': r.fill, 'line-width': roadWidth(r.base) } });
  }

  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      boundary: tileSource('core.study_boundary', { maxzoom: 14 }),
      counties: tileSource('core.counties', { properties: ['name'], maxzoom: 14 }),
      water: tileSource('basemap.hydro_context', { properties: ['kind'], maxzoom: 15 }),
      streams: tileSource('core.hydro_lines', { properties: ['kind'], maxzoom: 15 }),
      parks: tileSource('basemap.parks', { properties: ['name', 'kind', 'area_ha'], maxzoom: 15 }),
      // A function layer that sends only the road classes drawn at each zoom (db/serving/02_tile_functions.sql).
      roads: tileSource('core.roads_z'),
      rail: tileSource('core.rail_lines', { properties: ['railway'], maxzoom: 15 }),
      roadLabels: tileSource('basemap.road_labels', { properties: ['kind', 'label', 'length_m'], maxzoom: 15 }),
      places: tileSource('basemap.places', { properties: ['name', 'place', 'rank'], maxzoom: 14 }),
      landmarks: tileSource('basemap.landmarks', { properties: ['name', 'kind'], maxzoom: 14 }),
      riverLabels: tileSource('basemap.river_labels', { properties: ['name'], maxzoom: 14 }),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': BASE.outside } },
      { id: 'land', type: 'fill', source: 'boundary', 'source-layer': 'core.study_boundary',
        paint: { 'fill-color': BASE.land } },
      { id: 'parks', type: 'fill', source: 'parks', 'source-layer': 'basemap.parks',
        paint: { 'fill-color': ['match', ['get', 'kind'], 'golf', BASE.golf, 'cemetery', BASE.cemetery, BASE.park] } },
      { id: 'water', type: 'fill', source: 'water', 'source-layer': 'basemap.hydro_context',
        paint: { 'fill-color': BASE.water } },
      { id: 'streams', type: 'line', source: 'streams', 'source-layer': 'core.hydro_lines',
        minzoom: 11,
        paint: { 'line-color': BASE.waterLine,
                 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 2] } },
      // Thematic fills go here (beforeId: 'roads-anchor').
      { id: 'roads-anchor', type: 'background', layout: { visibility: 'none' } },
      { id: 'road-path', type: 'line', source: 'roads', 'source-layer': 'core.roads_z', minzoom: 15,
        filter: ['in', ['get', 'road_class'], ['literal', ['path', 'track']]],
        paint: { 'line-color': BASE.path, 'line-width': 0.8, 'line-dasharray': [2, 1.5] } },
      { id: 'road-service', type: 'line', source: 'roads', 'source-layer': 'core.roads_z', minzoom: 14,
        filter: ['==', ['get', 'road_class'], 'service'],
        paint: { 'line-color': BASE.localCase, 'line-width': roadWidth(0.4) } },
      ...roadLayers,
      { id: 'rail', type: 'line', source: 'rail', 'source-layer': 'core.rail_lines', minzoom: 11,
        filter: ['==', ['get', 'railway'], 'rail'],
        paint: { 'line-color': BASE.rail, 'line-width': 1, 'line-dasharray': [3, 2] } },
      { id: 'county-line', type: 'line', source: 'counties', 'source-layer': 'core.counties',
        paint: { 'line-color': BASE.boundary, 'line-width': 1.2, 'line-dasharray': [4, 2],
                 'line-opacity': 0.7 } },
      // Overlays (points, isochrones) go above the roads (beforeId: 'top-anchor').
      { id: 'top-anchor', type: 'background', layout: { visibility: 'none' } },

      // Reference labels -------------------------------------------------------------------
      { id: 'label-water', type: 'symbol', source: 'riverLabels', 'source-layer': 'basemap.river_labels',
        minzoom: 9.5,
        layout: { 'text-field': ['get', 'name'], 'text-font': ITALIC, 'text-letter-spacing': 0.12,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 14] },
        paint: { 'text-color': BASE.waterLabel, ...HALO } },
      { id: 'label-park', type: 'symbol', source: 'parks', 'source-layer': 'basemap.parks', minzoom: 12.5,
        filter: ['all', ['==', ['get', 'kind'], 'park'], ['has', 'name'],
                 ['>=', ['to-number', ['get', 'area_ha']], ['step', ['zoom'], 40, 14, 8, 15.5, 1]]],
        layout: { 'text-field': ['get', 'name'], 'text-font': ITALIC, 'text-size': 11, 'text-max-width': 8 },
        paint: { 'text-color': BASE.parkLabel, ...HALO } },
      { id: 'label-street-minor', type: 'symbol', source: 'roadLabels', 'source-layer': 'basemap.road_labels',
        minzoom: 14.5, filter: ['==', ['get', 'kind'], 'minor'],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': REGULAR,
                  'text-size': 10.5, 'symbol-spacing': 400 },
        paint: { 'text-color': BASE.labelSoft, ...HALO } },
      { id: 'label-street-major', type: 'symbol', source: 'roadLabels', 'source-layer': 'basemap.road_labels',
        minzoom: 12.5, filter: ['==', ['get', 'kind'], 'major'],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': MEDIUM,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 16, 12.5], 'symbol-spacing': 450 },
        paint: { 'text-color': BASE.label, ...HALO } },
      // Highway route numbers on a gold halo, a simplified shield.
      { id: 'label-highway', type: 'symbol', source: 'roadLabels', 'source-layer': 'basemap.road_labels',
        minzoom: 9, filter: ['in', ['get', 'kind'], ['literal', ['interstate', 'us', 'state']]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': ['step', ['zoom'], 350, 12, 500],
                  'text-field': ['get', 'label'], 'text-font': MEDIUM, 'text-size': 10.5,
                  'text-rotation-alignment': 'viewport', 'text-padding': 6,
                  'symbol-sort-key': ['match', ['get', 'kind'], 'interstate', 0, 'us', 1, 2] },
        paint: { 'text-color': '#4a3b12', 'text-halo-color': BASE.motorway, 'text-halo-width': 3 } },
      { id: 'label-neighborhood', type: 'symbol', source: 'places', 'source-layer': 'basemap.places',
        minzoom: 12.5, filter: ['>=', ['get', 'rank'], 4],
        layout: { 'text-field': ['get', 'name'], 'text-font': REGULAR, 'text-size': 11,
                  'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 7 },
        paint: { 'text-color': BASE.labelSoft, ...HALO } },
      { id: 'label-town', type: 'symbol', source: 'places', 'source-layer': 'basemap.places',
        minzoom: 10, filter: ['<=', ['get', 'rank'], 3],
        layout: { 'text-field': ['get', 'name'], 'text-font': MEDIUM, 'text-max-width': 8,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'rank'], 1, 14, 2, 11.5, 10.5],
                                14, ['match', ['get', 'rank'], 1, 18, 2, 14, 13]],
                  'symbol-sort-key': ['get', 'rank'] },
        paint: { 'text-color': BASE.label, ...HALO } },
      { id: 'landmark-dot', type: 'circle', source: 'landmarks', 'source-layer': 'basemap.landmarks', minzoom: 10.5,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 5], 'circle-color': BASE.landmark,
                 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } },
      { id: 'label-landmark', type: 'symbol', source: 'landmarks', 'source-layer': 'basemap.landmarks', minzoom: 10.5,
        // Downtown landmarks sit a few blocks apart, so let each label try eight spots around its dot
        // and keep a little padding, so neighbors drop out or move instead of touching.
        layout: { 'text-field': ['get', 'name'], 'text-font': MEDIUM, 'text-size': 11.5, 'text-max-width': 9,
                  'text-variable-anchor': ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
                  'text-radial-offset': 0.8, 'text-justify': 'auto', 'text-padding': 5 },
        paint: { 'text-color': BASE.landmark, ...HALO } },
    ],
  };
}

/**
 * Short on-map credits (MapLibre's attribution control). The basemap draws OpenStreetMap and NHD data
 * on every page, so those two are always included; pages add their own sources in between.
 */
export function mapCredits(...sources) {
  const osm = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>';
  return [osm, ...sources, 'USGS NHD'].join(' · ');
}

// Appended to every page's panel credits. OpenStreetMap is credited here once (basemap and street
// network), so pages should not list it again.
export const BASE_CREDIT = 'OpenStreetMap contributors (ODbL). Basemap: USGS NHD, U.S. Census TIGER/Line 2024. Labels set in Noto Sans (SIL OFL).';
