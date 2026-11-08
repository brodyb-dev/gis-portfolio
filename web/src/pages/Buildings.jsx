import { useEffect, useState } from 'react';
import MapView, { clickPopup } from '../components/MapView.jsx';
import { Legend, MapPanel, Segmented, Stat } from '../components/Panel.jsx';
import { BASE, RAMP, stepColor, stepLegend } from '../map/palette.js';
import { tileSource } from '../config.js';
import { FT_PER_M, SQMI_PER_KM2, fmt, useApi } from '../api.js';

const METRICS = {
  density: {
    label: 'Count', title: 'Buildings per square mile', prop: 'bldg_per_km2', scale: 1 / SQMI_PER_KM2,
    breaks: [125, 400, 800, 1500, 2500], fmt: (v) => v.toLocaleString('en-US'),
  },
  coverage: {
    label: 'Area', title: 'Footprint coverage (% of hex)', prop: 'coverage_pct',
    breaks: [2, 5, 10, 15, 20], fmt: (v) => `${v}%`,
  },
  height: {
    label: 'Height', title: 'Tall buildings (90th-percentile height)', prop: 'p90_height_m', scale: FT_PER_M,
    breaks: [18, 22, 26, 40, 80], fmt: (v) => `${v} ft`, minCount: 10,
  },
};
const HEIGHT_BREAKS = [13, 20, 30, 50, 100];  // feet
const HEX_NOTE = 'Hexagons 500 m (about ⅓ mile) across, 54 acres each; zoom 9–14';
const HEX_FADE = ['interpolate', ['linear'], ['zoom'], 13, 0.85, 14.5, 0];

function hexColor(m) {
  const value = ['*', ['to-number', ['get', m.prop], 0], m.scale || 1];
  const color = stepColor(value, m.breaks, RAMP.brick);
  const enough = ['>=', ['get', 'bldg_count'], m.minCount || 1];
  return ['case', enough, color, 'rgba(0,0,0,0)'];
}

function setup(map) {
  map.addSource('hex', tileSource('analysis.hex_buildings', {
    properties: ['bldg_count', 'bldg_per_km2', 'coverage_pct', 'median_height_m', 'p90_height_m'],
    maxzoom: 14,
  }));
  map.addSource('bldg', tileSource('core.buildings', { properties: ['height_m', 'bldg_class'], minzoom: 13 }));
  map.addLayer({
    id: 'hex-fill', type: 'fill', source: 'hex', 'source-layer': 'analysis.hex_buildings',
    maxzoom: 14.5,
    paint: { 'fill-color': hexColor(METRICS.density), 'fill-opacity': HEX_FADE },
  }, 'roads-anchor');
  map.addLayer({
    id: 'hex-line', type: 'line', source: 'hex', 'source-layer': 'analysis.hex_buildings',
    minzoom: 11, maxzoom: 14.5,
    paint: { 'line-color': '#ffffff', 'line-width': 0.4, 'line-opacity': 0.6 },
  }, 'roads-anchor');
  map.addLayer({
    id: 'bldg-fill', type: 'fill', source: 'bldg', 'source-layer': 'core.buildings', minzoom: 13,
    paint: {
      'fill-color': ['case', ['has', 'height_m'],
        stepColor(['*', ['get', 'height_m'], FT_PER_M], HEIGHT_BREAKS, RAMP.brick), BASE.building],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.95],
      'fill-outline-color': 'rgba(95,36,18,0.35)',
    },
  }, 'top-anchor');
  clickPopup(map, 'hex-fill', (p) => `
    <strong>${fmt.int(p.bldg_count)} buildings</strong> in this hexagon<br>
    ${fmt.int(p.bldg_per_km2 / SQMI_PER_KM2)} per sq mi · ${fmt.num(p.coverage_pct)}% covered<br>
    Median height ${p.median_height_m ? fmt.ft(p.median_height_m) : '—'},
    90th pct ${p.p90_height_m ? fmt.ft(p.p90_height_m) : '—'}`);
  clickPopup(map, 'bldg-fill', (p) => `
    <strong>${p.bldg_class || 'Building'}</strong><br>
    Height: ${p.height_m ? fmt.ft(p.height_m) : 'not in source'}`);
}

export default function Buildings() {
  const [map, setMap] = useState(null);
  const [metric, setMetric] = useState('density');
  const { data } = useApi('/stats/buildings');
  const m = METRICS[metric];

  useEffect(() => {
    if (map) map.setPaintProperty('hex-fill', 'fill-color', hexColor(m));
  }, [map, m]);

  return (
    <div className="map-page">
      <MapView setup={setup} onReady={setMap} label="Building density map" />
      <MapPanel
        title="Buildings"
        lede="Where St. Louis is built up, how much ground buildings cover, and where the tall ones are. Zoom in past the hexagons to see individual footprints colored by height."
        credits="Overture Maps buildings (ODbL), U.S. Census TIGER/Line 2024."
        how={<>
          <p>500,066 Overture building footprints were loaded into PostGIS and projected to NAD83 / UTM 15N (EPSG:26915). A grid of hexagons 500 m (about ⅓ mile) across from <code>ST_HexagonGrid</code> was clipped to the study area, and each building was counted in the hex that holds its interior point.</p>
          <p>Coverage is footprint area over hex area. Height uses the 90th percentile so a single tower doesn't dominate a hex; hexes with fewer than 10 buildings are left blank for height. Hex areas include the rivers, so river hexes read low.</p>
        </>}
      >
        <Segmented label="Hexagon measure" value={metric} onChange={setMetric}
                   options={Object.entries(METRICS).map(([value, x]) => ({ value, label: x.label }))} />
        <Legend title={m.title} items={stepLegend(m.breaks, RAMP.brick, m.fmt)}
                note={HEX_NOTE} />
        <Legend title="Building height, zoom 14+"
                items={[...stepLegend(HEIGHT_BREAKS, RAMP.brick, (v) => `${v} ft`),
                        { color: BASE.building, label: 'No height in source' }]} />
        {data && (
          <div className="stats">
            {data.areas.map((a) => (
              <div key={a.area} className="stat-group">
                <h2>{a.area}</h2>
                <Stat value={fmt.int(a.buildings)} label="buildings" />
                <Stat value={fmt.int(a.buildings_per_km2 / SQMI_PER_KM2)} label="per sq mi" />
                <Stat value={fmt.pct(a.coverage_pct)} label="covered" />
              </div>
            ))}
          </div>
        )}
      </MapPanel>
    </div>
  );
}
