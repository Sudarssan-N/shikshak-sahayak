import { ApiError, api } from "../api/client";
import type { DailyRecord } from "../api/types";
import "./place.css";

export function readPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This phone cannot share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error("Location is off. Turn it on to mark attendance at the school.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 },
    );
  });
}

/** Confirm a class record. Sends a location only when the school circle is set, or when the server asks for one. */
export async function confirmAtSchool(id: string, acknowledge: boolean, boundarySet: boolean): Promise<DailyRecord> {
  let loc = boundarySet ? await readPosition() : undefined;
  try {
    return await api.confirm(id, acknowledge, loc);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400 && !loc) {
      loc = await readPosition();
      return await api.confirm(id, acknowledge, loc);
    }
    throw e;
  }
}

export function formatHours(h: number | null | undefined): string {
  if (h == null || Number.isNaN(h)) return "—";
  const mins = Math.round(h * 60);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  if (hh <= 0) return `${mm}m`;
  if (mm === 0) return `${hh}h`;
  return `${hh}h ${mm}m`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** Distance from the school pin, drawn as a gauge. Direction is unknown, so the dot only moves outward. */
export function RangeRing({
  distanceM,
  radiusM,
  label,
  size = 168,
}: {
  distanceM: number | null;
  radiusM: number;
  label: string;
  size?: number;
}) {
  const ring = 78;
  const ratio = distanceM == null ? null : distanceM / Math.max(radiusM, 1);
  const inside = ratio != null && ratio <= 1;
  const dot = ratio == null ? null : Math.min(ratio, 1.22) * ring;
  return (
    <figure className="place-ring">
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={label}>
        <circle cx="100" cy="100" r={ring} className="place-ring-zone" />
        <circle cx="100" cy="100" r="5" className="place-ring-school" />
        {dot != null ? (
          <circle cx="100" cy={100 - dot} r="7" className={inside ? "place-ring-here" : "place-ring-out"} />
        ) : null}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
