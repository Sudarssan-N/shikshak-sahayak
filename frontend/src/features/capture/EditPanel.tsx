import { useId, useState } from "react";
import { api } from "../../api/client";
import type { DailyRecord, RecordPatch } from "../../api/types";
import { Button } from "../../components/ui";
import { friendlyError } from "./copy";

interface Props {
  record: DailyRecord;
  onUpdated: (r: DailyRecord) => void;
  onClose: () => void;
}

/** Small number steppers for the two counts teachers most often need to nudge. */
export function EditPanel({ record, onUpdated, onClose }: Props) {
  const [present, setPresent] = useState<number | null>(record.present);
  const [meals, setMeals] = useState<number | null>(record.meals_served);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch: RecordPatch = {};
  if (present !== record.present) patch.present = present;
  if (meals !== record.meals_served) patch.meals_served = meals;
  const changed = Object.keys(patch).length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.patchRecord(record.id, patch));
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <div className="cc-panel stack">
      <Stepper label="Present" value={present} onChange={setPresent} max={record.enrolled ?? undefined} />
      <Stepper label="Meals served" value={meals} onChange={setMeals} />
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row cap-split">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} loading={busy} disabled={!changed}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  max?: number;
}) {
  const id = useId();
  const v = value ?? 0;
  return (
    <div className="stepper">
      <label htmlFor={id}>{label}</label>
      <div className="stepper-ctl">
        <button type="button" aria-label={`${label} minus one`} onClick={() => onChange(Math.max(0, v - 1))} disabled={v <= 0}>
          −
        </button>
        <input
          id={id}
          className="num"
          type="text"
          inputMode="numeric"
          value={value ?? ""}
          placeholder="—"
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(0, 3);
            onChange(d === "" ? null : Number(d));
          }}
        />
        <button
          type="button"
          aria-label={`${label} plus one`}
          onClick={() => onChange(value === null ? 0 : v + 1)}
          disabled={max !== undefined && v >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}
