import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { AdminSchool, DutyReport, DutySession } from "../../api/types";
import { Button, Card, ErrorNote } from "../../components/ui";
import { formatClock, formatHours, fromLocalInput, toLocalInput } from "../place";
import { isKeyRejected, useAdmin } from "./shared";

function todayInput() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function placeLabel(s: DutySession) {
  if (s.missed_logout && !s.edited) return "Logout not marked";
  if (s.source === "admin") return "Entered here";
  if (s.edited) return "Times corrected";
  if (s.inside) return s.distance_m == null ? "At school" : `At school · ${s.distance_m} m`;
  return "Outside";
}

function dayLabel(day: string) {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** Login and logout hours for one school, with a way to correct a row or add a missed day. */
export function HoursPanel({ school }: { school: AdminSchool }) {
  const { rejectKey } = useAdmin();
  const [from, setFrom] = useState(todayInput());
  const [to, setTo] = useState(todayInput());
  const [report, setReport] = useState<DutyReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DutySession | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.adminDuty({ school_id: school.id, from, to }));
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setLoading(false);
    }
  }, [school.id, from, to, rejectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const multiDay = from !== to;

  return (
    <Card>
      <div className="ad-list-head">
        <div>
          <h2>Login and logout</h2>
          {report ? (
            <p className="muted num ad-small">
              {report.teachers} teacher{report.teachers === 1 ? "" : "s"} · {report.open_now} still in · {formatHours(report.hours_closed)} closed
            </p>
          ) : null}
        </div>
        <Button variant="ghost" className="ad-btn-sm" onClick={() => { setEditing(null); setAdding((v) => !v); }}>
          {adding ? "Close" : "Add hours"}
        </Button>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="hr-from">From</label>
          <input id="hr-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hr-to">To</label>
          <input id="hr-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {adding ? (
        <HoursForm
          school={school}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      ) : null}
      {editing ? (
        <HoursForm
          school={school}
          session={editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
      {report && report.missed.length && !editing ? (
        <div className="ad-missed" role="status">
          <p>
            <strong>{report.missed.length} missed logout{report.missed.length === 1 ? "" : "s"}.</strong> These logins were left
            open past midnight and count as zero hours until corrected.
          </p>
          <ul>
            {report.missed.map((s) => (
              <li key={s.id}>
                <span>
                  {s.teacher_name} · {dayLabel(s.day)} · login {formatClock(s.login_at)}
                </span>
                <Button variant="secondary" className="ad-btn-sm" onClick={() => { setAdding(false); setEditing(s); }}>
                  Correct hours
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ErrorNote error={error} />
      {loading && !report ? <p className="muted">Loading hours…</p> : null}
      {report && !report.sessions.length ? <p className="muted">No login in this range.</p> : null}
      {report && report.sessions.length ? (
        <div className="ad-table-wrap">
          <table className="ad-table ad-table-cards">
            <thead>
              <tr>
                <th scope="col">Teacher</th>
                <th scope="col">Login</th>
                <th scope="col">Logout</th>
                <th scope="col">Hours</th>
                <th scope="col">Where</th>
                <th scope="col"><span className="sr-only">Correct</span></th>
              </tr>
            </thead>
            <tbody>
              {report.sessions.map((s) => (
                <tr key={s.id}>
                  <th scope="row" data-label="Teacher">{s.teacher_name}</th>
                  <td data-label="Login" className="num">{multiDay ? `${dayLabel(s.day)}, ` : ""}{formatClock(s.login_at)}</td>
                  <td data-label="Logout" className="num">{s.open ? "Still in" : s.missed_logout && !s.edited ? "Not marked" : formatClock(s.logout_at)}</td>
                  <td data-label="Hours" className="num">{formatHours(s.hours)}{s.open ? " so far" : ""}</td>
                  <td data-label="Where">
                    <span className={`ad-pill ${(s.inside || s.source === "admin") && !(s.missed_logout && !s.edited) ? "ad-pill-good" : "ad-pill-warn"}`}>
                      {placeLabel(s)}
                    </span>
                    {s.note ? <span className="muted ad-small ad-block">{s.note}</span> : null}
                  </td>
                  <td data-label="" className="ad-actions">
                    <Button variant="secondary" className="ad-btn-sm" onClick={() => { setAdding(false); setEditing(s); }}>
                      Correct hours
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function HoursForm({
  school,
  session,
  onCancel,
  onSaved,
}: {
  school: AdminSchool;
  session?: DutySession;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { rejectKey } = useAdmin();
  const [teacherId, setTeacherId] = useState(session?.teacher_id ?? school.teachers[0]?.id ?? "");
  const [login, setLogin] = useState(session ? toLocalInput(session.login_at) : "");
  const [logout, setLogout] = useState(
    session?.logout_at && !(session.missed_logout && !session.edited) ? toLocalInput(session.logout_at) : "",
  );
  const [note, setNote] = useState(session?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    if (!login) {
      setError(new Error("Enter the login time."));
      return;
    }
    if (note.trim().length < 3) {
      setError(new Error("Write a short note saying why these hours were changed."));
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      login_at: fromLocalInput(login),
      logout_at: logout ? fromLocalInput(logout) : null,
      note: note.trim(),
    };
    try {
      if (session) await api.adminPatchDuty(session.id, body);
      else await api.adminCreateDuty({ ...body, teacher_id: teacherId });
      await onSaved();
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ad-hours-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="muted ad-small">{session ? `Correct ${session.teacher_name}` : "Add a missed login"}</p>
      {session ? null : (
        <div className="field">
          <label htmlFor="hr-who">Teacher</label>
          <select id="hr-who" className="input" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            {school.teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="ad-grid">
        <div className="field">
          <label htmlFor="hr-in">Login</label>
          <input id="hr-in" className="input" type="datetime-local" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="hr-out">Logout</label>
          <input id="hr-out" className="input" type="datetime-local" value={logout} onChange={(e) => setLogout(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="hr-note">Why this change</label>
        <input id="hr-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Forgot to mark logout" />
      </div>
      <div className="row">
        <Button type="submit" loading={busy}>Save hours</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}
