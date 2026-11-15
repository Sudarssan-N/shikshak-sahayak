import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Stats } from "../../api/types";
import { Button, EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { ActivityChart, type Day } from "./ActivityChart";
import "./stats.css";

const REFRESH_MS = 60_000;

const LANG_NAMES: Record<string, string> = {
  hi: "हिन्दी · Hindi",
  en: "English",
  mr: "मराठी · Marathi",
  kn: "ಕನ್ನಡ · Kannada",
};

const fmtN = (n: number) => n.toLocaleString("en-IN");

function istToday() {
  // en-CA gives YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Fill a continuous 30-day window so gaps show as zero instead of being skipped. */
function fillDays(daily: Stats["daily"]): Day[] {
  const byDay = new Map(daily.map((d) => [d.day.slice(0, 10), d]));
  const lastData = daily.length ? daily.map((d) => d.day.slice(0, 10)).sort().at(-1)! : "";
  const today = istToday();
  const end = lastData > today ? lastData : today;
  return Array.from({ length: 30 }, (_, i) => {
    const day = addDays(end, i - 29);
    const d = byDay.get(day);
    return { day, notes: d?.notes ?? 0, confirmed: d?.confirmed ?? 0 };
  });
}

function relTime(iso: string, now: number) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      setStats(await api.stats());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      inflight.current = false;
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
      else setNow(Date.now());
    }, REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  useEffect(() => {
    document.title = "Pilot impact · Shikshak Sahayak";
  }, []);

  return (
    <div className="st-page">
      <header className="st-head">
        <div>
          <p className="st-eyebrow">Shikshak Sahayak · live pilot counters</p>
          <h1>One voice note, a confirmed register</h1>
          <p className="muted st-lede">
            Government-school teachers speak the day’s attendance and mid-day meal; the app fills the record and checks
            it, and the teacher confirms. These are the real, anonymous totals from the pilot — nothing here is
            projected or modelled.
          </p>
        </div>
        <div className="st-refresh">
          <p className="muted num st-updated" aria-live="polite">
            {stats ? <>Updated {relTime(stats.updated_at, now)}</> : null}
          </p>
          <Button variant="secondary" className="st-btn-sm" onClick={() => void load()} loading={loading && !!stats}>
            Refresh
          </Button>
        </div>
      </header>

      {!stats ? (
        loading ? (
          <div className="st-center">
            <Spinner />
          </div>
        ) : (
          <div className="stack">
            <ErrorNote error={error} />
            <div>
              <Button variant="secondary" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          </div>
        )
      ) : (
        <Dashboard stats={stats} stale={error ? stats.updated_at : null} />
      )}
    </div>
  );
}

function Dashboard({ stats, stale }: { stats: Stats; stale: string | null }) {
  const days = useMemo(() => fillDays(stats.daily), [stats.daily]);
  const activeDays = days.filter((d) => d.notes > 0 || d.confirmed > 0).length;
  const langs = Object.entries(stats.languages)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const langTotal = langs.reduce((n, [, v]) => n + v, 0);
  const flagPct = stats.flags_raised ? Math.round((stats.flags_acted_on / stats.flags_raised) * 100) : null;
  const acc = stats.first_pass_accuracy;
  const updated = new Date(stats.updated_at);

  return (
    <div className={`st-body ${stale ? "is-stale" : ""}`}>
      {stale ? (
        <p className="st-stale" role="status">
          Couldn’t refresh just now — showing the last figures received. Retrying every minute.
        </p>
      ) : null}

      {stats.pilot_partners?.length ? (
        <section className="st-card st-partners" aria-labelledby="st-h-partners">
          <div className="st-card-head">
            <h2 id="st-h-partners">Pilot partners</h2>
            <p className="muted">Organisations bringing teachers to the pilot</p>
          </div>
          <ul className="st-partner-list">
            {stats.pilot_partners.map((p) => (
              <li key={p.name}>
                <p className="st-partner-name">
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.name}
                  </a>
                  <span className="st-tag">{p.status}</span>
                </p>
                <p className="muted st-partner-meta">
                  {p.location} · {p.about}
                </p>
                <p className="st-partner-detail">{p.detail}</p>
              </li>
            ))}
          </ul>
          <p className="muted st-partner-note">
            A partnership is not usage. The counters below count only teachers who have signed up and confirmed records.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="st-h-headline">
        <h2 id="st-h-headline" className="sr-only">
          Headline numbers
        </h2>
        <ul className="st-tiles">
          <Tile label="Teachers onboarded" value={fmtN(stats.teachers_onboarded)} sub="Signed up and gave consent" />
          <Tile
            label="Active teachers"
            value={fmtN(stats.teachers_active)}
            sub={
              stats.teachers_onboarded
                ? `${Math.round((stats.teachers_active / stats.teachers_onboarded) * 100)}% of onboarded · 3+ confirmed records`
                : "3+ confirmed records"
            }
          />
          <Tile label="Voice notes processed" value={fmtN(stats.notes_processed)} sub="Transcribed and turned into records" />
          <Tile label="Records confirmed" value={fmtN(stats.records_confirmed)} sub="Checked and confirmed by the teacher" />
          <Tile
            label="Flags acted on"
            value={
              <>
                {fmtN(stats.flags_acted_on)}
                <span className="st-of"> of {fmtN(stats.flags_raised)}</span>
              </>
            }
            sub={
              flagPct === null
                ? "No validation flags raised yet"
                : `${flagPct}% of flags were corrected or reviewed before confirming`
            }
          />
          <Tile
            label="Median time saved"
            value={stats.median_minutes_saved === null ? null : `${fmtN(Math.round(stats.median_minutes_saved * 10) / 10)} min`}
            sub="Per record · self-reported by teachers"
            tag="Self-reported"
          />
          <Tile
            label="First-pass accuracy"
            value={acc === null ? null : `${(acc * 100).toFixed(1)}%`}
            sub="Extracted fields not corrected by the teacher"
            meter={acc}
          />
        </ul>
      </section>

      <div className="st-grid">
        <section className="st-card st-card-wide" aria-labelledby="st-h-daily">
          <div className="st-card-head">
            <h2 id="st-h-daily">Daily activity</h2>
            <p className="muted num">
              Last 30 days · {fmtN(days.reduce((n, d) => n + d.notes, 0))} notes ·{" "}
              {fmtN(days.reduce((n, d) => n + d.confirmed, 0))} confirmed
            </p>
          </div>
          {activeDays ? (
            <ActivityChart days={days} />
          ) : (
            <EmptyState title="No activity in the last 30 days">
              <p>Bars appear here as soon as teachers start sending voice notes.</p>
            </EmptyState>
          )}
        </section>

        <section className="st-card" aria-labelledby="st-h-lang">
          <div className="st-card-head">
            <h2 id="st-h-lang">Languages spoken</h2>
            <p className="muted">Share of voice notes</p>
          </div>
          {langs.length ? (
            <ul className="st-langs">
              {langs.map(([code, n]) => {
                const pct = langTotal ? (n / langTotal) * 100 : 0;
                return (
                  <li key={code}>
                    <div className="st-lang-row">
                      <span lang={code}>{LANG_NAMES[code] ?? code}</span>
                      <span className="num">
                        <strong>{fmtN(n)}</strong> <span className="muted">· {Math.round(pct)}%</span>
                      </span>
                    </div>
                    <div className="st-lang-track" aria-hidden="true">
                      <div className="st-lang-fill" style={{ width: `${Math.max(pct, 1.5)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No notes yet" />
          )}
        </section>
      </div>

      <footer className="st-honesty">
        <h2>How to read these numbers</h2>
        <ul>
          <li>
            <strong>Pilot size:</strong> exactly <span className="num">{fmtN(stats.teachers_onboarded)}</span>{" "}
            {stats.teachers_onboarded === 1 ? "teacher" : "teachers"} onboarded,{" "}
            <span className="num">{fmtN(stats.teachers_active)}</span> active, with activity on{" "}
            <span className="num">{activeDays}</span> of the last 30 days. This is a small pilot; we do not extrapolate it.
          </li>
          <li>
            <strong>Who counts:</strong> anyone who signs up and accepts the consent screen counts as onboarded, so
            reviewers trying the app can appear here too. The shared demo account never counts.{" "}
            <strong>Active</strong> (3+ confirmed records) is the figure that reflects real classroom use.
          </li>
          <li>
            <strong>Privacy:</strong> these are totals only. They contain no student or teacher names, no phone numbers
            and no school identifiers; active teachers are counted by a random ID, never derived from a phone number.
          </li>
          <li>
            <strong>Time saved</strong> is what teachers report after confirming a record, compared with their own
            hand-filled baseline — the median, labelled self-reported. <strong>First-pass accuracy</strong> counts
            extracted fields the teacher did not have to correct; it is not a check against the paper register.
          </li>
          <li>
            “—” means there is not enough data yet to report the figure honestly.
          </li>
        </ul>
        <p className="muted num st-stamp">
          Figures as of{" "}
          <time dateTime={stats.updated_at}>
            {Number.isNaN(updated.getTime())
              ? stats.updated_at
              : updated.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}{" "}
            IST
          </time>{" "}
          · refreshes every minute
        </p>
      </footer>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tag,
  meter,
}: {
  label: string;
  value: ReactNode | null;
  sub: string;
  tag?: string;
  meter?: number | null;
}) {
  const empty = value === null;
  return (
    <li className="st-tile">
      <p className="st-tile-label">
        {label}
        {tag ? <span className="st-tag">{tag}</span> : null}
      </p>
      <p className={`st-tile-value num ${empty ? "is-empty" : ""}`}>
        {empty ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not available</span>
          </>
        ) : (
          value
        )}
      </p>
      {typeof meter === "number" ? (
        <div className="st-meter" aria-hidden="true">
          <div style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }} />
        </div>
      ) : null}
      <p className="st-tile-sub">{empty ? "Not enough data yet" : sub}</p>
    </li>
  );
}
