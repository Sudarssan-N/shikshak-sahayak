# Shikshak Sahayak

A teacher records one voice note ("Class 3, 23 present, Ravi and Sita absent, 25 meals served, finished lesson 7").
The app turns it into attendance and mid-day-meal records, checks them with deterministic rules, and asks the
teacher to confirm. It then generates the registers and the monthly report. Nothing is saved as confirmed until the teacher confirms.

- `backend/`: FastAPI, SQLAlchemy (SQLite in dev, Postgres via `DATABASE_URL`). Pipeline: ASR → extract → roster match → rules → confirm.
- `frontend/`: React 18 + Vite + TypeScript, phone-first. It covers the teacher app, the pilot-lead console (`/admin`) and the public impact page (`/stats`).
- `docs/API_CONTRACT.md`: the API. The PRD is one level up.

## Run locally

```bash
# backend
cd backend
uv venv .venv -p 3.11 && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python -m scripts.seed_demo          # fictional demo teacher, phone 9876500001
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q                  # 24 tests, no API keys needed

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

## Privacy

Audio is processed in memory and never stored. Roster names are encrypted at rest, and records reference students by ID.
Names are masked before any LLM call. `/stats` holds totals only, keyed by a random pseudonymous ID. "Delete my data" removes
the roster, records, transcripts and files. Licence: MIT.
