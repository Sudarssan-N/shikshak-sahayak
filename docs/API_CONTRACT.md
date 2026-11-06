# Shikshak Sahayak — API contract (v0)

Base URL in dev: the Vite dev server proxies `/api`, `/admin`, `/stats`, `/health` to `http://localhost:8000`.
The TypeScript mirror of every shape below is `frontend/src/api/types.ts`; the fetch wrapper is `frontend/src/api/client.ts`.

## Auth

| Who | How |
| --- | --- |
| Teacher | `Authorization: Bearer <token>` from `POST /api/auth/verify`. File downloads also accept `?token=<token>`. |
| Pilot lead | `X-Admin-Key: <ADMIN_KEY>` header. Can onboard; cannot read records. |
| Public | `/stats`, `/health` |

Errors are `{"detail": "<human message>"}` with a 4xx status. `409` on confirm means a Block flag is still open.

## Teacher endpoints

| Method + path | Body | Returns |
| --- | --- | --- |
| POST /api/auth/request-code | `{phone}` | `{sent: true, dev_code?: string}` (`dev_code` only when `DEV_MODE=1`) |
| POST /api/auth/verify | `{phone, code}` | `{token, teacher: Teacher}` |
| GET /api/me | – | `Teacher` |
| POST /api/me/consent | – | `Teacher` (sets `consent_at`) |
| DELETE /api/me | – | `{deleted: true}` — removes roster, records, transcripts, files |
| GET /api/roster | – | `ClassRoster[]` |
| POST /api/notes | multipart: `audio` (file) **or** `text` (string); optional `record_date` (YYYY-MM-DD) | `NoteResult` |
| GET /api/notes/{id} | – | `NoteResult` |
| GET /api/records?from=YYYY-MM-DD&to=YYYY-MM-DD&status= | – | `DailyRecord[]` newest first (default last 30 days) |
| GET /api/records/{id} | – | `DailyRecord` |
| POST /api/records/{id}/corrections | JSON `{patch?: RecordPatch, text?: string}` or multipart `audio` | `DailyRecord` (re-validated) |
| POST /api/records/{id}/resolve-name | `{spoken: string, student_id: string \| null}` (`null` = drop the name) | `DailyRecord` |
| POST /api/records/{id}/confirm | `{acknowledge_warnings: boolean}` | `DailyRecord` (409 if Block flags open; 422 if Warn flags and not acknowledged) |
| POST /api/records/{id}/time-saved | `{minutes: number}` | `{ok: true}` |
| GET /api/reports | – | `Report[]` |
| POST /api/reports | `{kind: "attendance"\|"mdm"\|"summary"\|"csv", month: "YYYY-MM"}` | `Report` |
| GET /api/reports/{id}/download | – | file (xlsx / pdf / csv) |

## Pilot-lead (admin) endpoints

| Method + path | Body | Returns |
| --- | --- | --- |
| GET /admin/teachers | – | `AdminTeacher[]` |
| POST /admin/teachers | `NewTeacher` | `AdminTeacher` |
| POST /admin/teachers/{id}/roster | multipart `file` (CSV: `roll_no,name,grade,section`) | `RosterUploadResult` |

## Public

| Method + path | Returns |
| --- | --- |
| GET /stats | `Stats` |
| GET /health | `{ok: true, asr: string, llm: string}` |

## Record lifecycle

`draft` → (`flagged` while any Block/Warn flag is open) → `confirmed`; a later correction of a confirmed record creates version+1 and marks the old one `superseded`.

## Validation rules (implemented in `backend/app/rules/rules.yaml` + `engine.py`)

V1 present ≤ enrolled (block) · V2 present + absent = enrolled (warn) · V3 meals ≤ present (warn) · V4 absent names resolved (block)
· V5 no duplicate confirmed record for class+date (warn) · V6 date not in future (block) / >7 days back or Sunday (warn)
· V7 lesson not going backwards (warn) · V8 gap in working days (info) · V9 plausible counts (warn) · V10 field confidence ≥ 0.7 (warn)
