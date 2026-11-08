import { BASE_CREDIT } from '../map/basemap.js';

/**
 * One legend swatch. `kind` is fill, line, circle, ring or hatch. `outline` colors a ring or a
 * hatch background; `width` sets a line's thickness in px; `faded` lowers the opacity.
 */
function Swatch({ color, kind, outline, width, faded }) {
  const style = { '--c': color, '--o': outline || color };
  if (width) style['--w'] = `${width}px`;
  if (faded) style.opacity = 0.35;
  return <span className={`swatch swatch-${kind}`} style={style} aria-hidden="true" />;
}

/**
 * A legend: a title and rows of swatches. `kind` is the default swatch kind for every row.
 * A row with `colors: [...]` shows one swatch per color (for example one per flood zone).
 */
export function Legend({ title, items, kind = 'fill', note }) {
  return (
    <figure className="legend">
      <figcaption>{title}</figcaption>
      <ul>
        {items.map((it) => (
          <li key={it.label}>
            {(it.colors || [it.color]).map((c, i) => (
              <Swatch key={i} color={c} kind={it.kind || kind} outline={it.outline}
                      width={it.width} faded={it.faded} />
            ))}
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

/** A row of mutually exclusive buttons. `className` adds a layout variant (e.g. a grid). */
export function Segmented({ options, value, onChange, label, className = '' }) {
  return (
    <div className={`segmented ${className}`.trim()} role="radiogroup" aria-label={label}>
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
