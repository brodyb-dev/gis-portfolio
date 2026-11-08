import { useEffect, useRef, useState } from 'react';
import MapView, { clickPopup, setVisible } from '../components/MapView.jsx';
import { Legend, MapPanel, Segmented, Stat, Toggle } from '../components/Panel.jsx';
import { ISO, NO_DATA, QC, RAMP, TRANSIT, stepColor, stepLegend } from '../map/palette.js';
import { MEDIUM, mapCredits } from '../map/basemap.js';
import { tileSource } from '../config.js';
import { M_PER_MI, SQMI_PER_KM2, fmt, getJSON, useApi } from '../api.js';

// The representative weekday the GTFS trips and departures were counted on (feed service Nov 2-29, 2026).
const GTFS_SAMPLE_DAY = 'Wednesday, Nov 11, 2026';

// Two rows: the transit pair on top, the other three below (see .segmented-modes in styles.css).
const MODES = [
  { value: 'transit', label: 'Transit access' },
  { value: 'routes', label: 'Transit network' },
  { value: 'iso', label: 'Isochrones' },
  { value: 'network', label: 'Street network' },
  { value: 'qc', label: 'Network QC' },
];
const LAYERS = {
  transit: ['transit-hex', 'transit-bldg'],
  routes: ['routes-bus-hit'],
  iso: ['iso-fill', 'iso-line', 'iso-start'],
  network: ['net-hex'],
  qc: ['qc-islands', 'qc-overlaps', 'qc-dead', 'qc-near', 'qc-cross', 'qc-traps'],
};
const ALL = Object.values(LAYERS).flat();
const ROUTE_LAYERS = ['routes-bus-casing', 'routes-bus', 'routes-rail-casing', 'routes-rail', 'stops',
  'routes-bus-label', 'rail-stop-blocker'];
// Whether routes and stops start out shown in each mode. They are the subject of the transit modes
// but clash with the QC symbols and crowd the street-network hexes.
const ROUTES_DEFAULT = { transit: true, routes: true, iso: true, network: false, qc: false };
const HEX_FADE_ZOOM = 14.5;  // hexes are fully faded out past this zoom

// Transit access shares, per hex.
const DIST = { q: { label: '¼ mile', adj: '¼-mile', short: '¼ mi', net: 'q_mile_net', eucl: 'q_mile_eucl' },
               h: { label: '½ mile', adj: '½-mile', short: '½ mi', net: 'h_mile_net', eucl: 'h_mile_eucl' } };
const SHARE_BREAKS = [0.1, 0.25, 0.5, 0.75, 0.9];
const GAP_BREAKS = [0.05, 0.1, 0.2, 0.3, 0.4];  // share difference, shown as percentage points
// Walk distance classes: 1/8, 1/4, 1/2, 1 and 2 miles (stored in meters).
const WALK_MILES = [0.125, 0.25, 0.5, 1, 2];
const WALK_BREAKS = WALK_MILES.map((mi) => mi * M_PER_MI);
const MILE_LABEL = { 0.125: '⅛ mi', 0.25: '¼ mi', 0.5: '½ mi', 1: '1 mi', 2: '2 mi' };
const num = (prop) => ['to-number', ['get', prop], 0];

// Hexes with only a few buildings swing between 0% and 100% on one building, so draw them faded.
const FEW_BUILDINGS = 5;
const fewOpacity = (full) => ['case', ['<', num('buildings'), FEW_BUILDINGS], full * 0.35, full];
const HEX_OPACITY = ['interpolate', ['linear'], ['zoom'], 9, 0.8, 12, 0.7, 13.5, 0.6, HEX_FADE_ZOOM, 0];
const TRANSIT_HEX_OPACITY = ['interpolate', ['linear'], ['zoom'],
  9, fewOpacity(0.8), 12, fewOpacity(0.7), 13.5, fewOpacity(0.6), HEX_FADE_ZOOM, 0];

const share = (prop) => ['/', num(prop), ['max', num('buildings'), 1]];
function transitColor(measure, dist) {
  const d = DIST[dist];
  let expr;
  if (measure === 'gap') {
    // No stop within the distance even in a straight line: nothing to overstate, so draw it gray.
    expr = ['case', ['==', num(d.eucl), 0], NO_DATA,
      stepColor(['-', share(d.eucl), share(d.net)], GAP_BREAKS, RAMP.plum)];
  } else {
    expr = stepColor(share(measure === 'net' ? d.net : d.eucl), SHARE_BREAKS, RAMP.teal);
  }
  return ['case', ['>', num('buildings'), 0], expr, 'rgba(0,0,0,0)'];
}
const pctFmt = (v) => `${Math.round(v * 100)}%`;
const ptsFmt = (v) => `${Math.round(v * 100)} pts`;

// Street network metrics, per hex.
const NET = {
  inter: { label: 'Intersections', title: 'Intersections per square mile', prop: 'intersections_per_km2',
           scale: 1 / SQMI_PER_KM2, breaks: [25, 50, 100, 150, 250], fmt: (v) => v },
  dead: { label: 'Dead ends', title: 'Dead-end share of street nodes', prop: 'dead_end_share',
          breaks: [0.05, 0.1, 0.2, 0.33, 0.5], fmt: pctFmt },
};
const netColor = (k) => ['case', ['>', num('intersections'), 0],
  stepColor(['*', num(NET[k].prop), NET[k].scale || 1], NET[k].breaks, RAMP.slate), 'rgba(0,0,0,0)'];

// Bus route widths, scaled by weekday trips: under 40, 40-99 and 100+.
const TRIP_BREAKS = [40, 100];
const tripScale = ['step', ['to-number', ['coalesce', ['get', 'weekday_trips'], 50]], 0.8, 40, 1.0, 100, 1.6];
const busWidth = (z9, z12, z15) => ['interpolate', ['linear'], ['zoom'],
  9, ['*', z9, tripScale], 12, ['*', z12, tripScale], 15, ['*', z15, tripScale]];

/** Approximate headway, assuming an ~18-hour service day split over two directions. */
function headwayMinutes(trips) {
  if (!trips) return null;
  return Math.round((18 * 60) / (trips / 2));
}

const ISO_EMPTY = { type: 'FeatureCollection', features: [] };

function setup(map) {
  // Transit
  map.addSource('hex-transit', tileSource('analysis.hex_transit', {
    properties: ['buildings', 'q_mile_net', 'q_mile_eucl', 'h_mile_net', 'h_mile_eucl', 'median_net_m', 'median_detour_ratio'],
    maxzoom: 14 }));
  map.addSource('bldg-transit', tileSource('analysis.building_transit', { properties: ['net_m', 'eucl_m'], minzoom: 14 }));
  map.addSource('routes', tileSource('core.transit_routes', {
    properties: ['route_short_name', 'route_long_name', 'mode', 'weekday_trips'], maxzoom: 14 }));
  map.addSource('stops', tileSource('core.transit_stops', { properties: ['stop_name', 'is_rail', 'weekday_departures', 'routes'], maxzoom: 14 }));
  map.addLayer({ id: 'transit-hex', type: 'fill', source: 'hex-transit', 'source-layer': 'analysis.hex_transit',
    maxzoom: HEX_FADE_ZOOM,
    paint: { 'fill-color': transitColor('net', 'q'), 'fill-opacity': TRANSIT_HEX_OPACITY } }, 'roads-anchor');
  map.addLayer({ id: 'transit-bldg', type: 'circle', source: 'bldg-transit', 'source-layer': 'analysis.building_transit',
    minzoom: 14,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 5],
             'circle-color': stepColor(['get', 'net_m'], WALK_BREAKS, [...RAMP.teal].reverse()),
             'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.5 } }, 'top-anchor');

  // Network metrics
  map.addSource('hex-network', tileSource('analysis.hex_network', {
    properties: ['intersections', 'dead_ends', 'intersections_per_km2', 'dead_end_share', 'street_km_per_km2'],
    maxzoom: 14 }));
  map.addLayer({ id: 'net-hex', type: 'fill', source: 'hex-network', 'source-layer': 'analysis.hex_network',
    layout: { visibility: 'none' },
    paint: { 'fill-color': netColor('inter'), 'fill-opacity': HEX_OPACITY } }, 'roads-anchor');

  // QC findings
  const qc = (id, layer, props, extra) => {
    map.addSource(id, tileSource(layer, { properties: props, maxzoom: 15 }));
    map.addLayer({ id, source: id, 'source-layer': layer, layout: { visibility: 'none' }, ...extra }, 'top-anchor');
  };
  qc('qc-islands', 'qc.net_islands', ['mode', 'edges', 'length_m'], { type: 'line',
    paint: { 'line-color': QC.island, 'line-width': 2.2, 'line-dasharray': [2, 1] } });
  qc('qc-overlaps', 'qc.net_overlaps', ['class_a', 'class_b', 'overlap_m'], { type: 'line',
    paint: { 'line-color': QC.overlap, 'line-width': 4, 'line-opacity': 0.8 } });
  qc('qc-dead', 'qc.net_dead_ends', ['road_class', 'name', 'near_miss_m', 'at_boundary'], { type: 'circle',
    minzoom: 12, filter: ['all', ['!', ['to-boolean', ['get', 'at_boundary']]], ['!', ['has', 'near_miss_m']]],
    paint: { 'circle-radius': 2.2, 'circle-color': QC.dead_end } });
  // Near misses (likely missing connections) at every zoom, from the same tiles.
  map.addLayer({ id: 'qc-near', type: 'circle', source: 'qc-dead', 'source-layer': 'qc.net_dead_ends',
    layout: { visibility: 'none' },
    filter: ['all', ['!', ['to-boolean', ['get', 'at_boundary']]], ['has', 'near_miss_m']],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 15, 5.5], 'circle-color': QC.near_miss,
             'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } }, 'top-anchor');
  qc('qc-cross', 'qc.net_unnoded_crossings', ['kind', 'class_a', 'class_b'], { type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': QC.crossing,
             'circle-stroke-width': 2.5 } });
  qc('qc-traps', 'qc.net_oneway_traps', ['vertex_id'], { type: 'circle',
    paint: { 'circle-radius': 4, 'circle-color': QC.trap, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });

  // Routes and stops sit on top. Each line is a cream casing under a darker core, so it stays
  // readable over any hex color. Bus lines get wider with more weekday trips.
  const bus = ['==', ['get', 'mode'], 'bus'];
  const rail = ['==', ['get', 'mode'], 'rail'];
  const lineLayout = { 'line-join': 'round', 'line-cap': 'round' };
  map.addLayer({ id: 'routes-bus-casing', type: 'line', source: 'routes', 'source-layer': 'core.transit_routes',
    filter: bus, layout: lineLayout,
    paint: { 'line-color': TRANSIT.casing, 'line-opacity': 0.9, 'line-width': busWidth(2.0, 3.4, 6) } }, 'top-anchor');
  map.addLayer({ id: 'routes-bus', type: 'line', source: 'routes', 'source-layer': 'core.transit_routes',
    filter: bus, layout: lineLayout,
    paint: { 'line-color': TRANSIT.bus, 'line-opacity': 0.9, 'line-width': busWidth(0.9, 1.5, 3) } }, 'top-anchor');
  map.addLayer({ id: 'routes-rail-casing', type: 'line', source: 'routes', 'source-layer': 'core.transit_routes',
    filter: rail, layout: lineLayout,
    paint: { 'line-color': TRANSIT.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 15, 8] } }, 'top-anchor');
  map.addLayer({ id: 'routes-rail', type: 'line', source: 'routes', 'source-layer': 'core.transit_routes',
    filter: rail, layout: lineLayout,
    paint: { 'line-color': ['match', ['get', 'route_short_name'], 'MLR', TRANSIT.MLR, 'MLB', TRANSIT.MLB, TRANSIT.bus],
             'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 15, 5] } }, 'top-anchor');
  // An invisible, wider copy of the bus lines, so a route is easy to click (Transit network mode only).
  map.addLayer({ id: 'routes-bus-hit', type: 'line', source: 'routes', 'source-layer': 'core.transit_routes',
    filter: bus, layout: { visibility: 'none' },
    paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 12 } }, 'top-anchor');
  map.addLayer({ id: 'stops', type: 'circle', source: 'stops', 'source-layer': 'core.transit_stops', minzoom: 11,
    paint: { 'circle-radius': ['interpolate', ['linear'], num('weekday_departures'), 0, 1.8, 100, 3.5, 400, 7],
             'circle-color': ['case', ['to-boolean', ['get', 'is_rail']], '#ffffff', TRANSIT.stop],
             'circle-stroke-color': ['case', ['to-boolean', ['get', 'is_rail']], '#1d1d1d', TRANSIT.casing],
             'circle-stroke-width': ['case', ['to-boolean', ['get', 'is_rail']], 2, 0.8] } }, 'top-anchor');
  // Route numbers along the bus lines from zoom 13.
  map.addLayer({ id: 'routes-bus-label', type: 'symbol', source: 'routes', 'source-layer': 'core.transit_routes',
    minzoom: 13, filter: bus,
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'route_short_name'], 'text-font': MEDIUM,
              'text-size': 11, 'symbol-spacing': 400 },
    paint: { 'text-color': TRANSIT.bus, 'text-halo-color': TRANSIT.casing, 'text-halo-width': 1.5 } });
  // A "collision blocker": an invisible letter on each rail station. Circles don't take part in
  // label placement, but symbols do, so this keeps landmark labels from landing on a station.
  map.addLayer({ id: 'rail-stop-blocker', type: 'symbol', source: 'stops', 'source-layer': 'core.transit_stops',
    minzoom: 11, filter: ['to-boolean', ['get', 'is_rail']],
    layout: { 'text-field': 'O', 'text-font': MEDIUM, 'text-size': 16, 'text-allow-overlap': true },
    paint: { 'text-opacity': 0 } });

  // Isochrones (filled by the click tool)
  map.addSource('iso', { type: 'geojson', data: ISO_EMPTY });
  map.addSource('iso-start', { type: 'geojson', data: ISO_EMPTY });
  map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', layout: { visibility: 'none' },
    paint: { 'fill-color': ['match', ['get', 'minutes'], 5, ISO[5], 10, ISO[10], ISO[15]], 'fill-opacity': 0.42 } }, 'roads-anchor');
  map.addLayer({ id: 'iso-line', type: 'line', source: 'iso', layout: { visibility: 'none' },
    paint: { 'line-color': ISO[5], 'line-width': 1.2 } }, 'top-anchor');
  map.addLayer({ id: 'iso-start', type: 'circle', source: 'iso-start', layout: { visibility: 'none' },
    paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': ISO[5], 'circle-stroke-width': 3 } }, 'top-anchor');

  // Popups
  clickPopup(map, 'stops', (p) => `<strong>${p.stop_name}</strong><br>${fmt.int(p.weekday_departures)} weekday departures<br>Routes: ${p.routes || '—'}`);
  clickPopup(map, 'routes-bus-hit', routePopup, { unless: ['stops'] });
  clickPopup(map, 'transit-hex', (p) => p.buildings > 0 ? `
    <strong>${fmt.int(p.buildings)} buildings</strong><br>
    Within ¼ mile: ${pctFmt(p.q_mile_net / p.buildings)} walking vs. ${pctFmt(p.q_mile_eucl / p.buildings)} straight line<br>
    Typical walk to a stop: ${fmt.dist(p.median_net_m)}, ${fmt.num(p.median_detour_ratio, 2)}× the straight-line distance` : 'No buildings');
  clickPopup(map, 'transit-bldg', (p) => `Walk to nearest stop: <strong>${fmt.dist(p.net_m)}</strong><br>Straight line: ${fmt.dist(p.eucl_m)}`);
  // street km per km2 x 1.609 = street miles per square mile
  clickPopup(map, 'net-hex', (p) => `<strong>${fmt.int(p.intersections)} intersections</strong>, ${fmt.int(p.dead_ends)} dead ends<br>${fmt.int(p.intersections_per_km2 / SQMI_PER_KM2)} per sq mi · ${fmt.num(p.street_km_per_km2 * 1.609344)} street miles per sq mi`);
  const deadPopup = (p) => `<strong>Dead end</strong> on ${p.name || p.road_class}<br>${p.near_miss_m != null ? `Near miss: ${fmt.dist(p.near_miss_m)} from another street (likely a missing connection)` : 'No other street within 10 ft'}`;
  clickPopup(map, 'qc-dead', deadPopup);
  clickPopup(map, 'qc-near', deadPopup);
  clickPopup(map, 'qc-cross', (p) => `<strong>Crossing with no shared node</strong><br>${p.kind}: ${p.class_a} × ${p.class_b}`);
  clickPopup(map, 'qc-overlaps', (p) => `<strong>Duplicated way</strong><br>${p.class_a} / ${p.class_b}, ${fmt.ft(p.overlap_m)} overlap`);
  clickPopup(map, 'qc-islands', (p) => `<strong>${p.mode} island</strong><br>${fmt.int(p.edges)} edges, ${fmt.mi(p.length_m, 2)}, not joined to the main network`);
  clickPopup(map, 'qc-traps', () => '<strong>One-way trap</strong><br>Reachable by car but no legal way back out (or the reverse)');
}

function routePopup(p) {
  const name = [p.route_short_name, p.route_long_name].filter(Boolean).join(' ');
  const trips = Number(p.weekday_trips);
  const headway = headwayMinutes(trips);
  const service = headway
    ? `${fmt.int(trips)} weekday trips<br>A bus about every ${headway} min each way`
    : 'Weekday trips not available';
  return `<strong>${name || 'Bus route'}</strong><br>${service}`;
}

/** The chip at the top of the map that says what it shows. */
function mapTitle({ mode, measure, dist, travel, netMetric }) {
  const d = DIST[dist];
  if (mode === 'transit') {
    if (measure === 'net') return `Share of buildings within a ${d.adj} walk of a weekday stop`;
    if (measure === 'eucl') return `Share of buildings within ${d.label} of a stop, straight line`;
    return `How far a straight-line ${d.adj} buffer overstates walk access (percentage points)`;
  }
  if (mode === 'routes') return 'Metro bus and MetroLink routes, by weekday trips';
  if (mode === 'iso') return `How far you can ${travel} in 5, 10 and 15 minutes`;
  if (mode === 'network') return NET[netMetric].title;
  return 'Street network QC findings';
}

/** Show the API's 1/4 and 1/2 as the single characters used everywhere else on the site. */
const niceFraction = (label) => label.replace('1/4', '¼').replace('1/2', '½');

export default function Transportation() {
  const [map, setMap] = useState(null);
  const [mode, setMode] = useState('transit');
  const [measure, setMeasure] = useState('net');
  const [dist, setDist] = useState('q');
  const [netMetric, setNetMetric] = useState('inter');
  const [travel, setTravel] = useState('walk');
  const [iso, setIso] = useState({ status: 'idle' });
  const [routesOn, setRoutesOn] = useState(ROUTES_DEFAULT);
  const [zoomedIn, setZoomedIn] = useState(false);  // past the zoom where hexes fade out
  const access = useApi('/stats/transit-access').data;
  const network = useApi('/stats/network').data;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const travelRef = useRef(travel);
  travelRef.current = travel;
  const lastClick = useRef(null);

  // Routes are the subject of Transit network mode, so they're always on there.
  const showRoutes = mode === 'routes' || routesOn[mode];
  const setShowRoutes = (on) => setRoutesOn((s) => ({ ...s, [mode]: on }));

  useEffect(() => {
    if (!map) return;
    setVisible(map, ALL, false);
    setVisible(map, LAYERS[mode], true);
    // In Transit network mode, show stops one zoom level earlier.
    if (map.getLayer('stops')) map.setLayerZoomRange('stops', mode === 'routes' ? 10 : 11, 24);
  }, [map, mode]);
  useEffect(() => { if (map) map.setPaintProperty('transit-hex', 'fill-color', transitColor(measure, dist)); }, [map, measure, dist]);
  useEffect(() => { if (map) map.setPaintProperty('net-hex', 'fill-color', netColor(netMetric)); }, [map, netMetric]);
  useEffect(() => { if (map) setVisible(map, ROUTE_LAYERS, showRoutes); }, [map, showRoutes]);

  useEffect(() => {  // track whether the hexes have faded out, for the "zoom out" chip
    if (!map) return undefined;
    const onZoom = () => setZoomedIn(map.getZoom() > HEX_FADE_ZOOM);
    onZoom();
    map.on('zoom', onZoom);
    return () => map.off('zoom', onZoom);
  }, [map]);

  async function runIso(lngLat, how) {
    lastClick.current = lngLat;
    setIso({ status: 'loading', mode: how });
    try {
      const d = await getJSON('/isochrone', { lon: lngLat.lng.toFixed(6), lat: lngLat.lat.toFixed(6), mode: how, minutes: '5,10,15' });
      map.getSource('iso').setData(d);
      map.getSource('iso-start').setData({ type: 'Feature', geometry: d.start, properties: {} });
      const outer = d.features[0]?.geometry;  // largest band first
      if (outer) {
        const pts = (outer.type === 'Polygon' ? [outer.coordinates] : outer.coordinates).flat(2);
        const b = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [x, y] of pts) {
          b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
          b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
        }
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]],
                      { padding: 60, maxZoom: 15, duration: 600 });
      }
      setIso({ status: 'done', mode: how, data: d });
    } catch (e) {
      // The API answers a bad spot (outside the counties, too far from a street) with a 400 and a
      // plain-English `detail`, which getJSON passes on as the message. A TypeError means no answer at all.
      const message = e instanceof TypeError
        ? "Couldn't reach the isochrone service. Is the API running?"
        : e.message;
      map.getSource('iso')?.setData(ISO_EMPTY);
      map.getSource('iso-start')?.setData(ISO_EMPTY);
      setIso({ status: 'error', mode: how, error: message });
    }
  }

  useEffect(() => {
    if (!map) return undefined;
    const onClick = (e) => { if (modeRef.current === 'iso') runIso(e.lngLat, travelRef.current); };
    map.on('click', onClick);
    return () => map.off('click', onClick);
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {  // re-run for the new travel mode on the same point
    if (map && lastClick.current && mode === 'iso') runIso(lastClick.current, travel);
  }, [travel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (map) map.getCanvas().style.cursor = mode === 'iso' ? 'crosshair' : '';
  }, [map, mode]);

  const d = DIST[dist];
  return (
    <div className="map-page">
      <MapView setup={setup} onReady={setMap} label="Transportation map"
               title={mapTitle({ mode, measure, dist, travel, netMetric })}
               credits={mapCredits('Overture Maps', 'Metro Transit GTFS')}>
        {mode === 'iso' && iso.status === 'idle' && <div className="map-chip">Click the map to start</div>}
        {iso.status === 'loading' && mode === 'iso' && (
          <div className="map-chip"><span className="spinner" aria-hidden="true" />
            Computing {iso.mode === 'drive' ? 'drive (a couple of seconds)' : 'walk'}…</div>
        )}
        {mode === 'network' && zoomedIn && <div className="map-chip">Zoom out to see the hexagons</div>}
      </MapView>
      <MapPanel
        title="Transportation"
        lede="How well St. Louis is served by transit when you actually walk the streets, how far you can get in 5, 10 and 15 minutes, and what the street network looks like, flaws included."
        credits="Metro St. Louis GTFS (weekday service), Overture Maps buildings (ODbL)."
        how={<HowTransport mode={mode} />}
      >
        <Segmented label="Map" value={mode} onChange={setMode} options={MODES} className="segmented-modes" />

        {mode === 'transit' && <>
          <Segmented label="Distance" value={dist} onChange={setDist}
                     options={[{ value: 'q', label: '¼ mile' }, { value: 'h', label: '½ mile' }]} />
          <Segmented label="Measure" value={measure} onChange={setMeasure}
                     options={[{ value: 'net', label: 'Network walk' }, { value: 'eucl', label: 'Straight line' },
                               { value: 'gap', label: 'Overstated' }]} />
          {measure === 'gap'
            ? <Legend title={`Percentage points of the hex's buildings a straight-line ${d.adj} buffer counts but a ${d.adj} walk doesn't reach`}
                      items={[...stepLegend(GAP_BREAKS, RAMP.plum, ptsFmt),
                              { color: NO_DATA, label: `No stop within ${d.short} either way` }]}
                      note={`Faded hexes have fewer than ${FEW_BUILDINGS} buildings.`} />
            : <Legend title={`Share of buildings within ${d.label} of a stop (${measure === 'net' ? 'walking the network' : 'straight line'})`}
                      items={stepLegend(SHARE_BREAKS, RAMP.teal, pctFmt)}
                      note={`Faded hexes have fewer than ${FEW_BUILDINGS} buildings.`} />}
          <Legend title="Each building's walk to the nearest stop, zoom 14+" kind="circle"
                  items={stepLegend(WALK_MILES, [...RAMP.teal].reverse(), (v) => MILE_LABEL[v])} />
          {access && <AccessTable access={access} />}
        </>}

        {mode === 'routes' && <p className="hint">Click a bus route for its weekday trips and how often it runs. Route numbers appear from zoom 13.</p>}

        {mode === 'iso' && <>
          <Segmented label="Travel mode" value={travel} onChange={setTravel}
                     options={[{ value: 'walk', label: 'Walk' }, { value: 'drive', label: 'Drive' }]} />
          <p className="hint">Click anywhere in St. Louis City or County. The start snaps to the nearest street.</p>
          <Legend title={`${travel === 'walk' ? 'Walking' : 'Driving'} time from the start`}
                  items={[5, 10, 15].map((m) => ({ color: ISO[m], label: `${m} minutes` }))} />
          {iso.status === 'error' && <p className="notice" role="status">{iso.error}</p>}
          {iso.status === 'done' && (
            <div className="stats">
              {[...iso.data.features].reverse().map((f) => (
                <Stat key={f.properties.minutes} value={isoArea(f.properties.area_km2)}
                      label={`within ${f.properties.minutes} min`} />
              ))}
              <p className="fine">Computed in {iso.data.elapsed_ms} ms{iso.data.cached ? ' (cached)' : ''}; start moved {fmt.dist(iso.data.snap_distance_m)} to the nearest street.</p>
            </div>
          )}
        </>}

        {mode === 'network' && <>
          <Segmented label="Metric" value={netMetric} onChange={setNetMetric}
                     options={Object.entries(NET).map(([value, x]) => ({ value, label: x.label }))} />
          <Legend title={NET[netMetric].title} items={stepLegend(NET[netMetric].breaks, RAMP.slate, NET[netMetric].fmt)}
                  note="Hexagons about ⅓ mile across. Streets exclude driveways, parking aisles and alleys." />
          {network && <div className="stats">
            <Stat value={fmt.int(network.metrics.intersections)} label="intersections" />
            <Stat value={fmt.int(network.metrics.intersections_per_km2 / SQMI_PER_KM2)} label="per sq mi" />
            <Stat value={fmt.pct(network.metrics.dead_end_share_pct)} label="dead ends" />
          </div>}
        </>}

        {mode === 'qc' && <>
          <Legend title="Network QC findings" kind="circle" items={[
            { color: QC.near_miss, label: 'Near miss: dead end within 10 ft of another street' },
            { color: QC.dead_end, label: 'Other dead end (zoom 12+)' },
            { color: QC.crossing, label: 'Crossing with no shared node', kind: 'ring' },
            { color: QC.trap, label: 'One-way trap' },
            { color: QC.overlap, label: 'Duplicated way', kind: 'line' },
            { color: QC.island, label: 'Island (not joined to main network)', kind: 'dash' },
          ]} />
          {network && <div className="stats">
            <Stat value={fmt.int(network.qc.near_misses)} label="near misses" />
            <Stat value={fmt.int(network.qc.unnoded_crossings)} label="unnoded crossings" />
            <Stat value={fmt.int(network.qc.overlaps)} label="duplicated ways" />
            <Stat value={fmt.int(network.qc.oneway_traps)} label="one-way traps" />
          </div>}
        </>}

        {mode !== 'routes' && (
          <Toggle checked={showRoutes} onChange={setShowRoutes}>Show transit routes and stops</Toggle>
        )}
        {showRoutes && <TransitLegend />}
      </MapPanel>
    </div>
  );
}

/** Isochrone area, with tiny areas shown as "< 0.01 sq mi" instead of 0.00. */
function isoArea(km2) {
  return km2 * SQMI_PER_KM2 < 0.005 ? '< 0.01 sq mi' : fmt.sqmi(km2);
}

function TransitLegend() {
  return <>
    <Legend title="Bus route, weekday trips" kind="line" items={[
      { color: TRANSIT.bus, width: 2, label: `Under ${TRIP_BREAKS[0]}` },
      { color: TRANSIT.bus, width: 3, label: `${TRIP_BREAKS[0]}–${TRIP_BREAKS[1] - 1}` },
      { color: TRANSIT.bus, width: 5, label: `${TRIP_BREAKS[1]}+` },
    ]} />
    <Legend title="MetroLink and stops" kind="line" items={[
      { color: TRANSIT.MLR, width: 4, label: 'MetroLink Red Line' },
      { color: TRANSIT.MLB, width: 4, label: 'MetroLink Blue Line' },
      { color: '#ffffff', outline: '#1d1d1d', label: 'MetroLink station', kind: 'ring' },
      { color: TRANSIT.stop, label: 'Bus stop (size = weekday departures)', kind: 'circle' },
    ]} />
  </>;
}

function AccessTable({ access }) {
  return (
    <table className="data">
      <caption>Buildings within walking distance of a stop</caption>
      <thead><tr><th>Distance</th><th>Straight line</th><th>Network walk</th><th>Straight line overstates by</th></tr></thead>
      <tbody>
        {access.distances.map((r) => (
          <tr key={r.label}>
            <td>{niceFraction(r.label)}</td>
            <td>{fmt.pct(r.straight_line.pct)}</td>
            <td>{fmt.pct(r.network.pct)}</td>
            {/* Relative difference, then the gap in percentage points (what the map shows). */}
            <td><strong>{fmt.pct(r.pct_overstated, 0)}</strong> ({fmt.num(r.straight_line.pct - r.network.pct)} pts)</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={4}>
        For the typical building, the walk to the nearest stop is
        about <strong>{fmt.num(access.median_detour_ratio, 1)}×</strong> the straight-line distance.
      </td></tr></tfoot>
    </table>
  );
}

function HowTransport({ mode }) {
  if (mode === 'routes') return <>
    <p>Routes, stops and trips come from Metro's GTFS feed. Each bus route is drawn wider the more trips it runs on a representative weekday ({GTFS_SAMPLE_DAY}), counting both directions. Stops are sized by their departures that day.</p>
    <p>The headway in each route's popup is a rough average: the day's trips split over two directions and spread across an 18-hour service day. Real schedules run more often at rush hour and less often at night.</p>
  </>;
  if (mode === 'iso') return <>
    <p>The street network was built in PostGIS from OpenStreetMap ways, split where ways share a node, and routed with pgRouting. Walking is 3 mph on any walkable way; driving uses posted speeds or road-class defaults and respects one-way streets. Drive times are free-flow, with no traffic.</p>
    <p>Each click runs <code>pgr_dijkstraCost</code> from the nearest network node, and each band is a concave hull of the nodes reached in time, slightly smoothed.</p>
  </>;
  if (mode === 'network') return <p>Intersections are street nodes where three or more streets meet; dead ends have one. Both are counted per hexagon (about ⅓ mile across) from the routable network, leaving out driveways, parking aisles and alleys.</p>;
  if (mode === 'qc') return <p>A data-production QC pass over the routable network. Dead ends within 3 m (10 ft) of another street are likely missing connections (undershoots). Crossings with no shared node on the same layer are either missing junctions or missing bridge tags. Islands are pieces not joined to the main network, and one-way traps are places a car can enter but not leave. Dead ends at the study boundary are clipping artifacts and are hidden.</p>;
  return <>
    <p>Every building was snapped to the nearest walkable street, and one Dijkstra run from all stops with weekday service gave each building its walking distance to the nearest stop. That was compared with the usual straight-line buffer around stops.</p>
    <p>Straight-line buffers count buildings across rivers, rail yards, highways and dead-end subdivisions that a real walk can't cross in that distance, so they overstate access.</p>
  </>;
}
