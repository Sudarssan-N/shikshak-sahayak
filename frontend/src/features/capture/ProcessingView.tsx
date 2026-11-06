import { useEffect, useState } from "react";
import { Spinner } from "../../components/ui";
import { CheckIcon } from "./Brand";

const AUDIO_STEPS = ["Listening to your note…", "Understanding classes and numbers…", "Checking against your class list…"];
const TEXT_STEPS = ["Reading your note…", "Understanding classes and numbers…", "Checking against your class list…"];
const STEP_MS = 2600;

/** One request, three reassuring steps on a timer. The last step waits for the server. */
export function ProcessingView({ source }: { source: "audio" | "text" }) {
  const steps = source === "audio" ? AUDIO_STEPS : TEXT_STEPS;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= steps.length - 1) return;
    const t = setTimeout(() => setI(i + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [i, steps.length]);

  return (
    <div className="rec-processing">
      <div className="rec-wave" aria-hidden>
        {[0, 1, 2, 3, 4].map((k) => (
          <span key={k} style={{ animationDelay: `${k * 0.12}s` }} />
        ))}
      </div>
      <ol className="rec-steps" aria-live="polite">
        {steps.map((s, k) => (
          <li key={s} className={k < i ? "done" : k === i ? "now" : "later"} aria-current={k === i ? "step" : undefined}>
            <span className="rec-step-icon">{k < i ? <CheckIcon size={16} /> : k === i ? <Spinner small /> : null}</span>
            <span>{k <= i ? s : s.replace("…", "")}</span>
          </li>
        ))}
      </ol>
      <p className="muted cap-small cap-center">Nothing is saved until you confirm.</p>
    </div>
  );
}
