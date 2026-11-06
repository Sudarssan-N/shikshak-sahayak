import { useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { DailyRecord } from "../../api/types";
import { Button, classLabel, formatDate } from "../../components/ui";
import { CheckIcon } from "./Brand";

const MINUTES = [
  { v: 0, label: "0" },
  { v: 5, label: "5" },
  { v: 10, label: "10" },
  { v: 15, label: "15" },
  { v: 20, label: "20+" },
];

interface Props {
  records: DailyRecord[];
  practice: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
  onAnother: () => void;
}

/** Saved! Then one tap: how much time did this save? */
export function DoneView({ records, practice, headingRef, onAnother }: Props) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<number | null>(null);

  async function rate(minutes: number) {
    setPicked(minutes);
    // Best effort: a lost rating must never block the teacher.
    await Promise.allSettled(records.map((r) => api.timeSaved(r.id, minutes)));
    setTimeout(() => navigate("/", { replace: true }), 900);
  }

  return (
    <div className="rec-done">
      <div className="rec-done-badge" aria-hidden>
        <CheckIcon size={44} />
      </div>
      <h1 ref={headingRef} tabIndex={-1}>
        {practice ? "Practice done — you're all set!" : "Saved"}
      </h1>
      <ul className="rec-done-list">
        {records.map((r) => (
          <li key={r.id}>
            <strong>{classLabel(r.grade, r.section)}</strong>
            <span className="muted"> · {formatDate(r.record_date)}</span>
            <span className="num">
              {" "}
              · {r.present ?? "—"} present · {r.meals_served ?? "—"} meals
            </span>
          </li>
        ))}
      </ul>

      <section className="rec-rate" aria-labelledby="rate-h">
        <h2 id="rate-h">How many minutes did this save you?</h2>
        <p className="muted cap-small" lang="hi">
          इससे आपके कितने मिनट बचे?
        </p>
        {picked === null ? (
          <div className="rec-rate-chips" role="group" aria-label="Minutes saved">
            {MINUTES.map((m) => (
              <button key={m.v} type="button" className="rec-rate-chip num" onClick={() => void rate(m.v)}>
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="rec-thanks" role="status">
            Thank you! Taking you home…
          </p>
        )}
      </section>

      {picked === null ? (
        <div className="stack">
          <Button variant="secondary" block onClick={onAnother}>
            Record another note
          </Button>
          <Button variant="ghost" block onClick={() => navigate("/", { replace: true })}>
            Skip
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The server could not make sense of the note (or found nothing to record). */
export function FailedView({
  message,
  transcript,
  headingRef,
  onRetry,
}: {
  message: string;
  transcript?: string;
  headingRef: RefObject<HTMLHeadingElement>;
  onRetry: () => void;
}) {
  return (
    <div className="rec-failed stack">
      <h1 ref={headingRef} tabIndex={-1}>
        Let's try that again
      </h1>
      <p className="error-note" role="alert">
        {message}
      </p>
      {transcript ? (
        <details className="rec-transcript">
          <summary>What I heard</summary>
          <p>{transcript}</p>
        </details>
      ) : null}
      <Button block onClick={onRetry}>
        Record again
      </Button>
    </div>
  );
}
