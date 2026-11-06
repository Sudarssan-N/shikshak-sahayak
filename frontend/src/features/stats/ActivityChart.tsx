import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export interface Day {
  day: string; // YYYY-MM-DD
  notes: number;
  confirmed: number;
}

const H = 220;
const M = { top: 12, right: 8, bottom: 28, left: 36 };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function label(day: string, long = false) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(
    "en-IN",
    long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" },
  );
}

/** Grouped daily bars (notes vs confirmed). Hand-rolled SVG; hover/focus readout + table view for a11y. */
export function ActivityChart({ days }: { days: Day[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = useMemo(() => niceMax(Math.max(0, ...days.map((d) => Math.max(d.notes, d.confirmed)))), [days]);
  const step = max % 4 === 0 ? max / 4 : max / 5;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

  const innerW = width - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const slot = innerW / Math.max(1, days.length);
  const barW = Math.max(1.5, Math.min(14, (slot - 4) / 2));
  const y = (v: number) => M.top + innerH - (v / max) * innerH;
  const labelEvery = width < 480 ? 10 : width < 760 ? 7 : 5;

  const shown = active ?? days.length - 1;
  const cur = days[shown];
  const totals = days.reduce((t, d) => ({ notes: t.notes + d.notes, confirmed: t.confirmed + d.confirmed }), {
    notes: 0,
    confirmed: 0,
  });

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width - M.left;
    const i = Math.floor(x / slot);
    if (i >= 0 && i < days.length) setActive(i);
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    const i = active ?? days.length - 1;
    let n = i;
    if (e.key === "ArrowLeft") n = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") n = Math.min(days.length - 1, i + 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = days.length - 1;
    else return;
    e.preventDefault();
    setActive(n);
  }

  return (
    <div className="st-chart">
      <div className="st-chart-top">
        <ul className="st-legend" aria-label="Legend">
          <li>
            <span className="st-key st-key-notes" aria-hidden="true" />
            Voice notes
          </li>
          <li>
            <span className="st-key st-key-conf" aria-hidden="true" />
            Records confirmed
          </li>
        </ul>
        <p className="st-readout num" aria-live="polite">
          {cur ? (
            <>
              <span className="muted">{label(cur.day, true)}</span>
              <span>
                <strong>{cur.notes}</strong> notes
              </span>
              <span>
                <strong>{cur.confirmed}</strong> confirmed
              </span>
            </>
          ) : null}
        </p>
      </div>
      <div ref={wrapRef} className="st-chart-svg">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`Daily activity, last ${days.length} days: ${totals.notes} voice notes and ${totals.confirmed} records confirmed. Use left and right arrow keys to read each day.`}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="st-gridline" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
              <text className="st-axis" x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {active !== null ? (
            <rect className="st-hover" x={M.left + active * slot} y={M.top} width={slot} height={innerH} rx={3} />
          ) : null}
          {days.map((d, i) => {
            const cx = M.left + i * slot + slot / 2;
            return (
              <g key={d.day}>
                {d.notes > 0 ? (
                  <rect
                    className="st-bar-notes"
                    x={cx - barW - 1}
                    y={y(d.notes)}
                    width={barW}
                    height={Math.max(1, y(0) - y(d.notes))}
                    rx={Math.min(2, barW / 2)}
                  />
                ) : null}
                {d.confirmed > 0 ? (
                  <rect
                    className="st-bar-conf"
                    x={cx + 1}
                    y={y(d.confirmed)}
                    width={barW}
                    height={Math.max(1, y(0) - y(d.confirmed))}
                    rx={Math.min(2, barW / 2)}
                  />
                ) : null}
                {(days.length - 1 - i) % labelEvery === 0 ? (
                  <text
                    className="st-axis"
                    x={i === days.length - 1 ? width - M.right : cx}
                    y={H - 8}
                    textAnchor={i === days.length - 1 ? "end" : "middle"}
                  >
                    {label(d.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line className="st-baseline" x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} />
        </svg>
      </div>
      <details className="st-table-toggle">
        <summary>Show as table</summary>
        <div className="st-table-wrap">
          <table className="st-table num">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Voice notes</th>
                <th scope="col">Records confirmed</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row">{label(d.day, true)}</th>
                  <td>{d.notes}</td>
                  <td>{d.confirmed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
