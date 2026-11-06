import { useState } from "react";
import { api } from "../../api/client";
import type { Report, ReportKind } from "../../api/types";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "../../components/ui";
import { formatDateTime, monthLabel, recentMonths } from "./dates";
import { useLoad } from "./useLoad";
import "./dashboard.css";

const KINDS: { kind: ReportKind; title: string; fmt: string; desc: string }[] = [
  { kind: "attendance", title: "Attendance register", fmt: "XLSX", desc: "Month grid of every student by working day, with P / A marks and totals." },
  { kind: "mdm", title: "MDM register", fmt: "XLSX", desc: "Per day and class: enrolled, present and meals served, with month totals." },
  { kind: "summary", title: "Monthly summary", fmt: "PDF", desc: "Working days, average attendance, total meals and lessons completed per class." },
  { kind: "csv", title: "Upload CSV", fmt: "CSV", desc: "One row per class per day, in the column order the portal or block office expects." },
];
const KIND_TITLE = Object.fromEntries(KINDS.map((k) => [k.kind, k.title])) as Record<ReportKind, string>;
const MONTHS = recentMonths(12);

export default function ReportsPage() {
  const [month, setMonth] = useState(MONTHS[0]);
  const { data: history, error, loading, reload, setData } = useLoad(() => api.reports(), []);

  const onMade = (r: Report) => setData([r, ...(history ?? []).filter((h) => h.id !== r.id)]);

  return (
    <div className="db-page">
      <PageHeader title="Reports" subtitle="Registers ready to print or upload" />

      <div className="field db-month">
        <label htmlFor="db-month">Month</label>
        <select id="db-month" className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <p className="db-note">
        Only <strong>confirmed</strong> records go into these files. A day with an unresolved check is left blank,
        never guessed, so confirm your records first.
      </p>

      <div className="db-tiles">
        {KINDS.map((k) => (
          <ReportTile key={`${k.kind}-${month}`} {...k} month={month} onMade={onMade} />
        ))}
      </div>

      <section className="db-section" aria-labelledby="db-hist-h">
        <h2 id="db-hist-h">Made earlier</h2>
        {loading && !history ? (
          <Spinner />
        ) : error ? (
          <div className="stack">
            <ErrorNote error={error} />
            <Button variant="secondary" onClick={() => void reload()}>Try again</Button>
          </div>
        ) : history && history.length ? (
          <ul className="db-list">
            {[...history]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((r) => (
                <li key={r.id}>
                  <a className="db-row" href={api.downloadUrl(r)} download={r.filename}>
                    <span className="db-row-main">
                      <span className="db-row-title">{KIND_TITLE[r.kind] ?? r.kind}</span>
                      <span className="db-row-meta">
                        <span>{monthLabel(r.period)}</span>
                        <span>Made {formatDateTime(r.created_at)}</span>
                      </span>
                    </span>
                    <span className="db-download">Download</span>
                  </a>
                </li>
              ))}
          </ul>
        ) : (
          <EmptyState title="No reports yet">
            <p>Pick a month and tap Generate.</p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function ReportTile({
  kind, title, fmt, desc, month, onMade,
}: { kind: ReportKind; title: string; fmt: string; desc: string; month: string; onMade: (r: Report) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createReport(kind, month);
      setReport(r);
      onMade(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="db-tile">
      <h3>
        {title}
        <span className="db-fmt">{fmt}</span>
      </h3>
      <p className="muted">{desc}</p>
      <Button variant={report ? "secondary" : "primary"} block loading={busy} onClick={() => void generate()}>
        {report ? "Make again" : "Generate"}
      </Button>
      <div aria-live="polite">
        {report ? (
          <a className="btn btn-primary btn-block" href={api.downloadUrl(report)} download={report.filename}>
            Download {monthLabel(month)}
          </a>
        ) : null}
        <ErrorNote error={error} />
      </div>
    </Card>
  );
}
