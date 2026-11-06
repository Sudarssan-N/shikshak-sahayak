import type { DailyRecord } from "../../api/types";

export const needsCheck = (r: DailyRecord) => r.status === "draft" || r.status === "flagged";
export const openFlags = (r: DailyRecord) => r.flags.filter((f) => f.resolution === "open");

export interface MonthStats {
  daysRecorded: number;
  avgAttendance: number | null; // 0..100
  meals: number;
}

/** Stats over confirmed records only, matching what goes into the registers. */
export function monthStats(records: DailyRecord[], month: string): MonthStats {
  const rows = records.filter((r) => r.status === "confirmed" && r.record_date?.startsWith(month));
  const days = new Set(rows.map((r) => r.record_date));
  let present = 0;
  let enrolled = 0;
  let meals = 0;
  for (const r of rows) {
    if (r.present != null && r.enrolled) {
      present += r.present;
      enrolled += r.enrolled;
    }
    meals += r.meals_served ?? 0;
  }
  return {
    daysRecorded: days.size,
    avgAttendance: enrolled ? Math.round((present / enrolled) * 100) : null,
    meals,
  };
}

/** Group records by record_date, newest date first; undated records last. */
export function groupByDate(records: DailyRecord[]): [string | null, DailyRecord[]][] {
  const map = new Map<string | null, DailyRecord[]>();
  for (const r of records) {
    const k = r.record_date;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)));
}
