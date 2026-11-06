"""Extraction stage: transcript → ExtractedRecord. LLM with JSON output (roster names masked) when configured,
validated against the schema; one retry; then the deterministic parser. Unsaid fields stay null."""
import json
import re
from datetime import date

from pydantic import ValidationError

from .. import llm
from ..schemas import ExtractedRecord
from . import parser

SYSTEM = """You turn an Indian government-school teacher's spoken daily note into JSON. The note may be Hindi,
English or code-mixed. Output ONLY a JSON object with this shape:
{"record_date": "YYYY-MM-DD" | null,
 "classes": [{"grade": int 1-8 | null, "section": str | null, "record_date": "YYYY-MM-DD" | null,
              "present": int | null, "absent_count": int | null, "absent_names": [str],
              "meals_served": int | null,
              "lessons": [{"subject": str | null, "lesson_ref": "lesson N" | null, "status": "started" | "completed" | null}]}],
 "field_confidence": {"present": 0-1, "meals_served": 0-1, "absent_names": 0-1},
 "missing_fields": [str]}
Rules:
- NEVER guess. A value the teacher did not say is null and its field name goes in missing_fields.
- Do not compute present from enrolled or absent; only copy numbers that were spoken.
- One entry in classes per class AND per date mentioned (backfill notes can name several days).
- Resolve "today"/"aaj" to TODAY, "yesterday"/"kal" to the day before, weekday names to the most recent such day.
- Tokens like [S1] are student names that were masked; copy them exactly into absent_names.
- absent_names lists names as spoken, without titles."""


def _mask(transcript: str, roster_names: list[str]) -> tuple[str, dict[str, str]]:
    mapping: dict[str, str] = {}
    out = transcript
    for i, name in enumerate(sorted({n for n in roster_names if n}, key=len, reverse=True)):
        for part in [name] + name.split()[:1]:
            if len(part) < 3:
                continue
            pat = re.compile(rf"(?<![\wऀ-ॿ]){re.escape(part)}(?![\wऀ-ॿ])", re.I)
            if pat.search(out):
                tok = f"[S{len(mapping) + 1}]"
                mapping[tok] = part
                out = pat.sub(tok, out)
    return out, mapping


def _unmask(rec: ExtractedRecord, mapping: dict[str, str]) -> ExtractedRecord:
    for c in rec.classes:
        c.absent_names = [mapping.get(n.strip(), n) for n in c.absent_names]
    return rec


async def extract(transcript: str, today: date, default_date: date | None,
                  roster_names: list[str]) -> tuple[ExtractedRecord, str]:
    """Returns (record, extractor_label)."""
    if llm.enabled():
        masked, mapping = _mask(transcript, roster_names)
        user = json.dumps({"TODAY": today.isoformat(), "DEFAULT_DATE": (default_date or today).isoformat(),
                           "note": masked}, ensure_ascii=False)
        for _ in range(2):
            raw = await llm.chat_json(SYSTEM, user)
            if raw is None:
                break
            try:
                rec = ExtractedRecord.model_validate(raw)
            except ValidationError:
                continue
            if rec.classes:
                rec = _unmask(rec, mapping)
                for c in rec.classes:
                    c.enrolled = None  # enrolled always comes from the roster
                    c.record_date = c.record_date or rec.record_date or default_date or today
                return rec, llm.label()
    rec = parser.parse(transcript, today, default_date)
    for c in rec.classes:
        c.record_date = c.record_date or default_date or today
    return rec, "parser"
