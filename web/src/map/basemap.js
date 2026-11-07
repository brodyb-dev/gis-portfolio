// A basemap drawn entirely from the project's own PostGIS layers (no third-party basemap):
// study area, water, roads by class, rail and the city/county line. Thematic layers are
// inserted below the 'labels-anchor' layer so roads stay on top of fills.
import { BASE } from './palette.js';
import { tileSource } from '../config.js';

const roadWidth = (base) => ['interpolate', ['exponential', 1.6], ['zoom'], 9, base * 0.35, 13, base, 17, base * 6];

export function baseStyle() {
  return {
    version: 8,
    sources: {
      boundary: tileSource('core.study_boundary', { maxzoom: 14 }),
      counties: tileSource('core.counties', { properties: ['name'], maxzoom: 14 }),
      water: tileSource('core.hydro_areas', { properties: ['kind'], maxzoom: 15 }),
      streams: tileSource('core.hydro_lines', { properties: ['kind'], maxzoom: 15 }),
      roads: tileSource('core.roads', { properties: ['road_class', 'bridge', 'tunnel'] }),
      rail: tileSource('core.rail_lines', { properties: ['railway'], maxzoom: 15 }),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': BASE.outside } },
      { id: 'land', type: 'fill', source: 'boundary', 'source-layer': 'core.study_boundary',
        paint: { 'fill-color': BASE.land } },
      { id: 'water', type: 'fill', source: 'water', 'source-layer': 'core.hydro_areas',
        filter: ['!=', ['get', 'kind'], 'swamp/marsh'], paint: { 'fill-color': BASE.water } },
      { id: 'streams', type: 'line', source: 'streams', 'source-layer': 'core.hydro_lines',
        minzoom: 11,
        paint: { 'line-color': BASE.waterLine,
                 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 2] } },
      // Thematic fills go here (beforeId: 'roads-anchor').
      { id: 'roads-anchor', type: 'background', layout: { visibility: 'none' } },
      { id: 'road-path', type: 'line', source: 'roads', 'source-layer': 'core.roads', minzoom: 15,
        filter: ['in', ['get', 'road_class'], ['literal', ['path', 'track']]],
        paint: { 'line-color': BASE.path, 'line-width': 0.8, 'line-dasharray': [2, 1.5] } },
      { id: 'road-service', type: 'line', source: 'roads', 'source-layer': 'core.roads', minzoom: 14,
        filter: ['==', ['get', 'road_class'], 'service'],
        paint: { 'line-color': BASE.local, 'line-width': roadWidth(0.4) } },
      { id: 'road-local', type: 'line', source: 'roads', 'source-layer': 'core.roads', minzoom: 12,
        filter: ['==', ['get', 'road_class'], 'local'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': BASE.local, 'line-width': roadWidth(0.8) } },
      { id: 'road-minor', type: 'line', source: 'roads', 'source-layer': 'core.roads', minzoom: 10,
        filter: ['in', ['get', 'road_class'], ['literal', ['secondary', 'tertiary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': BASE.minor, 'line-width': roadWidth(1.1) } },
      { id: 'road-major', type: 'line', source: 'roads', 'source-layer': 'core.roads',
        filter: ['in', ['get', 'road_class'], ['literal', ['primary', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': BASE.major, 'line-width': roadWidth(1.5) } },
      { id: 'road-motorway', type: 'line', source: 'roads', 'source-layer': 'core.roads',
        filter: ['==', ['get', 'road_class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': BASE.motorway, 'line-width': roadWidth(2) } },
      { id: 'rail', type: 'line', source: 'rail', 'source-layer': 'core.rail_lines', minzoom: 11,
        filter: ['==', ['get', 'railway'], 'rail'],
        paint: { 'line-color': BASE.rail, 'line-width': 1, 'line-dasharray': [3, 2] } },
      { id: 'county-line', type: 'line', source: 'counties', 'source-layer': 'core.counties',
        paint: { 'line-color': BASE.boundary, 'line-width': 1.2, 'line-dasharray': [4, 2],
                 'line-opacity': 0.7 } },
      // Overlays (points, isochrones) go above everything (beforeId: 'top-anchor').
      { id: 'top-anchor', type: 'background', layout: { visibility: 'none' } },
    ],
  };
}

export const BASE_CREDIT = 'Basemap: OpenStreetMap contributors (ODbL), USGS NHD, U.S. Census TIGER/Line 2024.';
