"""Speech to text. Sarvam Saarika (Indian languages, code-mix aware). Audio is processed in memory and never written
to disk or the database (stricter than the PRD's 24-hour limit). Swap in IndicConformer/Bhashini behind `transcribe`."""
import logging
from dataclasses import dataclass

import httpx

from . import config

log = logging.getLogger("shikshak.asr")

LANG = {"hi": "hi-IN", "en": "en-IN", "mr": "mr-IN", "kn": "kn-IN"}
EXT = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3",
       "audio/wav": "wav", "audio/x-wav": "wav"}


@dataclass
class Transcript:
    text: str
    language: str
    engine: str


class ASRError(Exception):
    """Teacher-facing message in str(exc)."""


def enabled() -> bool:
    return bool(config.SARVAM_API_KEY)


def label() -> str:
    return f"sarvam:{config.SARVAM_STT_MODEL}" if enabled() else "disabled (text input only)"


async def transcribe(audio: bytes, mime: str, language: str) -> Transcript:
    if not enabled():
        raise ASRError("Voice is not switched on for this server yet. Please type the note instead.")
    if len(audio) < 1500:
        raise ASRError("The recording was empty. Please hold the button and speak again.")
    mime = (mime or "audio/webm").split(";")[0].strip()
    data = {"model": config.SARVAM_STT_MODEL, "language_code": LANG.get(language, "unknown")}
    if config.SARVAM_STT_MODEL.startswith("saaras"):
        data["mode"] = "transcribe"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post("https://api.sarvam.ai/speech-to-text",
                                  headers={"api-subscription-key": config.SARVAM_API_KEY},
                                  files={"file": (f"note.{EXT.get(mime, 'webm')}", audio, mime)}, data=data)
    except httpx.HTTPError as exc:
        log.warning("ASR network error: %s", exc)
        raise ASRError("Could not reach the speech service. Your note is safe; please try again.") from exc
    if r.status_code >= 400:
        log.warning("Sarvam STT %s: %s", r.status_code, r.text[:300])
        raise ASRError("I could not understand the recording. Please try again in a quieter place.")
    j = r.json()
    text = (j.get("transcript") or "").strip()
    if not text:
        raise ASRError("I could not hear any words. Please speak a little closer to the phone.")
    return Transcript(text=text, language=(j.get("language_code") or language)[:5], engine=f"sarvam:{config.SARVAM_STT_MODEL}")
