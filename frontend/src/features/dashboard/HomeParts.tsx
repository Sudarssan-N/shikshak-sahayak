import { Link } from "react-router-dom";
import type { ClassSection, DailyRecord } from "../../api/types";
import { StatusBadge, classLabel, formatDate } from "../../components/ui";
import type { MonthStats } from "./recordUtils";

/** Per-class status for today as tiles, with a big Record button when anything is missing. */
export function TodayPanel({ classes, records }: { classes: ClassSection[]; records: DailyRecord[] }) {
  const byClass = new Map(records.map((r) => [r.class_id, r]));
  const missingClasses = classes.filter((c) => !byClass.has(c.id));
  const recorded = classes.length - missingClasses.length;
  const cta =
    missingClasses.length === 1 ? `Record ${classLabel(missingClasses[0].grade, missingClasses[0].section)} now` : "Record today’s note";
  return (
    <section className="db-today" aria-labelledby="db-today-h">
      <div className="db-section-head">
        <h2 id="db-today-h">Today</h2>
        {classes.length ? (
          <span className="db-today-count num">
            {recorded} of {classes.length} recorded
          </span>
        ) : null}
      </div>
      {classes.length === 0 ? (
        <p className="muted">No classes yet. Ask your pilot lead to add your class list.</p>
      ) : (
        <ul className="db-tiles-today">
          {classes.map((c) => {
            const r = byClass.get(c.id);
            const label = classLabel(c.grade, c.section);
            if (!r) {
              return (
                <li key={c.id} className="db-ct db-ct-missing">
                  <span className="db-ct-name">{label}</span>
                  <span className="db-ct-big">—</span>
                  <span className="db-ct-sub">not recorded yet</span>
                </li>
              );
            }
            const done = r.status === "confirmed";
            return (
              <li key={c.id}>
                <Link to={`/records/${r.id}`} className={`db-ct ${done ? "db-ct-done" : "db-ct-check"}`}>
                  <span className="db-ct-name">
                    {done ? <CheckMark /> : null}
                    {label}
                  </span>
                  <span className="db-ct-big num">
                    {r.present ?? "?"}
                    <small>/{r.enrolled ?? c.enrolled}</small>
                  </span>
                  <span className="db-ct-sub">{done ? `present · ${r.meals_served ?? "?"} meals` : <StatusBadge status={r.status} />}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {missingClasses.length > 0 || classes.length === 0 ? (
        <Link to="/record" className="btn btn-accent btn-block db-cta">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          {cta}
        </Link>
      ) : (
        <p className="db-alldone">All classes recorded for today. Well done.</p>
      )}
    </section>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function MonthStrip({ stats, label }: { stats: MonthStats; label: string }) {
  return (
    <section className="db-section" aria-labelledby="db-month-h">
      <h2 id="db-month-h">{label}</h2>
      <dl className="db-stats">
        <div className="db-stat">
          <dt>Days recorded</dt>
          <dd>{stats.daysRecorded}</dd>
        </div>
        <div className="db-stat">
          <dt>Avg attendance</dt>
          <dd>{stats.avgAttendance == null ? "—" : `${stats.avgAttendance}%`}</dd>
        </div>
        <div className="db-stat">
          <dt>Meals served</dt>
          <dd>{stats.meals.toLocaleString("en-IN")}</dd>
        </div>
      </dl>
      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 6 }}>
        From confirmed records only.
      </p>
    </section>
  );
}

/** V8-style gap nudge: yesterday was a working day and some class has no record. */
export function BackfillNudge({ date, classes }: { date: string; classes: ClassSection[] }) {
  const names = classes.map((c) => classLabel(c.grade, c.section)).join(", ");
  return (
    <aside className="db-nudge db-nudge-info" aria-label="Missing record">
      <p>
        <strong>No record for {formatDate(date)}</strong>
        <br />
        <span className="muted">{names}. Want to add it now?</span>
      </p>
      <Link to={`/record?date=${date}`} state={{ recordDate: date }} className="btn btn-secondary">
        Add {formatDate(date)}
      </Link>
    </aside>
  );
}

export function PracticeNudge() {
  return (
    <aside className="db-nudge" aria-label="Getting started">
      <p>
        <strong>Try a practice note first</strong>
        <br />
        Speak like you would in the staff room: “Class 3, 24 present, Ravi and Meena absent, 24 meals, finished
        lesson 7.” Nothing is saved until you confirm it.
      </p>
      <Link to="/record" className="btn btn-primary">
        Start practice note
      </Link>
    </aside>
  );
}
