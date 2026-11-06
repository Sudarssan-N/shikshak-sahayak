import type {
  FollowUp,
  AdminTeacher,
  ClassRoster,
  DailyRecord,
  NewTeacher,
  NoteResult,
  RecordPatch,
  Report,
  ReportKind,
  RosterUploadResult,
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
  confirm: (id: string, acknowledgeWarnings: boolean) =>
    request<DailyRecord>(`/api/records/${id}/confirm`, {
      method: "POST",
      body: json({ acknowledge_warnings: acknowledgeWarnings }),
    }),
  /** The card read aloud (mp3). Same query-token auth as report downloads, so an <audio> element can play it. */
  speechUrl: (id: string, version: number) =>
    `/api/records/${id}/speech?v=${version}&token=${encodeURIComponent(session.token ?? "")}`,
  followUp: () => request<FollowUp>("/api/followup"),
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

  // public
  stats: () => request<Stats>("/stats"),
};
