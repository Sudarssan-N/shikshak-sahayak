"""Public anonymous counters (/stats) and health. Totals only: no names, no phone numbers."""
from collections import Counter
from datetime import timedelta
from statistics import median

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import asr, config, llm, service
from ..db import Correction, DailyRecord, Teacher, UsageEvent, VoiceNote, get_db, now
from ..security import phone_hash

router = APIRouter()

# Partner organisations, stated as they stand. Not a usage count: teacher numbers come only from the database.
PILOT_PARTNERS = [
    {
        "name": "Ashraya",
        "url": "https://ashrayaconnect.org",
        "location": "Bengaluru, Karnataka",
        "about": "Runs Ashraya Shiksha Sarthi: 30+ learning centres and libraries, 5,000+ children (per ashrayaconnect.org).",
        "status": "Agreed to pilot",
        "detail": "Agreed to pilot Shikshak Sahayak with teachers at its centres. Onboarding and testing are in "
                  "progress; teacher accounts will appear in the counters above as they sign up.",
        "since": "2026-11",
    },
]


@router.get("/health")
def health():
    return {"ok": True, "asr": asr.label(), "llm": llm.label()}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    # The public demo account (config.DEMO_PHONES) is fictional: it never counts as impact.
    demo = db.scalars(select(Teacher).where(Teacher.phone_hash.in_(
        [phone_hash(p) for p in config.DEMO_PHONES] or ["-"]))).all()
    demo_ids, demo_pseudo = {t.id for t in demo} or {"-"}, {t.pseudo_id for t in demo}
    ev = [e for e in db.scalars(select(UsageEvent)).all() if e.teacher_pseudo_id not in demo_pseudo]
    by = Counter(e.event_type for e in ev)
    confirmed_per = Counter(e.teacher_pseudo_id for e in ev if e.event_type == "record_confirmed")
    onboarded = {e.teacher_pseudo_id for e in ev if e.event_type == "onboarded"}
    minutes = [e.value for e in ev if e.event_type == "time_saved" and e.value is not None]
    langs = Counter(e.language or "?" for e in ev if e.event_type == "note_processed")

    # first-pass accuracy: extracted fields the teacher did not have to correct, over confirmed records
    confirmed = db.scalars(select(DailyRecord).where(DailyRecord.status.in_(["confirmed", "superseded"]),
                                                     DailyRecord.previous_id.is_(None),
                                                     DailyRecord.source_note_id.is_not(None),
                                                     DailyRecord.teacher_id.not_in(demo_ids))).all()
    total_fields = sum(r.extracted_fields for r in confirmed)
    corrected = 0
    for r in confirmed:
        chain = [r.id] + [x for x in db.scalars(select(DailyRecord.id).where(DailyRecord.previous_id == r.id))]
        corrected += db.scalar(select(func.count(func.distinct(Correction.field)))
                               .where(Correction.record_id.in_(chain))) or 0
    acc = round(1 - corrected / total_fields, 3) if total_fields else None

    today = service.today()
    days = [today - timedelta(days=i) for i in range(29, -1, -1)]
    notes_by_day = Counter(e.day for e in ev if e.event_type == "note_processed")
    conf_by_day = Counter(e.day for e in ev if e.event_type == "record_confirmed")
    return {
        "teachers_onboarded": len(onboarded) or db.scalar(select(func.count(Teacher.id))
                                                          .where(Teacher.consent_at.is_not(None),
                                                                 Teacher.id.not_in(demo_ids))) or 0,
        "teachers_active": sum(1 for v in confirmed_per.values() if v >= 3),
        "notes_processed": by["note_processed"],
        "records_confirmed": by["record_confirmed"],
        "flags_raised": by["flag_raised"],
        "flags_acted_on": by["flag_acted"],
        "median_minutes_saved": median(minutes) if minutes else None,
        "first_pass_accuracy": acc,
        "languages": dict(langs),
        "daily": [{"day": d.isoformat(), "notes": notes_by_day[d], "confirmed": conf_by_day[d]} for d in days],
        "updated_at": now().isoformat(),
        "excludes_demo_account": bool(demo),
        "pilot_partners": PILOT_PARTNERS,
    }


_ = VoiceNote
