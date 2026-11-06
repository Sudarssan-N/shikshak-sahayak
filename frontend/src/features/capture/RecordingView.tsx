import type { CSSProperties, RefObject } from "react";
import { Button } from "../../components/ui";
import { mmss } from "./copy";

interface Props {
  elapsed: number;
  maxSeconds: number;
  meterRef: RefObject<HTMLDivElement>;
  onStop: () => void;
  onCancel: () => void;
  /** Smaller layout used inside a card (Fix by voice). */
  compact?: boolean;
}

/** Live recording: pulsing level ring around a big Stop button, a countdown ring and the timer. */
export function RecordingView({ elapsed, maxSeconds, meterRef, onStop, onCancel, compact }: Props) {
  const left = Math.max(0, maxSeconds - elapsed);
  const nearEnd = left <= 10;
  const style = { "--p": Math.min(1, elapsed / maxSeconds) } as CSSProperties;
  return (
    <div className={`rec-live ${compact ? "rec-live-compact" : ""}`}>
      <div className="rec-meter" ref={meterRef} style={style}>
        <span className="rec-meter-pulse" aria-hidden />
        <span className="rec-meter-ring" aria-hidden />
        <button type="button" className="rec-big rec-big-stop" onClick={onStop} aria-label="Stop and send">
          <span className="rec-stop-square" aria-hidden />
        </button>
      </div>
      <p className="rec-timer num" aria-hidden>
        <span className="rec-dot" /> {mmss(elapsed)}
        <span className="muted"> / {mmss(maxSeconds)}</span>
      </p>
      <p className={`cap-small ${nearEnd ? "rec-near-end" : "muted"}`} aria-live="polite">
        {nearEnd ? `${Math.ceil(left)} seconds left` : "Listening… tap the square when you're done."}
      </p>
      <div className="row cap-center">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onStop}>Done, send</Button>
      </div>
    </div>
  );
}
