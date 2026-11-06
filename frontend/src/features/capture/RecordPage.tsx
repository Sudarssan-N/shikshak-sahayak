import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { DailyRecord, NoteResult } from "../../api/types";
import { useAuth } from "../../auth";
import { Button } from "../../components/ui";
import { ConfirmCard } from "./ConfirmCard";
import { friendlyError, todayIso } from "./copy";
import { DoneView, FailedView } from "./DoneView";
import { IdleView } from "./IdleView";
import { ProcessingView } from "./ProcessingView";
import { RecordingView } from "./RecordingView";
import { recorderErrorText, useRecorder } from "./useRecorder";
import "./capture.css";

const MAX_SECONDS = 90;
const MIN_SECONDS = 1;

type Pending = { kind: "audio"; blob: Blob } | { kind: "text"; text: string };
type Phase =
  | { name: "idle" }
  | { name: "processing"; pending: Pending }
  | { name: "send-error"; pending: Pending; message: string }
  | { name: "review"; note: NoteResult["note"] }
  | { name: "failed"; message: string; transcript?: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function RecordPage() {
  const { teacher, refresh } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const practice = params.get("practice") === "1";

  // Backfill: /record?date=YYYY-MM-DD, or state.recordDate from the dashboard.
  const presetDate = params.get("date") ?? (location.state as { recordDate?: string } | null)?.recordDate;
  const [recordDate, setRecordDate] = useState(() => (presetDate && ISO_DAY.test(presetDate) ? presetDate : todayIso()));
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [shortNote, setShortNote] = useState(false);
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const send = useCallback(
    async (pending: Pending) => {
      setPhase({ name: "processing", pending });
      setAnnounce("Sending your note.");
      const date = recordDate === todayIso() ? undefined : recordDate;
      try {
        const res = pending.kind === "audio" ? await api.sendAudio(pending.blob, date) : await api.sendText(pending.text, date);
        if (res.note.status === "failed") {
          setPhase({ name: "failed", message: res.note.error ?? "I couldn't understand that note.", transcript: res.note.transcript });
        } else if (!res.records.length) {
          setPhase({
            name: "failed",
            message: "I couldn't find any class, attendance or meal numbers in that note. Try saying the class and how many were present.",
            transcript: res.note.transcript,
          });
        } else {
          setRecords(res.records);
          setPhase({ name: "review", note: res.note });
          setAnnounce(`Ready to check: ${res.records.length} ${res.records.length === 1 ? "class" : "classes"}.`);
        }
      } catch (e) {
        setPhase({ name: "send-error", pending, message: friendlyError(e) });
      }
    },
    [recordDate],
  );

  const rec = useRecorder({
    maxSeconds: MAX_SECONDS,
    onDone: (blob, seconds) => {
      if (seconds < MIN_SECONDS) {
        setShortNote(true);
        return;
      }
      void send({ kind: "audio", blob });
    },
  });

  const replaceRecord = (oldId: string) => (r: DailyRecord) =>
    setRecords((rs) => rs.map((x) => (x.id === oldId ? r : x)));

  const allConfirmed = phase.name === "review" && records.length > 0 && records.every((r) => r.status === "confirmed");

  useEffect(() => {
    if (allConfirmed) {
      setAnnounce("All records saved.");
      void refresh(); // records_confirmed changed (ends onboarding)
    }
  }, [allConfirmed, refresh]);

  // Move focus to the new heading whenever the screen changes, so screen readers follow along.
  const view = rec.status === "recording" ? "recording" : allConfirmed ? "done" : phase.name;
  useEffect(() => {
    headingRef.current?.focus();
  }, [view]);

  if (!teacher) return null;

  const reset = () => {
    setRecords([]);
    setPhase({ name: "idle" });
  };

  const startRecording = () => {
    setShortNote(false);
    void rec.start();
  };

  let body;
  if (view === "recording") {
    body = (
      <>
        <ScreenTitle headingRef={headingRef} practice={practice} title="Listening…" />
        <RecordingView elapsed={rec.elapsed} maxSeconds={MAX_SECONDS} meterRef={rec.meterRef} onStop={rec.stop} onCancel={rec.cancel} />
      </>
    );
  } else if (view === "done") {
    body = <DoneView records={records} practice={practice} headingRef={headingRef} onAnother={reset} />;
  } else if (phase.name === "processing") {
    body = (
      <>
        <ScreenTitle headingRef={headingRef} practice={practice} title="Working on it" />
        <ProcessingView source={phase.pending.kind} />
      </>
    );
  } else if (phase.name === "send-error") {
    const p = phase.pending;
    body = (
      <div className="stack">
        <ScreenTitle headingRef={headingRef} practice={practice} title="Couldn't send" />
        <p className="error-note" role="alert">
          {phase.message}
        </p>
        <p className="muted">{p.kind === "audio" ? "Your recording is saved on this phone — no need to speak again." : "Your typed note is kept."}</p>
        <Button block onClick={() => void send(p)}>
          Try again
        </Button>
        <Button block variant="ghost" onClick={reset}>
          {p.kind === "audio" ? "Discard and record again" : "Start over"}
        </Button>
      </div>
    );
  } else if (phase.name === "failed") {
    body = <FailedView message={phase.message} transcript={phase.transcript} headingRef={headingRef} onRetry={reset} />;
  } else if (phase.name === "review") {
    const pending = records.filter((r) => r.status !== "confirmed").length;
    body = (
      <div className="stack">
        <ScreenTitle
          headingRef={headingRef}
          practice={practice}
          title="Check and confirm"
          sub={
            records.length > 1
              ? `${pending} of ${records.length} classes left to confirm. Nothing is saved until you confirm.`
              : "Nothing is saved until you confirm."
          }
        />
        {phase.note.transcript ? (
          <details className="rec-transcript">
            <summary>What I heard</summary>
            <p>{phase.note.transcript}</p>
          </details>
        ) : null}
        {records.map((r) => (
          <ConfirmCard key={r.id} record={r} language={teacher.language} onUpdated={replaceRecord(r.id)} />
        ))}
        <Button variant="ghost" block onClick={reset}>
          Discard and record again
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <ScreenTitle
          headingRef={headingRef}
          practice={practice}
          title={practice ? "Your practice note" : "Today's note"}
          sub="Class, how many came, who was absent, meals served, lesson done — in one go."
        />
        {shortNote ? (
          <p className="cap-callout" role="status">
            That was very short. Tap the microphone, say your whole note, then tap the square.
          </p>
        ) : null}
        <IdleView
          teacher={teacher}
          recordDate={recordDate}
          onDateChange={setRecordDate}
          onRecord={startRecording}
          onSendText={(text) => void send({ kind: "text", text })}
          starting={rec.status === "starting"}
          micError={rec.error ? recorderErrorText(rec.error) : null}
        />
      </>
    );
  }

  return (
    <div className={`rec-page ${practice ? "rec-practice" : ""}`}>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {body}
    </div>
  );
}

function ScreenTitle({
  title,
  sub,
  practice,
  headingRef,
}: {
  title: string;
  sub?: string;
  practice: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
    <header className="rec-title">
      {practice ? <span className="rec-practice-tag">Practice run · नमूना</span> : null}
      <h1 ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      {sub ? <p className="muted">{sub}</p> : null}
    </header>
  );
}
