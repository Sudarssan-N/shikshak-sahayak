import { useState } from "react";
import { api } from "../../api/client";
import type { DailyRecord, Language } from "../../api/types";
import { Button, Spinner } from "../../components/ui";
import { MicIcon } from "./Brand";
import { exampleFix, friendlyError, LANG_TAG } from "./copy";
import { RecordingView } from "./RecordingView";
import { recorderErrorText, useRecorder } from "./useRecorder";

const FIX_MAX_S = 30;

interface Props {
  recordId: string;
  language: Language;
  onUpdated: (r: DailyRecord) => void;
  onClose: () => void;
}

type Pending = { kind: "audio"; blob: Blob } | { kind: "text"; text: string };

/** Speak (or type) a short correction: "No, 24 were present." */
export function FixPanel({ recordId, language, onUpdated, onClose }: Props) {
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Pending | null>(null);

  async function send(p: Pending) {
    setBusy(true);
    setError(null);
    setFailed(null);
    try {
      const r = p.kind === "audio" ? await api.correctByAudio(recordId, p.blob) : await api.correctByText(recordId, p.text);
      onUpdated(r);
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setFailed(p); // keep it so they can retry without re-recording
      setBusy(false);
    }
  }

  const rec = useRecorder({ maxSeconds: FIX_MAX_S, onDone: (blob) => void send({ kind: "audio", blob }) });
  const micError = rec.error ? recorderErrorText(rec.error) : null;
  const recording = rec.status !== "idle";

  return (
    <div className="cc-panel stack" aria-busy={busy || undefined}>
      <p className="cap-small muted">
        Say only what's wrong, for example: <span lang={LANG_TAG[language]}>“{exampleFix(language)}”</span>
      </p>

      {busy ? (
        <p className="row" role="status">
          <Spinner small /> Updating the record…
        </p>
      ) : recording ? (
        <RecordingView compact elapsed={rec.elapsed} maxSeconds={FIX_MAX_S} meterRef={rec.meterRef} onStop={rec.stop} onCancel={rec.cancel} />
      ) : mode === "voice" && !micError ? (
        <div className="row cap-center">
          <Button onClick={() => void rec.start()}>
            <MicIcon size={20} /> Speak the correction
          </Button>
          <Button variant="ghost" onClick={() => setMode("text")}>
            Type it
          </Button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void send({ kind: "text", text: text.trim() });
          }}
        >
          {micError ? <p className="error-note">{micError}</p> : null}
          <label className="field">
            <span className="sr-only">Correction</span>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={exampleFix("en")} autoFocus />
          </label>
          <div className="row cap-split">
            {!micError ? (
              <Button type="button" variant="ghost" onClick={() => setMode("voice")}>
                <MicIcon size={18} /> Speak instead
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!text.trim()}>
              Apply fix
            </Button>
          </div>
        </form>
      )}

      {error ? (
        <div className="error-note" role="alert">
          <p>{error}</p>
          {failed ? (
            <Button variant="secondary" onClick={() => void send(failed)}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      {!recording && !busy ? (
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      ) : null}
    </div>
  );
}
