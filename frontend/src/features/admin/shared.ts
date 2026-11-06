import { createContext, useContext } from "react";
import { ApiError } from "../../api/client";
import type { ClassSection, Language } from "../../api/types";

export const LANGUAGES: { code: Language; native: string; english: string }[] = [
  { code: "hi", native: "हिन्दी", english: "Hindi" },
  { code: "en", native: "English", english: "English" },
  { code: "mr", native: "मराठी", english: "Marathi" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada" },
];

export function languageLabel(code: string) {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? (l.native === l.english ? l.native : `${l.native} (${l.english})`) : code;
}

export const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8];

/** Accepts "98765 43210", "+91 98765-43210", "098765..." and returns 10 digits, or null. */
export function normalisePhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export function classList(classes: { grade: number; section: string | null }[]) {
  if (!classes.length) return "—";
  return [...classes]
    .sort((a, b) => a.grade - b.grade || (a.section ?? "").localeCompare(b.section ?? ""))
    .map((c) => `${c.grade}${c.section ? `-${c.section}` : ""}`)
    .join(", ");
}

export function sortClasses(classes: ClassSection[]) {
  return [...classes].sort((a, b) => a.grade - b.grade || (a.section ?? "").localeCompare(b.section ?? ""));
}

export function isKeyRejected(e: unknown) {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

/** Admin shell context: any child that gets a 401/403 calls rejectKey() to bounce back to the key gate. */
export const AdminCtx = createContext<{ rejectKey: () => void }>({ rejectKey: () => {} });
export const useAdmin = () => useContext(AdminCtx);

export function formatShortDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
