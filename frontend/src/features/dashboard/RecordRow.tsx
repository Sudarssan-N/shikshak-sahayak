import { Link } from "react-router-dom";
import type { DailyRecord } from "../../api/types";
import { StatusBadge, classLabel, formatDate } from "../../components/ui";
import { openFlags } from "./recordUtils";

/** One tappable record line: class, present/enrolled, meals, status, open-flag count. */
export function RecordRow({ record: r, showDate = false }: { record: DailyRecord; showDate?: boolean }) {
  const flags = openFlags(r).length;
  const label = classLabel(r.grade, r.section);
  const open = openFlags(r);
  const tone =
    r.status === "confirmed"
      ? "done"
      : open.some((f) => f.severity === "block") || r.unresolved_names.length
        ? "block"
        : flags > 0
          ? "warn"
          : "draft";
  return (
    <li>
      <Link to={`/records/${r.id}`} className="db-row">
        <span className={`db-row-icon db-row-icon-${tone}`} aria-hidden>
          {tone === "done" ? "✓" : tone === "block" ? "!" : tone === "warn" ? "?" : "…"}
        </span>
        <span className="db-row-main">
          <span className="db-row-title">
            {label}
            {showDate ? <span className="muted"> · {formatDate(r.record_date)}</span> : null}
          </span>
          <span className="db-row-meta num">
            <span>
              <strong>{r.present ?? "?"}</strong>/{r.enrolled ?? "?"} present
            </span>
            <span>{r.meals_served ?? "?"} meals</span>
            {flags > 0 ? (
              <span className="db-flagcount">
                {flags} to check
              </span>
            ) : null}
          </span>
        </span>
        <StatusBadge status={r.status} />
        <svg className="db-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>
    </li>
  );
}
