"""Beyond the daily register: the mid-day-meal count message, absence follow-up with parents, and monthly
reading/maths levels for Teaching at the Right Level. All teacher-scoped; nothing here is shared outside the app."""
import re
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import asr, followup, grain, levels, service, speech
from ..db import (DailyRecord, FollowUpAction, LearningLevel, Student, StudentContact, Teacher, get_db, now)
from ..reports.generate import _template
from ..security import decrypt_name, encrypt_name, normalize_phone, valid_phone
from .deps import current_teacher

router = APIRouter(prefix="/api")

ACTIONS = {"call", "visit", "message", "spoke_child", "other"}
REASONS = {"illness", "work", "migration", "distance", "family_event", "not_interested", "unknown", "other"}
OUTCOMES = {"will_return", "returned", "unreachable", "other"}


def _own_student(student_id: str, t: Teacher, db: Session) -> Student:
    s = db.get(Student, student_id)
    if s is None or s.class_id not in {k.id for k in t.classes}:
        raise HTTPException(404, "Student not found.")
    return s


def _phone(db: Session, student_id: str) -> str | None:
    c = db.get(StudentContact, student_id)
    return decrypt_name(c.phone_enc) if c else None


# ------------------------------------------------------------------ mid-day meal

@router.get("/mdm/today")
def mdm_today(day: date | None = None, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    """Total meals for the school today from confirmed records, and the daily count message the PM POSHAN
    SMS/IVRS system expects. The number and format differ by state, so both come from the state template."""
    d = day or service.today()
    recs = db.scalars(select(DailyRecord).where(DailyRecord.teacher_id == t.id, DailyRecord.record_date == d,
                                                DailyRecord.status == "confirmed")).all()
    by_class = {r.class_id: r for r in recs}  # latest confirmed per class
    meals = sum(r.meals_served or 0 for r in by_class.values())
    present = sum(r.present or 0 for r in by_class.values())
    tpl = (_template(t.school.state).get("mdm_sms") or {})
    body = (tpl.get("body") or "MDM {meals}").format(meals=meals, present=present, date=d.strftime("%d%m%Y"),
                                                       udise=t.school.udise_code or "")
    number = str(tpl.get("number") or "")
    return {"date": d.isoformat(), "meals": meals, "present": present,
            "classes_confirmed": len(by_class), "classes_total": len(t.classes),
            "complete": len(by_class) == len(t.classes) and len(t.classes) > 0,
            "sms_body": body, "sms_number": number,
            "sms_url": f"sms:{number}?body={quote(body)}",
            "format_note": tpl.get("note") or "Check your state's MDM SMS format and number before sending."}


class GrainReceivedIn(BaseModel):
    day: date
    kg: float = Field(gt=0, le=5000)
    note: str | None = Field(None, max_length=160)


class GrainOpeningIn(BaseModel):
    month: str = Field(min_length=7, max_length=7)
    kg: float = Field(ge=0, le=5000)
    note: str | None = Field(None, max_length=160)


class GrainNormsIn(BaseModel):
    primary_g: int = Field(ge=20, le=400)
    upper_g: int = Field(ge=20, le=400)


def _grain(fn):
    try:
        return fn()
    except service.UserFacingError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.get("/mdm/stock")
def mdm_stock(month: str | None = None, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    """Food grain for the month: confirmed meals × grams, plus opening stock and deliveries the teacher entered."""
    m = month or service.today().strftime("%Y-%m")
    return _grain(lambda: grain.stock(db, t, m))


@router.post("/mdm/stock/received")
def mdm_stock_received(body: GrainReceivedIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    return _grain(lambda: grain.add_received(db, t, body.day, body.kg, body.note))


@router.post("/mdm/stock/opening")
def mdm_stock_opening(body: GrainOpeningIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    return _grain(lambda: grain.set_opening(db, t, body.month, body.kg, body.note))


@router.put("/mdm/norms")
def mdm_norms(body: GrainNormsIn, month: str | None = None, t: Teacher = Depends(current_teacher),
              db: Session = Depends(get_db)):
    m = month or service.today().strftime("%Y-%m")
    return _grain(lambda: grain.set_norms(db, t, body.primary_g, body.upper_g, m))


@router.delete("/mdm/stock/{movement_id}")
def mdm_stock_delete(movement_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    return _grain(lambda: grain.remove(db, t, movement_id))


# ------------------------------------------------------------------ absence follow-up

@router.get("/followup")
def follow_up(t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    """Dropout early-warning in two tiers, with each child's last follow-up and latest reading level."""
    items = followup.teacher_concerns(db, t, service.today())
    ids = [c.student_id for c in items]
    last: dict[str, FollowUpAction] = {}
    if ids:
        for a in db.scalars(select(FollowUpAction).where(FollowUpAction.student_id.in_(ids))
                            .order_by(FollowUpAction.created_at)):
            last[a.student_id] = a
    lv: dict[str, LearningLevel] = {}
    if ids:
        for row in db.scalars(select(LearningLevel).where(LearningLevel.student_id.in_(ids))
                              .order_by(LearningLevel.month)):
            lv[row.student_id] = row
    has_phone = set(db.scalars(select(StudentContact.student_id).where(StudentContact.student_id.in_(ids)))) \
        if ids else set()
    children = []
    for c in items:
        d = c.as_dict()
        level = lv.get(c.student_id)
        d["reading_level"] = level.reading if level else None
        if level and level.reading in levels.LOW_READING:
            d["reasons"].append(f"reads at {levels.READING_LABEL[level.reading].lower()} level")
        a = last.get(c.student_id)
        d["last_action"] = ({"action": a.action, "reason": a.reason, "outcome": a.outcome,
                             "at": a.created_at.isoformat()} if a else None)
        d["has_phone"] = c.student_id in has_phone
        children.append(d)
    # Absence plus a low reading level first within each tier: the strongest combined signal.
    children.sort(key=lambda d: (d["tier"] != "act", d["reading_level"] not in levels.LOW_READING))
    return {"window_days": followup.WINDOW_DAYS, "streak_min": followup.STREAK_MIN, "pct_min": followup.ACT_PCT,
            "act_pct": followup.ACT_PCT, "watch_missed_pct": followup.WATCH_MISSED_PCT, "children": children}


def _fmt_day(d: date, lang: str) -> str:
    months = {"hi": ["जन", "फ़र", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सित", "अक्टू", "नव", "दिस"]}
    if lang in months:
        return f"{d.day} {months[lang][d.month - 1]}"
    return d.strftime("%-d %b")


def parent_message(t: Teacher, c: followup.Concern) -> str:
    """Tells the parent the child's total absences (the fact that changes behaviour in the trials), gender-neutral."""
    lang, child, g = t.language, c.name.split()[0], c.grade
    days = ", ".join(_fmt_day(d, lang) for d in c.absent_dates[-3:])
    sig = f"— {t.name}, {t.school.name}"
    if lang == "hi":
        return (f"नमस्ते। पिछले {c.days_recorded} स्कूल दिनों में {child} (कक्षा {g}) की {c.days_absent} दिन "
                f"अनुपस्थिति रही है ({days})। नियमित आना पढ़ाई के लिए ज़रूरी है। कृपया कल {child} को स्कूल भेजें, "
                f"या कोई परेशानी हो तो मुझे बताएँ। {sig}")
    if lang == "mr":
        return (f"नमस्कार. मागील {c.days_recorded} शाळेच्या दिवसांपैकी {c.days_absent} दिवस {child} (इयत्ता {g}) "
                f"शाळेत गैरहजर ({days}). नियमित उपस्थिती शिकण्यासाठी महत्त्वाची आहे. कृपया उद्या {child} ला शाळेत "
                f"पाठवा, किंवा काही अडचण असल्यास मला कळवा. {sig}")
    if lang == "kn":
        return (f"ನಮಸ್ಕಾರ. ಕಳೆದ {c.days_recorded} ಶಾಲಾ ದಿನಗಳಲ್ಲಿ {child} ({g}ನೇ ತರಗತಿ) {c.days_absent} ದಿನ ಗೈರು "
                f"({days}). ನಿಯಮಿತ ಹಾಜರಾತಿ ಕಲಿಕೆಗೆ ಮುಖ್ಯ. ದಯವಿಟ್ಟು ನಾಳೆ {child} ಅನ್ನು ಶಾಲೆಗೆ ಕಳುಹಿಸಿ, ಏನಾದರೂ "
                f"ತೊಂದರೆ ಇದ್ದರೆ ನನಗೆ ತಿಳಿಸಿ. {sig}")
    return (f"Namaste. {child} (Class {g}) has been absent {c.days_absent} of the last {c.days_recorded} school days "
            f"({days}). Coming every day matters for learning. Please send {child} to school tomorrow, or tell me "
            f"if something is wrong. {sig}")


def _concern(db: Session, t: Teacher, s: Student) -> followup.Concern:
    k = next(k for k in t.classes if k.id == s.class_id)
    for c in followup.class_concerns(db, k, service.today()):
        if c.student_id == s.id:
            return c
    raise HTTPException(409, "This child is not on the follow-up list right now.")


@router.get("/followup/{student_id}/message")
def message(student_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    s = _own_student(student_id, t, db)
    text = parent_message(t, _concern(db, t, s))
    phone = _phone(db, s.id)
    q = quote(text)
    return {"text": text, "phone": phone,
            "sms_url": f"sms:{phone or ''}?body={q}",
            "whatsapp_url": f"https://wa.me/91{phone}?text={q}" if phone else f"https://wa.me/?text={q}"}


@router.get("/followup/{student_id}/message/speech")
async def message_speech(student_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    """The parent message read aloud, for a phone call or for parents who cannot read an SMS."""
    s = _own_student(student_id, t, db)
    try:
        audio = await speech.synthesize(parent_message(t, _concern(db, t, s)), t.language)
    except speech.SpeechError as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=600"})


class ContactIn(BaseModel):
    phone: str = Field(max_length=20)


@router.put("/students/{student_id}/contact")
def set_contact(student_id: str, body: ContactIn, t: Teacher = Depends(current_teacher),
                db: Session = Depends(get_db)):
    s = _own_student(student_id, t, db)
    if not valid_phone(body.phone):
        raise HTTPException(422, "Please enter a 10-digit mobile number.")
    c = db.get(StudentContact, s.id) or StudentContact(student_id=s.id, phone_enc="")
    c.phone_enc = encrypt_name(normalize_phone(body.phone))
    c.updated_at = now()
    db.add(c)
    db.commit()
    return {"ok": True, "phone": normalize_phone(body.phone)}


class ActionIn(BaseModel):
    action: str
    reason: str | None = None
    outcome: str | None = None
    note: str | None = Field(None, max_length=500)


@router.post("/followup/{student_id}/actions")
def log_action(student_id: str, body: ActionIn, t: Teacher = Depends(current_teacher),
               db: Session = Depends(get_db)):
    s = _own_student(student_id, t, db)
    if body.action not in ACTIONS or (body.reason and body.reason not in REASONS) or \
            (body.outcome and body.outcome not in OUTCOMES):
        raise HTTPException(422, "Please pick from the options shown.")
    a = FollowUpAction(teacher_id=t.id, student_id=s.id, action=body.action, reason=body.reason,
                       outcome=body.outcome, note=(body.note or "").strip() or None)
    db.add(a)
    service.track(db, t, "followup_logged")
    db.commit()
    return {"action": a.action, "reason": a.reason, "outcome": a.outcome, "at": a.created_at.isoformat()}


@router.get("/followup/{student_id}/actions")
def list_actions(student_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    s = _own_student(student_id, t, db)
    rows = db.scalars(select(FollowUpAction).where(FollowUpAction.student_id == s.id)
                      .order_by(FollowUpAction.created_at.desc()).limit(20)).all()
    return [{"action": a.action, "reason": a.reason, "outcome": a.outcome, "note": a.note,
             "at": a.created_at.isoformat()} for a in rows]


# ------------------------------------------------------------------ learning levels (TaRL)

def _month(m: str | None) -> str:
    m = m or service.today().strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", m):
        raise HTTPException(422, "Month must look like 2026-11.")
    return m


def _own_class(class_id: str, t: Teacher):
    k = next((k for k in t.classes if k.id == class_id), None)
    if k is None:
        raise HTTPException(404, "Class not found.")
    return k


@router.get("/levels")
def get_levels(class_id: str, month: str | None = None, t: Teacher = Depends(current_teacher),
               db: Session = Depends(get_db)):
    k = _own_class(class_id, t)
    m = _month(month)
    rows = {r.student_id: r for r in db.scalars(select(LearningLevel).where(LearningLevel.class_id == k.id,
                                                                             LearningLevel.month == m))}
    kids = []
    for e in sorted(service.roster(k), key=lambda e: e.roll_no):
        r = rows.get(e.id)
        kids.append({"student_id": e.id, "name": e.name, "roll_no": e.roll_no,
                     "reading": r.reading if r else None, "maths": r.maths if r else None})
    done = sum(1 for x in kids if x["reading"] or x["maths"])
    return {"class_id": k.id, "month": m, "children": kids, "done": done, "total": len(kids),
            "groups": levels.groups(kids),
            "reading_levels": [{"id": x, "label": levels.READING_LABEL[x]} for x in levels.READING],
            "maths_levels": [{"id": x, "label": levels.MATHS_LABEL[x]} for x in levels.MATHS]}


@router.post("/levels/parse")
async def parse_levels(class_id: str = Form(...), text: str | None = Form(None),
                       audio: UploadFile | None = File(None), t: Teacher = Depends(current_teacher)):
    """Turn 'Meena story subtraction, Ravi letters 1 to 9' (spoken or typed) into proposed levels. Saves nothing."""
    k = _own_class(class_id, t)
    if audio is not None:
        try:
            text = (await asr.transcribe(await audio.read(), audio.content_type or "", t.language)).text
        except asr.ASRError as exc:
            raise HTTPException(422, str(exc)) from exc
    if not (text or "").strip():
        raise HTTPException(422, "Say or type at least one child and level.")
    roster = service.roster(k)
    names = {e.id: e for e in roster}
    p = levels.parse(text, roster)
    return {"transcript": text,
            "items": [{**i, "name": names[i["student_id"]].name, "roll_no": names[i["student_id"]].roll_no}
                      for i in p.items],
            "unmatched": p.unmatched}


class LevelItem(BaseModel):
    student_id: str
    reading: str | None = None
    maths: str | None = None


class LevelsIn(BaseModel):
    class_id: str
    month: str | None = None
    source: str = "tap"
    items: list[LevelItem]


@router.put("/levels")
def save_levels(body: LevelsIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    k = _own_class(body.class_id, t)
    m = _month(body.month)
    ids = {s.id for s in k.students if s.active}
    existing = {r.student_id: r for r in db.scalars(select(LearningLevel).where(LearningLevel.class_id == k.id,
                                                                                 LearningLevel.month == m))}
    for it in body.items:
        if it.student_id not in ids or (it.reading and it.reading not in levels.READING) or \
                (it.maths and it.maths not in levels.MATHS):
            raise HTTPException(422, "A child or level was not recognised. Please pick from the list.")
        r = existing.get(it.student_id)
        if r is None:
            r = LearningLevel(teacher_id=t.id, class_id=k.id, student_id=it.student_id, month=m)
            db.add(r)
            existing[it.student_id] = r
        r.reading, r.maths = it.reading, it.maths
        r.source = "voice" if body.source == "voice" else "tap"
        r.updated_at = now()
    service.track(db, t, "levels_saved", value=len(body.items))
    db.commit()
    return get_levels(k.id, m, t, db)
