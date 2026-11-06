# Shikshak Sahayak

A teacher records one voice note ("Class 3, 23 present, Ravi and Sita absent, 25 meals served, finished lesson 7").
The app turns it into attendance and mid-day-meal records, checks them with deterministic rules, and asks the
teacher to confirm. It then generates the registers and the monthly report. Nothing is saved as confirmed until the teacher confirms.

- `backend/`: FastAPI, SQLAlchemy (SQLite in dev, Postgres via `DATABASE_URL`). Pipeline: ASR → extract → roster match → rules → confirm.
- `frontend/`: React 18 + Vite + TypeScript, phone-first. It covers the teacher app, the pilot-lead console (`/admin`) and the public impact page (`/stats`).
- `docs/API_CONTRACT.md`: the API. The PRD is one level up.

**Live demo:** https://shikshak-sahayak-646454690406.asia-south1.run.app. Log in with the fictional demo teacher
`9876500001`; the one-time code is shown on screen for this account only. Public impact counters are at `/stats`,
and they exclude the demo account.

## What it does

- **Voice note → records.** Speak in Hindi, Marathi, Kannada or English (Sarvam Saaras STT). The LLM extracts
  classes, counts, absent names and lessons, and a deterministic parser is the fallback. Names are matched to
  the class list, and an unclear name ("which Ravi?") is asked about, never guessed.
- **Rules before registers.** Deterministic checks (meals more than present, counts that don't add up, missing
  fields) block or warn before anything is saved.
- **Spoken read-back.** "Listen" reads the card aloud in the teacher's language (Sarvam Bulbul), so a busy
  teacher can confirm by ear.
- **Dropout early-warning.** Home lists children absent on the last 3 recorded school days in a row, or below
  75% attendance this month, from confirmed records only. The monthly summary PDF carries the same list.
- **Registers and reports.** Attendance and MDM registers (XLSX), an upload CSV and a monthly summary PDF.

## Run locally

```bash
# backend
cd backend
uv venv .venv -p 3.11 && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python -m scripts.seed_demo          # fictional demo teacher, phone 9876500001
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q                  # 30 tests, no API keys needed

# frontend (dev server on :5173, proxies the API to :8000)
cd frontend && npm install && npm run dev
```

Log in with `9876500001`. In dev mode the one-time code is shown on screen. The pilot-lead key for `/admin` is `dev-admin-key`.
To serve everything from one process, run `npm run build`. FastAPI then serves `frontend/dist`.

## Configuration (`backend/.env`)

| Var | Default | Notes |
| --- | --- | --- |
| `SARVAM_API_KEY` | empty | Turns on voice (Saarika STT) and LLM extraction. Without it, typed notes and the rule-based parser still work |
| `LLM_PROVIDER` | `sarvam` if key else `none` | `none` = deterministic parser only |
| `DATABASE_URL` | SQLite in `backend/data/` | Postgres for the pilot |
| `SECRET_KEY`, `ADMIN_KEY` | dev values | **Set both in prod** |
| `DEV_MODE` | `1` | Returns the login code in the API response. Set `0` in prod |

Microphone access needs HTTPS (or localhost). Test on phones through a deployed HTTPS URL or a tunnel.

## Deploy (Cloud Run, scales to zero)

One container serves the API and the built UI (`Dockerfile` at the repo root). The database is a free Supabase
Postgres, in a private `shikshak` schema owned by its own role and not exposed through Supabase's REST API.
Keys live in Secret Manager.

```bash
gcloud run deploy shikshak-sahayak --source . --region asia-south1 --allow-unauthenticated \
  --min-instances 0 --max-instances 2 --memory 512Mi \
  --set-env-vars DEV_MODE=0,DEMO_PHONES=9876500001 \
  --set-secrets DATABASE_URL=ss-database-url:latest,SECRET_KEY=ss-secret-key:latest,ADMIN_KEY=ss-admin-key:latest,SARVAM_API_KEY=ss-sarvam-key:latest
```

With `--min-instances 0` nothing runs, and nothing is billed, while nobody is using it. The first request after
idle takes a few seconds while the container starts. Reports are rebuilt from the database if the container's
disk was wiped.

## Privacy

Audio is processed in memory and never stored. Roster names are encrypted at rest, and records reference students by ID.
Names are masked before any LLM call. Read-back sends the absent children's names to Sarvam's speech service, the
same provider that already hears them in the voice note, and the audio is never stored. `/stats` holds totals only, keyed by a random pseudonymous ID. "Delete my data" removes
the roster, records, transcripts and files. Licence: MIT.
