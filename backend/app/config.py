"""Runtime configuration, read once from the environment (and backend/.env for local dev)."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent  # backend/
load_dotenv(ROOT / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DEV_MODE = _env("DEV_MODE", "1") == "1"
DATA_DIR = Path(_env("DATA_DIR", str(ROOT / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = _env("DATABASE_URL", f"sqlite:///{DATA_DIR / 'shikshak.db'}")

# Phones whose login code is shown on screen even in production (the public demo account for judges).
# Real teachers never get their code in the API response; OTP delivery for them is a separate channel.
DEMO_PHONES = {p.strip() for p in _env("DEMO_PHONES").split(",") if p.strip()}

# Dropout early-warning thresholds (see followup.py for where the defaults come from).
FOLLOWUP_STREAK_MIN = int(_env("FOLLOWUP_STREAK_MIN", "3"))
FOLLOWUP_ACT_PCT = int(_env("FOLLOWUP_ACT_PCT", "80"))
FOLLOWUP_WATCH_MISSED_PCT = int(_env("FOLLOWUP_WATCH_MISSED_PCT", "10"))

SECRET_KEY = _env("SECRET_KEY", "dev-only-change-me")
ADMIN_KEY = _env("ADMIN_KEY", "dev-admin-key" if DEV_MODE else "")
TOKEN_MAX_AGE_S = 30 * 24 * 3600
TIMEZONE = _env("TIMEZONE", "Asia/Kolkata")

# Speech: Sarvam Saaras/Saarika. Without a key, audio notes fail politely and text input still works.
SARVAM_API_KEY = _env("SARVAM_API_KEY")
SARVAM_STT_MODEL = _env("SARVAM_STT_MODEL", "saaras:v4")
# Extraction LLM: "sarvam" (OpenAI-compatible chat), or "none" to use only the deterministic parser.
LLM_PROVIDER = _env("LLM_PROVIDER", "sarvam" if SARVAM_API_KEY else "none")
SARVAM_CHAT_MODEL = _env("SARVAM_CHAT_MODEL", "sarvam-105b-conversations")

FRONTEND_DIST = Path(_env("FRONTEND_DIST", str(ROOT.parent / "frontend" / "dist")))
REPORTS_DIR = DATA_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
