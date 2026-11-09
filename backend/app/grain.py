"""Food-grain ledger for the mid-day meal.

Confirmed meals become kilos at the PM POSHAN gram norm (100 g in classes 1–5, 150 g in classes 6–8).
The school can change those grams. Opening stock and grain received are figures the teacher typed.
Closing is shown only when an opening figure exists, so a blank first line never looks like an empty store.
Cooking cost is not calculated here: state rates differ and this ledger counts food grain only.
"""
import calendar
import re
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import DailyRecord, GrainMovement, GrainNorm, Teacher, now
from .service import UserFacingError, class_label, today

PRIMARY_G = 100
UPPER_G = 150
SOURCE = (
    "National PM POSHAN food-grain norm is 100 g per child per day in classes 1–5 and 150 g in classes 6–8. "
    "The kilos here use the grams saved for this school. Rice or wheat, not pulses, vegetables or oil."
)
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")


def grams_for(grade: int, primary_g: int, upper_g: int) -> int:
    return primary_g if grade <= 5 else upper_g


def _q(n: Decimal) -> float:
    return float(n.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def kg_of(meals: int, grams: int) -> float:
    return _q(Decimal(meals) * Decimal(grams) / Decimal(1000))


def add_kg(*parts: float) -> float:
    total = sum((Decimal(str(p)) for p in parts), Decimal(0))
    return _q(total)


def parse_month(month: str) -> tuple[date, date]:
    m = _MONTH.match((month or "").strip())
    if not m:
        raise UserFacingError(422, "Month should look like 2026-11.")
    year, mon = int(m.group(1)), int(m.group(2))
    if mon < 1 or mon > 12 or year < 2020 or year > 2100:
        raise UserFacingError(422, "That month is not valid.")
    last = calendar.monthrange(year, mon)[1]
    return date(year, mon, 1), date(year, mon, last)


def _norms(db: Session, school_id: str) -> tuple[int, int]:
    row = db.get(GrainNorm, school_id)
    if row is None:
        return PRIMARY_G, UPPER_G
    return row.primary_g, row.upper_g


def _note(note: str | None) -> str | None:
    if note is None:
        return None
    text = note.strip()
    if len(text) > 160:
        raise UserFacingError(422, "Keep the note under 160 characters.")
    return text or None


def _store_kg(kg: float) -> float:
    if kg != kg or kg in (float("inf"), float("-inf")):
        raise UserFacingError(422, "Enter the kilos of food grain.")
    return _q(Decimal(str(kg)))


def _check_day(day: date) -> None:
    if day > today():
        raise UserFacingError(400, "That date is in the future.")
    if day.year < 2020:
        raise UserFacingError(400, "That date is too far back.")


def stock(db: Session, t: Teacher, month: str) -> dict:
    """Confirmed meals of every teacher at this school, plus the school's opening balance and deliveries.

    The store is one per school, so what is used has to be counted across all its teachers.
    """
    start, end = parse_month(month)
    primary_g, upper_g = _norms(db, t.school_id)
    staff = select(Teacher.id).where(Teacher.school_id == t.school_id)
    recs = db.scalars(select(DailyRecord).where(
        DailyRecord.teacher_id.in_(staff), DailyRecord.status == "confirmed",
        DailyRecord.record_date >= start, DailyRecord.record_date <= end)).all()
    by: dict[str, dict] = {}
    for r in recs:
        meals = r.meals_served or 0
        if meals <= 0:
            continue
        k = r.klass
        row = by.setdefault(k.id, {"grade": k.grade, "section": k.section, "label": class_label(k),
                                   "meals": 0, "grams": grams_for(k.grade, primary_g, upper_g), "kg": Decimal(0)})
        row["meals"] += meals
        row["kg"] += Decimal(meals) * Decimal(row["grams"]) / Decimal(1000)
    classes = []
    for row in sorted(by.values(), key=lambda x: (x["grade"], x["section"] or "")):
        row["kg"] = _q(row["kg"])
        classes.append(row)
    consumed = add_kg(*(c["kg"] for c in classes)) if classes else 0.0
    movements = db.scalars(select(GrainMovement).where(
        GrainMovement.school_id == t.school_id, GrainMovement.day >= start, GrainMovement.day <= end)
        .order_by(GrainMovement.day, GrainMovement.created_at)).all()
    openings = [m for m in movements if m.kind == "opening"]
    opening = openings[-1] if openings else None
    received = add_kg(*(m.kg for m in movements if m.kind == "received")) if any(
        m.kind == "received" for m in movements) else 0.0
    opening_kg = _q(Decimal(str(opening.kg))) if opening else None
    closing = None if opening_kg is None else add_kg(opening_kg, received, -consumed)
    return {
        "month": f"{start.year:04d}-{start.month:02d}",
        "norms": {"primary_g": primary_g, "upper_g": upper_g, "source": SOURCE},
        "opening_kg": opening_kg,
        "received_kg": received,
        "consumed_kg": consumed,
        "closing_kg": closing,
        "classes": classes,
        "movements": [{"id": m.id, "day": m.day.isoformat(), "kind": m.kind,
                       "kg": _q(Decimal(str(m.kg))), "note": m.note} for m in movements],
    }


def add_received(db: Session, t: Teacher, day: date, kg: float, note: str | None) -> dict:
    _check_day(day)
    db.add(GrainMovement(school_id=t.school_id, teacher_id=t.id, day=day, kind="received",
                         kg=_store_kg(kg), note=_note(note)))
    db.commit()
    return stock(db, t, day.strftime("%Y-%m"))


def set_opening(db: Session, t: Teacher, month: str, kg: float, note: str | None) -> dict:
    start, end = parse_month(month)
    rows = db.scalars(select(GrainMovement).where(
        GrainMovement.school_id == t.school_id, GrainMovement.kind == "opening",
        GrainMovement.day >= start, GrainMovement.day <= end).order_by(GrainMovement.created_at)).all()
    kept = rows[-1] if rows else None
    for extra in rows[:-1]:
        db.delete(extra)
    q, text = _store_kg(kg), _note(note)
    if kept is None:
        db.add(GrainMovement(school_id=t.school_id, teacher_id=t.id, day=start, kind="opening", kg=q, note=text))
    else:
        kept.teacher_id, kept.day, kept.kg, kept.note = t.id, start, q, text
    db.commit()
    return stock(db, t, month)


def set_norms(db: Session, t: Teacher, primary_g: int, upper_g: int, month: str) -> dict:
    row = db.get(GrainNorm, t.school_id)
    if row is None:
        db.add(GrainNorm(school_id=t.school_id, primary_g=primary_g, upper_g=upper_g))
    else:
        row.primary_g, row.upper_g, row.updated_at = primary_g, upper_g, now()
    db.commit()
    return stock(db, t, month)


def remove(db: Session, t: Teacher, movement_id: str) -> dict:
    row = db.get(GrainMovement, movement_id)
    if row is None or row.school_id != t.school_id:
        raise UserFacingError(404, "That food-grain entry was not found.")
    month = row.day.strftime("%Y-%m")
    db.delete(row)
    db.commit()
    return stock(db, t, month)
