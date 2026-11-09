import type {
  ClassLevels,
  FollowUp,
  FollowUpActionKind,
  FollowUpActionLog,
  FollowUpOutcome,
  FollowUpReason,
  GrainStock,
  MdmToday,
  ParentMessage,
  ParsedLevels,
  AdminSchool,
  AdminTeacher,
  ClassRoster,
  ClassSection,
  ClassStudentRow,
  DutyReport,
  DutySession,
  DutyStatus,
  DailyRecord,
  NewTeacher,
  NoteResult,
  RecordPatch,
  Report,
  ReportKind,
  RosterUploadResult,
  SchoolBoundary,
  Stats,
  Teacher,
} from "./types";

const TOKEN_KEY = "ss_token";
const ADMIN_KEY = "ss_admin_key";

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: session only */
  }
}

export const session = {
  get token() {
    return safeGet(TOKEN_KEY);
  },
  set token(v: string | null) {
    safeSet(TOKEN_KEY, v);
  },
  get adminKey() {
    return safeGet(ADMIN_KEY);
  },
  set adminKey(v: string | null) {
    safeSet(ADMIN_KEY, v);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (admin) {
    if (session.adminKey) headers.set("X-Admin-Key", session.adminKey);
  } else if (session.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* not json */
    }
    if (res.status === 401 && !admin) session.token = null;
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  // auth
  requestCode: (phone: string) =>
    request<{ sent: boolean; dev_code?: string }>("/api/auth/request-code", { method: "POST", body: json({ phone }) }),
  verify: (phone: string, code: string) =>
    request<{ token: string; teacher: Teacher }>("/api/auth/verify", { method: "POST", body: json({ phone, code }) }),
  me: () => request<Teacher>("/api/me"),
  consent: () => request<Teacher>("/api/me/consent", { method: "POST" }),
  deleteMe: () => request<{ deleted: boolean }>("/api/me", { method: "DELETE" }),
  roster: () => request<ClassRoster[]>("/api/roster"),

  // capture
  sendAudio: (audio: Blob, recordDate?: string) => {
    const fd = new FormData();
    const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
    fd.append("audio", audio, `note.${ext}`);
    if (recordDate) fd.append("record_date", recordDate);
    return request<NoteResult>("/api/notes", { method: "POST", body: fd });
  },
  sendText: (text: string, recordDate?: string) => {
    const fd = new FormData();
    fd.append("text", text);
    if (recordDate) fd.append("record_date", recordDate);
    return request<NoteResult>("/api/notes", { method: "POST", body: fd });
  },
  note: (id: string) => request<NoteResult>(`/api/notes/${id}`),

  // records
  records: (params: { from?: string; to?: string; status?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<DailyRecord[]>(`/api/records${q.size ? `?${q}` : ""}`);
  },
  record: (id: string) => request<DailyRecord>(`/api/records/${id}`),
  patchRecord: (id: string, patch: RecordPatch) =>
    request<DailyRecord>(`/api/records/${id}/corrections`, { method: "POST", body: json({ patch }) }),
  correctByText: (id: string, text: string) =>
    request<DailyRecord>(`/api/records/${id}/corrections`, { method: "POST", body: json({ text }) }),
  correctByAudio: (id: string, audio: Blob) => {
    const fd = new FormData();
    const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
    fd.append("audio", audio, `correction.${ext}`);
    return request<DailyRecord>(`/api/records/${id}/corrections`, { method: "POST", body: fd });
  },
  resolveName: (id: string, spoken: string, studentId: string | null) =>
    request<DailyRecord>(`/api/records/${id}/resolve-name`, {
      method: "POST",
      body: json({ spoken, student_id: studentId }),
    }),
  confirm: (id: string, acknowledgeWarnings: boolean, loc?: { lat: number; lng: number }) =>
    request<DailyRecord>(`/api/records/${id}/confirm`, {
      method: "POST",
      body: json({ acknowledge_warnings: acknowledgeWarnings, ...(loc ?? {}) }),
    }),
  duty: () => request<DutyStatus>("/api/duty"),
  dutyWhere: (loc: { lat: number; lng: number }) =>
    request<DutyStatus>("/api/duty/where", { method: "POST", body: json(loc) }),
  dutyIn: (loc: { lat: number; lng: number }) =>
    request<{ session: DutySession; place: DutyStatus["place"] }>("/api/duty/in", { method: "POST", body: json(loc) }),
  dutyOut: (loc: { lat: number; lng: number }) =>
    request<{ session: DutySession; place: DutyStatus["place"] }>("/api/duty/out", { method: "POST", body: json(loc) }),
  /** The card read aloud (mp3). Same query-token auth as report downloads, so an <audio> element can play it. */
  speechUrl: (id: string, version: number) =>
    `/api/records/${id}/speech?v=${version}&token=${encodeURIComponent(session.token ?? "")}`,
  followUp: () => request<FollowUp>("/api/followup"),
  parentMessage: (studentId: string) => request<ParentMessage>(`/api/followup/${studentId}/message`),
  parentMessageSpeechUrl: (studentId: string) =>
    `/api/followup/${studentId}/message/speech?token=${encodeURIComponent(session.token ?? "")}`,
  setParentPhone: (studentId: string, phone: string) =>
    request<{ ok: boolean; phone: string }>(`/api/students/${studentId}/contact`, { method: "PUT", body: json({ phone }) }),
  logFollowUp: (
    studentId: string,
    body: { action: FollowUpActionKind; reason?: FollowUpReason | null; outcome?: FollowUpOutcome | null; note?: string },
  ) => request<FollowUpActionLog>(`/api/followup/${studentId}/actions`, { method: "POST", body: json(body) }),
  mdmToday: () => request<MdmToday>("/api/mdm/today"),
  grainStock: (month: string) => request<GrainStock>(`/api/mdm/stock?month=${month}`),
  addGrainReceived: (body: { day: string; kg: number; note?: string }) =>
    request<GrainStock>("/api/mdm/stock/received", { method: "POST", body: json(body) }),
  setGrainOpening: (body: { month: string; kg: number; note?: string }) =>
    request<GrainStock>("/api/mdm/stock/opening", { method: "POST", body: json(body) }),
  setGrainNorms: (body: { primary_g: number; upper_g: number }, month: string) =>
    request<GrainStock>(`/api/mdm/norms?month=${month}`, { method: "PUT", body: json(body) }),
  deleteGrainMovement: (id: string) => request<GrainStock>(`/api/mdm/stock/${id}`, { method: "DELETE" }),
  levels: (classId: string, month?: string) =>
    request<ClassLevels>(`/api/levels?class_id=${classId}${month ? `&month=${month}` : ""}`),
  parseLevels: (classId: string, input: { text?: string; audio?: Blob }) => {
    const fd = new FormData();
    fd.append("class_id", classId);
    if (input.text) fd.append("text", input.text);
    if (input.audio) {
      const ext = input.audio.type.includes("ogg") ? "ogg" : input.audio.type.includes("mp4") ? "m4a" : "webm";
      fd.append("audio", input.audio, `levels.${ext}`);
    }
    return request<ParsedLevels>("/api/levels/parse", { method: "POST", body: fd });
  },
  saveLevels: (
    classId: string,
    items: { student_id: string; reading: string | null; maths: string | null }[],
    source: "tap" | "voice",
  ) => request<ClassLevels>("/api/levels", { method: "PUT", body: json({ class_id: classId, items, source }) }),
  timeSaved: (id: string, minutes: number) =>
    request<{ ok: boolean }>(`/api/records/${id}/time-saved`, { method: "POST", body: json({ minutes }) }),

  // reports
  reports: () => request<Report[]>("/api/reports"),
  createReport: (kind: ReportKind, month: string) =>
    request<Report>("/api/reports", { method: "POST", body: json({ kind, month }) }),
  downloadUrl: (r: Report) => `${r.download_url}?token=${encodeURIComponent(session.token ?? "")}`,

  // admin
  adminTeachers: () => request<AdminTeacher[]>("/admin/teachers", {}, true),
  adminCreateTeacher: (t: NewTeacher) =>
    request<AdminTeacher>("/admin/teachers", { method: "POST", body: json(t) }, true),
  adminUploadRoster: (teacherId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<RosterUploadResult>(`/admin/teachers/${teacherId}/roster`, { method: "POST", body: fd }, true);
  },
  adminSchools: () => request<AdminSchool[]>("/admin/schools", {}, true),
  adminSetBoundary: (schoolId: string, body: { lat: number; lng: number; radius_m: number }) =>
    request<SchoolBoundary>(`/admin/schools/${schoolId}/boundary`, { method: "PUT", body: json(body) }, true),
  adminClearBoundary: (schoolId: string) =>
    request<{ cleared: boolean }>(`/admin/schools/${schoolId}/boundary`, { method: "DELETE" }, true),
  adminAddClass: (teacherId: string, body: { grade: number; section: string | null }) =>
    request<ClassSection>(`/admin/teachers/${teacherId}/classes`, { method: "POST", body: json(body) }, true),
  adminStudents: (teacherId: string, classId: string) =>
    request<{ class: ClassSection; students: ClassStudentRow[] }>(
      `/admin/teachers/${teacherId}/classes/${classId}/students`,
      {},
      true,
    ),
  adminAddStudent: (teacherId: string, classId: string, body: { roll_no: number; name: string }) =>
    request<ClassStudentRow>(`/admin/teachers/${teacherId}/classes/${classId}/students`, {
      method: "POST",
      body: json(body),
    }, true),
  adminPatchStudent: (
    teacherId: string,
    classId: string,
    studentId: string,
    body: { roll_no?: number; name?: string; active?: boolean },
  ) =>
    request<ClassStudentRow>(`/admin/teachers/${teacherId}/classes/${classId}/students/${studentId}`, {
      method: "PATCH",
      body: json(body),
    }, true),
  adminDuty: (params: { school_id?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<DutyReport>(`/admin/duty${q.size ? `?${q}` : ""}`, {}, true);
  },
  adminCreateDuty: (body: { teacher_id: string; login_at: string; logout_at: string | null; note: string }) =>
    request<DutySession>("/admin/duty", { method: "POST", body: json(body) }, true),
  adminPatchDuty: (id: string, body: { login_at: string; logout_at: string | null; note: string }) =>
    request<DutySession>(`/admin/duty/${id}`, { method: "PATCH", body: json(body) }, true),

  // public
  stats: () => request<Stats>("/stats"),
};
