"""Spoken read-back: turn a record into one short sentence in the teacher's language and synthesise it with
Sarvam Bulbul, so a busy teacher can confirm by ear. Audio is generated on demand and kept only in a small
in-memory cache; nothing is written to disk or the database."""
import base64
import logging
from collections import OrderedDict
from hashlib import sha256

import httpx

from . import config
from .db import DailyRecord

log = logging.getLogger("shikshak.speech")

TTS_LANG = {"hi": "hi-IN", "en": "en-IN", "mr": "mr-IN", "kn": "kn-IN"}
TTS_MODEL = "bulbul:v3"
TTS_SPEAKER = "priya"
_CACHE: "OrderedDict[str, bytes]" = OrderedDict()
_CACHE_MAX = 64


class SpeechError(Exception):
    """Teacher-facing message in str(exc)."""


def enabled() -> bool:
    return bool(config.SARVAM_API_KEY)


def _names(names: list[str], lang: str) -> str:
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    joiner = {"hi": " और ", "mr": " आणि ", "kn": " ಮತ್ತು ", "en": " and "}.get(lang, " and ")
    return ", ".join(names[:-1]) + joiner + names[-1]


def summary_text(r: DailyRecord, absent_names: list[str], open_flags: list[str], lang: str) -> str:
    """One readable sentence per fact. Unknown numbers are said as unknown, never guessed."""
    g = r.klass.grade
    sec = f" {r.klass.section}" if r.klass.section else ""
    p, m = r.present, r.meals_served
    a = len(absent_names) + len(r.unresolved or [])
    names = _names(absent_names, lang)
    n = len(open_flags)
    if lang == "hi":
        parts = [f"कक्षा {g}{sec}।", f"{p} बच्चे आए।" if p is not None else "हाज़िर बच्चों की गिनती नहीं मिली।"]
        if a:
            parts.append(f"{a} बच्चे नहीं आए" + (f": {names}।" if names else "।"))
        parts.append(f"{m} बच्चों ने खाना खाया।" if m is not None else "खाने की गिनती नहीं मिली।")
        if n:
            parts.append(f"{n} बात जाँचनी है।" if n == 1 else f"{n} बातें जाँचनी हैं।")
        parts.append("क्या यह सही है?")
    elif lang == "mr":
        parts = [f"इयत्ता {g}{sec}.", f"{p} मुले हजर." if p is not None else "हजर मुलांची संख्या मिळाली नाही."]
        if a:
            parts.append(f"{a} गैरहजर" + (f": {names}." if names else "."))
        parts.append(f"{m} मुलांनी जेवण घेतले." if m is not None else "जेवणाची संख्या मिळाली नाही.")
        if n:
            parts.append(f"{n} गोष्टी तपासायच्या आहेत.")
        parts.append("हे बरोबर आहे का?")
    elif lang == "kn":
        parts = [f"{g}ನೇ ತರಗತಿ{sec}.", f"{p} ಮಕ್ಕಳು ಹಾಜರು." if p is not None else "ಹಾಜರಾತಿ ಸಂಖ್ಯೆ ಸಿಗಲಿಲ್ಲ."]
        if a:
            parts.append(f"{a} ಗೈರು" + (f": {names}." if names else "."))
        parts.append(f"{m} ಊಟ ನೀಡಲಾಗಿದೆ." if m is not None else "ಊಟದ ಸಂಖ್ಯೆ ಸಿಗಲಿಲ್ಲ.")
        if n:
            parts.append(f"{n} ವಿಷಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.")
        parts.append("ಇದು ಸರಿಯೇ?")
    else:
        parts = [f"Class {g}{sec}.", f"{p} present." if p is not None else "I did not hear how many were present."]
        if a:
            parts.append(f"{a} absent" + (f": {names}." if names else "."))
        parts.append(f"{m} meals served." if m is not None else "I did not hear the meals count.")
        if n:
            parts.append(f"Please check: {open_flags[0]}" + (f" And {n - 1} more." if n > 1 else ""))
        parts.append("Is this right?")
    return " ".join(parts)[:2400]


async def synthesize(text: str, lang: str) -> bytes:
    if not enabled():
        raise SpeechError("Read-aloud is not switched on for this server.")
    key = sha256(f"{lang}|{text}".encode()).hexdigest()
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]
    body = {"text": text, "target_language_code": TTS_LANG.get(lang, "hi-IN"), "speaker": TTS_SPEAKER,
            "model": TTS_MODEL, "speech_sample_rate": 24000, "output_audio_codec": "mp3",
            "enable_preprocessing": True, "pace": 0.95}
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post("https://api.sarvam.ai/text-to-speech",
                                  headers={"api-subscription-key": config.SARVAM_API_KEY}, json=body)
    except httpx.HTTPError as exc:
        log.warning("TTS network error: %s", exc)
        raise SpeechError("Could not reach the voice service. Please read the card instead.") from exc
    if r.status_code >= 400:
        log.warning("Sarvam TTS %s: %s", r.status_code, r.text[:300])
        raise SpeechError("Could not read this aloud right now. Please read the card instead.")
    audio = base64.b64decode(r.json()["audios"][0])
    _CACHE[key] = audio
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return audio
