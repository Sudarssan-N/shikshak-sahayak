"""Dropout early-warning: children who keep missing school, from the teacher's own confirmed records.

Deterministic and explainable. A child is flagged when either holds:
- absent on the last STREAK_MIN recorded school days for their class in a row, or
- attendance below PCT_MIN over the window, once the class has at least MIN_DAYS recorded days.
Only confirmed records count, so drafts never raise an alarm.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import ClassSection, DailyRecord, Teacher
from .security import decrypt_name

STREAK_MIN = 3
PCT_MIN = 75
MIN_DAYS = 5
WINDOW_DAYS = 30


@dataclass
class Concern:
    student_id: str
    name: str
    roll_no: int
    class_id: str
    grade: int
    section: str | None
    streak: int  # consecutive recorded days absent, counting back from the latest
    days_absent: int
    days_recorded: int
    attendance_pct: int
    last_present: date | None
    reasons: list[str]

    def as_dict(self) -> dict:
        return {"student_id": self.student_id, "name": self.name, "roll_no": self.roll_no,
                "class_id": self.class_id, "grade": self.grade, "section": self.section,
                "streak": self.streak, "days_absent": self.days_absent, "days_recorded": self.days_recorded,
                "attendance_pct": self.attendance_pct,
                "last_present": self.last_present.isoformat() if self.last_present else None,
                "reasons": self.reasons}


def _class_records(db: Session, k: ClassSection, start: date, end: date) -> list[DailyRecord]:
    """One confirmed record per day (the latest version), oldest first."""
    rows = db.scalars(select(DailyRecord).where(
        DailyRecord.class_id == k.id, DailyRecord.status == "confirmed",
        DailyRecord.record_date >= start, DailyRecord.record_date <= end)
        .order_by(DailyRecord.record_date, DailyRecord.confirmed_at)).all()
    by_day: dict[date, DailyRecord] = {}
    for r in rows:
        by_day[r.record_date] = r  # later confirmations win
    return [by_day[d] for d in sorted(by_day)]


def class_concerns(db: Session, k: ClassSection, end: date, window_days: int = WINDOW_DAYS) -> list[Concern]:
    recs = _class_records(db, k, end - timedelta(days=window_days), end)
    if not recs:
        return []
    out: list[Concern] = []
    for s in k.students:
        if not s.active:
            continue
        absent_flags = [s.id in (r.absent_student_ids or []) for r in recs]
        days_absent = sum(absent_flags)
        if days_absent == 0:
            continue
        streak = 0
        for a in reversed(absent_flags):
            if not a:
                break
            streak += 1
        pct = round(100 * (len(recs) - days_absent) / len(recs))
        last_present = next((r.record_date for r, a in zip(reversed(recs), reversed(absent_flags)) if not a), None)
        reasons = []
        if streak >= STREAK_MIN:
            reasons.append(f"absent the last {streak} school days")
        if len(recs) >= MIN_DAYS and pct < PCT_MIN:
            reasons.append(f"came {pct}% of days this month")
        if reasons:
            out.append(Concern(s.id, decrypt_name(s.name_enc), s.roll_no, k.id, k.grade, k.section, streak,
                               days_absent, len(recs), pct, last_present, reasons))
    out.sort(key=lambda c: (-c.streak, c.attendance_pct, c.roll_no))
    return out


def teacher_concerns(db: Session, t: Teacher, end: date, window_days: int = WINDOW_DAYS) -> list[Concern]:
    out: list[Concern] = []
    for k in t.classes:
        out.extend(class_concerns(db, k, end, window_days))
    out.sort(key=lambda c: (-c.streak, c.attendance_pct))
    return out
