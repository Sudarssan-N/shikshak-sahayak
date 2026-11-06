import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminTeacher, Language, NewTeacher, RosterUploadResult } from "../../api/types";
import { Button, Card, ErrorNote } from "../../components/ui";
import { RosterUpload } from "./RosterUpload";
import { DoneStep } from "./DoneStep";
import { GRADES, LANGUAGES, STATES, isKeyRejected, normalisePhone, useAdmin } from "./shared";

const STEPS = ["Teacher profile", "Class roster", "Hand over"] as const;
const TARGET_S = 5 * 60;

export function OnboardWizard() {
  const [step, setStep] = useState(0);
  const [teacher, setTeacher] = useState<AdminTeacher | null>(null);
  const [phone, setPhone] = useState("");
  const [roster, setRoster] = useState<RosterUploadResult | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the step heading so screen-reader and keyboard users land on the new step.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function goDone() {
    setFinishedAt(Date.now());
    setStep(2);
  }

  function restart() {
    setTeacher(null);
    setPhone("");
    setRoster(null);
    setFinishedAt(null);
    setStartedAt(Date.now());
    setStep(0);
  }

  return (
    <div className="stack">
      <div className="ad-wizard-head">
        <ol className="ad-steps" aria-label="Onboarding steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={i === step ? "is-current" : i < step ? "is-done" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="ad-step-dot num" aria-hidden="true">
                {i < step ? "✓" : i + 1}
              </span>
              <span className="ad-step-label">
                <span className="sr-only">Step {i + 1} of 3: </span>
                {s}
                {i < step ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <Elapsed startedAt={startedAt} finishedAt={finishedAt} />
      </div>

      <Card className="ad-wizard-card">
        <h2 ref={headingRef} tabIndex={-1} className="ad-step-title">
          {step + 1}. {STEPS[step]}
        </h2>
        {step === 0 ? (
          <ProfileStep
            onCreated={(t, p) => {
              setTeacher(t);
              setPhone(p);
              setStep(1);
            }}
          />
        ) : null}
        {step === 1 && teacher ? (
          <div className="stack">
            <p className="muted">
              Registered <strong>{teacher.name}</strong>. Now load the class register so spoken names can be matched to
              real students.
            </p>
            <RosterUpload
              teacherId={teacher.id}
              teacherName={teacher.name}
              classes={teacher.classes}
              onUploaded={setRoster}
            />
            <div className="ad-step-foot">
              <Button type="button" onClick={goDone} disabled={!roster || roster.accepted === 0}>
                Continue
              </Button>
              <Button type="button" variant="ghost" onClick={goDone}>
                Skip — upload roster later
              </Button>
            </div>
          </div>
        ) : null}
        {step === 2 && teacher ? (
          <div className="stack">
            <DoneStep teacher={teacher} phone={phone} roster={roster} />
            <div className="ad-step-foot">
              <Button type="button" onClick={restart}>
                Onboard next teacher
              </Button>
              <Link to="/admin" className="btn btn-ghost">
                Back to teacher list
              </Link>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Elapsed({ startedAt, finishedAt }: { startedAt: number; finishedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (finishedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finishedAt]);
  const s = Math.max(0, Math.round(((finishedAt ?? now) - startedAt) / 1000));
  const over = s > TARGET_S;
  return (
    <p className={`ad-elapsed num ${over ? "is-over" : ""}`}>
      {finishedAt ? `Done in ${fmt(s)}` : `${fmt(s)} elapsed`}
      <span className="muted"> · target under 5:00</span>
    </p>
  );
}

/* ---------------- Step 1: profile ---------------- */

interface ClassRow {
  key: number;
  grade: string;
  section: string;
}

type Errors = Partial<Record<"name" | "phone" | "language" | "school" | "state" | "udise" | "classes", string>>;

function ProfileStep({ onCreated }: { onCreated: (t: AdminTeacher, phone: string) => void }) {
  const { rejectKey } = useAdmin();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<Language | "">("");
  const [school, setSchool] = useState("");
  const [state, setState] = useState("");
  const [udise, setUdise] = useState("");
  const [rows, setRows] = useState<ClassRow[]>([{ key: 1, grade: "", section: "" }]);
  const nextKey = useRef(2);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const errors = validate();
  const show = (k: keyof Errors) => (submitted || touched[k]) && errors[k];

  function validate(): Errors {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = "Enter the teacher’s name.";
    if (!phone.trim()) e.phone = "Enter the teacher’s mobile number.";
    else if (!normalisePhone(phone)) e.phone = "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.";
    if (!language) e.language = "Choose the language the teacher will speak in.";
    if (school.trim().length < 2) e.school = "Enter the school name.";
    if (!state) e.state = "Choose the state.";
    if (udise.trim() && !/^\d{11}$/.test(udise.trim())) e.udise = "UDISE code is 11 digits. Leave empty if unknown.";
    const filled = rows.filter((r) => r.grade);
    if (!filled.length) e.classes = "Add at least one class the teacher takes attendance for.";
    else if (rows.some((r) => !r.grade && r.section.trim())) e.classes = "Pick a grade for every row with a section.";
    else if (rows.some((r) => r.section.trim() && !/^[A-Za-z0-9]{1,3}$/.test(r.section.trim())))
      e.classes = "Section should be short, like A, B or 1.";
    else {
      const seen = new Set<string>();
      for (const r of filled) {
        const k = `${r.grade}-${r.section.trim().toUpperCase()}`;
        if (seen.has(k)) {
          e.classes = `Class ${r.grade}${r.section.trim() ? `-${r.section.trim().toUpperCase()}` : ""} is listed twice.`;
          break;
        }
        seen.add(k);
      }
    }
    return e;
  }

  const blur = (k: keyof Errors) => () => setTouched((t) => ({ ...t, [k]: true }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.keys(errors).length) {
      // Focus the first invalid control.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    const digits = normalisePhone(phone)!;
    const body: NewTeacher = {
      name: name.trim(),
      phone: digits,
      language: language as Language,
      school_name: school.trim(),
      state,
      classes: rows
        .filter((r) => r.grade)
        .map((r) => ({ grade: Number(r.grade), section: r.section.trim() ? r.section.trim().toUpperCase() : null })),
    };
    if (udise.trim()) body.udise_code = udise.trim();
    setSaving(true);
    try {
      const t = await api.adminCreateTeacher(body);
      onCreated(t, digits);
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setSaving(false);
    }
  }

  const errCount = Object.keys(errors).length;

  return (
    <form ref={formRef} className="stack" onSubmit={submit} noValidate>
      <div aria-live="polite" className="sr-only">
        {submitted && errCount ? `${errCount} field${errCount > 1 ? "s" : ""} need attention.` : ""}
      </div>

      <div className="ad-grid">
        <Field id="t-name" label="Teacher’s name" error={show("name")}>
          <input
            id="t-name"
            className="input"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={blur("name")}
            aria-invalid={!!show("name")}
            aria-describedby={show("name") ? "t-name-err" : undefined}
          />
        </Field>
        <Field
          id="t-phone"
          label="Mobile number"
          hint="The teacher logs in with this number. Only the last 4 digits are shown afterwards."
          error={show("phone")}
        >
          <div className="ad-phone">
            <span className="ad-phone-cc" aria-hidden="true">
              +91
            </span>
            <input
              id="t-phone"
              className="input num"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={blur("phone")}
              aria-invalid={!!show("phone")}
              aria-describedby={show("phone") ? "t-phone-err" : "t-phone-hint"}
            />
          </div>
        </Field>
        <Field id="t-lang" label="Language for voice notes" error={show("language")}>
          <select
            id="t-lang"
            className="input"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            onBlur={blur("language")}
            aria-invalid={!!show("language")}
            aria-describedby={show("language") ? "t-lang-err" : undefined}
          >
            <option value="">Choose…</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.native === l.english ? l.native : `${l.native} — ${l.english}`}
              </option>
            ))}
          </select>
        </Field>
        <Field id="t-school" label="School name" error={show("school")}>
          <input
            id="t-school"
            className="input"
            autoComplete="off"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            onBlur={blur("school")}
            aria-invalid={!!show("school")}
            aria-describedby={show("school") ? "t-school-err" : undefined}
          />
        </Field>
        <Field id="t-state" label="State" error={show("state")}>
          <select
            id="t-state"
            className="input"
            value={state}
            onChange={(e) => setState(e.target.value)}
            onBlur={blur("state")}
            aria-invalid={!!show("state")}
            aria-describedby={show("state") ? "t-state-err" : undefined}
          >
            <option value="">Choose…</option>
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field id="t-udise" label="UDISE code (optional)" hint="11 digits, on the school’s UDISE+ certificate." error={show("udise")}>
          <input
            id="t-udise"
            className="input num"
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            value={udise}
            onChange={(e) => setUdise(e.target.value.replace(/\D/g, ""))}
            onBlur={blur("udise")}
            aria-invalid={!!show("udise")}
            aria-describedby={show("udise") ? "t-udise-err" : "t-udise-hint"}
          />
        </Field>
      </div>

      <fieldset className="ad-fieldset" aria-describedby={show("classes") ? "t-classes-err" : "t-classes-hint"}>
        <legend>Classes taught</legend>
        <p id="t-classes-hint" className="muted ad-small">
          Every class this teacher marks attendance for. Grades 1–8; section only if the school has more than one.
        </p>
        <ul className="ad-class-rows">
          {rows.map((r, i) => (
            <li key={r.key} className="ad-class-row">
              <div className="field">
                <label htmlFor={`g-${r.key}`}>Grade</label>
                <select
                  id={`g-${r.key}`}
                  className="input"
                  value={r.grade}
                  aria-invalid={!!show("classes") && !r.grade && i === 0}
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, grade: e.target.value } : x)))}
                  onBlur={blur("classes")}
                >
                  <option value="">—</option>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      Class {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`s-${r.key}`}>Section</label>
                <input
                  id={`s-${r.key}`}
                  className="input"
                  maxLength={3}
                  autoComplete="off"
                  placeholder="optional"
                  value={r.section}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, section: e.target.value.toUpperCase() } : x)))
                  }
                  onBlur={blur("classes")}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                className="ad-remove"
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                Remove<span className="sr-only"> class row {i + 1}</span>
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, grade: "", section: "" }])}
            disabled={rows.length >= 16}
          >
            + Add another class
          </Button>
        </div>
        {show("classes") ? (
          <p id="t-classes-err" className="ad-inline-err">
            {errors.classes}
          </p>
        ) : null}
      </fieldset>

      <ErrorNote error={error} />
      <div className="ad-step-foot">
        <Button type="submit" loading={saving}>
          Save and continue
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | false | undefined;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="ad-inline-err">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="muted ad-small">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
