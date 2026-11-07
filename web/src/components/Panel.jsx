import { BASE_CREDIT } from '../map/basemap.js';

/** A legend: a title and rows of swatches. `kind` is fill, line or circle. */
export function Legend({ title, items, kind = 'fill', note }) {
  return (
    <figure className="legend">
      <figcaption>{title}</figcaption>
      <ul>
        {items.map((it) => (
          <li key={it.label}>
            <span className={`swatch swatch-${it.kind || kind}`}
                  style={{ '--c': it.color, '--o': it.outline || it.color }} aria-hidden="true" />
            {it.label}
          </li>
        ))}
      </ul>
      {note && <p className="legend-note">{note}</p>}
    </figure>
  );
}

/** The side panel on every map page: what it shows, how it was made, controls, credits. */
export function MapPanel({ title, lede, children, how, credits }) {
  return (
    <aside className="panel">
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
      {how && (
        <details className="how" open>
          <summary>How it was made</summary>
          {how}
        </details>
      )}
      <p className="credits">
        <strong>Sources:</strong> {credits} {BASE_CREDIT}
      </p>
    </aside>
  );
}

/** A row of mutually exclusive buttons. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
                className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labeled checkbox for an overlay. */
export function Toggle({ checked, onChange, children }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Stat({ value, label }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
