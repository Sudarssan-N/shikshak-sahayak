import { useState, type FormEvent } from "react";
import { Button, Card } from "../../components/ui";

export function KeyGate({ rejected, onSave }: { rejected: boolean; onSave: (key: string) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const empty = key.trim() === "";

  const [checking, setChecking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (empty) return;
    setChecking(true);
    try {
      await onSave(key.trim());
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="ad-gate">
      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          <div>
            <h1>Pilot lead sign-in</h1>
            <p className="muted">
              Paste the pilot-lead key you were given. It lets you register teachers and upload class rosters. It does
              not show any attendance or meal records.
            </p>
          </div>
          <div aria-live="assertive">
            {rejected ? (
              <p className="error-note" role="alert">
                Key not accepted. Check for missing characters and paste it again.
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="ad-key">Pilot-lead key</label>
            <input
              id="ad-key"
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-invalid={touched && empty}
              aria-describedby={touched && empty ? "ad-key-err" : "ad-key-help"}
            />
            {touched && empty ? (
              <p id="ad-key-err" className="ad-inline-err">
                Paste the key to continue.
              </p>
            ) : (
              <p id="ad-key-help" className="muted ad-small">
                Stored only in this browser. Use “Forget key” when you are done on a shared computer.
              </p>
            )}
          </div>
          <Button type="submit" block loading={checking}>
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
