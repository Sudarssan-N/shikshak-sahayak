import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "starting" | "recording";
export type RecorderError = "denied" | "no-mic" | "unsupported" | "failed";

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m));
}

export function recorderSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

interface Options {
  maxSeconds: number;
  /** Called with the finished audio when the teacher taps Stop or the time limit is hit. Not called on cancel. */
  onDone: (blob: Blob, seconds: number) => void;
}

/**
 * MediaRecorder + live input level. The level is written straight to the `--level` CSS variable
 * (0..1) on `meterRef` every animation frame, so a meter animates without re-rendering React.
 */
export function useRecorder({ maxSeconds, onDone }: Options) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<RecorderError | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const meterRef = useRef<HTMLDivElement>(null);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const res = useRef<{
    rec?: MediaRecorder;
    stream?: MediaStream;
    ctx?: AudioContext;
    raf?: number;
    timer?: number;
    startedAt: number;
    /** One object per recording, so a late `onstop` from a cancelled take can't leak into the next one. */
    take?: { cancelled: boolean };
  }>({ startedAt: 0 });

  const teardown = useCallback(() => {
    const r = res.current;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.timer) clearInterval(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => undefined);
    r.raf = r.timer = undefined;
    r.stream = r.ctx = r.rec = undefined;
    meterRef.current?.style.setProperty("--level", "0");
  }, []);

  const stop = useCallback(() => {
    const rec = res.current.rec;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const cancel = useCallback(() => {
    if (res.current.take) res.current.take.cancelled = true;
    stop();
    teardown();
    setStatus("idle");
    setElapsed(0);
  }, [stop, teardown]);

  const start = useCallback(async () => {
    setError(null);
    if (!recorderSupported()) {
      setError("unsupported");
      return;
    }
    setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-mic" : "failed");
      setStatus("idle");
      return;
    }

    const r = res.current;
    r.stream = stream;
    const take = { cancelled: false };
    r.take = take;

    // Level meter (best effort: a meter failure must never block recording).
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      void ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let smooth = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        smooth = smooth * 0.7 + Math.min(1, rms * 4) * 0.3;
        meterRef.current?.style.setProperty("--level", smooth.toFixed(3));
        r.raf = requestAnimationFrame(tick);
      };
      r.ctx = ctx;
      r.raf = requestAnimationFrame(tick);
    } catch {
      /* no meter */
    }

    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      teardown();
      setError("unsupported");
      setStatus("idle");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunks.push(ev.data);
    };
    rec.onstop = () => {
      const seconds = (Date.now() - r.startedAt) / 1000;
      if (take.cancelled) return; // cancel() already tore down
      teardown();
      setStatus("idle");
      setElapsed(0);
      if (chunks.length) {
        onDoneRef.current(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), seconds);
      }
    };
    r.rec = rec;
    r.startedAt = Date.now();
    rec.start(1000);
    setElapsed(0);
    setStatus("recording");
    r.timer = window.setInterval(() => {
      const s = (Date.now() - r.startedAt) / 1000;
      setElapsed(s);
      if (s >= maxSeconds) stop();
    }, 250);
  }, [maxSeconds, stop, teardown]);

  // Leaving the page mid-recording: release the mic and drop the audio.
  useEffect(
    () => () => {
      if (res.current.take) res.current.take.cancelled = true;
      const rec = res.current.rec;
      if (rec && rec.state !== "inactive") rec.stop();
      teardown();
    },
    [teardown],
  );

  return { status, error, elapsed, meterRef, start, stop, cancel, clearError: () => setError(null) };
}

export function recorderErrorText(e: RecorderError): string {
  switch (e) {
    case "denied":
      return "Microphone permission is off. Allow the microphone for this site in your browser settings, then try again — or type your note instead.";
    case "no-mic":
      return "No microphone was found on this phone. You can type your note instead.";
    case "unsupported":
      return "This browser can't record audio here. Try Chrome, or type your note instead.";
    default:
      return "The microphone could not start. Please try again, or type your note instead.";
  }
}
