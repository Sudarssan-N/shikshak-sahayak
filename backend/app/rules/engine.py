"""Deterministic validation rules engine: the model extracts, the rules judge. Pure functions over a context, so
every rule is unit-testable with a pass and a fail fixture."""
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import yaml

RULES = {r["id"]: r for r in yaml.safe_load((Path(__file__).parent / "rules.yaml").read_text())}
LABELS = {"present": "the number present", "meals_served": "meals served", "absent_names": "the absent names"}


@dataclass
class Ctx:
    klass: str                      # "Class 3" / "Class 3-A"
    record_date: date | None
    today: date
    enrolled: int | None
    present: int | None
    meals_served: int | None
    absent_ids: list[str]
    absent_count_spoken: int | None
    unresolved: list[dict]          # {"spoken", "candidates": [{"name","roll_no"}]}
    lessons: list[dict]
    field_confidence: dict[str, float] = field(default_factory=dict)
    confirmed_same_day: bool = False          # another confirmed record for class+date exists
    last_lesson_no: int | None = None         # from the last confirmed record before this date
    last_record_date: date | None = None      # last confirmed record before this date


@dataclass
class FlagOut:
    rule_id: str
    severity: str
    field: str | None
    message: str


def _flag(rule_id: str, **kw) -> FlagOut:
    r = RULES[rule_id]
    fld = r.get("field")
    if fld and "{" in fld:
        fld = fld.format(**kw)
    return FlagOut(rule_id.rstrip("b"), r["severity"], fld, r["message"].format(**kw))


def _fmt(d: date) -> str:
    return d.strftime("%a %d %b")


def _lesson_no(lessons: list[dict]) -> int | None:
    nums = [int(m.group()) for ls in lessons for m in [re.search(r"\d+", ls.get("lesson_ref") or "")] if m]
    return max(nums) if nums else None


def validate(c: Ctx) -> list[FlagOut]:
    out: list[FlagOut] = []
    named_absent = len(c.absent_ids) + len(c.unresolved)

    # V11: the one number every register needs
    if c.present is None:
        out.append(_flag("V11", klass=c.klass))
    # V1
    if c.present is not None and c.enrolled is not None and c.enrolled > 0 and c.present > c.enrolled:
        out.append(_flag("V1", present=c.present, klass=c.klass, enrolled=c.enrolled))
    # V2: present + absent = enrolled, when all three are known
    absent = named_absent if named_absent else c.absent_count_spoken
    if c.present is not None and absent is not None and c.enrolled and c.present <= c.enrolled \
            and c.present + absent != c.enrolled:
        out.append(_flag("V2", present=c.present, absent=absent, sum=c.present + absent, klass=c.klass,
                         enrolled=c.enrolled))
    # V12: spoken absent count disagrees with names given
    if c.absent_count_spoken is not None and named_absent and c.absent_count_spoken != named_absent:
        out.append(_flag("V12", absent_count=c.absent_count_spoken, named=named_absent, klass=c.klass))
    # V3
    if c.meals_served is not None and c.present is not None and c.meals_served > c.present:
        out.append(_flag("V3", meals_served=c.meals_served, present=c.present, klass=c.klass))
    # V4: every absent name resolved
    for u in c.unresolved:
        cands = u.get("candidates") or []
        if len(cands) > 1:
            q = "Which one: " + " or ".join(f"{x['name']} (roll {x['roll_no']})" for x in cands) + "?"
        elif len(cands) == 1:
            q = f"Did you mean {cands[0]['name']} (roll {cands[0]['roll_no']})?"
        else:
            q = "Please say the name again or remove it."
        out.append(_flag("V4", spoken=u["spoken"], klass=c.klass, question=q))
    # V5, V6, V6b, V8: date checks
    if c.record_date:
        if c.confirmed_same_day:
            out.append(_flag("V5", klass=c.klass, date=_fmt(c.record_date)))
        if c.record_date > c.today:
            out.append(_flag("V6", date=_fmt(c.record_date)))
        else:
            reason = None
            if c.record_date.weekday() == 6:
                reason = "a Sunday"
            elif (c.today - c.record_date).days > RULES["V6b"]["params"]["max_days_back"]:
                reason = f"{(c.today - c.record_date).days} days ago"
            if reason:
                out.append(_flag("V6b", date=_fmt(c.record_date), reason=reason))
        if c.last_record_date and c.last_record_date < c.record_date <= c.today:
            d = c.last_record_date + timedelta(days=1)
            while d < c.record_date:
                if d.weekday() != 6:
                    out.append(_flag("V8", klass=c.klass, gap_day=_fmt(d)))
                    break
                d += timedelta(days=1)
    # V7: lesson going backwards
    now_no = _lesson_no(c.lessons)
    if now_no is not None and c.last_lesson_no is not None and now_no < c.last_lesson_no:
        out.append(_flag("V7", klass=c.klass, last=c.last_lesson_no, now=now_no))
    # V9: plausibility
    max_size = RULES["V9"]["params"]["max_class_size"]
    if c.enrolled == 0:
        out.append(_flag("V9", reason=f"{c.klass} has no students in the roster yet. Ask your pilot lead to add it."))
    elif c.enrolled and c.enrolled > max_size:
        out.append(_flag("V9", reason=f"{c.klass} has {c.enrolled} enrolled, more than {max_size}. Please check the roster."))
    elif c.present == 0 and c.enrolled:
        out.append(_flag("V9", reason=f"0 present in {c.klass}. Was the school closed?"))
    # V10: low-confidence fields
    min_conf = RULES["V10"]["params"]["min_confidence"]
    for f, conf in c.field_confidence.items():
        if f in LABELS and conf < min_conf:
            value = {"present": c.present, "meals_served": c.meals_served}.get(f, "the list")
            if value is not None:
                out.append(_flag("V10", field=f if f != "absent_names" else "absent", label=LABELS[f], value=value))
    return out
