import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type {
  FollowUpActionKind,
  FollowUpChild,
  FollowUpOutcome,
  FollowUpReason,
  ParentMessage,
} from "../../api/types";
import { classLabel, formatDate } from "../../components/ui";
import { useLoad } from "./useLoad";

const ACTIONS: { id: FollowUpActionKind; label: string }[] = [
  { id: "call", label: "Called parent" },
  { id: "visit", label: "Home visit" },
  { id: "message", label: "Sent message" },
  { id: "spoke_child", label: "Spoke to child" },
];
const REASONS: { id: FollowUpReason; label: string }[] = [
  { id: "illness", label: "Illness" },
  { id: "work", label: "Work at home / farm" },
  { id: "migration", label: "Family moved away" },
  { id: "distance", label: "Distance / transport" },
  { id: "family_event", label: "Wedding / festival" },
  { id: "not_interested", label: "Not interested" },
  { id: "unknown", label: "Don’t know yet" },
];
const OUTCOMES: { id: FollowUpOutcome; label: string }[] = [
  { id: "will_return", label: "Will come back" },
  { id: "returned", label: "Back in school" },
  { id: "unreachable", label: "Could not reach" },
];
const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])) as Record<string, string>;
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((a) => [a.id, a.label])) as Record<string, string>;

function daysAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** Dropout early-warning on Home, with the follow-up loop: message the parent, then log what happened. */
export function FollowUpPanel() {
  const { data, error, reload } = useLoad(() => api.followUp(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [showWatch, setShowWatch] = useState(false);
  if (error || !data) return null; // never block Home on this panel
  const act = data.children.filter((k) => k.tier === "act");
  const watch = data.children.filter((k) => k.tier === "watch");
  const row = (k: FollowUpChild) => (
    <FollowUpRow
      key={k.student_id}
      child={k}
      open={open === k.student_id}
      onToggle={() => setOpen(open === k.student_id ? null : k.student_id)}
      onChanged={() => void reload()}
    />
  );
  return (
    <section className="db-section" aria-labelledby="db-fu-h">
      <div className="db-section-head">
        <h2 id="db-fu-h">Children to follow up</h2>
        {act.length ? <span className="db-count db-count-warn num">{act.length}</span> : null}
      </div>
      {data.children.length === 0 ? (
        <p className="db-fu-empty">
          No child has missed {data.streak_min} school days in a row or {data.watch_missed_pct}% of days this month.
        </p>
      ) : (
        <>
          {act.length ? <ul className="db-list">{act.map(row)}</ul> : <p className="db-fu-empty">No child needs action now.</p>}
          {watch.length ? (
            <div className="db-fu-watch">
              <button type="button" className="db-fu-watch-btn" aria-expanded={showWatch} onClick={() => setShowWatch(!showWatch)}>
                Also watching <span className="num">{watch.length}</span> {watch.length === 1 ? "child" : "children"} who miss
                some days
                <span aria-hidden>{showWatch ? "▴" : "▾"}</span>
              </button>
              {showWatch ? <ul className="db-list">{watch.map(row)}</ul> : null}
            </div>
          ) : null}
          <p className="db-fu-note">
            Telling parents exactly how many days their child missed is what made the difference in attendance trials. Call
            or message in the first week.
          </p>
        </>
      )}
    </section>
  );
}

function FollowUpRow({
  child: k,
  open,
  onToggle,
  onChanged,
}: {
  child: FollowUpChild;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const urgent = k.tier === "act" && (k.streak >= 5 || k.attendance_pct < 50);
  const sheetId = `fu-${k.student_id}`;
  return (
    <li className={`db-fu-item ${open ? "db-fu-open" : ""}`}>
      <button type="button" className="db-fu-row" aria-expanded={open} aria-controls={sheetId} onClick={onToggle}>
        <span className={`db-fu-streak ${urgent ? "db-fu-urgent" : ""} ${k.tier === "watch" ? "db-fu-watchbadge" : ""}`} aria-hidden>
          <strong className="num">{k.streak >= 3 ? k.streak : `${k.attendance_pct}%`}</strong>
          <small>{k.streak >= 3 ? "days" : "came"}</small>
        </span>
        <span className="db-row-main">
          <span className="db-row-title">
            {k.name} <span className="muted num">#{k.roll_no}</span>
          </span>
          <span className="db-row-meta">
            <span>{classLabel(k.grade, k.section)}</span>
            <span>{k.reasons.join(" · ")}</span>
          </span>
          {k.last_action ? (
            <span className="db-fu-last">
              {ACTION_LABEL[k.last_action.action] ?? "Followed up"} {daysAgo(k.last_action.at)}
              {k.last_action.outcome ? ` · ${OUTCOME_LABEL[k.last_action.outcome]}` : ""}
            </span>
          ) : (
            <span className="db-fu-last db-fu-none">Not followed up yet</span>
          )}
        </span>
        <svg className="db-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden style={{ transform: open ? "rotate(90deg)" : undefined }}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open ? <FollowUpSheet id={sheetId} child={k} onChanged={onChanged} /> : null}
    </li>
  );
}

function FollowUpSheet({ id, child: k, onChanged }: { id: string; child: FollowUpChild; onChanged: () => void }) {
  const [msg, setMsg] = useState<ParentMessage | null>(null);
  const [msgErr, setMsgErr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [editingPhone, setEditingPhone] = useState(!k.has_phone);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const [action, setAction] = useState<FollowUpActionKind | null>(null);
  const [reason, setReason] = useState<FollowUpReason | null>(null);
  const [outcome, setOutcome] = useState<FollowUpOutcome | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api.parentMessage(k.student_id).then(
      (m) => {
        setMsg(m);
        if (m.phone) setPhone(m.phone);
      },
      (e: Error) => setMsgErr(e.message),
    );
    return () => audio.current?.pause();
  }, [k.student_id]);

  async function savePhone() {
    setPhoneErr(null);
    try {
      await api.setParentPhone(k.student_id, phone);
      setMsg(await api.parentMessage(k.student_id));
      setEditingPhone(false);
      onChanged();
    } catch (e) {
      setPhoneErr((e as Error).message);
    }
  }

  function play() {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    const a = audio.current ?? new Audio(api.parentMessageSpeechUrl(k.student_id));
    audio.current = a;
    a.onended = () => setPlaying(false);
    a.onerror = () => setPlaying(false);
    a.currentTime = 0;
    setPlaying(true);
    a.play().catch(() => setPlaying(false));
  }

  async function save() {
    if (!action) return;
    setSaving(true);
    try {
      await api.logFollowUp(k.student_id, { action, reason, outcome });
      setSaved(true);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id={id} className="db-fu-sheet">
      <div className="db-fu-block">
        <h3 className="db-fu-h">Message to the parent</h3>
        {msgErr ? <p className="error-note">{msgErr}</p> : null}
        {msg ? <p className="db-fu-msg">{msg.text}</p> : <p className="muted">Preparing message…</p>}
        {editingPhone ? (
          <form
            className="db-fu-phone"
            onSubmit={(e) => {
              e.preventDefault();
              void savePhone();
            }}
          >
            <label htmlFor={`${id}-ph`} className="sr-only">
              Parent’s mobile number
            </label>
            <input
              id={`${id}-ph`}
              className="input"
              inputMode="tel"
              autoComplete="off"
              placeholder="Parent’s mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button className="btn btn-secondary" type="submit" disabled={phone.replace(/\D/g, "").length < 10}>
              Save
            </button>
          </form>
        ) : (
          <p className="db-fu-phone-line">
            Parent: <span className="num">{msg?.phone}</span>{" "}
            <button type="button" className="cap-linkbtn" onClick={() => setEditingPhone(true)}>
              Change
            </button>
          </p>
        )}
        {phoneErr ? <p className="error-note">{phoneErr}</p> : null}
        <div className="db-fu-send">
          <a className={`btn btn-primary ${msg ? "" : "btn-disabled"}`} href={msg?.sms_url} aria-disabled={!msg}>
            SMS
          </a>
          <a className={`btn btn-primary ${msg ? "" : "btn-disabled"}`} href={msg?.whatsapp_url} target="_blank" rel="noreferrer" aria-disabled={!msg}>
            WhatsApp
          </a>
          <button type="button" className="btn btn-secondary" onClick={play} disabled={!msg}>
            {playing ? "Stop" : "Play aloud"}
          </button>
        </div>
        <p className="db-fu-hint">“Play aloud” reads the message on a phone call, for parents who can’t read an SMS. Messages go from your own phone.</p>
      </div>

      <div className="db-fu-block">
        <h3 className="db-fu-h">What did you do?</h3>
        {saved ? (
          <p className="db-fu-saved" role="status">
            Saved. It shows on this child’s row.
          </p>
        ) : (
          <>
            <Chips label="Action" options={ACTIONS} value={action} onChange={setAction} />
            <Chips label="Why is the child missing school?" options={REASONS} value={reason} onChange={setReason} />
            <Chips label="Result" options={OUTCOMES} value={outcome} onChange={setOutcome} />
            <button type="button" className="btn btn-accent btn-block" disabled={!action || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save follow-up"}
            </button>
          </>
        )}
        {k.absent_dates.length ? (
          <p className="db-fu-hint">Absent on: {k.absent_dates.map((d) => formatDate(d)).join(", ")}</p>
        ) : null}
      </div>
    </div>
  );
}

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="db-fu-chips" role="group" aria-label={label}>
      <span className="db-fu-chiplabel">{label}</span>
      <div className="db-fu-chiprow">
        {options.map((o) => (
          <button key={o.id} type="button" className="db-chip" aria-pressed={value === o.id} onClick={() => onChange(value === o.id ? null : o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
