import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth";
import { Button, classLabel, ErrorNote } from "../../components/ui";
import { Brand, CheckIcon, MicIcon } from "./Brand";
import { CONSENT, exampleNote, friendlyError, LANG_TAG } from "./copy";
import "./capture.css";

export default function WelcomePage() {
  const { teacher, setTeacher, logout } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"consent" | "practice">(teacher?.consent_at ? "practice" : "consent");
  const [lang, setLang] = useState<"en" | "hi">(teacher?.language === "hi" ? "hi" : "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  if (!teacher) return null; // RequireTeacher guarantees this
  const firstName = teacher.name.split(" ")[0];
  const grade = teacher.classes[0]?.grade ?? 3;

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      setTeacher(await api.consent());
      setStep("practice");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const c = CONSENT[lang];

  return (
    <div className="cap-screen">
      <Brand />

      <section className="cap-panel cap-school" aria-label="Your school">
        <p className="cap-eyebrow">Namaste, {firstName}</p>
        <p className="cap-school-name">{teacher.school.name}</p>
        <ul className="cap-class-list">
          {teacher.classes.map((cl) => (
            <li key={cl.id}>
              <span>{classLabel(cl.grade, cl.section)}</span>
              <span className="muted num">{cl.enrolled} students</span>
            </li>
          ))}
          {teacher.classes.length === 0 ? <li className="muted">No classes yet — your pilot lead will add them.</li> : null}
        </ul>
      </section>

      {step === "consent" ? (
        <section className="cap-panel stack" lang={LANG_TAG[lang]} aria-labelledby="consent-h">
          <div className="cap-split row">
            <h1 id="consent-h" ref={headingRef} tabIndex={-1}>
              {c.title}
            </h1>
            <button
              type="button"
              className="cap-chip"
              onClick={() => setLang(lang === "en" ? "hi" : "en")}
              lang={lang === "en" ? "hi" : "en"}
              aria-pressed={lang === "hi"}
            >
              {c.toggle}
            </button>
          </div>
          <ul className="cap-consent">
            {c.lines.map((l) => (
              <li key={l}>
                <span className="cap-consent-tick">
                  <CheckIcon size={16} />
                </span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
          <ErrorNote error={error} />
          <Button block onClick={agree} loading={busy}>
            {c.agree}
          </Button>
          <button type="button" className="cap-linkbtn cap-center" onClick={logout} lang="en">
            Not {firstName}? Log out
          </button>
        </section>
      ) : (
        <section className="cap-panel stack" aria-labelledby="practice-h">
          <h1 id="practice-h" ref={headingRef} tabIndex={-1}>
            Let's try one practice note
          </h1>
          <p className="muted">
            Tap the microphone and say something like this. You'll see what I understood before anything is saved.
          </p>
          <blockquote className="cap-example" lang={LANG_TAG[teacher.language]}>
            “{exampleNote(teacher.language, grade)}”
          </blockquote>
          {teacher.language !== "en" ? (
            <p className="muted cap-small">
              Or in English: “{exampleNote("en", grade)}”
            </p>
          ) : null}
          <Button block onClick={() => navigate("/record?practice=1")}>
            <MicIcon size={20} /> Start practice
          </Button>
          <Button block variant="ghost" onClick={() => navigate("/", { replace: true })}>
            Skip for now
          </Button>
        </section>
      )}
    </div>
  );
}
