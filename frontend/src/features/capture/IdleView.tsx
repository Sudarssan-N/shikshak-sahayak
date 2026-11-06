import { useEffect, useId, useRef, useState } from "react";
import type { Teacher } from "../../api/types";
import { Button, formatDate } from "../../components/ui";
import { MicIcon } from "./Brand";
import { daysAgoIso, exampleNote, LANG_TAG, todayIso } from "./copy";

interface Props {
  teacher: Teacher;
  recordDate: string;
  onDateChange: (iso: string) => void;
  onRecord: () => void;
  onSendText: (text: string) => void;
  starting: boolean;
  micError: string | null;
}

export function IdleView({ teacher, recordDate, onDateChange, onRecord, onSendText, starting, micError }: Props) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const grade = teacher.classes[0]?.grade ?? 3;

  // A blocked mic means typing is the only way forward — open it for them.
  useEffect(() => {
    if (micError) setTyping(true);
  }, [micError]);
  useEffect(() => {
    if (typing) textRef.current?.focus();
  }, [typing]);

  return (
    <div className="rec-idle">
      <DateChooser value={recordDate} onChange={onDateChange} />

      <div className="rec-hint">
        <span className="rec-hint-label">Say it like this</span>
        <p className="rec-example" lang={LANG_TAG[teacher.language]}>
          “{exampleNote(teacher.language, grade)}”
        </p>
      </div>

      {micError ? (
        <p className="error-note" role="alert">
          {micError}
        </p>
      ) : null}

      {!typing ? (
        <div className="rec-stage">
          <button type="button" className="rec-big" onClick={onRecord} disabled={starting} aria-label="Start recording">
            <MicIcon size={56} />
          </button>
          <p className="rec-big-label">{starting ? "Starting microphone…" : "Tap to speak"}</p>
          <p className="rec-big-sub">Up to 90 seconds · speak in your own language</p>
          <button type="button" className="cap-linkbtn" onClick={() => setTyping(true)}>
            Type instead
          </button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onSendText(text.trim());
          }}
        >
          <div className="field">
            <label htmlFor="note-text">Type your note</label>
            <textarea
              id="note-text"
              ref={textRef}
              className="input rec-textarea"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={exampleNote("en", grade)}
              lang={LANG_TAG[teacher.language]}
            />
          </div>
          <Button type="submit" block disabled={!text.trim()}>
            Send note
          </Button>
          {!micError ? (
            <Button type="button" variant="ghost" block onClick={() => setTyping(false)}>
              <MicIcon size={18} /> Speak instead
            </Button>
          ) : (
            <Button type="button" variant="ghost" block onClick={onRecord}>
              <MicIcon size={18} /> Try the microphone again
            </Button>
          )}
        </form>
      )}
    </div>
  );
}

function dayLabel(iso: string) {
  if (iso === todayIso()) return "Today";
  if (iso === daysAgoIso(1)) return "Yesterday";
  return formatDate(iso);
}

/** "Recording for: Today ▾" — for catching up on missed days. */
function DateChooser({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };
  const quick = [todayIso(), daysAgoIso(1), daysAgoIso(2)];
  return (
    <div className="rec-date">
      <button
        type="button"
        className="rec-date-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="muted">Recording for:</span> <strong>{dayLabel(value)}</strong>
        <span aria-hidden className={`rec-caret ${open ? "rec-caret-open" : ""}`}>
          ▾
        </span>
      </button>
      {open ? (
        <div id={panelId} className="rec-date-panel">
          <div className="row" role="group" aria-label="Pick a day">
            {quick.map((iso) => (
              <button key={iso} type="button" className="cap-chip" aria-pressed={value === iso} onClick={() => pick(iso)}>
                {dayLabel(iso)}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="cap-small muted">Another day</span>
            <input
              type="date"
              className="input"
              max={todayIso()}
              value={value}
              onChange={(e) => e.target.value && pick(e.target.value)}
            />
          </label>
          <p className="muted cap-small">You can also just say the day in your note, e.g. “Yesterday Class 3…”.</p>
        </div>
      ) : null}
    </div>
  );
}
