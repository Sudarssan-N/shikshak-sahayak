import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { GrainStock } from "../../api/types";
import { Button, ErrorNote, formatDate } from "../../components/ui";
import { monthKey, ymd } from "./dates";
import { useLoad } from "./useLoad";

function formatKg(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function kilos(raw: string, allowZero: boolean): number | null {
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return null;
  return n;
}

function grams(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 20 || n > 400) return null;
  return n;
}

/** This month's rice or wheat: meals already confirmed, times the gram norm, plus what the teacher says arrived. */
export function GrainCard() {
  const month = monthKey(new Date());
  const { data, error, loading, reload, setData } = useLoad(() => api.grainStock(month), [month]);
  const [arrived, setArrived] = useState("");
  const [opening, setOpening] = useState("");
  const [primary, setPrimary] = useState("100");
  const [upper, setUpper] = useState("150");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setPrimary(String(data.norms.primary_g));
    setUpper(String(data.norms.upper_g));
    setOpening(data.opening_kg == null ? "" : String(data.opening_kg));
  }, [data]);

  async function run(work: () => Promise<GrainStock>) {
    setBusy(true);
    setFormError(null);
    try {
      setData(await work());
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onArrived(e: FormEvent) {
    e.preventDefault();
    const kg = kilos(arrived, false);
    if (kg == null) {
      setFormError(new Error("Enter how many kilos arrived."));
      return;
    }
    await run(async () => {
      const next = await api.addGrainReceived({ day: ymd(new Date()), kg });
      setArrived("");
      return next;
    });
  }

  async function onOpening(e: FormEvent) {
    e.preventDefault();
    const kg = kilos(opening, true);
    if (kg == null) {
      setFormError(new Error("Enter the kilos in store on the 1st. Use 0 if the store was empty."));
      return;
    }
    await run(async () => {
      const next = await api.setGrainOpening({ month, kg });
      setOpening(next.opening_kg == null ? "" : String(next.opening_kg));
      return next;
    });
  }

  async function onNorms(e: FormEvent) {
    e.preventDefault();
    const primaryG = grams(primary);
    const upperG = grams(upper);
    if (primaryG == null || upperG == null) {
      setFormError(new Error("Enter whole grams between 20 and 400."));
      return;
    }
    await run(() => api.setGrainNorms({ primary_g: primaryG, upper_g: upperG }, month));
  }

  if (loading && !data) return null;
  if (!data) {
    return (
      <section className="db-mdm" aria-labelledby="db-grain-h">
        <h2 id="db-grain-h">Food grain in store</h2>
        <ErrorNote error={error} />
        <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
          Try again
        </button>
      </section>
    );
  }

  const left = data.closing_kg;
  const short = left != null && left < 0;

  return (
    <section className="db-mdm db-grain" aria-labelledby="db-grain-h">
      <div>
        <h2 id="db-grain-h">Food grain in store</h2>
        <p className="db-mdm-sub">
          The school store, counted from every teacher’s confirmed meals. Classes 1–5: {data.norms.primary_g} g · classes 6–8: {data.norms.upper_g} g per child.
        </p>
      </div>
      <dl className="db-grain-stats">
        <div>
          <dt>Used</dt>
          <dd className="num">{formatKg(data.consumed_kg)} kg</dd>
        </div>
        <div>
          <dt>Arrived</dt>
          <dd className="num">{formatKg(data.received_kg)} kg</dd>
        </div>
        <div>
          <dt>Left</dt>
          <dd className={`num${short ? " short" : ""}`}>{left == null ? "—" : `${formatKg(left)} kg`}</dd>
        </div>
      </dl>
      {data.classes.length > 0 ? (
        <p className="db-mdm-note">{data.classes.map((c) => `${c.label} ${formatKg(c.kg)} kg`).join(" · ")}</p>
      ) : (
        <p className="db-mdm-note">Confirm a class and its meals to see the grain used.</p>
      )}
      {left == null ? <p className="db-mdm-note">Enter what was in store on the 1st to see what is left.</p> : null}
      {short ? (
        <p className="db-mdm-note">Short by {formatKg(-left)} kg against the grain you entered. Check the meals or the delivery.</p>
      ) : null}
      <ErrorNote error={formError} />
      <form className="db-grain-form" onSubmit={(e) => void onArrived(e)}>
        <label htmlFor="db-grain-arrived">Grain arrived today (kg)</label>
        <input
          id="db-grain-arrived"
          className="input"
          type="number"
          inputMode="decimal"
          min="0.001"
          step="0.1"
          value={arrived}
          onChange={(e) => setArrived(e.target.value)}
        />
        <Button type="submit" variant="secondary" loading={busy}>
          Add
        </Button>
      </form>
      <form className="db-grain-form" onSubmit={(e) => void onOpening(e)}>
        <label htmlFor="db-grain-opening">In store on the 1st (kg)</label>
        <input
          id="db-grain-opening"
          className="input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.1"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
        />
        <Button type="submit" variant="secondary" loading={busy}>
          Save
        </Button>
      </form>
      {data.movements.length > 0 ? (
        <ul className="db-grain-list">
          {data.movements.map((m) => (
            <li key={m.id}>
              <span>
                {m.kind === "opening" ? "In store on the 1st" : "Arrived"} · {formatDate(m.day)} · {formatKg(m.kg)} kg
                {m.note ? ` · ${m.note}` : ""}
              </span>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => api.deleteGrainMovement(m.id))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="db-grain-more">
        <summary>Change grams per child</summary>
        <form className="stack" onSubmit={(e) => void onNorms(e)}>
          <div className="db-grain-grams">
            <label>
              Classes 1–5
              <input className="input" type="number" inputMode="numeric" min={20} max={400} step={1} value={primary} onChange={(e) => setPrimary(e.target.value)} />
            </label>
            <label>
              Classes 6–8
              <input className="input" type="number" inputMode="numeric" min={20} max={400} step={1} value={upper} onChange={(e) => setUpper(e.target.value)} />
            </label>
          </div>
          <Button type="submit" variant="secondary" loading={busy}>
            Save grams
          </Button>
          <p className="db-mdm-note">{data.norms.source}</p>
        </form>
      </details>
      <p className="db-mdm-note">
        Only confirmed meals count. <Link to="/reports">Monthly MDM register</Link> includes these kilos.
      </p>
    </section>
  );
}
