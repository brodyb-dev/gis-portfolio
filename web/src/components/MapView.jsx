import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LABEL_LAYERS, baseStyle } from '../map/basemap.js';
import { MAX_BOUNDS, STUDY_BOUNDS } from '../config.js';

/**
 * A MapLibre map on the project basemap. `setup(map)` runs once the style has loaded and adds
 * the page's own sources and layers, then `onReady(map)` hands the map to the page so its
 * effects can restyle layers. `children` render on top of the map (status chips and such).
 * `title` is a short chip saying what the map shows; `credits` is the HTML for the on-map attribution.
 */
export default function MapView({ setup, onReady, children, label = 'Map', bounds = STUDY_BOUNDS, title, credits }) {
  const container = useRef(null);
  const [map, setMap] = useState(null);
  const [labels, setLabels] = useState(true);
  const [busy, setBusy] = useState(true);  // tiles still loading
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current,
      style: baseStyle(),
      bounds,
      fitBoundsOptions: { padding: 24 },
      minZoom: 8.5,
      maxZoom: 18,
      maxBounds: MAX_BOUNDS,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
    // A compact "i" credit on the map itself (OpenStreetMap's license asks for attribution near the map).
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: credits }), 'bottom-right');
    // Say so while tiles are on their way, so a half-drawn layer doesn't read as missing data.
    m.on('dataloading', () => setBusy(true));
    m.on('idle', () => setBusy(false));
    m.on('load', () => {
      // MapLibre opens the compact credit at first. On a phone it covers the map, so start it
      // collapsed there; the "i" button still opens it.
      if (window.matchMedia('(max-width: 820px)').matches) {
        m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      }
      setupRef.current?.(m);
      setMap(m);
      readyRef.current?.(m);
    });
    return () => m.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (map) setVisible(map, LABEL_LAYERS, labels); }, [map, labels]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" role="region" aria-label={label} />
      {/* Top-left stack: labels button, what-this-map-shows title, then any status chips. Stacking
          them in one column keeps them from overlapping each other on a narrow phone screen. */}
      <div className="map-stack">
        {map && (
          <button type="button" className="map-labels-btn" aria-pressed={labels}
                  onClick={() => setLabels((v) => !v)}
                  title="Show or hide street, place and landmark names">
            {labels ? 'Hide labels' : 'Show labels'}
          </button>
        )}
        {map && title && <div className="map-title">{title}</div>}
        {children}
      </div>
      {!map && <div className="map-loading">Loading map…</div>}
      {map && busy && <div className="map-busy" role="status"><span className="spinner" aria-hidden="true" />Loading map data…</div>}
    </div>
  );
}

/** Show or hide a set of layers. */
export function setVisible(map, ids, on) {
  if (!map.style) return;  // map already removed (unmount, or a dev hot reload)
  for (const id of [].concat(ids)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

/**
 * Show a popup with `html(props)` when a feature of `layerId` is clicked. `unless` lists layers
 * that win when both are under the click (say, a stop sitting on a route), so only one popup opens.
 */
export function clickPopup(map, layerId, html, { unless = [] } = {}) {
  map.on('click', layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const others = unless.filter((id) => map.getLayer(id));
    if (others.length && map.queryRenderedFeatures(e.point, { layers: others }).length) return;
    new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(e.lngLat).setHTML(html(f.properties)).addTo(map);
  });
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
}
