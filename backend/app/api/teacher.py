"""Teacher-facing routes: login by one-time code, capture, records, reports, delete-my-data."""
import logging
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import config, followup, service, speech
from ..db import (Correction, DailyRecord, LoginCode, Report, Student, Teacher, UsageEvent, ValidationFlag,
                  VoiceNote, get_db, now)
from ..reports import generate as reports
from ..schemas import ConfirmIn, CorrectionIn, PhoneIn, ReportIn, ResolveNameIn, TimeSavedIn, VerifyIn
from ..security import code_hash, make_token, new_code, phone_hash, valid_phone
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
    show = config.DEV_MODE or body.phone.strip()[-10:] in config.DEMO_PHONES
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
    for k in t.classes:
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


@router.get("/followup")
def follow_up(t: Teacher = Depends(current_teacher), db: Session = Depends(get_db)):
    """Dropout early-warning: children with a run of absences or low attendance in the last 30 days."""
    items = followup.teacher_concerns(db, t, service.today())
    return {"window_days": followup.WINDOW_DAYS, "streak_min": followup.STREAK_MIN, "pct_min": followup.PCT_MIN,
            "children": [c.as_dict() for c in items]}


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
        r = service.confirm(db, own_record(record_id, t, db), body.acknowledge_warnings)
    except service.UserFacingError as exc:
        _err(exc)
    return service.ser_record(r)


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
