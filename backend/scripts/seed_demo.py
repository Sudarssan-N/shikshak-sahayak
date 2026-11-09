"""Seed a fictional demo teacher with a roster and ~2 weeks of confirmed records, going through the real pipeline
(text notes → parser → rules → confirm), so the dashboard, registers and /stats have something to show.

    cd backend && .venv/bin/python -m scripts.seed_demo        # phone 9876500001, admin key dev-admin-key
"""
import asyncio
import random
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import service
from app.db import SessionLocal, Teacher, now
from app.main import app
from app.security import phone_hash

PHONE = "9876500001"
ADMIN = {"X-Admin-Key": "dev-admin-key"}


def main():
    c = TestClient(app)
    db = SessionLocal()
    if db.scalars(select(Teacher).where(Teacher.phone_hash == phone_hash(PHONE))).first():
        print(f"Demo teacher already exists. Log in with {PHONE}.")
        return
    t = c.post("/admin/teachers", headers=ADMIN, json={
        "name": "Sunita Devi", "phone": PHONE, "language": "hi", "school_name": "Primary School Rampur (demo)",
        "state": "Uttar Pradesh", "classes": [{"grade": 3, "section": None}, {"grade": 5, "section": None}]}).json()
    csv_bytes = (Path(__file__).parent / "sample_roster.csv").read_bytes()
    up = c.post(f"/admin/teachers/{t['id']}/roster", headers=ADMIN, files={"file": ("roster.csv", csv_bytes)}).json()
    print("roster accepted:", up["accepted"], "rejected:", len(up["rejected"]))

    teacher = db.get(Teacher, t["id"])
    teacher.consent_at = now() - timedelta(days=15)
    service.track(db, teacher, "onboarded", language="hi")
    db.commit()

    rnd = random.Random(7)
    names3 = ["Ravi Kumar", "Sita", "Arjun", "Meena", "Gaurav", "Neha", "Kavita"]
    names5 = ["Farhan", "Jyoti", "Rohit", "Uma", "Kunal"]
    day = service.today() - timedelta(days=14)
    lesson3, lesson5 = 3, 5
    while day < service.today():
        if day.weekday() != 6:
            a3 = rnd.sample([n for n in names3 if n != "Kavita"], rnd.choice([0, 0, 1, 1, 2]))
            a5 = rnd.sample([n for n in names5 if n != "Kunal"], rnd.choice([0, 0, 0, 1, 1]))
            # Two realistic early-warning cases for the follow-up list: Kunal stops coming for the last 4 school
            # days, and Kavita misses about half the days.
            if (service.today() - day).days <= 5 and "Kunal" not in a5:
                a5.append("Kunal")
            elif (service.today() - day).days > 5 and "Kunal" in a5:
                a5.remove("Kunal")
            if rnd.random() < 0.45 and "Kavita" not in a3:
                a3.append("Kavita")
            p3, p5 = 28 - len(a3), 24 - len(a5)
            lesson3 += rnd.random() < 0.4
            lesson5 += rnd.random() < 0.4
            text = (f"Class 3 {p3} present, absent {', '.join(a3)}. Mid day meal {p3}. Lesson {lesson3} started. "
                    f"Class 5 {p5} present" + (f", absent {', '.join(a5)}" if a5 else "") +
                    f". Meals {p5}. Maths lesson {lesson5} completed.")
            note = asyncio.run(service.process_note(db, teacher, text=text, record_date=day))
            for r in service.ser_note(db, note)["records"]:
                rec = db.get(service.DailyRecord, r["id"])
                try:
                    service.confirm(db, rec, acknowledge_warnings=True)
                except service.UserFacingError as exc:
                    print(day, "not confirmed:", exc)
            first = service.ser_note(db, note)["records"]
            if first:
                c_rec = db.get(service.DailyRecord, first[0]["id"])
                service.track(db, teacher, "time_saved", value=rnd.choice([5, 10, 10, 15]))
                db.commit()
                _ = c_rec
        day += timedelta(days=1)
    # This month's reading/maths levels, so the TaRL groups and the combined follow-up flag have data. No parent
    # phone numbers are seeded: a tap on "SMS" in the demo must never reach a real person.
    from app.db import FollowUpAction, LearningLevel
    from app.levels import MATHS, READING
    month = service.today().strftime("%Y-%m")
    for k in teacher.classes:
        for e in service.roster(k):
            first = e.name.split()[0]
            r = {"Kavita": 1, "Neha": 2, "Kunal": 1}.get(first, rnd.choice([1, 2, 2, 3, 3, 4, 4, 4]))
            m = max(0, min(4, r + rnd.choice([-1, 0, 0, 1])))
            db.add(LearningLevel(teacher_id=teacher.id, class_id=k.id, student_id=e.id, month=month,
                                 reading=READING[r], maths=MATHS[m], source="voice"))
            if first == "Kavita":
                db.add(FollowUpAction(teacher_id=teacher.id, student_id=e.id, action="call", reason="work",
                                      outcome="will_return", created_at=now() - timedelta(days=2)))
    db.commit()
    print(f"Seeded. Log in at the web app with phone {PHONE} (dev code is shown on screen).")


if __name__ == "__main__":
    main()
