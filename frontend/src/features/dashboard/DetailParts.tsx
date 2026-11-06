import { useState, type FormEvent } from "react";
import { ApiError, api } from "../../api/client";
import type { DailyRecord, Flag, Severity } from "../../api/types";
import { Button, ErrorNote, SeverityBadge } from "../../components/ui";
import { openFlags } from "./recordUtils";

const RESOLUTION: Record<Flag["resolution"], string> = {
  open: "",
  confirmed_anyway: "Confirmed anyway",
  corrected: "Fixed",
  dismissed: "Dismissed",
};
const ORDER: Record<Severity, number> = { block: 0, warn: 1, info: 2 };

/** Like FlagList with `all`, plus a label saying how each resolved flag was settled. */
export function DetailFlags({ flags }: { flags: Flag[] }) {
  const sorted = [...flags].sort(
    (a, b) => Number(a.resolution !== "open") - Number(b.resolution !== "open") || ORDER[a.severity] - ORDER[b.severity],
  );
  return (
    <ul className="flag-list">
      {sorted.map((f) => (
        <li key={f.id} className={`flag flag-${f.severity} ${f.resolution !== "open" ? "flag-resolved" : ""}`}>
          <SeverityBadge severity={f.severity} />
          <span>
            {f.message}
            {f.resolution !== "open" ? <span className="db-flag-res"> · {RESOLUTION[f.resolution]}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

type OnUpdate = (r: DailyRecord, announce: string) => void;

/** Confirm with Warn acknowledgement on the second tap; disabled while a Block flag is open. */
export function ConfirmButton({ record, onUpdate }: { record: DailyRecord; onUpdate: OnUpdate }) {
  const open = openFlags(record);
  const blocks = open.filter((f) => f.severity === "block").length;
  const warns = open.filter((f) => f.severity === "warn").length;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    if (warns > 0 && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onUpdate(await api.confirm(record.id, armed), "Record confirmed.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setArmed(true);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {blocks > 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Fix the {blocks === 1 ? "item" : `${blocks} items`} marked “Must fix” before confirming.
        </p>
      ) : armed ? (
        <p style={{ margin: 0 }}>
          I have looked at the {warns === 1 ? "item" : `${warns} items`} marked “Check”. Tap again to confirm anyway.
        </p>
      ) : null}
      <Button block loading={busy} disabled={blocks > 0} onClick={() => void confirm()}>
        {armed ? "Yes, confirm anyway" : "Confirm record"}
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

const toNum = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))));

/** Edit present / meals. Correcting a confirmed record makes a new version (new id). */
export function EditNumbers({ record, onUpdate, onCancel }: { record: DailyRecord; onUpdate: OnUpdate; onCancel: () => void }) {
  const [present, setPresent] = useState(record.present?.toString() ?? "");
  const [meals, setMeals] = useState(record.meals_served?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const patch: { present?: number | null; meals_served?: number | null } = {};
    if (toNum(present) !== record.present) patch.present = toNum(present);
    if (toNum(meals) !== record.meals_served) patch.meals_served = toNum(meals);
    if (!Object.keys(patch).length) return onCancel();
    setBusy(true);
    setError(null);
    try {
      onUpdate(await api.patchRecord(record.id, patch), "Saved. Checks have been run again.");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void save(e)}>
      <div className="db-form-grid">
        <div className="field">
          <label htmlFor="db-present">Present</label>
          <input id="db-present" className="input num" type="number" inputMode="numeric" min={0}
            max={record.enrolled ?? undefined} value={present} onChange={(e) => setPresent(e.target.value)} />
          {record.enrolled != null ? <span className="muted num" style={{ fontSize: "0.85rem" }}>of {record.enrolled} enrolled</span> : null}
        </div>
        <div className="field">
          <label htmlFor="db-meals">Meals served</label>
          <input id="db-meals" className="input num" type="number" inputMode="numeric" min={0}
            value={meals} onChange={(e) => setMeals(e.target.value)} />
        </div>
      </div>
      {record.status === "confirmed" ? (
        <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
          This record is confirmed. Saving keeps the old one and makes version {record.version + 1}, which you confirm again.
        </p>
      ) : null}
      <ErrorNote error={error} />
      <div className="row">
        <Button type="submit" loading={busy}>Save</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

/** V4: pick which roster student an unmatched spoken name means, or drop it. */
export function NameResolver({ record, onUpdate }: { record: DailyRecord; onUpdate: OnUpdate }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function pick(spoken: string, studentId: string | null) {
    setBusy(`${spoken}:${studentId}`);
    setError(null);
    try {
      onUpdate(await api.resolveName(record.id, spoken, studentId), studentId ? `${spoken} matched.` : `${spoken} removed.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
    <ul className="db-list">
      {record.unresolved_names.map((u) => (
        <li key={u.spoken} className="card" style={{ padding: 12 }}>
          <p>
            Who is “<strong>{u.spoken}</strong>”?
          </p>
          <div className="db-candidates">
            {u.candidates.map((c) => (
              <Button key={c.student_id} variant="secondary" loading={busy === `${u.spoken}:${c.student_id}`}
                disabled={busy !== null} onClick={() => void pick(u.spoken, c.student_id)}>
                <span className="num">{c.roll_no}.</span> {c.name}
              </Button>
            ))}
            <Button variant="ghost" loading={busy === `${u.spoken}:null`} disabled={busy !== null}
              onClick={() => void pick(u.spoken, null)}>
              Not in my class
            </Button>
          </div>
        </li>
      ))}
    </ul>
    <ErrorNote error={error} />
    </div>
  );
}
