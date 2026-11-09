"""Head-teacher desk: class lists, login/logout hours, and the school circle.

This key still cannot open children's daily attendance, meals, or voice notes.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import geo, service
from ..db import ClassSection, DutySession, SchoolBoundary, Student, Teacher, get_db, now
from ..schemas import BoundaryIn, DutyWrite, NewClass, NewStudent, StudentPatch
from ..security import decrypt_name, encrypt_name
from .deps import require_admin

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


def _teacher(db: Session, teacher_id: str) -> Teacher:
    t = db.get(Teacher, teacher_id)
    if t is None:
        raise HTTPException(404, "Teacher not found.")
    return t


def _class(t: Teacher, class_id: str) -> ClassSection:
    k = next((c for c in t.classes if c.id == class_id), None)
    if k is None:
        raise HTTPException(404, "That class is not on this teacher's list.")
    return k


def _student_out(s: Student) -> dict:
    return {"id": s.id, "roll_no": s.roll_no, "name": decrypt_name(s.name_enc), "active": s.active}


def _names(db: Session) -> dict[str, str]:
    return {t.id: t.name for t in db.scalars(select(Teacher))}


# ---------------------------------------------------------------- schools and the circle

@router.get("/schools")
def list_schools(db: Session = Depends(get_db)):
    bounds = {b.school_id: b for b in db.scalars(select(SchoolBoundary))}
    grouped: dict[str, dict] = {}
    for t in db.scalars(select(Teacher)):
        s = t.school
        row = grouped.get(s.id)
        if row is None:
            row = {"id": s.id, "name": s.name, "state": s.state, "udise_code": s.udise_code,
                   "boundary": geo.boundary_dict(bounds.get(s.id)), "teachers": []}
            grouped[s.id] = row
        row["teachers"].append({"id": t.id, "name": t.name, "phone_last4": t.phone_last4,
                                 "classes": [service.ser_class(k) for k in t.classes]})
    out = list(grouped.values())
    for row in out:
        row["teachers"].sort(key=lambda x: x["name"])
    out.sort(key=lambda x: (x["name"].lower(), x["state"]))
    return out


@router.put("/schools/{school_id}/boundary")
def set_boundary(school_id: str, body: BoundaryIn, db: Session = Depends(get_db)):
    if not db.scalars(select(Teacher).where(Teacher.school_id == school_id)).first():
        raise HTTPException(404, "School not found.")
    b = db.get(SchoolBoundary, school_id)
    if b is None:
        b = SchoolBoundary(school_id=school_id, lat=body.lat, lng=body.lng, radius_m=body.radius_m)
        db.add(b)
    else:
        b.lat, b.lng, b.radius_m = body.lat, body.lng, body.radius_m
        b.updated_at = now()
    db.commit()
    db.refresh(b)
    return geo.boundary_dict(b)


@router.delete("/schools/{school_id}/boundary")
def clear_boundary(school_id: str, db: Session = Depends(get_db)):
    b = db.get(SchoolBoundary, school_id)
    if b is not None:
        db.delete(b)
        db.commit()
    return {"cleared": True}


# ---------------------------------------------------------------- class people

@router.post("/teachers/{teacher_id}/classes")
def add_class(teacher_id: str, body: NewClass, db: Session = Depends(get_db)):
    t = _teacher(db, teacher_id)
    sec = (body.section or "").strip().upper() or None
    if any(k.grade == body.grade and (k.section or None) == sec for k in t.classes):
        label = f"{body.grade}{'-' + sec if sec else ''}"
        raise HTTPException(409, f"Class {label} is already on this teacher's list.")
    k = ClassSection(teacher_id=t.id, grade=body.grade, section=sec)
    db.add(k)
    db.commit()
    db.refresh(k)
    return service.ser_class(k)


@router.get("/teachers/{teacher_id}/classes/{class_id}/students")
def list_students(teacher_id: str, class_id: str, db: Session = Depends(get_db)):
    k = _class(_teacher(db, teacher_id), class_id)
    students = sorted(k.students, key=lambda s: (not s.active, s.roll_no))
    return {"class": service.ser_class(k), "students": [_student_out(s) for s in students]}


@router.post("/teachers/{teacher_id}/classes/{class_id}/students")
def add_student(teacher_id: str, class_id: str, body: NewStudent, db: Session = Depends(get_db)):
    k = _class(_teacher(db, teacher_id), class_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Enter the child's name.")
    existing = next((s for s in k.students if s.roll_no == body.roll_no), None)
    if existing is not None and existing.active:
        raise HTTPException(409, f"Roll {body.roll_no} is already {decrypt_name(existing.name_enc)} in this class.")
    if existing is not None:
        existing.name_enc = encrypt_name(name)
        existing.active = True
        row = existing
    else:
        row = Student(roll_no=body.roll_no, name_enc=encrypt_name(name), active=True)
        k.students.append(row)
    db.commit()
    db.refresh(row)
    return _student_out(row)


@router.patch("/teachers/{teacher_id}/classes/{class_id}/students/{student_id}")
def patch_student(teacher_id: str, class_id: str, student_id: str, body: StudentPatch,
                  db: Session = Depends(get_db)):
    k = _class(_teacher(db, teacher_id), class_id)
    row = next((s for s in k.students if s.id == student_id), None)
    if row is None:
        raise HTTPException(404, "That child is not in this class.")
    if body.roll_no is None and body.name is None and body.active is None:
        raise HTTPException(422, "Nothing to change.")
    if body.roll_no is not None and body.roll_no != row.roll_no:
        taken = next((s for s in k.students if s.roll_no == body.roll_no and s.id != row.id and s.active), None)
        if taken is not None:
            raise HTTPException(409, f"Roll {body.roll_no} is already {decrypt_name(taken.name_enc)} in this class.")
        row.roll_no = body.roll_no
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "Enter the child's name.")
        row.name_enc = encrypt_name(name)
    if body.active is not None:
        row.active = body.active
    db.commit()
    db.refresh(row)
    return _student_out(row)


# ---------------------------------------------------------------- login / logout hours

def _span(body: DutyWrite):
    login_at = geo.parse_when(body.login_at)
    logout_at = geo.parse_when(body.logout_at) if body.logout_at else None
    try:
        geo.check_span(login_at, logout_at)
    except geo.PlaceError as exc:
        raise HTTPException(exc.status, str(exc))
    return login_at, logout_at


@router.get("/duty")
def list_duty(school_id: str | None = None, teacher_id: str | None = None,
              day_from: date | None = Query(None, alias="from"),
              day_to: date | None = Query(None, alias="to"), db: Session = Depends(get_db)):
    start = day_from or geo.local_today()
    end = day_to or start
    if end < start:
        raise HTTPException(422, "The end date is before the start date.")
    if (end - start).days > 62:
        raise HTTPException(422, "Pick a range of 62 days or less.")
    geo.close_stale(db, teacher_id=teacher_id, school_id=school_id)
    q = select(DutySession)
    if school_id:
        q = q.where(DutySession.school_id == school_id)
    if teacher_id:
        q = q.where(DutySession.teacher_id == teacher_id)
    rows = [s for s in db.scalars(q.order_by(DutySession.login_at.desc()))
            if start <= geo.local_date(s.login_at) <= end]
    names = _names(db)
    closed = [s for s in rows if s.logout_at is not None]
    return {"from": start.isoformat(), "to": end.isoformat(),
            "sessions": [geo.ser_duty(s, names.get(s.teacher_id, "Teacher")) for s in rows],
            "teachers": len({s.teacher_id for s in rows}),
            "open_now": sum(1 for s in rows if s.logout_at is None),
            "hours_closed": round(sum(geo.hours_of(s) for s in closed), 2),
            # Shown whatever the date range, so a forgotten logout is never hidden behind "today".
            "missed": [geo.ser_duty(s, names.get(s.teacher_id, "Teacher"))
                       for s in geo.missed(db, school_id=school_id, teacher_id=teacher_id)]}


@router.post("/duty")
def create_duty(body: DutyWrite, db: Session = Depends(get_db)):
    if not body.teacher_id:
        raise HTTPException(422, "Choose the teacher these hours belong to.")
    t = _teacher(db, body.teacher_id)
    geo.close_stale(db, teacher_id=t.id)
    if db.scalars(select(DutySession).where(DutySession.teacher_id == t.id, DutySession.logout_at.is_(None))).first():
        raise HTTPException(409, "This teacher is still logged in. Set a logout on the open row first.")
    login_at, logout_at = _span(body)
    row = DutySession(teacher_id=t.id, school_id=t.school_id, login_at=login_at, logout_at=logout_at,
                      source="admin", edited=True, note=body.note.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return geo.ser_duty(row, t.name)


@router.patch("/duty/{session_id}")
def patch_duty(session_id: str, body: DutyWrite, db: Session = Depends(get_db)):
    row = db.get(DutySession, session_id)
    if row is None:
        raise HTTPException(404, "That login row was not found.")
    t = db.get(Teacher, row.teacher_id)
    if body.logout_at is None and db.scalars(select(DutySession).where(
            DutySession.teacher_id == row.teacher_id, DutySession.logout_at.is_(None),
            DutySession.id != row.id)).first():
        raise HTTPException(409, "This teacher already has an open login. Set a logout time.")
    login_at, logout_at = _span(body)
    row.login_at, row.logout_at = login_at, logout_at
    row.edited = True
    row.note = body.note.strip()
    db.commit()
    db.refresh(row)
    return geo.ser_duty(row, t.name if t else "Teacher")
