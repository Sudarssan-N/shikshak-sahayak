import { api } from "../../api/client";
import { useAuth } from "../../auth";
import { EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { addDays, isWorkingDay, monthKey, monthLabel, ymd } from "./dates";
import { BackfillNudge, MonthStrip, PracticeNudge, TodayPanel } from "./HomeParts";
import { RecordRow } from "./RecordRow";
import { monthStats, needsCheck } from "./recordUtils";
import { useLoad } from "./useLoad";
import "./dashboard.css";

function greeting(h: number) {
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const { teacher } = useAuth();
  const now = new Date();
  const today = ymd(now);
  const yesterdayDate = addDays(now, -1);
  const yesterday = ymd(yesterdayDate);
  const month = monthKey(now);
  // One request covers today, yesterday, this month and the last 30 days of drafts.
  const thirtyAgo = ymd(addDays(now, -30));
  const from = `${month}-01` < thirtyAgo ? `${month}-01` : thirtyAgo;

  const { data, error, loading, reload } = useLoad(() => api.records({ from, to: today }), [from, today]);

  if (!teacher) return null;
  const records = (data ?? []).filter((r) => r.status !== "superseded");
  const todays = records.filter((r) => r.record_date === today);
  const pending = records.filter(needsCheck);
  const missingYesterday = isWorkingDay(yesterdayDate)
    ? teacher.classes.filter((c) => !records.some((r) => r.class_id === c.id && r.record_date === yesterday))
    : [];

  return (
    <div className="db-page">
      <header className="db-greet">
        <p className="muted">{greeting(now.getHours())},</p>
        <h1>{teacher.name}</h1>
        <p className="muted">{teacher.school.name}</p>
      </header>

      {teacher.records_confirmed === 0 ? <PracticeNudge /> : null}

      {loading && !data ? (
        <div className="row" aria-live="polite">
          <Spinner /> <span className="muted">Loading your records…</span>
        </div>
      ) : error ? (
        <div className="stack">
          <ErrorNote error={error} />
          <button className="btn btn-secondary" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <TodayPanel classes={teacher.classes} records={todays} />

          {data && missingYesterday.length > 0 ? <BackfillNudge date={yesterday} classes={missingYesterday} /> : null}

          <section className="db-section" aria-labelledby="db-check-h">
            <h2 id="db-check-h">Needs your check</h2>
            {pending.length ? (
              <ul className="db-list">
                {pending.map((r) => (
                  <RecordRow key={r.id} record={r} showDate />
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing waiting">
                <p>Every record is confirmed.</p>
              </EmptyState>
            )}
          </section>

          <MonthStrip stats={monthStats(records, month)} label={`This month · ${monthLabel(month)}`} />
        </>
      )}
    </div>
  );
}
