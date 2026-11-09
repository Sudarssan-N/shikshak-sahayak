"""Register and report generation from CONFIRMED records only. Days without a confirmed record are left blank,
never filled with a guess. Layout labels and CSV column order come from templates/<state>/template.yaml."""
import calendar
import csv
import io
from datetime import date, datetime
from pathlib import Path

import yaml
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config, followup
from ..db import DailyRecord, Report, Teacher, ValidationFlag, uid
from ..service import class_label, roster

TEMPLATES = Path(__file__).parent / "templates"
EXT = {"attendance": "xlsx", "mdm": "xlsx", "summary": "pdf", "csv": "csv"}


def _template(state: str) -> dict:
    p = TEMPLATES / state.lower().replace(" ", "_") / "template.yaml"
    return yaml.safe_load((p if p.exists() else TEMPLATES / "generic" / "template.yaml").read_text())


def _month_bounds(month: str) -> tuple[date, date]:
    y, m = map(int, month.split("-"))
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def _confirmed(db: Session, t: Teacher, start: date, end: date) -> list[DailyRecord]:
    return db.scalars(select(DailyRecord).where(
        DailyRecord.teacher_id == t.id, DailyRecord.status == "confirmed",
        DailyRecord.record_date >= start, DailyRecord.record_date <= end).order_by(DailyRecord.record_date)).all()


def _footer(tpl: dict) -> str:
    return tpl["footer"].format(generated=datetime.now().strftime("%d %b %Y %H:%M"))


def _lessons_text(r: DailyRecord) -> str:
    return "; ".join(" ".join(x for x in (ls.get("subject"), ls.get("lesson_ref"), ls.get("status")) if x)
                     for ls in r.lessons)


HEAD = Font(bold=True)
FILL = PatternFill("solid", fgColor="DCEFE9")


def attendance_xlsx(db: Session, t: Teacher, month: str, tpl: dict) -> bytes:
    start, end = _month_bounds(month)
    recs = _confirmed(db, t, start, end)
    a = tpl["attendance"]
    wb = Workbook()
    wb.remove(wb.active)
    for k in t.classes:
        ws = wb.create_sheet(class_label(k)[:31])
        by_day = {r.record_date: r for r in recs if r.class_id == k.id}
        days = [date(start.year, start.month, d) for d in range(1, end.day + 1)]
        days = [d for d in days if d.weekday() != 6]
        ws.append([f"{a['title']} — {class_label(k)} — {start.strftime('%B %Y')} — {t.school.name}"])
        ws["A1"].font = Font(bold=True, size=13)
        header = a["columns_left"] + [d.day for d in days] + a["columns_right"]
        ws.append(header)
        for c in ws[2]:
            c.font, c.fill, c.alignment = HEAD, FILL, Alignment(horizontal="center")
        for e in sorted(roster(k), key=lambda e: e.roll_no):
            marks, p_count, a_count = [], 0, 0
            for d in days:
                r = by_day.get(d)
                if r is None:
                    marks.append("")
                elif e.id in r.absent_student_ids:
                    marks.append(a["absent_mark"])
                    a_count += 1
                else:
                    marks.append(a["present_mark"])
                    p_count += 1
            ws.append([e.roll_no, e.name] + marks + [p_count, a_count])
        totals = ["", "Present (said)"] + [by_day[d].present if d in by_day else "" for d in days]
        ws.append(totals)
        ws.append([])
        ws.append([_footer(tpl)])
        ws.column_dimensions["B"].width = 24
        for i in range(3, 3 + len(days)):
            ws.column_dimensions[get_column_letter(i)].width = 4
    if not wb.sheetnames:
        wb.create_sheet("Empty")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def mdm_xlsx(db: Session, t: Teacher, month: str, tpl: dict) -> bytes:
    start, end = _month_bounds(month)
    recs = _confirmed(db, t, start, end)
    m = tpl["mdm"]
    wb = Workbook()
    ws = wb.active
    ws.title = "MDM"
    ws.append([f"{m['title']} — {start.strftime('%B %Y')} — {t.school.name}"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append(m["columns"])
    for c in ws[2]:
        c.font, c.fill = HEAD, FILL
    tot_p = tot_m = 0
    for r in recs:
        ws.append([r.record_date.strftime("%d-%m-%Y"), class_label(r.klass), r.enrolled, r.present, r.meals_served])
        tot_p += r.present or 0
        tot_m += r.meals_served or 0
    ws.append(["Total", "", "", tot_p, tot_m])
    for c in ws[ws.max_row]:
        c.font = HEAD
    ws.append([])
    ws.append([_footer(tpl)])
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 12
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def upload_csv(db: Session, t: Teacher, month: str, tpl: dict) -> bytes:
    start, end = _month_bounds(month)
    cols = tpl["csv"]["columns"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([h for h, _ in cols])
    for r in _confirmed(db, t, start, end):
        row = {"udise_code": t.school.udise_code or "", "record_date": r.record_date.isoformat(),
               "grade": r.klass.grade, "section": r.klass.section or "", "enrolled": r.enrolled,
               "present": r.present, "absent": len(r.absent_student_ids), "meals_served": r.meals_served,
               "lessons": _lessons_text(r)}
        w.writerow(["" if row[f] is None else row[f] for _, f in cols])
    return buf.getvalue().encode("utf-8-sig")  # BOM so Excel opens it correctly


def summary_pdf(db: Session, t: Teacher, month: str, tpl: dict) -> bytes:
    start, end = _month_bounds(month)
    recs = _confirmed(db, t, start, end)
    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=f"Monthly summary {month}")
    story = [Paragraph(f"{tpl['summary']['title']} — {start.strftime('%B %Y')}", styles["Title"]),
             Paragraph(f"{t.school.name}, {t.school.state}" + (f" · UDISE {t.school.udise_code}"
                                                              if t.school.udise_code else ""), styles["Normal"]),
             Spacer(1, 12)]
    rows = [["Class", "Days recorded", "Avg attendance", "Meals served", "Lessons completed", "Open checks"]]
    for k in t.classes:
        kr = [r for r in recs if r.class_id == k.id]
        pct = [r.present / r.enrolled for r in kr if r.present is not None and r.enrolled]
        done = sorted({ls.get("lesson_ref") for r in kr for ls in r.lessons
                       if ls.get("status") == "completed" and ls.get("lesson_ref")})
        open_ = db.query(ValidationFlag).join(DailyRecord).filter(
            DailyRecord.class_id == k.id, DailyRecord.record_date >= start, DailyRecord.record_date <= end,
            DailyRecord.status.in_(["draft", "flagged"]), ValidationFlag.resolution == "open",
            ValidationFlag.severity == "block").count()
        rows.append([class_label(k), len({r.record_date for r in kr}),
                     f"{100 * sum(pct) / len(pct):.0f}%" if pct else "—",
                     sum(r.meals_served or 0 for r in kr), ", ".join(done) or "—", open_])
    table = Table(rows, repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dcefe9")),
                               ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                               ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbbbbb")),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    working = sum(1 for d in range(1, end.day + 1) if date(start.year, start.month, d).weekday() != 6)
    story += [table, Spacer(1, 12)]
    # Dropout early-warning for the month, from confirmed records only.
    concerns = followup.teacher_concerns(db, t, end, window_days=(end - start).days)
    story.append(Paragraph("Children to follow up", styles["Heading2"]))
    if concerns:
        frows = [["Class", "Roll", "Name", "Days absent", "Attendance", "Priority", "Why"]]
        frows += [[f"Class {c.grade}{'-' + c.section if c.section else ''}", c.roll_no, c.name,
                   f"{c.days_absent}/{c.days_recorded}", f"{c.attendance_pct}%",
                   "Act" if c.tier == "act" else "Watch", "; ".join(c.reasons)]
                  for c in concerns]
        ft = Table(frows, repeatRows=1)
        ft.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fff1d6")),
                                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbbbbb"))]))
        story.append(ft)
    else:
        story.append(Paragraph(f"No child was absent {followup.STREAK_MIN} school days in a row or missed "
                               f"{followup.WATCH_MISSED_PCT}% or more of recorded days.", styles["Normal"]))
    story += [Spacer(1, 12),
              Paragraph(f"Working days in month (Mon–Sat): {working}. Days with no confirmed record are left "
                        f"blank in the registers.", styles["Normal"]),
              Spacer(1, 18), Paragraph(_footer(tpl), styles["Italic"])]
    doc.build(story)
    return buf.getvalue()


BUILDERS = {"attendance": attendance_xlsx, "mdm": mdm_xlsx, "summary": summary_pdf, "csv": upload_csv}
NAMES = {"attendance": "attendance-register", "mdm": "mdm-register", "summary": "monthly-summary", "csv": "upload"}


def build_bytes(db: Session, t: Teacher, kind: str, month: str) -> bytes:
    return BUILDERS[kind](db, t, month, _template(t.school.state))


def generate(db: Session, t: Teacher, kind: str, month: str) -> Report:
    data = build_bytes(db, t, kind, month)
    rid = uid()
    filename = f"{NAMES[kind]}-{month}.{EXT[kind]}"
    path = config.REPORTS_DIR / f"{rid}.{EXT[kind]}"
    path.write_bytes(data)
    rep = Report(id=rid, teacher_id=t.id, kind=kind, period=month, filename=filename, file_uri=str(path))
    db.add(rep)
    db.commit()
    return rep
