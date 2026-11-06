import { Link } from "react-router-dom";
import type { DailyRecord } from "../../api/types";
import { StatusBadge, classLabel, formatDate } from "../../components/ui";
import { openFlags } from "./recordUtils";

/** One tappable record line: class, present/enrolled, meals, status, open-flag count. */
export function RecordRow({ record: r, showDate = false }: { record: DailyRecord; showDate?: boolean }) {
  const flags = openFlags(r).length;
  const label = classLabel(r.grade, r.section);
  return (
    <li>
      <Link to={`/records/${r.id}`} className="db-row">
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
        <span className="db-chev" aria-hidden>
          ›
        </span>
      </Link>
    </li>
  );
}
