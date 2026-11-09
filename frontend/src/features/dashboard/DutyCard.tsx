import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { DutyStatus, PlaceCheck } from "../../api/types";
import { Button, ErrorNote } from "../../components/ui";
import { RangeRing, formatClock, formatHours, readPosition } from "../place";

/** Teacher's own login and logout. The phone is read only when they tap, and only against the school circle. */
export function DutyCard() {
  const [status, setStatus] = useState<DutyStatus | null>(null);
  const [place, setPlace] = useState<PlaceCheck | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"in" | "out" | "where" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setStatus(await api.duty());
  }, []);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  async function act(kind: "in" | "out" | "where") {
    setBusy(kind);
    setError(null);
    try {
      const loc = await readPosition();
      const next = await api.dutyWhere(loc);
      setStatus(next);
      setPlace(next.place ?? null);
      if (kind === "where") return;
      if (next.place && !next.place.inside) {
        setError(new Error(`You are ${next.place.distance_m} m from the school. Login and logout can be marked within ${next.place.radius_m} m.`));
        return;
      }
      if (kind === "in") await api.dutyIn(loc);
      else await api.dutyOut(loc);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  if (!status && error) {
    return (
      <section className="duty" aria-labelledby="duty-h">
        <div className="duty-body">
          <h2 id="duty-h">School hours</h2>
          <ErrorNote error={error} />
          <Button variant="secondary" onClick={() => void load().catch(setError)}>Try again</Button>
        </div>
      </section>
    );
  }
  if (!status) {
    return (
      <section className="duty" aria-busy="true" aria-labelledby="duty-h">
        <div className="duty-body">
          <h2 id="duty-h">School hours</h2>
          <p className="muted">Loading school hours…</p>
        </div>
      </section>
    );
  }
  const boundary = status?.boundary;
  const open = status?.open;
  const radius = boundary?.radius_m ?? place?.radius_m ?? 250;
  const ringLabel = !boundary
    ? "School area not set"
    : place
      ? place.inside
        ? `Inside the school area · ${place.distance_m} m from the pin`
        : `${place.distance_m} m from the school · need to be within ${place.radius_m} m`
      : `${radius} m around the school`;

  return (
    <section className="duty" aria-labelledby="duty-h">
      <RangeRing distanceM={place?.distance_m ?? null} radiusM={radius} label={ringLabel} size={148} />
      <div className="duty-body">
        <h2 id="duty-h">School hours</h2>
        {!boundary ? (
          <p className="muted">
            The head teacher has not set the school area yet. You can still confirm class records. Login starts once
            the area is set.
          </p>
        ) : open ? (
          <p>
            Logged in at <strong className="num">{formatClock(open.login_at)}</strong>
            {status ? ` · ${formatHours(status.hours_today)} today` : ""}.
          </p>
        ) : (
          <p className="muted">
            Mark login and logout from inside the school area ({radius} m).
            {status && status.today.length ? ` Today: ${formatHours(status.hours_today)}.` : ""}
          </p>
        )}
        {status.missed?.length ? (
          <p className="duty-missed" role="status">
            Logout was not marked on{" "}
            {status.missed.map((s) => new Date(s.login_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })).join(", ")}.
            Those hours show as zero until your head teacher corrects them.
          </p>
        ) : null}
        {status && status.today.length ? (
          <ul className="duty-log">
            {status.today.map((s) => (
              <li key={s.id} className="num">
                {formatClock(s.login_at)} – {s.open ? "still in" : formatClock(s.logout_at)} · {formatHours(s.hours)}
                {s.edited ? " · corrected" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          {boundary ? (
            <Button variant="ghost" className="ad-btn-sm" onClick={() => void act("where")} loading={busy === "where"}>
              Check distance
            </Button>
          ) : null}
          {boundary && !open ? (
            <Button onClick={() => void act("in")} loading={busy === "in"}>
              Mark login
            </Button>
          ) : null}
          {boundary && open ? (
            <Button onClick={() => void act("out")} loading={busy === "out"}>
              Mark logout
            </Button>
          ) : null}
        </div>
        <ErrorNote error={error} />
      </div>
    </section>
  );
}
