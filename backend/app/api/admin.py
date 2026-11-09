"""Pilot-lead routes. The key can onboard teachers and load rosters. It cannot read daily records."""
import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import geo, service
from ..db import ClassSection, School, Student, Teacher, get_db
from ..schemas import NewTeacher
from ..security import encrypt_name, normalize_phone, phone_hash, valid_phone
from .deps import require_admin

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


def _ser(db: Session, t: Teacher) -> dict:
    return {"id": t.id, "name": t.name, "phone_last4": t.phone_last4, "language": t.language,
            "school": {"id": t.school.id, "name": t.school.name, "state": t.school.state,
                       "udise_code": t.school.udise_code, "boundary": geo.public_boundary(db, t.school_id)},
            "classes": [service.ser_class(k) for k in t.classes],
            "consent_at": t.consent_at.isoformat() if t.consent_at else None,
            "roster_size": sum(1 for k in t.classes for s in k.students if s.active),
            "created_at": t.created_at.isoformat()}


@router.get("/teachers")
def list_teachers(db: Session = Depends(get_db)):
    return [_ser(db, t) for t in db.scalars(select(Teacher).order_by(Teacher.created_at.desc()))]


def _school_for(db: Session, body: NewTeacher) -> School:
    """Join a chosen school, or the one with the same UDISE code; otherwise make a new one.

    Names alone are never matched: "Primary School Rampur" repeats across a state.
    """
    if body.school_id:
        s = db.get(School, body.school_id)
        if s is None:
            raise HTTPException(404, "That school is not on the list.")
        return s
    udise = (body.udise_code or "").strip() or None
    if udise:
        s = db.scalars(select(School).where(School.udise_code == udise)).first()
        if s is not None:
            return s
    name, state = (body.school_name or "").strip(), (body.state or "").strip()
    if not name or not state:
        raise HTTPException(422, "Enter the school name and state, or pick a school already on the list.")
    return School(name=name, state=state, udise_code=udise)


@router.post("/teachers")
def create_teacher(body: NewTeacher, db: Session = Depends(get_db)):
    if not valid_phone(body.phone):
        raise HTTPException(422, "Phone must be a 10-digit Indian mobile number.")
    ph = phone_hash(body.phone)
    if db.scalars(select(Teacher).where(Teacher.phone_hash == ph)).first():
        raise HTTPException(409, "A teacher with this phone number is already registered.")
    seen = set()
    for c in body.classes:
        key = (c.grade, (c.section or "").upper() or None)
        if key in seen:
            raise HTTPException(422, f"Class {c.grade}{'-' + c.section if c.section else ''} is listed twice.")
        seen.add(key)
    school = _school_for(db, body)
    t = Teacher(name=body.name.strip(), phone_hash=ph, phone_last4=normalize_phone(body.phone)[-4:],
                language=body.language, school=school)
    t.classes = [ClassSection(grade=g, section=s) for g, s in sorted(seen, key=lambda x: (x[0], x[1] or ""))]
    db.add(t)
    db.commit()
    return _ser(db, t)


@router.post("/teachers/{teacher_id}/roster")
async def upload_roster(teacher_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """CSV columns roll_no,name,grade,section. Re-uploading replaces the class roster (students not in the new file
    are marked inactive, so past records stay readable). Invalid rows are returned with the reason."""
    t = db.get(Teacher, teacher_id)
    if t is None:
        raise HTTPException(404, "Teacher not found.")
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "Please save the roster as a UTF-8 CSV file.")
    lines = text.splitlines()
    reader = csv.DictReader(io.StringIO(text))
    fields = [f.strip().lower() for f in (reader.fieldnames or [])]
    if not {"roll_no", "name", "grade"} <= set(fields):
        raise HTTPException(422, "The first row must be: roll_no,name,grade,section")
    reader.fieldnames = fields
    classes = {(k.grade, (k.section or "").upper()): k for k in t.classes}
    accepted: dict[str, dict[int, str]] = {}
    rejected = []
    for i, row in enumerate(reader, start=2):
        raw_line = lines[i - 1] if i - 1 < len(lines) else ""
        name = (row.get("name") or "").strip()
        try:
            roll = int((row.get("roll_no") or "").strip())
            grade = int((row.get("grade") or "").strip())
        except ValueError:
            rejected.append({"row": i, "raw": raw_line, "reason": "roll_no and grade must be numbers"})
            continue
        sec = (row.get("section") or "").strip().upper()
        k = classes.get((grade, sec)) or (classes.get((grade, "")) if not sec else None)
        if not name:
            rejected.append({"row": i, "raw": raw_line, "reason": "name is empty"})
        elif len(name) > 80:
            rejected.append({"row": i, "raw": raw_line, "reason": "name is longer than 80 characters"})
        elif k is None:
            rejected.append({"row": i, "raw": raw_line,
                             "reason": f"Class {grade}{'-' + sec if sec else ''} is not one of this teacher's classes"})
        elif roll in accepted.get(k.id, {}):
            rejected.append({"row": i, "raw": raw_line, "reason": f"roll_no {roll} appears twice in this class"})
        else:
            accepted.setdefault(k.id, {})[roll] = name
    for k in t.classes:
        rows = accepted.get(k.id)
        if not rows:
            continue
        existing = {s.roll_no: s for s in k.students}
        for s in k.students:
            s.active = s.roll_no in rows
        for roll, name in rows.items():
            if roll in existing:
                existing[roll].name_enc = encrypt_name(name)
                existing[roll].active = True
            else:
                k.students.append(Student(roll_no=roll, name_enc=encrypt_name(name)))
    db.commit()
    return {"accepted": sum(len(v) for v in accepted.values()), "rejected": rejected,
            "classes": [service.ser_class(k) for k in t.classes]}
