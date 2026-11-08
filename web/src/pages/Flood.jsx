import { useEffect, useState } from 'react';
import MapView, { clickPopup, setVisible } from '../components/MapView.jsx';
import { Legend, MapPanel, Toggle } from '../components/Panel.jsx';
import { BASE, FLOOD, FLOOD_DARK } from '../map/palette.js';
import { mapCredits } from '../map/basemap.js';
import { tileSource } from '../config.js';
import { fmt, useApi } from '../api.js';

const LABEL = { '100-yr': '100-year floodplain (1% annual chance)', '500-yr': '500-year floodplain (0.2%)',
                levee: 'Reduced risk behind a levee' };
const byClass = (colors) => ['match', ['get', 'flood_class'],
  '100-yr', colors['100-yr'], '500-yr', colors['500-yr'], 'levee', colors.levee, '#999999'];
const ZONES = ['100-yr', '500-yr', 'levee'];
const isClass = (k) => ['==', ['get', 'flood_class'], k];
const OVERLAYS = {
  buildings: ['flood-bldg'],
  roads: ['flood-roads'],
  stops: ['flood-stops'],
};

/**
 * A small diagonal-hatch image for the levee zone, drawn on a canvas and added to the map as a
 * fill pattern. Drawn at 2x (24 px for a 12 px tile) and registered with pixelRatio 2, so it stays crisp.
 */
function addHatch(map, id, color) {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  // One diagonal plus the two corner pieces, so the tiles join into continuous lines.
  for (const [x0, y0, x1, y1] of [[0, size, size, 0], [-size / 2, size / 2, size / 2, -size / 2],
                                  [size / 2, size * 1.5, size * 1.5, size / 2]]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  if (!map.hasImage(id)) map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function setup(map) {
  addHatch(map, 'levee-hatch', FLOOD.leveeHatch);
  map.addSource('zones', tileSource('core.flood_z', { maxzoom: 15 }));
  map.addSource('fbldg', tileSource('analysis.flood_buildings', { properties: ['flood_class', 'height_m', 'area_m2'], minzoom: 12 }));
  map.addSource('froads', tileSource('analysis.flood_roads', { properties: ['flood_class', 'road_class', 'name', 'length_m'] }));
  map.addSource('fstops', tileSource('analysis.flood_stops', { properties: ['flood_class', 'stop_name', 'routes', 'weekday_departures', 'is_rail'] }));

  // Zone fills, then the river water on top of them (the rivers are inside the 100-year zone but
  // shouldn't read as floodplain), then roads, then the exposed features.
  map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', 'source-layer': 'core.flood_z',
    filter: ['!=', ['get', 'flood_class'], 'levee'],
    paint: { 'fill-color': byClass(FLOOD), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 15, 0.45] } }, 'roads-anchor');
  // Levee zone: a soft lavender fill so it reads as an area, with a fine hatch on top.
  map.addLayer({ id: 'zones-levee-fill', type: 'fill', source: 'zones', 'source-layer': 'core.flood_z',
    filter: isClass('levee'),
    paint: { 'fill-color': FLOOD.levee, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 15, 0.4] } }, 'roads-anchor');
  map.addLayer({ id: 'zones-levee', type: 'fill', source: 'zones', 'source-layer': 'core.flood_z',
    filter: isClass('levee'),
    paint: { 'fill-pattern': 'levee-hatch' } }, 'roads-anchor');
  map.addLayer({ id: 'zones-500-line', type: 'line', source: 'zones', 'source-layer': 'core.flood_z', minzoom: 10,
    filter: isClass('500-yr'),
    paint: { 'line-color': FLOOD_DARK['500-yr'], 'line-width': 0.6 } }, 'roads-anchor');
  map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', 'source-layer': 'core.flood_z', minzoom: 12,
    filter: ['!=', ['get', 'flood_class'], '500-yr'],
    paint: { 'line-color': byClass(FLOOD_DARK), 'line-width': 0.6, 'line-opacity': 0.6 } }, 'roads-anchor');
  // 'water' is the basemap's own source (basemap.hydro_context), reused here as an overlay.
  map.addLayer({ id: 'flood-water', type: 'fill', source: 'water', 'source-layer': 'basemap.hydro_context',
    paint: { 'fill-color': BASE.water } }, 'roads-anchor');
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
  clickPopup(map, 'flood-bldg', (p) => `<strong>Building</strong> in the ${LABEL[p.flood_class].toLowerCase()}<br>${fmt.sqft(p.area_m2)} footprint${p.height_m ? `, ${fmt.ft(p.height_m)} tall` : ''}`);
  clickPopup(map, 'flood-roads', (p) => `<strong>${p.name || p.road_class}</strong><br>${LABEL[p.flood_class]}`);
  const zonePopup = (p) => `<strong>${LABEL[p.flood_class]}</strong><br>FEMA zone ${p.fld_zone}${p.zone_subty ? ` · ${p.zone_subty.toLowerCase()}` : ''}`;
  clickPopup(map, 'zones-fill', zonePopup, { unless: ['flood-water'] });
  clickPopup(map, 'zones-levee', zonePopup, { unless: ['flood-water'] });
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
      <MapView setup={setup} onReady={setMap} label="Flood exposure map"
               title="FEMA flood zones and the buildings, roads and stops in them"
               credits={mapCredits('Overture Maps', 'FEMA NFHL', 'Metro Transit GTFS')} />
      <MapPanel
        title="Flood Exposure"
        lede="The buildings, roads and transit that sit in FEMA flood zones along the Mississippi, Missouri and Meramec rivers and their creeks."
        credits="FEMA National Flood Hazard Layer, Overture Maps buildings (ODbL), Metro St. Louis GTFS."
        how={<>
          <p>FEMA's National Flood Hazard Layer was downloaded for the study area and grouped into the 100-year zone (the Special Flood Hazard Area: A, AE, AH, AO and similar), the 500-year zone (Zone X, 0.2% annual chance) and Zone X areas of reduced risk behind levees.</p>
          <p>A building counts as exposed if any part of its footprint touches a zone. Road miles are drivable roads clipped to each zone, leaving out bridges, which cross over the floodplain, and service roads (driveways and parking aisles). The 500-year totals include the 100-year zone.</p>
          <p>Rivers are drawn on top of the zones, so the shading you see is land.</p>
        </>}
      >
        <Legend title="FEMA flood zone" items={[
          { color: FLOOD['100-yr'], label: LABEL['100-yr'] },
          { color: FLOOD['500-yr'], label: LABEL['500-yr'] },
          { color: FLOOD.leveeHatch, outline: FLOOD.levee, label: LABEL.levee, kind: 'hatch' },
        ]} />
        <Legend title="Exposed features, colored by zone" items={[
          { colors: ZONES.map((k) => FLOOD_DARK[k]), label: 'Building (zoom 12+)' },
          { colors: ZONES.map((k) => FLOOD_DARK[k]), label: 'Road', kind: 'line' },
          { colors: ZONES.map((k) => FLOOD_DARK[k]), label: 'Transit stop', kind: 'ring' },
        ]} note="Left to right: 100-year, 500-year, behind a levee." />
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
        {flood && <p className="fine">Road miles leave out bridges and service roads (driveways and parking aisles).</p>}
        <FloodHistory />
      </MapPanel>
    </div>
  );
}

// Crest stages from the National Weather Service (Mississippi at St. Louis, gauge EADM7; Meramec
// at Valley Park and Arnold). Flood stage at St. Louis is 30 ft; the floodwall is built to 52 ft.
const CRESTS = [
  { year: '1785', stage: '42.0 ft', text: <>Remembered as "l'année des grandes eaux," the year of the great waters, about 20 years after St. Louis was founded. It is the oldest crest on the Weather Service's list.</> },
  { year: '1844', stage: '41.3 ft', text: <>The Great Flood of 1844 crested in late June. No flood carried more water past St. Louis until 1993.</> },
  { year: '1973', stage: '43.2 ft', text: <>A new record on April 28, 1973. The city's 11-mile riverfront floodwall, begun in 1959 and built to hold back 52 ft, was dedicated the next year.</> },
  { year: '1993', stage: '49.6 ft', text: <>The Great Flood: the record crest of 49.58 ft on August 1. The floodwall held downtown. On the Missouri River a levee break flooded the Chesterfield Valley, which was rebuilt behind a bigger levee. That valley is the largest hatched area on this map.</> },
  { year: '2015', stage: 'Meramec', text: <>After record December rain, the Meramec set new records on New Year's Eve at Valley Park (44.1 ft) and Arnold (47.3 ft). In May 2017 it rose to the second-highest crest on record at both. Much of that damage was outside the Mississippi floodplain people usually picture.</> },
  { year: '2019', stage: '46.0 ft', text: <>The second-highest crest on record at St. Louis, on June 8, 2019.</> },
];

function FloodHistory() {
  return (
    <section className="history">
      <h2>What "500-year" means</h2>
      <p>The names describe odds, not a schedule. Land in the <strong>100-year</strong> zone has a 1% chance of flooding in any year, about <strong>26%</strong> over a 30-year mortgage. The <strong>500-year</strong> zone has between a 0.2% and 1% chance a year, about <strong>6%</strong> or more over 30 years. Land behind a levee is mapped separately because a levee can be overtopped or fail.</p>
      <p>Leaving out the river channels, all three zones together cover about 18% of the land in the City and County. The 100-year zone is about 13%, the 500-year band about 2%, and land behind levees makes up the rest.</p>
      <h2>Why the City looks so dry</h2>
      <p>FEMA maps very little 100- or 500-year floodplain inside the City, and the creek floodplains in the County seem to stop short of the Mississippi. The data isn't missing. Two things explain it. The riverfront sits behind the 11-mile floodwall, so FEMA maps it as reduced risk behind a levee (the hatched strip) instead of floodplain. And the City's old creeks, including River des Peres and Mill Creek, were buried in sewers and tunnels, Mill Creek in the 1800s and River des Peres from 1924 to 1933. Their water still reaches the river, but underground, where FEMA doesn't map a floodplain. River des Peres comes back to the surface as a concrete channel along the City's southern edge before it joins the Mississippi.</p>
      <h2>Major floods in St. Louis</h2>
      <ol className="timeline">
        {CRESTS.map((c) => (
          <li key={c.year}>
            <span className="tl-year">{c.year}</span>
            <span className="tl-stage">{c.stage}</span>
            <p>{c.text}</p>
          </li>
        ))}
      </ol>
      <p className="fine">Stages are Mississippi River crests at the St. Louis gauge (flood stage 30 ft) unless noted. Source: National Weather Service St. Louis (historic crests; Great Flood of 1993; December 2015 flooding report); USGS Fact Sheet FS-188-95.</p>
    </section>
  );
}
