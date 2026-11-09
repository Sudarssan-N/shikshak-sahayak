import { useState } from "react";
import { api } from "../../api/client";
import type { AdminSchool } from "../../api/types";
import { Button, Card, ErrorNote } from "../../components/ui";
import { RangeRing, readPosition } from "../place";
import { isKeyRejected, useAdmin } from "./shared";

/** The circle around a school. Teachers inside it, including the ground just around the gate, can mark attendance. */
export function BoundaryPanel({ school, onChanged }: { school: AdminSchool; onChanged: () => Promise<void> }) {
  const { rejectKey } = useAdmin();
  const saved = school.boundary;
  const [lat, setLat] = useState(saved ? String(saved.lat) : "");
  const [lng, setLng] = useState(saved ? String(saved.lng) : "");
  const [radius, setRadius] = useState(saved?.radius_m ?? 250);
  const [busy, setBusy] = useState<"save" | "locate" | "clear" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [savedNote, setSavedNote] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  async function locate() {
    setBusy("locate");
    setError(null);
    try {
      const here = await readPosition();
      setLat(here.lat.toFixed(6));
      setLng(here.lng.toFixed(6));
      setSavedNote("Pin dropped from this phone. Save it if you are standing at the school.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      setError(new Error("Enter the school's latitude and longitude, or use this phone at the school."));
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await api.adminSetBoundary(school.id, { lat: la, lng: ln, radius_m: radius });
      setSavedNote(`Saved. Attendance works within ${radius} m of this pin.`);
      setConfirmClear(false);
      await onChanged();
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    try {
      await api.adminClearBoundary(school.id);
      setLat("");
      setLng("");
      setSavedNote("School area cleared. Teachers can confirm class records from anywhere, and cannot mark login.");
      setConfirmClear(false);
      await onChanged();
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setBusy(null);
    }
  }

  const label = saved
    ? `${radius} m around the school. Login, logout and class attendance stay inside this circle.`
    : "No area yet. Drop a pin, then set how far around the school still counts.";

  return (
    <Card className="ad-boundary">
      <h2>School area</h2>
      <p className="muted ad-small">
        Stand at the school, or type the pin. The circle includes the ground just around the gate, so a weak GPS
        reading still counts as “at school”.
      </p>
      <RangeRing distanceM={null} radiusM={radius} label={label} />
      <div className="ad-grid">
        <div className="field">
          <label htmlFor="bd-lat">Latitude</label>
          <input id="bd-lat" className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="26.8467" />
        </div>
        <div className="field">
          <label htmlFor="bd-lng">Longitude</label>
          <input id="bd-lng" className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="80.9462" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="bd-radius">Around the school · {radius} m</label>
        <input
          id="bd-radius"
          type="range"
          min={50}
          max={1500}
          step={10}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        />
      </div>
      <div className="row">
        <Button variant="secondary" onClick={() => void locate()} loading={busy === "locate"}>
          Use this phone
        </Button>
        <Button onClick={() => void save()} loading={busy === "save"}>
          Save area
        </Button>
      </div>
      {savedNote ? <p className="ad-copied">{savedNote}</p> : null}
      <ErrorNote error={error} />
      {saved ? (
        confirmClear ? (
          <div className="stack">
            <p className="ad-warn">Clearing the area lets class records be confirmed from anywhere, and stops login marking.</p>
            <div className="row">
              <Button variant="danger" onClick={() => void clear()} loading={busy === "clear"}>
                Clear area
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="ad-btn-sm" onClick={() => setConfirmClear(true)}>
            Clear area
          </Button>
        )
      ) : null}
    </Card>
  );
}
