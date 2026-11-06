import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { DailyRecord } from "../../api/types";
import { EmptyState, ErrorNote, PageHeader, Spinner, formatDate } from "../../components/ui";
import { addDays, todayYmd, ymd } from "./dates";
import { RecordRow } from "./RecordRow";
import { groupByDate, needsCheck } from "./recordUtils";
import { useLoad } from "./useLoad";
import "./dashboard.css";

type Filter = "all" | "check" | "confirmed";
const FILTERS: { id: Filter; label: string; test: (r: DailyRecord) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "check", label: "Needs check", test: needsCheck },
  { id: "confirmed", label: "Confirmed", test: (r) => r.status === "confirmed" },
];

export default function RecordsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const to = todayYmd();
  const from = ymd(addDays(new Date(), -30));
  const { data, error, loading, reload } = useLoad(() => api.records({ from, to }), [from, to]);

  const live = (data ?? []).filter((r) => r.status !== "superseded");
  const active = FILTERS.find((f) => f.id === filter)!;
  const shown = live.filter(active.test);

  return (
    <div className="db-page">
      <PageHeader title="Records" subtitle="Last 30 days" />

      <div className="db-chips" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="db-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} <span className="num">({live.filter(f.test).length})</span>
          </button>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {loading ? "Loading records" : error ? "" : `Showing ${shown.length} records`}
      </p>
      <div>
        {loading && !data ? (
          <div className="row">
            <Spinner /> <span className="muted">Loading records…</span>
          </div>
        ) : error ? (
          <div className="stack">
            <ErrorNote error={error} />
            <button className="btn btn-secondary" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <EmptyState title={filter === "all" ? "No records yet" : "Nothing here"}>
            {filter === "all" ? (
              <>
                <p>Record one voice note after class and it will show up here.</p>
                <Link to="/record" className="btn btn-primary">
                  Record a note
                </Link>
              </>
            ) : (
              <p>No {active.label.toLowerCase()} records in the last 30 days.</p>
            )}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 20 }}>
            {groupByDate(shown).map(([date, rows]) => (
              <section key={date ?? "none"} className="db-group" aria-label={formatDate(date)}>
                <h2>{formatDate(date)}</h2>
                <ul className="db-list">
                  {rows.map((r) => (
                    <RecordRow key={r.id} record={r} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
