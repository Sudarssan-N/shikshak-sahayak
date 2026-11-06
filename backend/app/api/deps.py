from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from .. import config
from ..db import DailyRecord, Teacher, get_db
from ..security import read_token


def current_teacher(authorization: str | None = Header(None), token: str | None = Query(None),
                    db: Session = Depends(get_db)) -> Teacher:
    raw = token
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:]
    tid = read_token(raw) if raw else None
    t = db.get(Teacher, tid) if tid else None
    if t is None:
        raise HTTPException(401, "Please log in again.")
    return t


def require_admin(x_admin_key: str | None = Header(None)) -> None:
    if not config.ADMIN_KEY or x_admin_key != config.ADMIN_KEY:
        raise HTTPException(401, "Pilot-lead key not accepted.")


def own_record(record_id: str, teacher: Teacher, db: Session) -> DailyRecord:
    r = db.get(DailyRecord, record_id)
    if r is None or r.teacher_id != teacher.id:
        raise HTTPException(404, "Record not found.")
    return r
