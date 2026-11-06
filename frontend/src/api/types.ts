// Mirror of docs/API_CONTRACT.md. Keep in sync with backend/app/schemas.py.

export type Language = "hi" | "en" | "mr" | "kn";
export type Severity = "block" | "warn" | "info";
export type RecordStatus = "draft" | "flagged" | "confirmed" | "superseded";
export type ReportKind = "attendance" | "mdm" | "summary" | "csv";

export interface School {
  id: string;
  name: string;
  state: string;
  udise_code: string | null;
}

export interface ClassSection {
  id: string;
  grade: number;
  section: string | null;
  enrolled: number; // active students in roster
}

export interface Teacher {
  id: string;
  name: string;
  language: Language;
  school: School;
  classes: ClassSection[];
  consent_at: string | null; // ISO datetime; null = consent screen not yet accepted
  records_confirmed: number; // 0 = still onboarding (practice note pending)
}

export interface Student {
  id: string;
  roll_no: number;
  name: string;
}

export interface ClassRoster extends ClassSection {
  students: Student[];
}

export interface Flag {
  id: string;
  rule_id: string; // "V1".."V10"
  severity: Severity;
  message: string;
  field: string | null; // e.g. "present", "meals_served", "absent", "record_date"
  resolution: "open" | "confirmed_anyway" | "corrected" | "dismissed";
}

export interface LessonProgress {
  subject: string | null;
  lesson_ref: string | null; // "lesson 7"
  status: "started" | "completed" | null;
}

export interface AbsentStudent {
  student_id: string;
  name: string;
  roll_no: number;
}

export interface UnresolvedName {
  spoken: string;
  candidates: AbsentStudent[]; // empty = no roster match at all
}

export interface DailyRecord {
  id: string;
  note_id: string | null;
  class_id: string;
  grade: number;
  section: string | null;
  record_date: string | null; // YYYY-MM-DD
  enrolled: number | null; // from roster, never from the model
  present: number | null;
  absent: AbsentStudent[];
  absent_count: number | null; // "4 absent" as spoken; may differ from absent.length (rule V12)
  unresolved_names: UnresolvedName[];
  meals_served: number | null;
  lessons: LessonProgress[];
  status: RecordStatus;
  version: number;
  flags: Flag[]; // open + resolved; filter on resolution === "open" for the card
  missing_fields: string[];
  created_at: string;
  confirmed_at: string | null;
}

export interface VoiceNote {
  id: string;
  transcript: string;
  language: string;
  asr_engine: string; // "sarvam:saaras", "text", "mock"
  status: "received" | "processed" | "failed";
  duration_s: number | null;
  error: string | null; // teacher-facing message when status === "failed"
}

export interface NoteResult {
  note: VoiceNote;
  records: DailyRecord[]; // one per class (and per date for backfill notes)
}

export interface RecordPatch {
  record_date?: string;
  present?: number | null;
  meals_served?: number | null;
  absent_student_ids?: string[];
  lessons?: LessonProgress[];
}

export interface Report {
  id: string;
  kind: ReportKind;
  period: string; // YYYY-MM
  filename: string;
  created_at: string;
  download_url: string; // relative, needs ?token=
}

export interface AdminTeacher {
  id: string;
  name: string;
  phone_last4: string;
  language: Language;
  school: School;
  classes: ClassSection[];
  consent_at: string | null;
  roster_size: number;
  created_at: string;
}

export interface NewTeacher {
  name: string;
  phone: string; // 10-digit Indian mobile, digits only
  language: Language;
  school_name: string;
  state: string;
  udise_code?: string;
  classes: { grade: number; section: string | null }[];
}

export interface RosterRejectedRow {
  row: number; // 1-based CSV line number including header
  raw: string;
  reason: string;
}

export interface RosterUploadResult {
  accepted: number;
  rejected: RosterRejectedRow[];
  classes: ClassSection[];
}

export interface Stats {
  teachers_onboarded: number;
  teachers_active: number; // ≥ 3 confirmed records
  notes_processed: number;
  records_confirmed: number;
  flags_raised: number;
  flags_acted_on: number; // corrected or confirmed after review
  median_minutes_saved: number | null; // self-reported
  first_pass_accuracy: number | null; // 0..1, fields not corrected / fields extracted
  languages: Record<string, number>; // notes per language
  daily: { day: string; notes: number; confirmed: number }[]; // last 30 days
  updated_at: string;
}

/** Dropout early-warning: a child with a run of absences or low attendance in the last 30 days. */
export interface FollowUpChild {
  student_id: string;
  name: string;
  roll_no: number;
  class_id: string;
  grade: number;
  section: string | null;
  streak: number;
  days_absent: number;
  days_recorded: number;
  attendance_pct: number;
  last_present: string | null;
  reasons: string[];
}

export interface FollowUp {
  window_days: number;
  streak_min: number;
  pct_min: number;
  children: FollowUpChild[];
}
