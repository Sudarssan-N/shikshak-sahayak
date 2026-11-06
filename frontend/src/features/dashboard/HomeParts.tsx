import { Link } from "react-router-dom";
import type { ClassSection, DailyRecord } from "../../api/types";
import { StatusBadge, classLabel, formatDate } from "../../components/ui";
import type { MonthStats } from "./recordUtils";

/** Per-class status for today, with a big Record button when anything is missing. */
export function TodayPanel({ classes, records }: { classes: ClassSection[]; records: DailyRecord[] }) {
  const byClass = new Map(records.map((r) => [r.class_id, r]));
  const missing = classes.filter((c) => !byClass.has(c.id)).length;
  return (
    <section className="card db-today" aria-labelledby="db-today-h">
      <h2 id="db-today-h">Today</h2>
      {classes.length === 0 ? (
        <p className="muted">No classes yet. Ask your pilot lead to add your class list.</p>
      ) : (
        <ul className="db-list" style={{ gap: 0 }}>
          {classes.map((c) => {
            const r = byClass.get(c.id);
            return (
              <li key={c.id} className="db-today-row">
                <span>
                  <strong>{classLabel(c.grade, c.section)}</strong>
                  <span className="muted num"> · {c.enrolled} enrolled</span>
                </span>
                {!r ? (
                  <span className="muted">Not recorded yet</span>
                ) : r.status === "confirmed" ? (
                  <Link to={`/records/${r.id}`} className="db-today-done num">
                    ✓ {r.present ?? "?"}/{r.enrolled ?? c.enrolled}
                  </Link>
                ) : (
                  <Link to={`/records/${r.id}`} aria-label={`${classLabel(c.grade, c.section)}: open record`}>
                    <StatusBadge status={r.status} />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {missing > 0 || classes.length === 0 ? (
        <Link to="/record" className="btn btn-primary btn-block db-cta">
          <span aria-hidden>●</span> Record today’s note
        </Link>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          All classes recorded for today. Well done.
        </p>
      )}
    </section>
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
