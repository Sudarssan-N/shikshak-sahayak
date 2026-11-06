"""Thin LLM layer (Sarvam, OpenAI-compatible chat). Every call returns None on failure; callers fall back to the
deterministic parser, so the product works end to end with no key configured."""
import json
import logging
import re

import httpx

from . import config

log = logging.getLogger("shikshak.llm")


def enabled() -> bool:
    return config.LLM_PROVIDER == "sarvam" and bool(config.SARVAM_API_KEY)


def label() -> str:
    return f"sarvam:{config.SARVAM_CHAT_MODEL}" if enabled() else "parser"


async def chat_json(system: str, user: str, max_tokens: int = 1500) -> dict | None:
    if not enabled():
        return None
    body = {
        "model": config.SARVAM_CHAT_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post("https://api.sarvam.ai/v1/chat/completions",
                                  headers={"api-subscription-key": config.SARVAM_API_KEY}, json=body)
        if r.status_code >= 400:
            log.warning("Sarvam chat %s: %s", r.status_code, r.text[:300])
            return None
        content = r.json()["choices"][0]["message"].get("content") or ""
    except Exception as exc:  # network, quota, malformed
        log.warning("LLM call failed: %s", exc)
        return None
    return parse_json(content)


def parse_json(text: str) -> dict | None:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    for candidate in (text, (re.search(r"\{.*\}", text, re.S) or [None])[0]):
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None
