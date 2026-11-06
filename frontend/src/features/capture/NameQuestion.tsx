import { useState } from "react";
import { api } from "../../api/client";
import type { DailyRecord, UnresolvedName } from "../../api/types";
import { Spinner } from "../../components/ui";
import { friendlyError } from "./copy";

interface Props {
  recordId: string;
  classText: string;
  item: UnresolvedName;
  onUpdated: (r: DailyRecord) => void;
}

/** "Which Ravi?" — one tap picks the roster entry, or drops a name that isn't in the class. */
export function NameQuestion({ recordId, classText, item, onUpdated }: Props) {
  const [busy, setBusy] = useState<string | null>(null); // student_id, or "__drop__"
  const [error, setError] = useState<string | null>(null);
  const { spoken, candidates } = item;

  const question =
    candidates.length > 1
      ? `Which ${spoken}?`
      : candidates.length === 1
        ? `Did you mean ${candidates[0].name}?`
        : `I couldn't find “${spoken}” in ${classText}.`;

  async function choose(id: string | null) {
    setBusy(id ?? "__drop__");
    setError(null);
    try {
      onUpdated(await api.resolveName(recordId, spoken, id));
    } catch (e) {
      setError(friendlyError(e));
      setBusy(null);
    }
  }

  return (
    <fieldset className="nq" disabled={busy !== null}>
      <legend className="nq-q">
        <span className="nq-badge" aria-hidden>
          ?
        </span>
        {question}
        <span className="muted cap-small"> You said “{spoken}” as absent.</span>
      </legend>
      <div className="nq-options">
        {candidates.map((c) => (
          <button key={c.student_id} type="button" className="nq-option" onClick={() => choose(c.student_id)}>
            <span className="nq-roll num">Roll {c.roll_no}</span>
            <span className="nq-name">{c.name}</span>
            {busy === c.student_id ? <Spinner small /> : null}
          </button>
        ))}
        <button type="button" className="nq-option nq-drop" onClick={() => choose(null)}>
          <span className="nq-name">Not in my class — remove</span>
          {busy === "__drop__" ? <Spinner small /> : null}
        </button>
      </div>
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
