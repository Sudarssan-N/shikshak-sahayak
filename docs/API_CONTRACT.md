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
| POST /api/records/{id}/confirm | `{acknowledge_warnings: boolean, lat?: number, lng?: number}` | `DailyRecord`. If the school circle is set, lat/lng must fall inside it (400 without a location, 403 outside). 409 if a Block flag is open; 422 if Warn flags are not acknowledged. |
| GET /api/duty | – | Today's login/logout, whether a school circle is set, and `missed` (logouts not marked in the last 7 days). A login left open from an earlier day is closed at zero hours with `missed_logout: true`; hours are never guessed |
| POST /api/duty/where | `{lat, lng}` | Same, plus `place.inside` and `place.distance_m` |
| POST /api/duty/in | `{lat, lng}` | Opens a login if the phone is inside the school circle |
| POST /api/duty/out | `{lat, lng}` | Closes the open login if the phone is still inside the circle |
| POST /api/records/{id}/time-saved | `{minutes: number}` | `{ok: true}` |
| GET /api/reports | – | `Report[]` |
| POST /api/reports | `{kind: "attendance"\|"mdm"\|"summary"\|"csv", month: "YYYY-MM"}` | `Report` |
| GET /api/reports/{id}/download | – | file (xlsx / pdf / csv) |
| GET /api/mdm/today | – | Today's confirmed meal total and the PM POSHAN SMS body |
| GET /api/mdm/stock?month=YYYY-MM | – | `GrainStock` for the school's one store. Confirmed meals of every teacher at the school × grams, plus opening stock and deliveries. `closing_kg` is null until an opening is entered. No child names |
| POST /api/mdm/stock/received | `{day, kg, note?}` | `GrainStock`. `kg` is above 0 and at most 5000. `day` cannot be in the future |
| POST /api/mdm/stock/opening | `{month, kg, note?}` | `GrainStock`. One opening per month; sending again replaces it. `kg` may be 0 |
| PUT /api/mdm/norms?month=YYYY-MM | `{primary_g, upper_g}` | `GrainStock`. Grams per child, 20–400. Defaults are 100 (classes 1–5) and 150 (classes 6–8) |
| DELETE /api/mdm/stock/{id} | – | `GrainStock` for that entry's month. 404 if it is another school's entry |

## Pilot-lead (admin) endpoints

| Method + path | Body | Returns |
| --- | --- | --- |
| GET /admin/teachers | – | `AdminTeacher[]` |
| POST /admin/teachers | `NewTeacher` (`school_id` to join a listed school, or `school_name` + `state`; a matching `udise_code` joins that school. Names alone never merge schools) | `AdminTeacher` |
| POST /admin/teachers/{id}/roster | multipart `file` (CSV: `roll_no,name,grade,section`) | `RosterUploadResult` |
| GET /admin/schools | – | Schools, their teachers and classes, and the school circle if one is set |
| PUT /admin/schools/{id}/boundary | `{lat, lng, radius_m}` | The circle. `radius_m` is 50–1500 and is the “in and around” distance |
| DELETE /admin/schools/{id}/boundary | – | `{cleared: true}` |
| POST /admin/teachers/{id}/classes | `{grade, section}` | The new class |
| GET /admin/teachers/{id}/classes/{classId}/students | – | `{class, students}` with names |
| POST /admin/teachers/{id}/classes/{classId}/students | `{roll_no, name}` | The child. A removed roll is put back |
| PATCH /admin/teachers/{id}/classes/{classId}/students/{studentId} | `{active?, name?, roll_no?}` | The child |
| GET /admin/duty?school_id&from&to | – | Login/logout rows, open count, closed hours, and `missed`: uncorrected missed logouts from the last 14 days, whatever the range |
| POST /admin/duty | `{teacher_id, login_at, logout_at, note}` | A row entered by the head teacher. `note` is required |
| PATCH /admin/duty/{id} | `{login_at, logout_at, note}` | The corrected row. Times are marked edited |

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
· V13 meals equal the full class roll (warn)
