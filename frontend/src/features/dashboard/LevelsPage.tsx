import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { ClassLevels, ParsedLevels } from "../../api/types";
import { useAuth } from "../../auth";
import { classLabel, ErrorNote, Spinner } from "../../components/ui";
import { MicIcon } from "../capture/Brand";
import { recorderErrorText, useRecorder } from "../capture/useRecorder";
import "./dashboard.css";

type Draft = Record<string, { reading: string | null; maths: string | null }>;

const EXAMPLE = {
  hi: "मीना कहानी घटाना, रवि अक्षर एक अंक, सीता शब्द दो अंक",
  en: "Meena story subtraction, Ravi letters 1 to 9, Sita words 10 to 99",
} as const;

/** Monthly ASER-style levels per child, said or tapped, and the Teaching-at-the-Right-Level groups they make. */
export default function LevelsPage() {
  const { teacher } = useAuth();
  const classes = teacher?.classes ?? [];
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [data, setData] = useState<ClassLevels | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [source, setSource] = useState<"tap" | "voice">("tap");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState<ParsedLevels | null>(null);
  const [text, setText] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!classId) return;
    setData(null);
    setDraft({});
    setHeard(null);
    api.levels(classId).then(setData, setError);
  }, [classId]);

  const rec = useRecorder({ maxSeconds: 90, onDone: (blob) => void parse({ audio: blob }) });

  async function parse(input: { text?: string; audio?: Blob }) {
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    try {
      const p = await api.parseLevels(classId, input);
      setHeard(p);
      setSource("voice");
      setDraft((d) => {
        const next = { ...d };
        for (const it of p.items) {
          const cur = next[it.student_id] ?? currentOf(it.student_id);
          next[it.student_id] = { reading: it.reading ?? cur.reading, maths: it.maths ?? cur.maths };
        }
        return next;
      });
      setText("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function currentOf(id: string) {
    const c = data?.children.find((k) => k.student_id === id);
    return { reading: c?.reading ?? null, maths: c?.maths ?? null };
  }

  const changed = useMemo(
    () =>
      Object.entries(draft).filter(([id, v]) => {
        const c = currentOf(id);
        return c.reading !== v.reading || c.maths !== v.maths;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, data],
  );

  async function save() {
    setBusy(true);
    try {
      const items = changed.map(([student_id, v]) => ({ student_id, ...v }));
      const res = await api.saveLevels(classId, items, source);
      setData(res);
      setDraft({});
      setHeard(null);
      setSource("tap");
      setSavedMsg(`Saved ${items.length} ${items.length === 1 ? "child" : "children"}.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!teacher) return null;
  const lang = teacher.language === "hi" ? "hi" : "en";
  const recording = rec.status !== "idle";
  const monthName = data ? new Date(`${data.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "";

  return (
    <div className="db-page lv-page">
      <header>
        <Link to="/" className="lv-back">
          ‹ Home
        </Link>
        <h1>Reading &amp; maths levels</h1>
        <p className="muted">
          Once a month, say each child’s level. Children at the same level learn together: that is Teaching at the Right Level.
        </p>
      </header>

      {classes.length > 1 ? (
        <div className="db-chips" role="group" aria-label="Class">
          {classes.map((k) => (
            <button key={k.id} type="button" className="db-chip" aria-pressed={k.id === classId} onClick={() => setClassId(k.id)}>
              {classLabel(k.grade, k.section)}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <ErrorNote error={error} /> : null}
      {!data ? (
        <div className="row" aria-live="polite">
          <Spinner /> <span className="muted">Loading the class…</span>
        </div>
      ) : (
        <>
          <section className="lv-say" aria-labelledby="lv-say-h">
            <h2 id="lv-say-h">Say the levels</h2>
            <p className="lv-example" lang={lang === "hi" ? "hi" : "en-IN"}>
              “{EXAMPLE[lang]}”
            </p>
            <div className="lv-say-row">
              <button
                type="button"
                className={`lv-mic ${recording ? "lv-mic-on" : ""}`}
                onClick={() => (recording ? rec.stop() : void rec.start())}
                disabled={busy}
                aria-label={recording ? "Stop and use what I said" : "Speak levels"}
              >
                {recording ? <span className="lv-stop" aria-hidden /> : <MicIcon size={26} />}
              </button>
              <form
                className="lv-type"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim()) void parse({ text: text.trim() });
                }}
              >
                <label htmlFor="lv-text" className="sr-only">
                  Or type levels
                </label>
                <input id="lv-text" className="input" placeholder="Or type them here" value={text} onChange={(e) => setText(e.target.value)} />
                <button className="btn btn-secondary" type="submit" disabled={!text.trim() || busy}>
                  Add
                </button>
              </form>
            </div>
            {recording ? (
              <p className="lv-live num" aria-live="polite">
                Listening… {Math.floor(rec.elapsed)}s. Tap the button again when done.
              </p>
            ) : null}
            {rec.error ? <p className="error-note">{recorderErrorText(rec.error)}</p> : null}
            {busy ? (
              <p className="row muted">
                <Spinner small /> Working…
              </p>
            ) : null}
            {heard ? (
              <div className="lv-heard" role="status">
                <p>
                  <strong>
                    Filled {heard.items.length} {heard.items.length === 1 ? "child" : "children"}
                  </strong>{" "}
                  below. Check, then save.
                </p>
                {heard.unmatched.length ? (
                  <p className="lv-unmatched">
                    Not in this class: {heard.unmatched.map((u) => `“${u.spoken}”`).join(", ")}. Set them in the list.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <Groups data={data} />

          <section aria-labelledby="lv-list-h">
            <div className="db-section-head">
              <h2 id="lv-list-h">{monthName}</h2>
              <span className="db-today-count num">
                {data.done} of {data.total} done
              </span>
            </div>
            <ul className="lv-list">
              {data.children.map((k) => {
                const v = draft[k.student_id] ?? { reading: k.reading, maths: k.maths };
                const dirty = v.reading !== k.reading || v.maths !== k.maths;
                const set = (patch: Partial<typeof v>) => setDraft((d) => ({ ...d, [k.student_id]: { ...v, ...patch } }));
                return (
                  <li key={k.student_id} className={`lv-row ${dirty ? "lv-dirty" : ""}`}>
                    <span className="lv-name">
                      {k.name} <span className="muted num">#{k.roll_no}</span>
                    </span>
                    <label className="lv-sel">
                      <span>Reading</span>
                      <select className="input" value={v.reading ?? ""} onChange={(e) => set({ reading: e.target.value || null })}>
                        <option value="">—</option>
                        {data.reading_levels.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="lv-sel">
                      <span>Maths</span>
                      <select className="input" value={v.maths ?? ""} onChange={(e) => set({ maths: e.target.value || null })}>
                        <option value="">—</option>
                        {data.maths_levels.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {savedMsg ? (
            <p className="db-fu-saved" role="status">
              {savedMsg}
            </p>
          ) : null}
          {changed.length ? (
            <div className="lv-savebar">
              <button type="button" className="btn btn-accent btn-block" onClick={() => void save()} disabled={busy}>
                Save {changed.length} {changed.length === 1 ? "change" : "changes"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Groups({ data }: { data: ClassLevels }) {
  if (!data.groups.reading.length && !data.groups.maths.length) {
    return (
      <p className="db-fu-note">
        Groups appear here once levels are saved. Levels follow ASER: reading from letters to a story, maths from numbers to
        division.
      </p>
    );
  }
  return (
    <section aria-labelledby="lv-g-h" className="lv-groups">
      <h2 id="lv-g-h">Teach in these groups</h2>
      {(["reading", "maths"] as const).map((kind) =>
        data.groups[kind].length ? (
          <div key={kind} className="lv-gkind">
            <h3>{kind === "reading" ? "Reading" : "Maths"}</h3>
            <ul className="lv-glist">
              {data.groups[kind].map((g) => (
                <li key={g.level} className="lv-group">
                  <details>
                    <summary>
                      <span className="lv-glabel">{g.label}</span>
                      <span className="lv-gcount num">{g.count}</span>
                    </summary>
                    <p className="lv-gnames">{g.children.map((c) => c.name).join(", ")}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  );
}
