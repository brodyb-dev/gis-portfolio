import { useEffect, useState } from 'react';
import MapView, { clickPopup, setVisible } from '../components/MapView.jsx';
import { Legend, MapPanel, Toggle } from '../components/Panel.jsx';
import { FLOOD, FLOOD_DARK } from '../map/palette.js';
import { tileSource } from '../config.js';
import { fmt, useApi } from '../api.js';

const LABEL = { '100-yr': '100-year floodplain (1% annual chance)', '500-yr': '500-year floodplain (0.2%)',
                levee: 'Reduced risk behind a levee' };
const byClass = (colors) => ['match', ['get', 'flood_class'],
  '100-yr', colors['100-yr'], '500-yr', colors['500-yr'], 'levee', colors.levee, '#999999'];
const OVERLAYS = {
  buildings: ['flood-bldg'],
  roads: ['flood-roads'],
  stops: ['flood-stops'],
};

function setup(map) {
  map.addSource('zones', tileSource('core.flood_zones', { properties: ['flood_class', 'fld_zone', 'zone_subty'], maxzoom: 15 }));
  map.addSource('fbldg', tileSource('analysis.flood_buildings', { properties: ['flood_class', 'height_m', 'area_m2'], minzoom: 12 }));
  map.addSource('froads', tileSource('analysis.flood_roads', { properties: ['flood_class', 'road_class', 'name', 'length_m'] }));
  map.addSource('fstops', tileSource('analysis.flood_stops', { properties: ['flood_class', 'stop_name', 'routes', 'weekday_departures', 'is_rail'] }));

  map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', 'source-layer': 'core.flood_zones',
    paint: { 'fill-color': byClass(FLOOD), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 15, 0.45] } }, 'roads-anchor');
  map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', 'source-layer': 'core.flood_zones', minzoom: 12,
    paint: { 'line-color': byClass(FLOOD_DARK), 'line-width': 0.6, 'line-opacity': 0.6 } }, 'roads-anchor');
  map.addLayer({ id: 'flood-roads', type: 'line', source: 'froads', 'source-layer': 'analysis.flood_roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': byClass(FLOOD_DARK),
             'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.8, 13, 2, 17, 7] } }, 'top-anchor');
  map.addLayer({ id: 'flood-bldg', type: 'fill', source: 'fbldg', 'source-layer': 'analysis.flood_buildings', minzoom: 12,
    paint: { 'fill-color': byClass(FLOOD_DARK), 'fill-outline-color': '#ffffff' } }, 'top-anchor');
  map.addLayer({ id: 'flood-stops', type: 'circle', source: 'fstops', 'source-layer': 'analysis.flood_stops',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 7], 'circle-color': '#ffffff',
             'circle-stroke-color': byClass(FLOOD_DARK), 'circle-stroke-width': 2.5 } }, 'top-anchor');

  clickPopup(map, 'flood-stops', (p) => `<strong>${p.stop_name}</strong><br>${LABEL[p.flood_class]}<br>${fmt.int(p.weekday_departures)} weekday departures · Routes: ${p.routes || '—'}`);
  clickPopup(map, 'flood-bldg', (p) => `<strong>Building</strong> in the ${LABEL[p.flood_class].toLowerCase()}<br>${fmt.int(p.area_m2)} m² footprint${p.height_m ? `, ${fmt.num(p.height_m)} m tall` : ''}`);
  clickPopup(map, 'flood-roads', (p) => `<strong>${p.name || p.road_class}</strong><br>${LABEL[p.flood_class]}`);
  clickPopup(map, 'zones-fill', (p) => `<strong>${LABEL[p.flood_class]}</strong><br>FEMA zone ${p.fld_zone}${p.zone_subty ? ` · ${p.zone_subty.toLowerCase()}` : ''}`);
}

export default function Flood() {
  const [map, setMap] = useState(null);
  const [show, setShow] = useState({ buildings: true, roads: true, stops: true });
  const flood = useApi('/stats/flood').data;

  useEffect(() => {
    if (map) Object.entries(OVERLAYS).forEach(([k, ids]) => setVisible(map, ids, show[k]));
  }, [map, show]);
  const toggle = (k) => (on) => setShow((s) => ({ ...s, [k]: on }));

  return (
    <div className="map-page">
      <MapView setup={setup} onReady={setMap} label="Flood exposure map" />
      <MapPanel
        title="Flood Exposure"
        lede="The buildings, roads and transit that sit in FEMA flood zones along the Mississippi, Missouri and Meramec rivers and their creeks."
        credits="FEMA National Flood Hazard Layer, Overture Maps buildings (ODbL), Metro St. Louis GTFS, OpenStreetMap contributors (ODbL)."
        how={<>
          <p>FEMA's National Flood Hazard Layer was downloaded for the study area and grouped into the 100-year zone (the Special Flood Hazard Area: A, AE, AH, AO and similar), the 500-year zone (Zone X, 0.2% annual chance) and Zone X areas of reduced risk behind levees.</p>
          <p>A building counts as exposed if any part of its footprint touches a zone. Road miles are drivable roads clipped to each zone, leaving out bridges, which cross over the floodplain. The 500-year totals include the 100-year zone.</p>
        </>}
      >
        <Legend title="FEMA flood zone" items={['100-yr', '500-yr', 'levee'].map((k) => ({ color: FLOOD[k], label: LABEL[k] }))} />
        <Legend title="Exposed features (colored by zone)" items={[
          { color: FLOOD_DARK['100-yr'], label: 'Building (zoom 12+)' },
          { color: FLOOD_DARK['100-yr'], label: 'Road', kind: 'line' },
          { color: '#ffffff', outline: FLOOD_DARK['100-yr'], label: 'Transit stop', kind: 'ring' },
        ]} />
        <div className="toggles">
          <Toggle checked={show.buildings} onChange={toggle('buildings')}>Buildings</Toggle>
          <Toggle checked={show.roads} onChange={toggle('roads')}>Roads</Toggle>
          <Toggle checked={show.stops} onChange={toggle('stops')}>Transit stops</Toggle>
        </div>
        {flood && (
          <table className="data">
            <caption>What's exposed</caption>
            <thead><tr><th>Zone</th><th>Buildings</th><th>Road mi</th><th>Stops</th><th>Routes</th></tr></thead>
            <tbody>
              {flood.zones.map((z) => (
                <tr key={z.zone}>
                  <td>{z.zone}</td><td>{fmt.int(z.buildings)}</td><td>{fmt.num(z.road_miles)}</td>
                  <td>{fmt.int(z.transit_stops)}</td><td>{fmt.int(z.transit_routes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </MapPanel>
    </div>
  );
}
