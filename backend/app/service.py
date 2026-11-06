"""Pipeline orchestration and record lifecycle: ingest → transcribe → extract → match roster → validate → card;
corrections, name resolution, confirmation, usage counters. Routes stay thin and call into here."""
import logging
import re
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import asr, config
from .db import (ClassSection, Correction, DailyRecord, Student, Teacher, UsageEvent, ValidationFlag, VoiceNote,
                 now)
from .pipeline import extract as extract_mod
from .pipeline.parser import parse as parse_text
from .pipeline.roster_match import RosterEntry, match_names
from .rules.engine import Ctx, validate
from .schemas import ClassDay, LessonProgress, RecordPatch
from .security import decrypt_name

log = logging.getLogger("shikshak.pipeline")


class UserFacingError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def today() -> date:
    return datetime.now(ZoneInfo(config.TIMEZONE)).date()


def class_label(k: ClassSection) -> str:
    return f"Class {k.grade}{'-' + k.section if k.section else ''}"


def roster(k: ClassSection) -> list[RosterEntry]:
    return [RosterEntry(s.id, s.roll_no, decrypt_name(s.name_enc)) for s in k.students if s.active]


def track(db: Session, teacher: Teacher, event: str, value: float | None = None, language: str | None = None):
    db.add(UsageEvent(day=today(), event_type=event, language=language, teacher_pseudo_id=teacher.pseudo_id,
                      value=value))


# ---------------------------------------------------------------- validation

def _ctx(db: Session, r: DailyRecord, entries: dict[str, RosterEntry]) -> Ctx:
    k = r.klass
    prior = None
    same_day = False
    if r.record_date:
        prior = db.scalars(select(DailyRecord).where(
            DailyRecord.class_id == r.class_id, DailyRecord.status == "confirmed",
            DailyRecord.record_date < r.record_date).order_by(DailyRecord.record_date.desc()).limit(1)).first()
        same_day = db.scalars(select(DailyRecord.id).where(
            DailyRecord.class_id == r.class_id, DailyRecord.status == "confirmed",
            DailyRecord.record_date == r.record_date, DailyRecord.id != r.id)).first() is not None
    last_lesson = None
    if prior and prior.lessons:
        nums = [int(m.group()) for ls in prior.lessons for m in [re.search(r"\d+", ls.get("lesson_ref") or "")] if m]
        last_lesson = max(nums) if nums else None
    unresolved = [{"spoken": u["spoken"],
                   "candidates": [{"name": entries[c].name, "roll_no": entries[c].roll_no}
                                  for c in u.get("candidate_ids", []) if c in entries]} for u in r.unresolved]
    return Ctx(klass=class_label(k), record_date=r.record_date, today=today(), enrolled=r.enrolled,
               present=r.present, meals_served=r.meals_served, absent_ids=list(r.absent_student_ids),
               absent_count_spoken=r.absent_count_spoken, unresolved=unresolved, lessons=list(r.lessons),
               field_confidence=dict(r.field_confidence or {}), confirmed_same_day=same_day,
               last_lesson_no=last_lesson, last_record_date=prior.record_date if prior else None)


def revalidate(db: Session, r: DailyRecord, raised_event: bool = True):
    """Re-run all rules. Flags that no longer fire become 'corrected'; still-firing ones stay open."""
    entries = {e.id: e for e in roster(r.klass)}
    found = validate(_ctx(db, r, entries))
    open_flags = [f for f in r.flags if f.resolution == "open"]
    remaining = list(found)
    for f in open_flags:
        match = next((n for n in remaining if n.rule_id == f.rule_id and n.message == f.message), None) \
            or next((n for n in remaining if n.rule_id == f.rule_id), None)
        if match:
            f.message, f.severity, f.field = match.message, match.severity, match.field
            remaining.remove(match)
        else:
            f.resolution = "corrected"
            track(db, r_teacher(db, r), "flag_acted")
    for n in remaining:
        r.flags.append(ValidationFlag(rule_id=n.rule_id, severity=n.severity, field=n.field, message=n.message,
                                     resolution="open"))
        if raised_event:
            track(db, r_teacher(db, r), "flag_raised")
    if r.status in (None, "draft", "flagged"):
        r.status = "flagged" if any(f.resolution == "open" and f.severity in ("block", "warn") for f in r.flags) \
            else "draft"


def r_teacher(db: Session, r: DailyRecord) -> Teacher:
    return db.get(Teacher, r.teacher_id)


# ---------------------------------------------------------------- ingest

def _resolve_class(teacher: Teacher, cd: ClassDay) -> ClassSection | None:
    if cd.grade is None:
        return teacher.classes[0] if len(teacher.classes) == 1 else None
    hits = [k for k in teacher.classes if k.grade == cd.grade]
    if cd.section:
        exact = [k for k in hits if (k.section or "").upper() == cd.section.upper()]
        hits = exact or hits
    return hits[0] if len(hits) == 1 or hits else None


def _counted_fields(r: DailyRecord) -> int:
    return sum([r.present is not None, r.meals_served is not None, bool(r.absent_student_ids or r.unresolved),
                bool(r.lessons), r.record_date is not None])


async def process_note(db: Session, teacher: Teacher, *, audio: bytes | None = None, mime: str = "",
                       text: str | None = None, record_date: date | None = None,
                       channel: str = "web", channel_message_id: str | None = None) -> VoiceNote:
    if channel_message_id:
        dup = db.scalars(select(VoiceNote).where(VoiceNote.channel_message_id == channel_message_id)).first()
        if dup:
            return dup  # idempotent: provider retries never create a second record
    t0 = time.monotonic()
    note = VoiceNote(teacher_id=teacher.id, channel=channel, channel_message_id=channel_message_id,
                     language=teacher.language, status="received")
    db.add(note)
    db.flush()
    try:
        if audio is not None:
            tr = await asr.transcribe(audio, mime, teacher.language)  # audio stays in memory, then is dropped
            note.transcript, note.language, note.asr_engine = tr.text, tr.language, tr.engine
        else:
            note.transcript, note.asr_engine = (text or "").strip(), "text"
        if not note.transcript:
            raise asr.ASRError("The note was empty. Please say or type today's attendance.")

        names = [e.name for k in teacher.classes for e in roster(k)]
        rec, note.extractor = await extract_mod.extract(note.transcript, today(), record_date, names)
        if not rec.classes:
            raise asr.ASRError("I could not find attendance in that note. Try: \"Class 3, 23 present, "
                               "Ravi and Sita absent, 25 meals served.\"")
        made = 0
        for cd in rec.classes:
            k = _resolve_class(teacher, cd)
            if k is None:
                taught = ", ".join(class_label(x) for x in teacher.classes)
                said = f"Class {cd.grade}" if cd.grade else "no class"
                raise asr.ASRError(f"I heard {said}, but you teach {taught}. Please say the class clearly.")
            entries = roster(k)
            m = match_names(cd.absent_names, entries)
            r = DailyRecord(teacher_id=teacher.id, class_id=k.id, source_note_id=note.id, status="draft",
                            record_date=cd.record_date or record_date or today(), enrolled=len(entries),
                            present=cd.present, absent_count_spoken=cd.absent_count,
                            absent_student_ids=m.matched_ids, unresolved=m.unresolved,
                            meals_served=cd.meals_served, lessons=[ls.model_dump() for ls in cd.lessons],
                            field_confidence={k2: v for k2, v in rec.field_confidence.items()},
                            missing_fields=[f for f in ("present", "meals_served")
                                            if getattr(cd, f) is None])
            r.klass = k
            r.extracted_fields = _counted_fields(r)
            db.add(r)
            db.flush()
            revalidate(db, r)
            made += 1
        note.status = "processed"
        track(db, teacher, "note_processed", language=note.language)
    except asr.ASRError as exc:
        note.status, note.error = "failed", str(exc)
        track(db, teacher, "note_failed", language=teacher.language)
    note.latency_ms = int((time.monotonic() - t0) * 1000)
    log.info("note=%s status=%s asr=%s extractor=%s latency_ms=%s", note.id, note.status, note.asr_engine,
             note.extractor, note.latency_ms)
    db.commit()
    return note


# ---------------------------------------------------------------- corrections

def _editable(db: Session, r: DailyRecord) -> DailyRecord:
    """Draft/flagged records are edited in place; a confirmed one gets a new version and is superseded."""
    if r.status == "superseded":
        raise UserFacingError(409, "This record was replaced by a newer version.")
    if r.status != "confirmed":
        return r
    n = DailyRecord(teacher_id=r.teacher_id, class_id=r.class_id, source_note_id=r.source_note_id,
                    record_date=r.record_date, enrolled=r.enrolled, present=r.present,
                    absent_count_spoken=r.absent_count_spoken, absent_student_ids=list(r.absent_student_ids),
                    unresolved=list(r.unresolved), meals_served=r.meals_served, lessons=list(r.lessons),
                    field_confidence={}, missing_fields=[], extracted_fields=r.extracted_fields,
                    status="draft", version=r.version + 1, previous_id=r.id)
    n.klass = r.klass
    r.status = "superseded"
    db.add(n)
    db.flush()
    return n


def _log(db: Session, r: DailyRecord, fld: str, old, new, via: str):
    if old != new:
        db.add(Correction(record_id=r.id, field=fld, old_value=None if old is None else str(old),
                          new_value=None if new is None else str(new), via=via))
        conf = dict(r.field_confidence or {})
        conf.pop(fld, None)
        if fld == "absent_student_ids":
            conf.pop("absent_names", None)
        r.field_confidence = conf


def apply_patch(db: Session, r: DailyRecord, p: RecordPatch, via: str = "edit") -> DailyRecord:
    r = _editable(db, r)
    data = p.model_dump(exclude_unset=True)
    if "absent_student_ids" in data:
        valid = {e.id for e in roster(r.klass)}
        bad = [i for i in data["absent_student_ids"] if i not in valid]
        if bad:
            raise UserFacingError(422, "Some students are not in this class roster.")
    for fld, new in data.items():
        if fld == "lessons":
            new = [LessonProgress.model_validate(x).model_dump() for x in (new or [])]
        old = getattr(r, fld)
        _log(db, r, fld, old, new, via)
        setattr(r, fld, new)
        if fld == "absent_student_ids":
            r.absent_count_spoken = None
    r.missing_fields = [f for f in ("present", "meals_served") if getattr(r, f) is None]
    revalidate(db, r)
    db.commit()
    return r


async def correct_by_text(db: Session, r: DailyRecord, text: str, via: str = "text") -> DailyRecord:
    """Spoken/typed correction → patch on allowed fields only. Uses the same parser, scoped to one record."""
    text = text.strip()
    if not text:
        raise UserFacingError(422, "The correction was empty.")
    parsed = parse_text(text, today(), r.record_date)
    cd = parsed.classes[0] if parsed.classes else ClassDay()
    patch = RecordPatch()
    if cd.present is not None:
        patch.present = cd.present
    if cd.meals_served is not None:
        patch.meals_served = cd.meals_served
    if cd.lessons:
        patch.lessons = cd.lessons
    entries = roster(r.klass)
    ids = list(r.absent_student_ids)
    changed_names = False
    # "Ravi was present" / "Ravi not absent" → remove; "Meena also absent" → add
    for m in re.finditer(r"([A-Za-zऀ-ॿ ]+?)\s+(?:was|is|थी|था)?\s*(?:present|not absent|आया|आई|आए|हाजिर)",
                         text, re.I):
        hit = match_names([m.group(1).split()[-1]], entries)
        for sid in hit.matched_ids:
            if sid in ids:
                ids.remove(sid)
                changed_names = True
    if cd.absent_names and re.search(r"absent|अनुपस्थित|नहीं आ|गैरहाजिर", text, re.I):
        hit = match_names(cd.absent_names, entries)
        for sid in hit.matched_ids:
            if sid not in ids:
                ids.append(sid)
                changed_names = True
    if changed_names:
        patch.absent_student_ids = ids
    if not patch.model_dump(exclude_unset=True, exclude_none=True):
        raise UserFacingError(422, "I could not find a change in that. Try: \"present 24\" or \"meals 22\".")
    return apply_patch(db, r, patch, via=via)


async def correct_by_audio(db: Session, r: DailyRecord, teacher: Teacher, audio: bytes, mime: str) -> DailyRecord:
    try:
        tr = await asr.transcribe(audio, mime, teacher.language)
    except asr.ASRError as exc:
        raise UserFacingError(422, str(exc)) from exc
    return await correct_by_text(db, r, tr.text, via="voice")


def resolve_name(db: Session, r: DailyRecord, spoken: str, student_id: str | None) -> DailyRecord:
    r = _editable(db, r)
    entry = next((u for u in r.unresolved if u["spoken"] == spoken), None)
    if entry is None:
        raise UserFacingError(404, f"No open question about '{spoken}'.")
    if student_id and student_id not in {e.id for e in roster(r.klass)}:
        raise UserFacingError(422, "That student is not in this class.")
    r.unresolved = [u for u in r.unresolved if u["spoken"] != spoken]
    if student_id and student_id not in r.absent_student_ids:
        r.absent_student_ids = [*r.absent_student_ids, student_id]
    _log(db, r, "absent_student_ids", spoken, student_id or "removed", "name")
    revalidate(db, r)
    db.commit()
    return r


def confirm(db: Session, r: DailyRecord, acknowledge_warnings: bool) -> DailyRecord:
    if r.status == "confirmed":
        return r
    if r.status == "superseded":
        raise UserFacingError(409, "This record was replaced by a newer version.")
    revalidate(db, r, raised_event=False)
    open_flags = [f for f in r.flags if f.resolution == "open"]
    if any(f.severity == "block" for f in open_flags):
        db.commit()
        raise UserFacingError(409, "Please fix the items marked 'Must fix' before confirming.")
    if any(f.severity == "warn" for f in open_flags) and not acknowledge_warnings:
        db.commit()
        raise UserFacingError(422, "Some items need a check. Confirm anyway?")
    for f in open_flags:
        f.resolution = "confirmed_anyway"
        if f.severity == "warn":
            track(db, r_teacher(db, r), "flag_acted")
    # V5: confirming replaces an earlier confirmed record for the same class and day
    for old in db.scalars(select(DailyRecord).where(DailyRecord.class_id == r.class_id,
                                                    DailyRecord.record_date == r.record_date,
                                                    DailyRecord.status == "confirmed", DailyRecord.id != r.id)):
        old.status = "superseded"
    r.status, r.confirmed_at = "confirmed", now()
    track(db, r_teacher(db, r), "record_confirmed")
    db.commit()
    return r


# ---------------------------------------------------------------- serialization

def ser_class(k: ClassSection) -> dict:
    return {"id": k.id, "grade": k.grade, "section": k.section, "enrolled": sum(1 for s in k.students if s.active)}


def ser_teacher(db: Session, t: Teacher) -> dict:
    confirmed = db.query(DailyRecord).filter(DailyRecord.teacher_id == t.id,
                                             DailyRecord.status == "confirmed").count()
    return {"id": t.id, "name": t.name, "language": t.language,
            "school": {"id": t.school.id, "name": t.school.name, "state": t.school.state,
                       "udise_code": t.school.udise_code},
            "classes": [ser_class(k) for k in t.classes],
            "consent_at": t.consent_at.isoformat() if t.consent_at else None,
            "records_confirmed": confirmed}


def ser_record(r: DailyRecord) -> dict:
    entries = {e.id: e for e in roster(r.klass)}
    # include inactive/removed students' ids gracefully
    absent = [{"student_id": i, "name": entries[i].name, "roll_no": entries[i].roll_no}
              for i in r.absent_student_ids if i in entries]
    absent.sort(key=lambda a: a["roll_no"])
    unresolved = [{"spoken": u["spoken"],
                   "candidates": [{"student_id": c, "name": entries[c].name, "roll_no": entries[c].roll_no}
                                  for c in u.get("candidate_ids", []) if c in entries]} for u in r.unresolved]
    return {"id": r.id, "note_id": r.source_note_id, "class_id": r.class_id, "grade": r.klass.grade,
            "section": r.klass.section, "record_date": r.record_date.isoformat() if r.record_date else None,
            "enrolled": r.enrolled, "present": r.present, "absent": absent,
            "absent_count": r.absent_count_spoken, "unresolved_names": unresolved,
            "meals_served": r.meals_served, "lessons": r.lessons, "status": r.status, "version": r.version,
            "flags": [{"id": f.id, "rule_id": f.rule_id, "severity": f.severity, "message": f.message,
                       "field": f.field, "resolution": f.resolution} for f in r.flags],
            "missing_fields": r.missing_fields, "created_at": r.created_at.isoformat(),
            "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None}


def ser_note(db: Session, note: VoiceNote) -> dict:
    recs = db.scalars(select(DailyRecord).where(DailyRecord.source_note_id == note.id,
                                                DailyRecord.previous_id.is_(None))
                      .order_by(DailyRecord.created_at)).all()
    return {"note": {"id": note.id, "transcript": note.transcript, "language": note.language,
                     "asr_engine": note.asr_engine, "status": note.status, "duration_s": note.duration_s,
                     "error": note.error},
            "records": [ser_record(r) for r in recs]}


def records_between(db: Session, teacher: Teacher, start: date, end: date, status: str | None = None):
    q = select(DailyRecord).where(DailyRecord.teacher_id == teacher.id, DailyRecord.record_date >= start,
                                  DailyRecord.record_date <= end)
    if status:
        q = q.where(DailyRecord.status.in_(status.split(",")))
    return db.scalars(q.order_by(DailyRecord.record_date.desc(), DailyRecord.created_at.desc())).all()


def default_window() -> tuple[date, date]:
    t = today()
    return t - timedelta(days=30), t


def student_names(k: ClassSection) -> list[Student]:
    return [s for s in k.students if s.active]
