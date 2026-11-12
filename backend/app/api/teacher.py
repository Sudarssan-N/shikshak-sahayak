"""Teacher-facing routes: login by one-time code, capture, records, reports, delete-my-data."""
import csv
import logging
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .. import config, geo, service, speech
from ..db import (ClassSection, Correction, DailyRecord, DutySession, FollowUpAction, GrainMovement, LearningLevel, LoginCode,
                  Report, School, Student, StudentContact, Teacher, UsageEvent, ValidationFlag, VoiceNote, get_db, now)
from ..reports import generate as reports
from ..schemas import (ConfirmIn, CorrectionIn, PhoneIn, PinLoginIn, PlaceIn, ReportIn, ResolveNameIn, SignupIn,
                       TimeSavedIn, VerifyIn)
from ..security import (check_pin, code_hash, encrypt_name, hash_pin, make_token, new_code, normalize_phone, phone_hash,
                        valid_phone)
from .deps import current_teacher, own_record

router = APIRouter(prefix="/api")
log = logging.getLogger("shikshak.api")
MAX_AUDIO = 8 * 1024 * 1024  # ~90 s of opus is well under 1 MB; this is a hard ceiling


def _err(exc: service.UserFacingError):
    raise HTTPException(exc.status, str(exc))


# ------------------------------------------------------------------ auth

@router.post("/auth/request-code")
def request_code(body: PhoneIn, db: Session = Depends(get_db)):
    if not valid_phone(body.phone):
        raise HTTPException(422, "Please enter a 10-digit mobile number.")
    ph = phone_hash(body.phone)
    if not db.scalars(select(Teacher).where(Teacher.phone_hash == ph)).first():
        raise HTTPException(404, "This number is not registered yet. Please ask your pilot lead to add you.")
    code = new_code()
    db.add(LoginCode(phone_hash=ph, code_hash=code_hash(code), expires_at=now() + timedelta(minutes=10)))
    db.commit()
    # Delivery channel (SMS / WhatsApp template) is an open decision; in dev the code is returned directly.
    log.info("login code issued phone_hash=%s…", ph[:8])
    show = config.DEV_MODE or normalize_phone(body.phone) in {normalize_phone(p) for p in config.DEMO_PHONES}
    return {"sent": True, **({"dev_code": code} if show else {})}


@router.post("/auth/verify")
def verify(body: VerifyIn, db: Session = Depends(get_db)):
    ph = phone_hash(body.phone)
    lc = db.scalars(select(LoginCode).where(LoginCode.phone_hash == ph, LoginCode.used.is_(False))
                    .order_by(LoginCode.expires_at.desc())).first()
    if lc is None or lc.expires_at.replace(tzinfo=lc.expires_at.tzinfo or now().tzinfo) < now() or lc.attempts >= 5:
        raise HTTPException(401, "That code has expired. Please ask for a new one.")
    if lc.code_hash != code_hash(body.code.strip()):
        lc.attempts += 1
        db.commit()
        raise HTTPException(401, "That code didn't match. Please check and try again.")
    lc.used = True
    t = db.scalars(select(Teacher).where(Teacher.phone_hash == ph)).one()
    db.commit()
    return {"token": make_token(t.id), "teacher": service.ser_teacher(db, t)}


DEMO_SCHOOL = ("Primary School Rampur (demo)", "Uttar Pradesh")
WEAK_PINS = {"000000", "111111", "123456", "654321", "121212", "112233"}
PIN_MAX_FAILS, PIN_LOCK_MIN = 5, 15


@router.post("/auth/signup")
def signup(body: SignupIn, db: Session = Depends(get_db)):
    """Self-signup for the demo: name + phone + 6-digit PIN. Joins the demo school (classes 3 and 5) with the sample
    roster so capture works straight away. Numbers already on file can't be claimed this way."""
    if not config.ALLOW_SIGNUP:
        raise HTTPException(403, "Sign-up is closed. Please ask your pilot lead to add you.")
    if not valid_phone(body.phone):
        raise HTTPException(422, "Please enter a 10-digit mobile number.")
    if body.pin in WEAK_PINS or len(set(body.pin)) == 1:
        raise HTTPException(422, "That PIN is too easy to guess. Please choose a different 6-digit PIN.")
    ph = phone_hash(body.phone)
    if db.scalars(select(Teacher).where(Teacher.phone_hash == ph)).first():
        raise HTTPException(409, "This number is already registered. Please log in instead.")
    school = db.scalars(select(School).where(School.name == DEMO_SCHOOL[0])).first() \
        or School(name=DEMO_SCHOOL[0], state=DEMO_SCHOOL[1])
    t = Teacher(name=body.name.strip(), phone_hash=ph, phone_last4=normalize_phone(body.phone)[-4:], language="hi",
                school=school, pin_hash=hash_pin(body.pin))
    t.classes = [ClassSection(grade=3), ClassSection(grade=5)]
    by_grade = {k.grade: k for k in t.classes}
    with open(config.ROOT / "scripts" / "sample_roster.csv", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            k = by_grade.get(int(row["grade"]))
            if k is not None:
                k.students.append(Student(roll_no=int(row["roll_no"]), name_enc=encrypt_name(row["name"].strip())))
    db.add(t)
    db.commit()
    return {"token": make_token(t.id), "teacher": service.ser_teacher(db, t)}


@router.post("/auth/login-pin")
def login_pin(body: PinLoginIn, db: Session = Depends(get_db)):
    bad = HTTPException(401, "That number or PIN didn't match. Please check and try again.")
    t = db.scalars(select(Teacher).where(Teacher.phone_hash == phone_hash(body.phone))).first()
    if t is None or not t.pin_hash:
        check_pin(body.pin, hash_pin("000000"))  # keep timing similar for unknown numbers
        raise bad
    locked = t.pin_locked_until
    if locked is not None and locked.replace(tzinfo=locked.tzinfo or now().tzinfo) > now():
        raise HTTPException(429, "Too many wrong PINs. Please wait 15 minutes, or log in with an SMS code.")
    if not check_pin(body.pin, t.pin_hash):
        t.pin_fails = (t.pin_fails or 0) + 1
        if t.pin_fails >= PIN_MAX_FAILS:
            t.pin_fails, t.pin_locked_until = 0, now() + timedelta(minutes=PIN_LOCK_MIN)
        db.commit()
        raise bad
    t.pin_fails, t.pin_locked_until = 0, None
    db.commit()
    return {"token": make_token(t.id), "teacher": service.ser_teacher(db, t)}


# ------------------------------------------------------------------ me

@router.get("/me")
def me(t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    return service.ser_teacher(db, t)


@router.post("/me/consent")
def consent(t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    if not t.consent_at:
        t.consent_at = now()
        service.track(db, t, "onboarded", language=t.language)
        db.commit()
    return service.ser_teacher(db, t)


@router.delete("/me")
def delete_me(t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    """FR-15: remove roster, records, transcripts, files. Anonymous counters (no personal data) are kept."""
    rec_ids = [r for r in db.scalars(select(DailyRecord.id).where(DailyRecord.teacher_id == t.id))]
    if rec_ids:
        db.execute(delete(ValidationFlag).where(ValidationFlag.record_id.in_(rec_ids)))
        db.execute(delete(Correction).where(Correction.record_id.in_(rec_ids)))
        db.execute(delete(DailyRecord).where(DailyRecord.id.in_(rec_ids)))
    for rep in db.scalars(select(Report).where(Report.teacher_id == t.id)):
        Path(rep.file_uri).unlink(missing_ok=True)
        db.delete(rep)
    db.execute(delete(VoiceNote).where(VoiceNote.teacher_id == t.id))
    db.execute(delete(LoginCode).where(LoginCode.phone_hash == t.phone_hash))
    db.execute(delete(DutySession).where(DutySession.teacher_id == t.id))
    # Grain entries belong to the school's store. Keep them for the colleagues who still use it.
    colleague = db.scalars(select(Teacher).where(Teacher.school_id == t.school_id, Teacher.id != t.id)).first()
    if colleague is not None:
        db.execute(update(GrainMovement).where(GrainMovement.teacher_id == t.id).values(teacher_id=colleague.id))
    else:
        db.execute(delete(GrainMovement).where(GrainMovement.teacher_id == t.id))
    db.execute(delete(FollowUpAction).where(FollowUpAction.teacher_id == t.id))
    db.execute(delete(LearningLevel).where(LearningLevel.teacher_id == t.id))
    for k in t.classes:
        sids = [s.id for s in k.students]
        if sids:
            db.execute(delete(StudentContact).where(StudentContact.student_id.in_(sids)))
            db.execute(delete(FollowUpAction).where(FollowUpAction.student_id.in_(sids)))
            db.execute(delete(LearningLevel).where(LearningLevel.student_id.in_(sids)))
        db.execute(delete(Student).where(Student.class_id == k.id))
    db.delete(t)
    db.commit()
    return {"deleted": True}


@router.get("/roster")
def get_roster(t: Teacher = Depends(current_teacher)):
    return [{**service.ser_class(k),
             "students": [{"id": e.id, "roll_no": e.roll_no, "name": e.name}
                          for e in sorted(service.roster(k), key=lambda e: e.roll_no)]} for k in t.classes]


# ------------------------------------------------------------------ capture

@router.post("/notes")
async def create_note(audio: UploadFile | None = File(None), text: str | None = Form(None),
                      record_date: date | None = Form(None), t: Teacher = Depends(current_teacher),
                      db: Session = Depends(get_db)):
    if not t.consent_at:
        raise HTTPException(403, "Please read and accept the consent note first.")
    if audio is None and not (text and text.strip()):
        raise HTTPException(422, "Send a voice note or type the note.")
    data = None
    if audio is not None:
        data = await audio.read()
        if len(data) > MAX_AUDIO:
            raise HTTPException(413, "That recording is too long. Please keep notes under 90 seconds.")
    note = await service.process_note(db, t, audio=data, mime=audio.content_type if audio else "",
                                      text=text, record_date=record_date)
    del data  # audio is never persisted
    return service.ser_note(db, note)


@router.get("/notes/{note_id}")
def get_note(note_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    note = db.get(VoiceNote, note_id)
    if note is None or note.teacher_id != t.id:
        raise HTTPException(404, "Note not found.")
    return service.ser_note(db, note)


# ------------------------------------------------------------------ records

@router.get("/records")
def list_records(request: Request, status: str | None = None, t: Teacher = Depends(current_teacher),
                 db: Session = Depends(get_db)):
    start, end = service.default_window()
    q = request.query_params
    try:
        start = date.fromisoformat(q["from"]) if q.get("from") else start
        end = date.fromisoformat(q["to"]) if q.get("to") else end
    except ValueError:
        raise HTTPException(422, "Dates must be YYYY-MM-DD.")
    return [service.ser_record(r) for r in service.records_between(db, t, start, end, status)]


@router.get("/records/{record_id}")
def get_record(record_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    return service.ser_record(own_record(record_id, t, db))


@router.get("/records/{record_id}/speech")
async def record_speech(record_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    """The card read aloud in the teacher's language (mp3), so they can confirm by ear."""
    r = own_record(record_id, t, db)
    ser = service.ser_record(r)
    names = [a["name"] for a in ser["absent"]]
    flags = [f["message"] for f in ser["flags"] if f["resolution"] == "open" and f["severity"] != "info"]
    text = speech.summary_text(r, names, flags, t.language)
    try:
        audio = await speech.synthesize(text, t.language)
    except speech.SpeechError as exc:
        raise HTTPException(503, str(exc)) from exc
    service.track(db, t, "readback", language=t.language)
    db.commit()
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=600"})



@router.post("/records/{record_id}/corrections")
async def correct(record_id: str, request: Request, t: Teacher = Depends(current_teacher),
                  db: Session = Depends(get_db)):
    r = own_record(record_id, t, db)
    try:
        if request.headers.get("content-type", "").startswith("multipart/"):
            form = await request.form()
            up = form.get("audio")
            if up is None or isinstance(up, str):
                raise HTTPException(422, "Send the correction as audio, text or a patch.")
            r = await service.correct_by_audio(db, r, t, await up.read(), up.content_type or "")
        else:
            body = CorrectionIn.model_validate(await request.json())
            if body.patch is not None:
                r = service.apply_patch(db, r, body.patch)
            elif body.text:
                r = await service.correct_by_text(db, r, body.text)
            else:
                raise HTTPException(422, "Send the correction as audio, text or a patch.")
    except service.UserFacingError as exc:
        _err(exc)
    return service.ser_record(r)


@router.post("/records/{record_id}/resolve-name")
def resolve(record_id: str, body: ResolveNameIn, t: Teacher = Depends(current_teacher),
            db: Session = Depends(get_db)):
    try:
        r = service.resolve_name(db, own_record(record_id, t, db), body.spoken, body.student_id)
    except service.UserFacingError as exc:
        _err(exc)
    return service.ser_record(r)


@router.post("/records/{record_id}/confirm")
def confirm(record_id: str, body: ConfirmIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    try:
        geo.gate_class_attendance(db, t, body.lat, body.lng)
        r = service.confirm(db, own_record(record_id, t, db), body.acknowledge_warnings)
    except geo.PlaceError as exc:
        raise HTTPException(exc.status, str(exc))
    except service.UserFacingError as exc:
        _err(exc)
    return service.ser_record(r)


def _consented(t: Teacher) -> None:
    if not t.consent_at:
        raise HTTPException(403, "Please read and accept the consent note first.")


@router.get("/duty")
def duty(t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    return geo.status(db, t)


@router.post("/duty/where")
def duty_where(body: PlaceIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    _consented(t)
    return geo.where(db, t, body.lat, body.lng)


@router.post("/duty/in")
def duty_in(body: PlaceIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    _consented(t)
    try:
        return geo.punch_in(db, t, body.lat, body.lng)
    except geo.PlaceError as exc:
        raise HTTPException(exc.status, str(exc))


@router.post("/duty/out")
def duty_out(body: PlaceIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    _consented(t)
    try:
        return geo.punch_out(db, t, body.lat, body.lng)
    except geo.PlaceError as exc:
        raise HTTPException(exc.status, str(exc))


@router.post("/records/{record_id}/time-saved")
def time_saved(record_id: str, body: TimeSavedIn, t: Teacher = Depends(current_teacher),
               db: Session = Depends(get_db)):
    """Counted once per voice note, even when the note produced several class records."""
    r = own_record(record_id, t, db)
    note = db.get(VoiceNote, r.source_note_id) if r.source_note_id else None
    if note is not None and note.minutes_saved is not None:
        return {"ok": True}
    if note is not None:
        note.minutes_saved = body.minutes
    service.track(db, t, "time_saved", value=body.minutes)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ reports

def _ser_report(rep: Report) -> dict:
    return {"id": rep.id, "kind": rep.kind, "period": rep.period, "filename": rep.filename,
            "created_at": rep.created_at.isoformat(), "download_url": f"/api/reports/{rep.id}/download"}


@router.get("/reports")
def list_reports(t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    reps = db.scalars(select(Report).where(Report.teacher_id == t.id).order_by(Report.created_at.desc())
                      .limit(50)).all()
    return [_ser_report(r) for r in reps]


@router.post("/reports")
def create_report(body: ReportIn, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    return _ser_report(reports.generate(db, t, body.kind, body.month))


@router.get("/reports/{report_id}/download")
def download(report_id: str, t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    rep = db.get(Report, report_id)
    if rep is None or rep.teacher_id != t.id:
        raise HTTPException(404, "Report not found.")
    if not Path(rep.file_uri).exists():
        # Cloud Run's disk is wiped on restart: rebuild the file from the confirmed records instead of failing.
        Path(rep.file_uri).write_bytes(reports.build_bytes(db, t, rep.kind, rep.period))
    return FileResponse(rep.file_uri, filename=rep.filename)


_ = UsageEvent  # re-exported for type checkers
