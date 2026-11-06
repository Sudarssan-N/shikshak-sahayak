import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { DailyRecord, Flag, Language, Severity } from "../../api/types";
import { Button, classLabel, FlagList, formatDate, StatusBadge } from "../../components/ui";
import { CheckIcon, MicIcon } from "./Brand";
import { EditPanel } from "./EditPanel";
import { FixPanel } from "./FixPanel";
import { friendlyError } from "./copy";
import { NameQuestion } from "./NameQuestion";

interface Props {
  record: DailyRecord;
  language: Language;
  onUpdated: (r: DailyRecord) => void;
}

const openFlags = (r: DailyRecord) => r.flags.filter((f) => f.resolution === "open");

function worstFor(flags: Flag[], field: string): Severity | undefined {
  const hit = flags.filter((f) => f.field === field);
  return hit.find((f) => f.severity === "block")?.severity ?? hit.find((f) => f.severity === "warn")?.severity;
}

/** The confirmation card: what I understood for one class on one day, and the ways to fix it. */
export function ConfirmCard({ record, language, onUpdated }: Props) {
  const [panel, setPanelRaw] = useState<"none" | "fix" | "edit">("none");
  const setPanel = (p: "none" | "fix" | "edit") => {
    setError(null);
    setPanelRaw(p);
  };
  const [armed, setArmed] = useState(false); // second tap for "Confirm anyway"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flags = openFlags(record);
  const blocks = flags.filter((f) => f.severity === "block");
  const warns = flags.filter((f) => f.severity === "warn");
  const blocked = blocks.length > 0 || record.unresolved_names.length > 0;
  const title = classLabel(record.grade, record.section);
  const headingId = `cc-${record.id}`;

  // Any change to the record (fix, edit, name answer) invalidates a pending "Confirm anyway".
  useEffect(() => setArmed(false), [record]);

  async function confirm() {
    if (warns.length && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.confirm(record.id, warns.length > 0 || armed));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("Something still needs fixing before this can be saved.");
        api.record(record.id).then(onUpdated, () => undefined);
      } else if (e instanceof ApiError && e.status === 422) {
        setError("Please check the warnings above, then tap “Confirm anyway”.");
        setArmed(true);
      } else setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (record.status === "confirmed") {
    return (
      <section className="cc cc-saved" aria-labelledby={headingId}>
        <span className="cc-saved-icon">
          <CheckIcon size={22} />
        </span>
        <div>
          <h2 id={headingId} className="cc-saved-title">
            {title} saved
          </h2>
          <p className="muted cap-small num">
            {formatDate(record.record_date)} · {record.present ?? "—"} present · {record.meals_served ?? "—"} meals
          </p>
        </div>
      </section>
    );
  }

  const absentCount = record.absent.length + record.unresolved_names.length;
  const tone = blocked ? "block" : warns.length ? "warn" : "good";

  return (
    <section className={`cc cc-${tone}`} aria-labelledby={headingId}>
      <header className="cc-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          <p className="muted cap-small">{formatDate(record.record_date)}</p>
        </div>
        <StatusBadge status={record.status} />
      </header>

      <dl className="cc-nums">
        <Num label="Enrolled" sub="from class list" value={record.enrolled} quiet />
        <Num label="Present" value={record.present} sev={worstFor(flags, "present")} missing={record.missing_fields.includes("present")} />
        <Num label="Absent" sub="names said" value={absentCount} sev={worstFor(flags, "absent")} />
        <Num label="Meals" sub="served" value={record.meals_served} sev={worstFor(flags, "meals_served")} missing={record.missing_fields.includes("meals_served")} />
      </dl>

      {record.absent.length ? (
        <div className="cc-section">
          <h3 className="cc-label">Absent</h3>
          <ul className="cc-chips">
            {record.absent.map((s) => (
              <li key={s.student_id} className="cc-chip">
                {s.name} <span className="muted num">#{s.roll_no}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {record.unresolved_names.map((u) => (
        <NameQuestion key={u.spoken} recordId={record.id} classText={title} item={u} onUpdated={onUpdated} />
      ))}

      {record.lessons.length ? (
        <div className="cc-section">
          <h3 className="cc-label">Lessons</h3>
          <ul className="cc-lessons">
            {record.lessons.map((l, i) => (
              <li key={i}>
                <span>
                  {l.subject ? `${l.subject} · ` : ""}
                  {l.lesson_ref ?? "Lesson"}
                </span>
                {l.status ? <span className={`cc-lesson-status cc-lesson-${l.status}`}>{l.status === "completed" ? "Finished" : "Started"}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FlagList flags={record.flags} />

      {panel === "fix" ? <FixPanel recordId={record.id} language={language} onUpdated={onUpdated} onClose={() => setPanel("none")} /> : null}
      {panel === "edit" ? <EditPanel record={record} onUpdated={onUpdated} onClose={() => setPanel("none")} /> : null}

      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}

      {panel === "none" ? (
        <div className="cc-actions">
          {armed ? (
            <p className="cc-armed" role="status">
              {warns.length === 1 ? "1 thing" : `${warns.length || "Some"} things`} above may be wrong. Save anyway?
            </p>
          ) : null}
          <Button block onClick={confirm} loading={busy} disabled={blocked} className={armed ? "cc-confirm-anyway" : "cc-confirm"}>
            <CheckIcon /> {armed ? "Confirm anyway" : "Confirm"}
          </Button>
          {blocked ? (
            <p className="muted cap-small cap-center">
              {record.unresolved_names.length ? "Answer the question above to continue." : "Fix the red item above to continue."}
            </p>
          ) : null}
          <div className="cc-secondary">
            <Button variant="secondary" onClick={() => setPanel("fix")}>
              <MicIcon size={18} /> Fix by voice
            </Button>
            <Button variant="secondary" onClick={() => setPanel("edit")}>
              Edit numbers
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Num({
  label,
  sub,
  value,
  sev,
  missing,
  quiet,
}: {
  label: string;
  sub?: string;
  value: number | null;
  sev?: Severity;
  missing?: boolean;
  quiet?: boolean;
}) {
  return (
    <div className={`cc-num ${sev ? `cc-num-${sev}` : ""} ${quiet ? "cc-num-quiet" : ""}`}>
      <dt>
        {label}
        {sub ? <span className="cc-num-sub">{sub}</span> : null}
      </dt>
      <dd className="num">
        {value ?? "—"}
        {value === null || missing ? <span className="cc-num-sub">not heard</span> : null}
      </dd>
    </div>
  );
}
