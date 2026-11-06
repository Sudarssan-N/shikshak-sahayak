import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";

type State = "idle" | "loading" | "playing" | "error";

/** Reads the confirmation card aloud in the teacher's language, so they can check it by ear. */
export function ListenButton({ recordId, version }: { recordId: string; version: number }) {
  const [state, setState] = useState<State>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // A new version of the record means new words: drop the old audio.
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
  }, [recordId, version]);
  useEffect(() => () => audioRef.current?.pause(), []);

  function toggle() {
    if (state === "playing" || state === "loading") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    const a = audioRef.current ?? new Audio(api.speechUrl(recordId, version));
    audioRef.current = a;
    a.onplaying = () => setState("playing");
    a.onended = () => setState("idle");
    a.onerror = () => setState("error");
    setState("loading");
    a.currentTime = 0;
    a.play().catch(() => setState("error"));
  }

  const label =
    state === "loading" ? "Getting voice…" : state === "playing" ? "Stop" : state === "error" ? "Voice unavailable" : "Listen";
  return (
    <button
      type="button"
      className={`listen-btn listen-${state}`}
      onClick={toggle}
      aria-label={state === "playing" ? "Stop reading aloud" : "Read this card aloud"}
      disabled={state === "error"}
    >
      {state === "playing" ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5L6 9H3v6h3l5 4z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
