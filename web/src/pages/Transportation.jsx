import { useEffect, useRef, useState } from 'react';
import MapView, { clickPopup, setVisible } from '../components/MapView.jsx';
import { Legend, MapPanel, Segmented, Stat, Toggle } from '../components/Panel.jsx';
import { ISO, QC, RAMP, TRANSIT, stepColor, stepLegend } from '../map/palette.js';
import { tileSource } from '../config.js';
import { fmt, getJSON, useApi } from '../api.js';

const MODES = [
  { value: 'transit', label: 'Transit access' },
  { value: 'iso', label: 'Isochrones' },
  { value: 'network', label: 'Street network' },
  { value: 'qc', label: 'Network QC' },
];
const LAYERS = {
  transit: ['transit-hex', 'transit-bldg'],
  iso: ['iso-fill', 'iso-line', 'iso-start'],
  network: ['net-hex'],
  qc: ['qc-islands', 'qc-overlaps', 'qc-dead', 'qc-near', 'qc-cross', 'qc-traps'],
};
const ALL = Object.values(LAYERS).flat();

// Transit access shares, per hex.
const DIST = { q: { label: '¼ mile', net: 'q_mile_net', eucl: 'q_mile_eucl' },
               h: { label: '½ mile', net: 'h_mile_net', eucl: 'h_mile_eucl' } };
const SHARE_BREAKS = [0.1, 0.25, 0.5, 0.75, 0.9];
const GAP_BREAKS = [0.05, 0.1, 0.2, 0.3, 0.4];
const WALK_BREAKS = [200, 400, 800, 1600, 3200];
const share = (prop) => ['/', ['to-number', ['get', prop], 0], ['max', ['to-number', ['get', 'buildings'], 0], 1]];
function transitColor(measure, dist) {
  const d = DIST[dist];
  const expr = measure === 'gap'
    ? stepColor(['-', share(d.eucl), share(d.net)], GAP_BREAKS, RAMP.plum)
    : stepColor(share(measure === 'net' ? d.net : d.eucl), SHARE_BREAKS, RAMP.teal);
  return ['case', ['>', ['to-number', ['get', 'buildings'], 0], 0], expr, 'rgba(0,0,0,0)'];
}
const pctFmt = (v) => `${Math.round(v * 100)}%`;

// Street network metrics, per hex.
const NET = {
  inter: { label: 'Intersections', title: 'Intersections per km²', prop: 'intersections_per_km2',
           breaks: [10, 20, 40, 60, 90], fmt: (v) => v },
  dead: { label: 'Dead ends', title: 'Dead-end share of street nodes', prop: 'dead_end_share',
          breaks: [0.05, 0.1, 0.2, 0.33, 0.5], fmt: pctFmt },
};
const netColor = (k) => ['case', ['>', ['to-number', ['get', 'intersections'], 0], 0],
  stepColor(['to-number', ['get', NET[k].prop], 0], NET[k].breaks, RAMP.slate), 'rgba(0,0,0,0)'];

const ISO_EMPTY = { type: 'FeatureCollection', features: [] };

function setup(map) {
  // Transit
  map.addSource('hex-transit', tileSource('analysis.hex_transit', {
    properties: ['buildings', 'q_mile_net', 'q_mile_eucl', 'h_mile_net', 'h_mile_eucl', 'median_net_m', 'median_detour_ratio'],
    maxzoom: 14 }));
  map.addSource('bldg-transit', tileSource('analysis.building_transit', { properties: ['net_m', 'eucl_m'], minzoom: 14 }));
  map.addSource('routes', tileSource('core.transit_routes', { properties: ['route_short_name', 'route_long_name', 'mode'], maxzoom: 14 }));
  map.addSource('stops', tileSource('core.transit_stops', { properties: ['stop_name', 'is_rail', 'weekday_departures', 'routes'], maxzoom: 14 }));
  map.addLayer({ id: 'transit-hex', type: 'fill', source: 'hex-transit', 'source-layer': 'analysis.hex_transit',
    maxzoom: 14.5,
    paint: { 'fill-color': transitColor('net', 'q'),
             'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.85, 14.5, 0] } }, 'roads-anchor');
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
    paint: { 'fill-color': netColor('inter'), 'fill-opacity': 0.85 } }, 'roads-anchor');

  // QC findings
  const qc = (id, layer, props, extra) => {
    map.addSource(id, tileSource(layer, { properties: props, maxzoom: 15 }));
    map.addLayer({ id, source: id, 'source-layer': layer, layout: { visibility: 'none' }, ...extra }, 'top-anchor');
  };
  qc('qc-islands', 'qc.net_islands', ['mode', 'edges', 'length_m'], { type: 'line',
    paint: { 'line-color': QC.island, 'line-width': 2.2 } });
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

  // Routes and stops sit on top in every mode.
  map.addLayer({ id: 'routes-bus', type: 'line', source: 'routes', 'source-layer': 'core.transit_routes',
    filter: ['==', ['get', 'mode'], 'bus'],
    paint: { 'line-color': TRANSIT.bus, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 15, 2], 'line-opacity': 0.55 } }, 'top-anchor');
  map.addLayer({ id: 'routes-rail', type: 'line', source: 'routes', 'source-layer': 'core.transit_routes',
    filter: ['==', ['get', 'mode'], 'rail'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['match', ['get', 'route_short_name'], 'MLR', TRANSIT.MLR, 'MLB', TRANSIT.MLB, TRANSIT.bus],
             'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 15, 5] } }, 'top-anchor');
  map.addLayer({ id: 'stops', type: 'circle', source: 'stops', 'source-layer': 'core.transit_stops', minzoom: 11,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'weekday_departures'], 0, 1.8, 100, 3.5, 400, 7],
             'circle-color': ['case', ['to-boolean', ['get', 'is_rail']], '#ffffff', TRANSIT.stop],
             'circle-stroke-color': ['case', ['to-boolean', ['get', 'is_rail']], '#1d1d1d', '#ffffff'],
             'circle-stroke-width': ['case', ['to-boolean', ['get', 'is_rail']], 2, 0.6] } }, 'top-anchor');

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
  clickPopup(map, 'transit-hex', (p) => p.buildings > 0 ? `
    <strong>${fmt.int(p.buildings)} buildings</strong><br>
    Within ¼ mile: ${pctFmt(p.q_mile_net / p.buildings)} walking vs. ${pctFmt(p.q_mile_eucl / p.buildings)} straight line<br>
    Median walk to a stop: ${fmt.int(p.median_net_m)} m (${fmt.num(p.median_detour_ratio, 2)}× straight line)` : 'No buildings');
  clickPopup(map, 'transit-bldg', (p) => `Walk to nearest stop: <strong>${fmt.int(p.net_m)} m</strong><br>Straight line: ${fmt.int(p.eucl_m)} m`);
  clickPopup(map, 'net-hex', (p) => `<strong>${fmt.int(p.intersections)} intersections</strong>, ${fmt.int(p.dead_ends)} dead ends<br>${fmt.num(p.intersections_per_km2)} per km² · ${fmt.num(p.street_km_per_km2)} street km per km²`);
  const deadPopup = (p) => `<strong>Dead end</strong> on ${p.name || p.road_class}<br>${p.near_miss_m != null ? `Near miss: ${fmt.num(p.near_miss_m)} m from another edge (likely missing connection)` : 'No other edge within 3 m'}`;
  clickPopup(map, 'qc-dead', deadPopup);
  clickPopup(map, 'qc-near', deadPopup);
  clickPopup(map, 'qc-cross', (p) => `<strong>Crossing with no shared node</strong><br>${p.kind}: ${p.class_a} × ${p.class_b}`);
  clickPopup(map, 'qc-overlaps', (p) => `<strong>Duplicated way</strong><br>${p.class_a} / ${p.class_b}, ${fmt.int(p.overlap_m)} m overlap`);
  clickPopup(map, 'qc-islands', (p) => `<strong>${p.mode} island</strong><br>${fmt.int(p.edges)} edges, ${fmt.num(p.length_m / 1000, 2)} km, not joined to the main network`);
  clickPopup(map, 'qc-traps', () => '<strong>One-way trap</strong><br>Reachable by car but no legal way back out (or the reverse)');
}

export default function Transportation() {
  const [map, setMap] = useState(null);
  const [mode, setMode] = useState('transit');
  const [measure, setMeasure] = useState('net');
  const [dist, setDist] = useState('q');
  const [netMetric, setNetMetric] = useState('inter');
  const [travel, setTravel] = useState('walk');
  const [iso, setIso] = useState({ status: 'idle' });
  const [showRoutes, setShowRoutes] = useState(true);
  const access = useApi('/stats/transit-access').data;
  const network = useApi('/stats/network').data;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const travelRef = useRef(travel);
  travelRef.current = travel;
  const lastClick = useRef(null);

  useEffect(() => {
    if (!map) return;
    setVisible(map, ALL, false);
    setVisible(map, LAYERS[mode], true);
  }, [map, mode]);
  useEffect(() => { if (map) map.setPaintProperty('transit-hex', 'fill-color', transitColor(measure, dist)); }, [map, measure, dist]);
  useEffect(() => { if (map) map.setPaintProperty('net-hex', 'fill-color', netColor(netMetric)); }, [map, netMetric]);
  useEffect(() => { if (map) setVisible(map, ['routes-bus', 'routes-rail', 'stops'], showRoutes); }, [map, showRoutes]);

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
      setIso({ status: 'error', mode: how, error: e.message });
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
      <MapView setup={setup} onReady={setMap} label="Transportation map">
        {mode === 'iso' && iso.status === 'idle' && <div className="map-chip">Click the map to start</div>}
        {iso.status === 'loading' && mode === 'iso' && (
          <div className="map-chip"><span className="spinner" aria-hidden="true" />
            Computing {iso.mode === 'drive' ? 'drive (a couple of seconds)' : 'walk'}…</div>
        )}
      </MapView>
      <MapPanel
        title="Transportation"
        lede="How well St. Louis is served by transit when you actually walk the streets, how far you can get in 5, 10 and 15 minutes, and what the street network looks like, flaws included."
        credits="Metro St. Louis GTFS (weekday service), OpenStreetMap contributors (ODbL), Overture Maps buildings (ODbL)."
        how={<HowTransport mode={mode} />}
      >
        <Segmented label="Map" value={mode} onChange={setMode} options={MODES} />

        {mode === 'transit' && <>
          <Segmented label="Distance" value={dist} onChange={setDist}
                     options={[{ value: 'q', label: '¼ mile' }, { value: 'h', label: '½ mile' }]} />
          <Segmented label="Measure" value={measure} onChange={setMeasure}
                     options={[{ value: 'net', label: 'Network walk' }, { value: 'eucl', label: 'Straight line' },
                               { value: 'gap', label: 'Overstated' }]} />
          {measure === 'gap'
            ? <Legend title={`Share of buildings a straight-line ${d.label} buffer counts but a ${d.label} walk doesn't reach`}
                      items={stepLegend(GAP_BREAKS, RAMP.plum, pctFmt)} />
            : <Legend title={`Share of buildings within ${d.label} of a stop (${measure === 'net' ? 'walking the network' : 'straight line'})`}
                      items={stepLegend(SHARE_BREAKS, RAMP.teal, pctFmt)} />}
          <Legend title="Walk to nearest stop, zoom 14+ (m)" kind="circle"
                  items={stepLegend(WALK_BREAKS, [...RAMP.teal].reverse(), (v) => v.toLocaleString('en-US'))} />
          {access && <AccessTable access={access} />}
        </>}

        {mode === 'iso' && <>
          <Segmented label="Travel mode" value={travel} onChange={setTravel}
                     options={[{ value: 'walk', label: 'Walk' }, { value: 'drive', label: 'Drive' }]} />
          <p className="hint">Click anywhere in St. Louis City or County. The start snaps to the nearest street.</p>
          <Legend title={`${travel === 'walk' ? 'Walking' : 'Driving'} time from the start`}
                  items={[5, 10, 15].map((m) => ({ color: ISO[m], label: `${m} minutes` }))} />
          {iso.status === 'error' && <p className="error">{iso.error}</p>}
          {iso.status === 'done' && (
            <div className="stats">
              {[...iso.data.features].reverse().map((f) => (
                <Stat key={f.properties.minutes} value={`${fmt.num(f.properties.area_km2, 2)} km²`}
                      label={`within ${f.properties.minutes} min`} />
              ))}
              <p className="fine">Computed in {iso.data.elapsed_ms} ms{iso.data.cached ? ' (cached)' : ''}; start snapped {fmt.int(iso.data.snap_distance_m)} m.</p>
            </div>
          )}
        </>}

        {mode === 'network' && <>
          <Segmented label="Metric" value={netMetric} onChange={setNetMetric}
                     options={Object.entries(NET).map(([value, x]) => ({ value, label: x.label }))} />
          <Legend title={NET[netMetric].title} items={stepLegend(NET[netMetric].breaks, RAMP.slate, NET[netMetric].fmt)}
                  note="500 m hexagons. Streets exclude driveways, parking aisles and alleys." />
          {network && <div className="stats">
            <Stat value={fmt.int(network.metrics.intersections)} label="intersections" />
            <Stat value={fmt.num(network.metrics.intersections_per_km2)} label="per km²" />
            <Stat value={fmt.pct(network.metrics.dead_end_share_pct)} label="dead ends" />
          </div>}
        </>}

        {mode === 'qc' && <>
          <Legend title="Network QC findings" kind="circle" items={[
            { color: QC.near_miss, label: 'Near miss: dead end ≤ 3 m from another street' },
            { color: QC.dead_end, label: 'Other dead end (zoom 12+)' },
            { color: QC.crossing, label: 'Crossing with no shared node', kind: 'ring' },
            { color: QC.trap, label: 'One-way trap' },
            { color: QC.overlap, label: 'Duplicated way', kind: 'line' },
            { color: QC.island, label: 'Island (not joined to main network)', kind: 'line' },
          ]} />
          {network && <div className="stats">
            <Stat value={fmt.int(network.qc.near_misses)} label="near misses" />
            <Stat value={fmt.int(network.qc.unnoded_crossings)} label="unnoded crossings" />
            <Stat value={fmt.int(network.qc.overlaps)} label="duplicated ways" />
            <Stat value={fmt.int(network.qc.oneway_traps)} label="one-way traps" />
          </div>}
        </>}

        <Toggle checked={showRoutes} onChange={setShowRoutes}>Show transit routes and stops</Toggle>
        {showRoutes && <Legend title="Metro transit" kind="line" items={[
          { color: TRANSIT.MLR, label: 'MetroLink Red Line' },
          { color: TRANSIT.MLB, label: 'MetroLink Blue Line' },
          { color: TRANSIT.bus, label: 'Bus route' },
          { color: TRANSIT.stop, label: 'Stop (size = weekday departures, zoom 11+)', kind: 'circle' },
        ]} />}
      </MapPanel>
    </div>
  );
}

function AccessTable({ access }) {
  return (
    <table className="data">
      <caption>Buildings within walking distance of a stop</caption>
      <thead><tr><th>Distance</th><th>Straight line</th><th>Network walk</th><th>Overstated by</th></tr></thead>
      <tbody>
        {access.distances.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td>{fmt.pct(r.straight_line.pct)}</td>
            <td>{fmt.pct(r.network.pct)}</td>
            <td><strong>{fmt.pct(r.pct_overstated)}</strong></td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={4}>The median building's walk to its nearest stop is {access.median_detour_ratio}× the straight-line distance.</td></tr></tfoot>
    </table>
  );
}

function HowTransport({ mode }) {
  if (mode === 'iso') return <>
    <p>The street network was built in PostGIS from OpenStreetMap ways, split where ways share a node, and routed with pgRouting. Walking is 1.34 m/s (3 mph) on any walkable way; driving uses posted speeds or road-class defaults and respects one-way streets. Drive times are free-flow, with no traffic.</p>
    <p>Each click runs <code>pgr_dijkstraCost</code> from the nearest network node, and each band is a concave hull of the nodes reached in time, slightly smoothed.</p>
  </>;
  if (mode === 'network') return <p>Intersections are street nodes where three or more streets meet; dead ends have one. Both are counted per 500 m hexagon from the routable network, leaving out driveways, parking aisles and alleys.</p>;
  if (mode === 'qc') return <p>A data-production QC pass over the routable network. Dead ends within 3 m of another street are likely missing connections (undershoots). Crossings with no shared node on the same layer are either missing junctions or missing bridge tags. Islands are pieces not joined to the main network, and one-way traps are places a car can enter but not leave. Dead ends at the study boundary are clipping artifacts and are hidden.</p>;
  return <>
    <p>Every building was snapped to the nearest walkable street, and one Dijkstra run from all stops with weekday service gave each building its walking distance to the nearest stop. That was compared with the usual straight-line buffer around stops.</p>
    <p>Straight-line buffers count buildings across rivers, rail yards, highways and dead-end subdivisions that a real walk can't cross in that distance, so they overstate access.</p>
  </>;
}
