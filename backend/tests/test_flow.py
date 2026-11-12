"""End-to-end API tests over the deterministic pipeline (no LLM/ASR keys needed)."""
import os
import tempfile
from datetime import date, timedelta

os.environ["DATA_DIR"] = tempfile.mkdtemp()
os.environ["LLM_PROVIDER"] = "none"
os.environ["SARVAM_API_KEY"] = ""
os.environ["DEV_MODE"] = "1"
os.environ["FRONTEND_DIST"] = "/nonexistent"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import service  # noqa: E402
from app.main import app  # noqa: E402
from app.pipeline.parser import parse  # noqa: E402
from app.pipeline.roster_match import RosterEntry, match_names  # noqa: E402
from app.rules.engine import Ctx, validate  # noqa: E402

ADMIN = {"X-Admin-Key": "dev-admin-key"}
ROSTER = "roll_no,name,grade,section\n" + "\n".join(
    f"{i},{n},3," for i, n in enumerate(
        ["Aarav Singh", "Arjun Yadav", "Meena Kumari", "Ravi Kumar", "Ravi Sharma", "Sita Kumari", "Neha Bind",
         "Gaurav Pal", "Isha Gupta", "Karan Chauhan"], start=1)) + "\n1,Uma Devi,5,\n2,Farhan Ali,5,\n"


@pytest.fixture(scope="module")
def c():
    return TestClient(app)


_counter = iter(range(100))


@pytest.fixture
def teacher(c):
    phone = f"98765{next(_counter):05d}"
    t = c.post("/admin/teachers", headers=ADMIN, json={
        "name": "Test Teacher", "phone": phone, "language": "en", "school_name": "Test School", "state": "UP",
        "classes": [{"grade": 3}, {"grade": 5}]}).json()
    up = c.post(f"/admin/teachers/{t['id']}/roster", headers=ADMIN,
                files={"file": ("r.csv", (ROSTER + "x,Bad Row,3,\n11,Nobody,7,\n").encode())}).json()
    assert up["accepted"] == 12 and len(up["rejected"]) == 2
    code = c.post("/api/auth/request-code", json={"phone": phone}).json()["dev_code"]
    tok = c.post("/api/auth/verify", json={"phone": phone, "code": code}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert c.post("/api/me/consent", headers=h).json()["consent_at"]
    return h


def note(c, h, text, d=None):
    data = {"text": text}
    if d:
        data["record_date"] = d.isoformat()
    r = c.post("/api/notes", headers=h, data=data)
    assert r.status_code == 200, r.text
    return r.json()


def open_rules(rec):
    return sorted(f["rule_id"] for f in rec["flags"] if f["resolution"] == "open")


def test_admin_key_required(c):
    assert c.get("/admin/teachers").status_code == 401


def test_unregistered_phone(c):
    assert c.post("/api/auth/request-code", json={"phone": "9000000000"}).status_code == 404


def test_prd_worked_example(c, teacher):
    """PRD: enrolled from roster, V3 warns on meals > present, V4 blocks on ambiguous Ravi."""
    res = note(c, teacher, "Today Class 3, 7 present, 3 absent: Ravi, Sita, Arjun. Mid-day meal served 9. "
                           "Class 3 finished lesson 7.")
    assert res["note"]["status"] == "processed"
    rec = res["records"][0]
    assert rec["enrolled"] == 10 and rec["present"] == 7 and rec["meals_served"] == 9
    assert {a["name"] for a in rec["absent"]} == {"Sita Kumari", "Arjun Yadav"}
    assert rec["unresolved_names"][0]["spoken"] == "Ravi"
    assert {x["name"] for x in rec["unresolved_names"][0]["candidates"]} == {"Ravi Kumar", "Ravi Sharma"}
    assert "V3" in open_rules(rec) and "V4" in open_rules(rec)
    assert rec["status"] == "flagged"

    # Block flag prevents confirmation
    assert c.post(f"/api/records/{rec['id']}/confirm", headers=teacher,
                  json={"acknowledge_warnings": True}).status_code == 409
    ravi_k = next(x for x in rec["unresolved_names"][0]["candidates"] if x["name"] == "Ravi Kumar")
    rec = c.post(f"/api/records/{rec['id']}/resolve-name", headers=teacher,
                 json={"spoken": "Ravi", "student_id": ravi_k["student_id"]}).json()
    assert "V4" not in open_rules(rec) and len(rec["absent"]) == 3

    # spoken correction fixes the meals warning
    rec = c.post(f"/api/records/{rec['id']}/corrections", headers=teacher, json={"text": "meals 7"}).json()
    assert rec["meals_served"] == 7 and "V3" not in open_rules(rec)
    rec = c.post(f"/api/records/{rec['id']}/confirm", headers=teacher, json={"acknowledge_warnings": False}).json()
    assert rec["status"] == "confirmed"
    assert any(f["rule_id"] == "V3" and f["resolution"] == "corrected" for f in rec["flags"])


def test_hindi_note_and_two_classes(c, teacher):
    res = note(c, teacher, "आज कक्षा तीन में आठ बच्चे उपस्थित, रवि शर्मा और सीता नहीं आए। मध्याह्न भोजन आठ। "
                           "Class 5 2 present, meals 2")
    assert res["note"]["status"] == "processed"
    r3, r5 = res["records"]
    assert r3["present"] == 8 and r3["meals_served"] == 8 and r3["grade"] == 3
    assert {a["name"] for a in r3["absent"]} == {"Ravi Sharma", "Sita Kumari"}
    assert r5["grade"] == 5 and r5["present"] == 2


def test_never_invents_present(c, teacher):
    rec = note(c, teacher, "Class 3 absent Neha. Meals 9.")["records"][0]
    assert rec["present"] is None and "present" in rec["missing_fields"]
    assert "V11" in open_rules(rec)  # block until the teacher says it


def test_rules_v1_v9_and_future_date(c, teacher):
    rec = note(c, teacher, "Class 3 12 present, meals 12")["records"][0]
    assert "V1" in open_rules(rec)
    rec = note(c, teacher, "Class 3 0 present")["records"][0]
    assert "V9" in open_rules(rec)
    rec = note(c, teacher, "Class 3 10 present", d=service.today() + timedelta(days=2))["records"][0]
    assert "V6" in open_rules(rec)


def test_unknown_class_fails_politely(c, teacher):
    res = note(c, teacher, "Class 7 20 present")
    assert res["note"]["status"] == "failed" and "Class 7" in res["note"]["error"]


def test_correct_confirmed_creates_version_and_reports(c, teacher):
    d = service.today() - timedelta(days=1)
    rec = note(c, teacher, "Class 3 10 present, meals 10, lesson 4 started", d)["records"][0]
    rec = c.post(f"/api/records/{rec['id']}/confirm", headers=teacher, json={"acknowledge_warnings": True}).json()
    new = c.post(f"/api/records/{rec['id']}/corrections", headers=teacher,
                 json={"patch": {"present": 9, "absent_student_ids": [rec_student(c, teacher, "Neha Bind")]}}).json()
    assert new["version"] == 2 and new["id"] != rec["id"]
    assert c.get(f"/api/records/{rec['id']}", headers=teacher).json()["status"] == "superseded"
    c.post(f"/api/records/{new['id']}/confirm", headers=teacher, json={"acknowledge_warnings": True})
    month = d.strftime("%Y-%m")
    for kind in ("attendance", "mdm", "summary", "csv"):
        rep = c.post("/api/reports", headers=teacher, json={"kind": kind, "month": month}).json()
        f = c.get(rep["download_url"], params={"token": teacher["Authorization"][7:]})
        assert f.status_code == 200 and len(f.content) > 100
    csv_text = c.get(rep["download_url"], headers=teacher).content.decode("utf-8-sig")
    assert f"{d.isoformat()},3,,10,9,1,10" in csv_text


def rec_student(c, h, name):
    for k in c.get("/api/roster", headers=h).json():
        for s in k["students"]:
            if s["name"] == name:
                return s["id"]
    raise AssertionError(name)


def test_stats_are_anonymous(c, teacher):
    s = c.get("/stats").json()
    assert s["notes_processed"] > 0 and s["records_confirmed"] > 0
    blob = str(s)
    assert "Ravi" not in blob and "98765" not in blob


def test_delete_my_data(c, teacher):
    note(c, teacher, "Class 3 10 present")
    assert c.delete("/api/me", headers=teacher).json() == {"deleted": True}
    assert c.get("/api/me", headers=teacher).status_code == 401


# ---- unit fixtures: each rule passes and fails ----

def base(**kw):
    d = dict(klass="Class 3", record_date=date(2026, 11, 10), today=date(2026, 11, 10), enrolled=28, present=23,
             meals_served=23, absent_ids=["a"] * 5, absent_count_spoken=None, unresolved=[], lessons=[])
    d.update(kw)
    return Ctx(**d)


@pytest.mark.parametrize("rule,bad,good", [
    ("V1", dict(present=31, meals_served=None), dict()),
    ("V2", dict(absent_ids=["a"] * 4), dict()),
    ("V3", dict(meals_served=25), dict()),
    ("V4", dict(unresolved=[{"spoken": "Ravi", "candidates": []}]), dict()),
    ("V5", dict(confirmed_same_day=True), dict()),
    ("V6", dict(record_date=date(2026, 11, 12)), dict()),
    ("V7", dict(lessons=[{"lesson_ref": "lesson 7"}], last_lesson_no=9), dict(lessons=[{"lesson_ref": "lesson 9"}], last_lesson_no=9)),
    ("V8", dict(last_record_date=date(2026, 11, 7)), dict(last_record_date=date(2026, 11, 9))),
    ("V9", dict(present=0, meals_served=0, absent_ids=["a"] * 28), dict()),
    ("V10", dict(field_confidence={"present": 0.5}), dict(field_confidence={"present": 0.9})),
    ("V11", dict(present=None), dict()),
    ("V12", dict(absent_count_spoken=4), dict(absent_count_spoken=5)),
    ("V13", dict(meals_served=28, present=28, absent_ids=[]), dict()),
])
def test_rule_fixtures(rule, bad, good):
    assert rule in {f.rule_id for f in validate(base(**bad))}
    assert rule not in {f.rule_id for f in validate(base(**good))}


def test_roster_matcher():
    roster = [RosterEntry("1", 1, "Ravi Kumar"), RosterEntry("2", 2, "Ravi Sharma"), RosterEntry("3", 3, "Sita Kumari")]
    m = match_names(["Ravi", "सीता", "Ravi S", "Zubair"], roster)
    assert m.matched_ids == ["3", "2"]
    assert [u["spoken"] for u in m.unresolved] == ["Ravi", "Zubair"]
    assert sorted(m.unresolved[0]["candidate_ids"]) == ["1", "2"]


def test_parser_backfill_dates():
    r = parse("Monday class 3 22 present. Tuesday class 3 24 present, meals 24.", date(2026, 11, 11), None)
    assert [(c.record_date, c.present) for c in r.classes] == [(date(2026, 11, 9), 22), (date(2026, 11, 10), 24)]


def _confirm_day(c, h, text, d):
    rec = note(c, h, text, d)["records"][0]
    r = c.post(f"/api/records/{rec['id']}/confirm", headers=h, json={"acknowledge_warnings": True})
    assert r.status_code == 200, r.text
    return r.json()


def test_followup_flags_absence_streak(c, teacher):
    """Sita absent on the last 3 recorded days -> flagged; Meena absent once -> not flagged."""
    today = service.today()
    days = [today - timedelta(days=i) for i in (4, 3, 2, 1)]
    _confirm_day(c, teacher, "Class 3, 9 present, Meena absent, 9 meals", days[0])
    for d in days[1:]:
        _confirm_day(c, teacher, "Class 3, 9 present, Sita absent, 9 meals", d)
    res = c.get("/api/followup", headers=teacher).json()
    names = {ch["name"]: ch for ch in res["children"]}
    assert "Sita Kumari" in names and "Meena Kumari" not in names
    sita = names["Sita Kumari"]
    assert sita["streak"] == 3 and sita["days_absent"] == 3 and sita["days_recorded"] == 4
    assert sita["reasons"][0] == "absent the last 3 school days"


def test_followup_ignores_drafts(c, teacher):
    today = service.today()
    for i in (3, 2, 1):
        note(c, teacher, "Class 3, 9 present, Sita absent, 9 meals", today - timedelta(days=i))  # never confirmed
    assert c.get("/api/followup", headers=teacher).json()["children"] == []


def test_readback_text_and_disabled_without_key(c, teacher):
    from app import speech
    from app.db import DailyRecord, SessionLocal
    rec = note(c, teacher, "Class 3, 8 present, Sita and Arjun absent, 9 meals")["records"][0]
    db = SessionLocal()
    r = db.get(DailyRecord, rec["id"])
    en = speech.summary_text(r, ["Sita Kumari", "Arjun Yadav"], ["Meals are more than present."], "en")
    assert en.startswith("Class 3. 8 present. 2 absent: Sita Kumari and Arjun Yadav. 9 meals served.")
    assert "Please check: Meals are more than present." in en
    hi = speech.summary_text(r, ["Sita Kumari"], [], "hi")
    assert hi.startswith("कक्षा 3। 8 बच्चे आए।") and hi.endswith("क्या यह सही है?")
    db.close()
    # No Sarvam key in tests: the route fails politely instead of crashing.
    assert c.get(f"/api/records/{rec['id']}/speech", headers=teacher).status_code == 503


def test_report_download_survives_lost_file(c, teacher):
    from pathlib import Path
    from app.db import Report, SessionLocal
    month = service.today().strftime("%Y-%m")
    rep = c.post("/api/reports", headers=teacher, json={"kind": "summary", "month": month}).json()
    db = SessionLocal()
    Path(db.get(Report, rep["id"]).file_uri).unlink()
    db.close()
    r = c.get(rep["download_url"], headers=teacher)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def test_llm_date_cannot_override_picked_day(monkeypatch):
    """A model that invents TODAY must not move a note the teacher filed under another day."""
    import asyncio
    from app import llm
    from app.pipeline import extract as ex
    today, picked = date(2026, 11, 6), date(2026, 11, 3)

    async def fake_chat(system, user):
        return {"record_date": "2026-11-06", "classes": [{"grade": 3, "present": 20, "record_date": "2026-11-06"}]}

    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(llm, "chat_json", fake_chat)
    rec, _ = asyncio.run(ex.extract("Class 3, 20 present", today, picked, []))
    assert rec.classes[0].record_date == picked
    rec, _ = asyncio.run(ex.extract("Yesterday class 3, 20 present", today, picked, []))
    assert rec.classes[0].record_date == date(2026, 11, 6)  # a spoken day is still trusted


def test_stats_exclude_demo_account(c, teacher, monkeypatch):
    from app import config
    before = c.get("/stats", headers={"Accept": "application/json"}).json()["notes_processed"]
    note(c, teacher, "Class 3, 9 present, Sita absent, 9 meals")
    assert c.get("/stats").json()["notes_processed"] == before + 1
    # Mark every test teacher's phone as the demo account: their usage disappears from public impact.
    phones = {f"98765{i:05d}" for i in range(100)}
    monkeypatch.setattr(config, "DEMO_PHONES", phones)
    s = c.get("/stats").json()
    assert s["notes_processed"] <= before and s["excludes_demo_account"] is True


def test_demo_phone_code_shown_in_any_format(c, monkeypatch):
    from app import config
    c.post("/admin/teachers", headers=ADMIN, json={
        "name": "Demo", "phone": "7339113033", "language": "hi", "school_name": "S", "state": "UP",
        "classes": [{"grade": 3}]})
    monkeypatch.setattr(config, "DEV_MODE", False)
    monkeypatch.setattr(config, "DEMO_PHONES", {"7339113033"})
    for fmt in ("7339113033", "+91 73391 13033", "+917339113033"):
        assert "dev_code" in c.post("/api/auth/request-code", json={"phone": fmt}).json(), fmt
    monkeypatch.setattr(config, "DEMO_PHONES", set())
    assert "dev_code" not in c.post("/api/auth/request-code", json={"phone": "7339113033"}).json()


# ---------------------------------------------------------------- MDM count, follow-up loop, levels

def test_mdm_today_totals_confirmed_classes(c, teacher):
    d = service.today()
    _confirm_day(c, teacher, "Class 3, 9 present, Sita absent, 9 meals", d)
    m = c.get("/api/mdm/today", headers=teacher).json()
    assert m["meals"] == 9 and m["classes_confirmed"] == 1 and m["classes_total"] == 2 and not m["complete"]
    assert m["sms_body"] == "MDM 9" and m["sms_url"].startswith("sms:?body=MDM%209")
    note(c, teacher, "Class 5, 2 present, 2 meals", d)  # a draft never counts
    assert c.get("/api/mdm/today", headers=teacher).json()["meals"] == 9


def test_followup_tiers_and_parent_loop(c, teacher):
    today = service.today()
    days = [today - timedelta(days=i) for i in range(10, 0, -1)]  # 10 recorded days
    for i, d in enumerate(days):
        absent = ["Sita"] if i >= 7 else []          # Sita: last 3 days in a row -> act
        if i == 2:
            absent.append("Neha")                     # Neha: 1 of 10 missed = 10% -> watch
        text = f"Class 3, {10 - len(absent)} present" + (f", {' and '.join(absent)} absent" if absent else "") + \
            f", {10 - len(absent)} meals"
        _confirm_day(c, teacher, text, d)
    res = c.get("/api/followup", headers=teacher).json()
    by = {ch["name"]: ch for ch in res["children"]}
    assert by["Sita Kumari"]["tier"] == "act" and by["Neha Bind"]["tier"] == "watch"
    assert res["children"][0]["name"] == "Sita Kumari"  # act before watch
    sita = by["Sita Kumari"]["student_id"]

    msg = c.get(f"/api/followup/{sita}/message", headers=teacher).json()
    assert "absent 3 of the last 10 school days" in msg["text"] and msg["phone"] is None
    assert c.put(f"/api/students/{sita}/contact", headers=teacher, json={"phone": "12345"}).status_code == 422
    assert c.put(f"/api/students/{sita}/contact", headers=teacher, json={"phone": "+91 98111 22333"}).json()["ok"]
    msg = c.get(f"/api/followup/{sita}/message", headers=teacher).json()
    assert msg["phone"] == "9811122333" and msg["whatsapp_url"].startswith("https://wa.me/919811122333?text=")

    assert c.post(f"/api/followup/{sita}/actions", headers=teacher, json={"action": "dance"}).status_code == 422
    c.post(f"/api/followup/{sita}/actions", headers=teacher,
           json={"action": "call", "reason": "illness", "outcome": "will_return"})
    res = c.get("/api/followup", headers=teacher).json()
    s = next(ch for ch in res["children"] if ch["student_id"] == sita)
    assert s["last_action"]["action"] == "call" and s["has_phone"] is True
    # Another teacher can't touch this child
    other = c.post("/admin/teachers", headers=ADMIN, json={"name": "O", "phone": "9123400000", "language": "en",
                                                            "school_name": "S", "state": "UP",
                                                            "classes": [{"grade": 1}]}).json()
    code = c.post("/api/auth/request-code", json={"phone": "9123400000"}).json()["dev_code"]
    oh = {"Authorization": "Bearer " + c.post("/api/auth/verify", json={"phone": "9123400000", "code": code}).json()["token"]}
    assert c.get(f"/api/followup/{sita}/message", headers=oh).status_code == 404
    assert other["id"]


def test_levels_parse_english_and_hindi():
    from app import levels
    roster = [RosterEntry("m", 1, "Meena Kumari"), RosterEntry("r", 2, "Ravi Kumar"), RosterEntry("s", 3, "Sita Devi")]
    p = levels.parse("Meena story subtraction, Ravi letters 1 to 9. Sita reads words and can do 10 to 99", roster)
    got = {i["student_id"]: (i["reading"], i["maths"]) for i in p.items}
    assert got == {"m": ("story", "subtraction"), "r": ("letter", "num_1_9"), "s": ("word", "num_10_99")}
    p = levels.parse("मीना कहानी भाग, रवि अक्षर एक अंक, Gopal story", roster)
    got = {i["student_id"]: (i["reading"], i["maths"]) for i in p.items}
    assert got == {"m": ("story", "division"), "r": ("letter", "num_1_9")}
    assert p.unmatched[0]["spoken"] == "gopal"  # never guesses an unknown child
    p = levels.parse("Ravi beginner beginner", roster)
    assert (p.items[0]["reading"], p.items[0]["maths"]) == ("beginner", "beginner")


def test_levels_save_groups_and_combined_flag(c, teacher):
    me = c.get("/api/me", headers=teacher).json()
    k3 = next(k for k in me["classes"] if k["grade"] == 3)
    parsed = c.post("/api/levels/parse", headers=teacher,
                    data={"class_id": k3["id"], "text": "Sita letters 1 to 9, Meena story division"}).json()
    assert {i["name"] for i in parsed["items"]} == {"Sita Kumari", "Meena Kumari"}
    items = [{"student_id": i["student_id"], "reading": i["reading"], "maths": i["maths"]} for i in parsed["items"]]
    assert c.put("/api/levels", headers=teacher, json={"class_id": k3["id"], "items": [
        {"student_id": items[0]["student_id"], "reading": "fluent"}]}).status_code == 422
    lv = c.put("/api/levels", headers=teacher, json={"class_id": k3["id"], "source": "voice", "items": items}).json()
    assert lv["done"] == 2 and lv["total"] == 10
    assert [g["level"] for g in lv["groups"]["reading"]] == ["letter", "story"]
    # Sita is absent 3 days in a row and reads at letter level: the reason says so
    today = service.today()
    for i in (3, 2, 1):
        _confirm_day(c, teacher, "Class 3, 9 present, Sita absent, 9 meals", today - timedelta(days=i))
    sita = next(ch for ch in c.get("/api/followup", headers=teacher).json()["children"] if ch["name"] == "Sita Kumari")
    assert "reads at letters level" in sita["reasons"] and sita["reading_level"] == "letter"


# ---------------------------------------------------------------- school desk: people, hours, geofence

SCHOOL_PIN = {"lat": 26.8467, "lng": 80.9462, "radius_m": 200}
NEAR_SCHOOL = {"lat": 26.8470, "lng": 80.9462}  # about 30 m north of the pin
FAR_SCHOOL = {"lat": 26.8700, "lng": 80.9462}   # about 2.6 km north


def test_geofence_distance():
    from app import geo
    assert geo.haversine_m(26.8467, 80.9462, 26.8467, 80.9462) == 0
    assert 20 < geo.haversine_m(26.8467, 80.9462, 26.8470, 80.9462) < 60
    assert geo.haversine_m(26.8467, 80.9462, 26.8700, 80.9462) > 2000


def test_admin_adds_class_and_people(c, teacher):
    me = c.get("/api/me", headers=teacher).json()
    tid = me["id"]
    added = c.post(f"/admin/teachers/{tid}/classes", headers=ADMIN, json={"grade": 4, "section": "a"}).json()
    assert added["grade"] == 4 and added["section"] == "A" and added["enrolled"] == 0
    assert c.post(f"/admin/teachers/{tid}/classes", headers=ADMIN,
                  json={"grade": 4, "section": "A"}).status_code == 409
    stu = c.post(f"/admin/teachers/{tid}/classes/{added['id']}/students", headers=ADMIN,
                 json={"roll_no": 1, "name": "Gopal Verma"}).json()
    assert stu["name"] == "Gopal Verma" and stu["active"] is True
    assert c.post(f"/admin/teachers/{tid}/classes/{added['id']}/students", headers=ADMIN,
                  json={"roll_no": 1, "name": "Other Child"}).status_code == 409
    gone = c.patch(f"/admin/teachers/{tid}/classes/{added['id']}/students/{stu['id']}", headers=ADMIN,
                   json={"active": False}).json()
    assert gone["active"] is False
    back = c.post(f"/admin/teachers/{tid}/classes/{added['id']}/students", headers=ADMIN,
                  json={"roll_no": 1, "name": "Gopal Verma"}).json()
    assert back["id"] == stu["id"] and back["active"] is True
    roster = c.get("/api/roster", headers=teacher).json()
    assert any(s["name"] == "Gopal Verma" for k in roster for s in k["students"])
    listed = c.get(f"/admin/teachers/{tid}/classes/{added['id']}/students", headers=ADMIN).json()
    assert listed["students"][0]["name"] == "Gopal Verma"
    assert c.get("/admin/schools").status_code == 401


def test_boundary_gates_login_and_class_attendance(c, teacher):
    me = c.get("/api/me", headers=teacher).json()
    sid = me["school"]["id"]
    assert me["school"]["boundary"] is None
    assert c.post("/api/duty/in", headers=teacher, json=NEAR_SCHOOL).status_code == 409

    # No circle yet: class attendance still confirms without a location.
    today = service.today()
    rec = note(c, teacher, "Class 5 2 present, meals 2", today)["records"][0]
    assert c.post(f"/api/records/{rec['id']}/confirm", headers=teacher,
                  json={"acknowledge_warnings": True}).status_code == 200

    pin = c.put(f"/admin/schools/{sid}/boundary", headers=ADMIN, json=SCHOOL_PIN).json()
    assert pin["radius_m"] == 200
    schools = c.get("/admin/schools", headers=ADMIN).json()
    assert next(s for s in schools if s["id"] == sid)["boundary"]["radius_m"] == 200

    far = c.post("/api/duty/in", headers=teacher, json=FAR_SCHOOL)
    assert far.status_code == 403 and "m from the school" in far.json()["detail"]
    inn = c.post("/api/duty/in", headers=teacher, json=NEAR_SCHOOL).json()
    assert inn["place"]["inside"] is True and inn["session"]["open"] is True
    assert c.post("/api/duty/in", headers=teacher, json=NEAR_SCHOOL).status_code == 409

    yesterday = today - timedelta(days=1)
    rec = note(c, teacher, "Class 5 2 present, meals 2", yesterday)["records"][0]
    blocked = c.post(f"/api/records/{rec['id']}/confirm", headers=teacher,
                     json={"acknowledge_warnings": True, **FAR_SCHOOL})
    assert blocked.status_code == 403
    missing = c.post(f"/api/records/{rec['id']}/confirm", headers=teacher, json={"acknowledge_warnings": True})
    assert missing.status_code == 400
    saved = c.post(f"/api/records/{rec['id']}/confirm", headers=teacher,
                   json={"acknowledge_warnings": True, **NEAR_SCHOOL})
    assert saved.status_code == 200, saved.text

    assert c.post("/api/duty/out", headers=teacher, json=FAR_SCHOOL).status_code == 403
    out = c.post("/api/duty/out", headers=teacher, json=NEAR_SCHOOL).json()
    assert out["session"]["open"] is False

    # Head teacher corrects the hours, and can add a row when a punch was missed.
    edited = c.patch(f"/admin/duty/{out['session']['id']}", headers=ADMIN, json={
        "login_at": "2026-10-01T08:00:00", "logout_at": "2026-10-01T14:30:00",
        "note": "Corrected from the register"}).json()
    assert edited["edited"] is True and edited["hours"] == 6.5 and edited["source"] == "gate"
    report = c.get("/admin/duty", headers=ADMIN, params={"school_id": sid, "from": "2026-10-01", "to": "2026-10-01"}).json()
    assert report["sessions"][0]["id"] == edited["id"] and report["hours_closed"] == 6.5
    added = c.post("/admin/duty", headers=ADMIN, json={
        "teacher_id": me["id"], "login_at": "2026-10-02T09:00:00", "logout_at": "2026-10-02T13:00:00",
        "note": "Forgot to mark login"}).json()
    assert added["source"] == "admin" and added["hours"] == 4
    assert c.delete(f"/admin/schools/{sid}/boundary", headers=ADMIN).json()["cleared"] is True
    assert c.get("/api/me", headers=teacher).json()["school"]["boundary"] is None


def test_delete_me_removes_followup_and_levels(c, teacher):
    from app.db import FollowUpAction, GrainMovement, LearningLevel, SessionLocal, StudentContact
    me = c.get("/api/me", headers=teacher).json()
    k3 = next(k for k in me["classes"] if k["grade"] == 3)
    kid = c.get(f"/api/levels?class_id={k3['id']}", headers=teacher).json()["children"][0]["student_id"]
    c.put("/api/levels", headers=teacher, json={"class_id": k3["id"], "items": [{"student_id": kid, "reading": "word"}]})
    c.put(f"/api/students/{kid}/contact", headers=teacher, json={"phone": "9811122333"})
    db = SessionLocal()
    assert db.get(StudentContact, kid) is not None
    db.close()
    assert c.post("/api/mdm/stock/received", headers=teacher,
                  json={"day": service.today().isoformat(), "kg": 2}).status_code == 200
    assert c.delete("/api/me", headers=teacher).json()["deleted"]
    db = SessionLocal()
    assert db.query(GrainMovement).filter_by(teacher_id=me["id"]).count() == 0
    assert db.get(StudentContact, kid) is None
    assert db.query(LearningLevel).filter_by(student_id=kid).count() == 0
    assert db.query(FollowUpAction).filter_by(student_id=kid).count() == 0
    db.close()


def test_grain_stock_from_confirmed_meals(c, teacher):
    """Classes 1–5 use 100 g, classes 6–8 use 150 g. Closing exists only after an opening entry."""
    from io import BytesIO
    from openpyxl import load_workbook
    me = c.get("/api/me", headers=teacher).json()
    added = c.post(f"/admin/teachers/{me['id']}/classes", headers=ADMIN, json={"grade": 8}).json()
    for roll, name in ((1, "Gita Rao"), (2, "Hari Lal")):
        assert c.post(f"/admin/teachers/{me['id']}/classes/{added['id']}/students", headers=ADMIN,
                      json={"roll_no": roll, "name": name}).status_code == 200
    d = service.today()
    _confirm_day(c, teacher, "Class 3, 10 present, meals 10", d)  # 1.0 kg at 100 g
    rec5 = note(c, teacher, "Class 5, 2 present, meals 2", d)["records"][0]
    assert "V13" in open_rules(rec5)
    assert c.post(f"/api/records/{rec5['id']}/confirm", headers=teacher, json={"acknowledge_warnings": True}).status_code == 200
    _confirm_day(c, teacher, "Class 8, 2 present, meals 2", d)  # 0.3 kg at 150 g
    note(c, teacher, "Class 3, 8 present, meals 8", d - timedelta(days=1))  # draft: must not count

    month = d.strftime("%Y-%m")
    s = c.get("/api/mdm/stock", headers=teacher, params={"month": month}).json()
    by = {row["grade"]: row for row in s["classes"]}
    assert by[3]["grams"] == 100 and by[3]["kg"] == 1.0
    assert by[5]["grams"] == 100 and by[5]["kg"] == 0.2
    assert by[8]["grams"] == 150 and by[8]["kg"] == 0.3
    assert s["consumed_kg"] == 1.5 and s["opening_kg"] is None and s["closing_kg"] is None
    assert s["norms"]["primary_g"] == 100 and s["norms"]["upper_g"] == 150

    s = c.post("/api/mdm/stock/opening", headers=teacher, json={"month": month, "kg": 10}).json()
    s = c.post("/api/mdm/stock/received", headers=teacher, json={"day": d.isoformat(), "kg": 5, "note": "FCI"}).json()
    assert s["opening_kg"] == 10 and s["received_kg"] == 5 and s["closing_kg"] == 13.5
    s = c.post("/api/mdm/stock/opening", headers=teacher, json={"month": month, "kg": 8}).json()
    assert s["opening_kg"] == 8 and s["closing_kg"] == 11.5
    assert sum(1 for m in s["movements"] if m["kind"] == "opening") == 1

    s = c.put("/api/mdm/norms", headers=teacher, params={"month": month},
              json={"primary_g": 200, "upper_g": 150}).json()
    by = {row["grade"]: row for row in s["classes"]}
    assert by[3]["kg"] == 2.0 and by[5]["kg"] == 0.4 and by[8]["kg"] == 0.3
    assert s["consumed_kg"] == 2.7 and s["closing_kg"] == 10.3

    rep = c.post("/api/reports", headers=teacher, json={"kind": "mdm", "month": month}).json()
    blob = c.get(rep["download_url"], headers=teacher).content
    ws = load_workbook(BytesIO(blob)).active
    rows = list(ws.iter_rows(values_only=True))
    assert rows[1][-1] == "Food grain (kg)"
    assert any(r[1] == "Class 3" and r[5] == 2.0 for r in rows)
    assert any(r[1] == "Class 8" and r[5] == 0.3 for r in rows)
    assert any(r[0] == "Used from confirmed meals, whole school (kg)" and r[1] == 2.7 for r in rows)
    assert any(r[0] == "Left (kg)" and r[1] == 10.3 for r in rows)

    received = next(m for m in s["movements"] if m["kind"] == "received")
    other = c.post("/admin/teachers", headers=ADMIN, json={
        "name": "Other", "phone": "9123499111", "language": "en", "school_name": "Other School", "state": "UP",
        "classes": [{"grade": 1}]}).json()
    code = c.post("/api/auth/request-code", json={"phone": "9123499111"}).json()["dev_code"]
    oh = {"Authorization": "Bearer " + c.post("/api/auth/verify", json={"phone": "9123499111", "code": code}).json()["token"]}
    assert c.delete(f"/api/mdm/stock/{received['id']}", headers=oh).status_code == 404
    assert c.get("/api/mdm/stock", headers=oh).json()["consumed_kg"] == 0
    assert other["id"]
    s = c.delete(f"/api/mdm/stock/{received['id']}", headers=teacher).json()
    assert s["received_kg"] == 0 and s["closing_kg"] == 5.3

    assert c.get("/api/mdm/stock", headers=teacher, params={"month": "2026-13"}).status_code == 422
    assert c.post("/api/mdm/stock/received", headers=teacher, json={"day": d.isoformat(), "kg": 0}).status_code == 422
    assert c.post("/api/mdm/stock/received", headers=teacher, json={"day": "2099-01-01", "kg": 1}).status_code == 400
    assert c.put("/api/mdm/norms", headers=teacher, json={"primary_g": 5, "upper_g": 150}).status_code == 422


# ---------------------------------------------------------------- shared schools, missed logouts

def _login(c, phone):
    code = c.post("/api/auth/request-code", json={"phone": phone}).json()["dev_code"]
    h = {"Authorization": "Bearer " + c.post("/api/auth/verify", json={"phone": phone, "code": code}).json()["token"]}
    assert c.post("/api/me/consent", headers=h).status_code == 200
    return h


def test_second_teacher_joins_the_same_school(c, teacher):
    me = c.get("/api/me", headers=teacher).json()
    sid = me["school"]["id"]
    picked = c.post("/admin/teachers", headers=ADMIN, json={
        "name": "Colleague", "phone": "9123477001", "language": "hi", "school_id": sid,
        "classes": [{"grade": 2}]}).json()
    assert picked["school"]["id"] == sid
    same_name = c.post("/admin/teachers", headers=ADMIN, json={
        "name": "Elsewhere", "phone": "9123477002", "language": "hi", "school_name": me["school"]["name"],
        "state": me["school"]["state"], "classes": [{"grade": 2}]}).json()
    assert same_name["school"]["id"] != sid  # a name alone never merges two schools
    a = c.post("/admin/teachers", headers=ADMIN, json={
        "name": "U1", "phone": "9123477003", "language": "hi", "school_name": "UDISE School", "state": "UP",
        "udise_code": "09123400101", "classes": [{"grade": 1}]}).json()
    b = c.post("/admin/teachers", headers=ADMIN, json={
        "name": "U2", "phone": "9123477004", "language": "hi", "school_name": "UDISE Sch.", "state": "UP",
        "udise_code": "09123400101", "classes": [{"grade": 6}]}).json()
    assert a["school"]["id"] == b["school"]["id"]
    assert c.post("/admin/teachers", headers=ADMIN, json={
        "name": "X", "phone": "9123477005", "language": "hi", "school_id": "nope", "classes": [{"grade": 1}]}).status_code == 404
    assert c.post("/admin/teachers", headers=ADMIN, json={
        "name": "X", "phone": "9123477006", "language": "hi", "classes": [{"grade": 1}]}).status_code == 422
    desk = next(s for s in c.get("/admin/schools", headers=ADMIN).json() if s["id"] == sid)
    assert {t["name"] for t in desk["teachers"]} >= {"Test Teacher", "Colleague"}


def test_grain_store_is_shared_by_the_school(c, teacher):
    me = c.get("/api/me", headers=teacher).json()
    c.post("/admin/teachers", headers=ADMIN, json={
        "name": "Grain Colleague", "phone": "9123477011", "language": "en", "school_id": me["school"]["id"],
        "classes": [{"grade": 7}]})
    other = _login(c, "9123477011")
    d = service.today()
    month = d.strftime("%Y-%m")
    _confirm_day(c, teacher, "Class 3, 10 present, meals 10", d)  # 1.0 kg
    c.post("/api/mdm/stock/opening", headers=other, json={"month": month, "kg": 20})
    mine = c.get("/api/mdm/stock", headers=teacher, params={"month": month}).json()
    theirs = c.get("/api/mdm/stock", headers=other, params={"month": month}).json()
    assert mine["consumed_kg"] == theirs["consumed_kg"] == 1.0
    assert mine["closing_kg"] == theirs["closing_kg"] == 19.0
    # The colleague leaves: the school's opening entry stays for the teacher who remains.
    assert c.delete("/api/me", headers=other).json()["deleted"]
    assert c.get("/api/mdm/stock", headers=teacher, params={"month": month}).json()["opening_kg"] == 20


def test_forgotten_logout_is_closed_not_counted(c, teacher):
    from app.db import DutySession, SessionLocal
    me = c.get("/api/me", headers=teacher).json()
    sid = me["school"]["id"]
    c.put(f"/admin/schools/{sid}/boundary", headers=ADMIN, json=SCHOOL_PIN)
    first = c.post("/api/duty/in", headers=teacher, json=NEAR_SCHOOL).json()["session"]
    db = SessionLocal()
    row = db.get(DutySession, first["id"])
    row.login_at = row.login_at - timedelta(days=1)  # left open since yesterday
    db.commit()
    db.close()

    st = c.get("/api/duty", headers=teacher).json()
    assert st["open"] is None and st["missed"][0]["id"] == first["id"]
    assert c.post("/api/duty/out", headers=teacher, json=NEAR_SCHOOL).status_code == 409
    again = c.post("/api/duty/in", headers=teacher, json=NEAR_SCHOOL)
    assert again.status_code == 200, again.text

    report = c.get("/admin/duty", headers=ADMIN, params={"school_id": sid}).json()  # today only
    missed = report["missed"]
    assert [m["id"] for m in missed] == [first["id"]] and missed[0]["hours"] == 0 and missed[0]["missed_logout"]
    day = missed[0]["day"]
    fixed = c.patch(f"/admin/duty/{first['id']}", headers=ADMIN, json={
        "login_at": f"{day}T08:00:00", "logout_at": f"{day}T14:00:00", "note": "From the staff register"}).json()
    assert fixed["hours"] == 6 and fixed["edited"]
    assert c.get("/admin/duty", headers=ADMIN, params={"school_id": sid}).json()["missed"] == []
    c.delete(f"/admin/schools/{sid}/boundary", headers=ADMIN)


def test_signup_and_pin_login(c, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "ALLOW_SIGNUP", True)
    body = {"name": "New Teacher", "phone": "9123456780", "pin": "482916"}
    assert c.post("/api/auth/signup", json={**body, "pin": "123456"}).status_code == 422  # weak
    assert c.post("/api/auth/signup", json={**body, "pin": "12ab56"}).status_code == 422  # not digits
    r = c.post("/api/auth/signup", json=body)
    assert r.status_code == 200 and r.json()["teacher"]["name"] == "New Teacher"
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert c.get("/api/me", headers=h).status_code == 200
    assert c.get("/api/roster", headers=h).json()  # sample roster loaded
    assert c.post("/api/auth/signup", json=body).status_code == 409  # number taken
    ok = c.post("/api/auth/login-pin", json={"phone": "+91 91234 56780", "pin": "482916"})
    assert ok.status_code == 200 and ok.json()["token"]
    for _ in range(5):
        assert c.post("/api/auth/login-pin", json={"phone": "9123456780", "pin": "000001"}).status_code == 401
    assert c.post("/api/auth/login-pin", json={"phone": "9123456780", "pin": "482916"}).status_code == 429  # locked
    assert c.post("/api/auth/login-pin", json={"phone": "9000000001", "pin": "482916"}).status_code == 401  # unknown
    monkeypatch.setattr(config, "ALLOW_SIGNUP", False)
    assert c.post("/api/auth/signup", json={**body, "phone": "9123456781"}).status_code == 403
