import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth";
import { Button, Card, ErrorNote, Spinner, classLabel } from "../../components/ui";
import { useLoad } from "./useLoad";

/** One collapsible block per class: roll no + name. */
export function RosterViewer() {
  const { data, error, loading, reload } = useLoad(() => api.roster(), []);
  if (loading && !data)
    return (
      <div className="row">
        <Spinner /> <span className="muted">Loading class lists…</span>
      </div>
    );
  if (error)
    return (
      <div className="stack">
        <ErrorNote error={error} />
        <Button variant="secondary" onClick={() => void reload()}>Try again</Button>
      </div>
    );
  if (!data?.length) return <p className="muted">No class list yet. Your pilot lead uploads it for you.</p>;
  return (
    <div>
      {data.map((c) => (
        <details key={c.id} className="db-roster">
          <summary>
            <span>
              {classLabel(c.grade, c.section)} <span className="muted num">· {c.students.length} students</span>
            </span>
          </summary>
          <ol className="db-names" aria-label={`${classLabel(c.grade, c.section)} students`}>
            {[...c.students]
              .sort((a, b) => a.roll_no - b.roll_no)
              .map((s) => (
                <li key={s.id}>
                  <span className="db-roll">{s.roll_no}</span>
                  <span>{s.name}</span>
                </li>
              ))}
          </ol>
        </details>
      ))}
    </div>
  );
}

const WORD = "DELETE";

/** Typed-word confirmation, then delete everything and sign out. */
export function DeleteData() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMe();
      logout();
      navigate("/login", { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Card className="db-danger">
      <h2>Delete my data</h2>
      <p className="muted">
        Removes your class lists, every record, transcripts and generated files from Shikshak Sahayak. This cannot be
        undone. Download any registers you need first.
      </p>
      {!open ? (
        <Button variant="secondary" block onClick={() => setOpen(true)}>
          Delete my data…
        </Button>
      ) : (
        <div className="stack">
          <div className="field">
            <label htmlFor="db-del">
              Type <strong>{WORD}</strong> to confirm
            </label>
            <input id="db-del" className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false}
              value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <div aria-live="polite">
            <ErrorNote error={error} />
          </div>
          <Button variant="danger" block loading={busy} disabled={typed.trim().toUpperCase() !== WORD}
            onClick={() => void doDelete()}>
            Permanently delete everything
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => { setOpen(false); setTyped(""); }}>
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}
