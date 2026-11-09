"""School circle. Location is read only at the moment a teacher marks login, logout, or class attendance.

Nothing here follows a phone through the day. A punch keeps distance and inside/out, not a path.
"""
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .db import DutySession, SchoolBoundary, Teacher, now


class PlaceError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _tz() -> ZoneInfo:
    return ZoneInfo(config.TIMEZONE)


def as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return as_utc(dt).isoformat()


def local_date(dt: datetime):
    return as_utc(dt).astimezone(_tz()).date()


def local_today():
    return datetime.now(_tz()).date()


def parse_when(dt: datetime) -> datetime:
    """Naive datetimes are school-local (Asia/Kolkata). Aware ones are converted to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=_tz()).astimezone(timezone.utc)
    return dt.astimezone(timezone.utc)


def clock(dt: datetime) -> str:
    local = as_utc(dt).astimezone(_tz())
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{hour}:{local.strftime('%M %p').lower()}"


def boundary_dict(b: SchoolBoundary | None) -> dict | None:
    if b is None:
        return None
    return {"lat": b.lat, "lng": b.lng, "radius_m": b.radius_m, "updated_at": iso(b.updated_at)}


def public_boundary(db: Session, school_id: str) -> dict | None:
    return boundary_dict(db.get(SchoolBoundary, school_id))


def measure(b: SchoolBoundary, lat: float, lng: float) -> dict:
    distance_m = int(round(haversine_m(b.lat, b.lng, lat, lng)))
    return {"inside": distance_m <= b.radius_m, "distance_m": distance_m, "radius_m": b.radius_m}


def outside_message(place: dict, what: str) -> str:
    return (f"You are {place['distance_m']} m from the school. "
            f"{what} can be marked within {place['radius_m']} m, in and around the school.")


def gate_class_attendance(db: Session, teacher: Teacher, lat: float | None, lng: float | None) -> None:
    """When a school circle is set, confirming a class record requires a point inside it.

    Schools with no circle keep the old confirm path, so a head teacher who has not set an area
    does not lock anyone out.
    """
    b = db.get(SchoolBoundary, teacher.school_id)
    if b is None:
        return
    if lat is None or lng is None:
        raise PlaceError(400, "Share your location to confirm this record. "
                         "Class attendance can be marked only in and around the school.")
    place = measure(b, lat, lng)
    if not place["inside"]:
        raise PlaceError(403, outside_message(place, "Class attendance"))


def _open_session(db: Session, teacher_id: str) -> DutySession | None:
    return db.scalars(select(DutySession).where(DutySession.teacher_id == teacher_id,
                                                DutySession.logout_at.is_(None))).first()


MISSED_NOTE = "Logout was not marked. Hours stay at zero until the head teacher corrects them."


def close_stale(db: Session, teacher_id: str | None = None, school_id: str | None = None) -> int:
    """Close logins left open from an earlier school day, at zero hours.

    Without this a forgotten logout blocks the next morning's login and, if the teacher taps
    logout instead, books a 30-hour day. The real hours are unknown, so none are invented.
    """
    q = select(DutySession).where(DutySession.logout_at.is_(None))
    if teacher_id:
        q = q.where(DutySession.teacher_id == teacher_id)
    if school_id:
        q = q.where(DutySession.school_id == school_id)
    today = local_today()
    closed = 0
    for row in db.scalars(q):
        if local_date(row.login_at) < today:
            row.logout_at = row.login_at
            row.missed_logout = True
            row.note = MISSED_NOTE
            closed += 1
    if closed:
        db.commit()
    return closed


def missed(db: Session, school_id: str | None = None, teacher_id: str | None = None, days: int = 14) -> list[DutySession]:
    """Missed logouts the head teacher has not corrected yet, newest first."""
    since = local_today() - timedelta(days=days)
    q = select(DutySession).where(DutySession.missed_logout.is_(True), DutySession.edited.is_(False))
    if school_id:
        q = q.where(DutySession.school_id == school_id)
    if teacher_id:
        q = q.where(DutySession.teacher_id == teacher_id)
    return [r for r in db.scalars(q.order_by(DutySession.login_at.desc())) if local_date(r.login_at) >= since]


def hours_of(s: DutySession) -> float:
    end = as_utc(s.logout_at) if s.logout_at else now()
    hours = (end - as_utc(s.login_at)).total_seconds() / 3600
    return round(max(0.0, hours), 2)


def ser_duty(s: DutySession, teacher_name: str) -> dict:
    return {"id": s.id, "teacher_id": s.teacher_id, "teacher_name": teacher_name, "school_id": s.school_id,
            "login_at": iso(s.login_at), "logout_at": iso(s.logout_at) if s.logout_at else None,
            "hours": hours_of(s), "open": s.logout_at is None, "inside": s.login_inside,
            "distance_m": s.login_distance_m, "source": s.source, "edited": s.edited, "missed_logout": bool(s.missed_logout),
            "day": local_date(s.login_at).isoformat(), "note": s.note}


def status(db: Session, teacher: Teacher) -> dict:
    close_stale(db, teacher_id=teacher.id)
    b = db.get(SchoolBoundary, teacher.school_id)
    rows = list(db.scalars(select(DutySession).where(DutySession.teacher_id == teacher.id)
                           .order_by(DutySession.login_at.desc())))
    today = local_today()
    todays = [s for s in rows if local_date(s.login_at) == today]
    open_row = next((s for s in rows if s.logout_at is None), None)
    return {"boundary": boundary_dict(b),
            "open": ser_duty(open_row, teacher.name) if open_row else None,
            "today": [ser_duty(s, teacher.name) for s in todays],
            "hours_today": round(sum(hours_of(s) for s in todays), 2),
            "missed": [ser_duty(s, teacher.name) for s in missed(db, teacher_id=teacher.id, days=7)]}


def where(db: Session, teacher: Teacher, lat: float, lng: float) -> dict:
    b = db.get(SchoolBoundary, teacher.school_id)
    body = status(db, teacher)
    body["place"] = measure(b, lat, lng) if b else None
    return body


def _require_inside(db: Session, teacher: Teacher, lat: float, lng: float, what: str) -> tuple[SchoolBoundary, dict]:
    b = db.get(SchoolBoundary, teacher.school_id)
    if b is None:
        raise PlaceError(409, "The head teacher has not set the school area yet, so login and logout cannot be marked.")
    place = measure(b, lat, lng)
    if not place["inside"]:
        raise PlaceError(403, outside_message(place, what))
    return b, place


def punch_in(db: Session, teacher: Teacher, lat: float, lng: float) -> dict:
    b, place = _require_inside(db, teacher, lat, lng, "Login")
    close_stale(db, teacher_id=teacher.id)
    open_row = _open_session(db, teacher.id)
    if open_row is not None:
        raise PlaceError(409, f"You are already logged in since {clock(open_row.login_at)}.")
    row = DutySession(teacher_id=teacher.id, school_id=teacher.school_id, login_at=now(),
                      login_inside=True, login_distance_m=place["distance_m"], source="gate")
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"session": ser_duty(row, teacher.name), "place": place, "boundary": boundary_dict(b)}


def punch_out(db: Session, teacher: Teacher, lat: float, lng: float) -> dict:
    b, place = _require_inside(db, teacher, lat, lng, "Logout")
    close_stale(db, teacher_id=teacher.id)
    row = _open_session(db, teacher.id)
    if row is None:
        raise PlaceError(409, "You are not logged in today, so there is no logout to mark. "
                         "If you forgot to log in, ask the head teacher to add the hours.")
    row.logout_at = now()
    db.commit()
    db.refresh(row)
    return {"session": ser_duty(row, teacher.name), "place": place, "boundary": boundary_dict(b)}


def check_span(login_at: datetime, logout_at: datetime | None) -> None:
    if logout_at is not None and logout_at <= login_at:
        raise PlaceError(422, "Logout has to be after login.")
    if logout_at is not None and logout_at - login_at > timedelta(hours=16):
        raise PlaceError(422, "A school day here is at most 16 hours. Check the times.")
    skew = now() + timedelta(minutes=5)
    if login_at > skew:
        raise PlaceError(422, "Login time cannot be in the future.")
    if logout_at is not None and logout_at > skew:
        raise PlaceError(422, "Logout time cannot be in the future.")
