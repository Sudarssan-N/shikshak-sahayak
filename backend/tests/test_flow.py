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
