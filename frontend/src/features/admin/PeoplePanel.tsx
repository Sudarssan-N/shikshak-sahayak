import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminSchool, ClassStudentRow } from "../../api/types";
import { Button, Card, ErrorNote } from "../../components/ui";
import { GRADES, classList, isKeyRejected, useAdmin } from "./shared";

/** Add a class, then add children to it, one at a time. CSV upload stays on the roster page. */
export function PeoplePanel({
  school,
  focusTeacher,
  onChanged,
}: {
  school: AdminSchool;
  focusTeacher: string | null;
  onChanged: () => Promise<void>;
}) {
  const { rejectKey } = useAdmin();
  const initial = school.teachers.find((t) => t.id === focusTeacher)?.id ?? school.teachers[0]?.id ?? "";
  const [teacherId, setTeacherId] = useState(initial);
  const teacher = school.teachers.find((t) => t.id === teacherId) ?? school.teachers[0];
  const [classId, setClassId] = useState(teacher?.classes[0]?.id ?? "");
  const [students, setStudents] = useState<ClassStudentRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [roll, setRoll] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [grade, setGrade] = useState(1);
  const [section, setSection] = useState("");
  const [addingClass, setAddingClass] = useState(false);
  const [showClass, setShowClass] = useState(false);

  const klass = teacher?.classes.find((c) => c.id === classId) ?? teacher?.classes[0];
  const teacherKey = teacher?.id ?? "";
  const classKey = klass?.id ?? "";

  useEffect(() => {
    if (!teacherKey || !classKey) {
      setStudents([]);
      return;
    }
    let live = true;
    setStudents(null);
    api.adminStudents(teacherKey, classKey).then(
      (r) => {
        if (live) setStudents(r.students);
      },
      (e) => {
        if (!live) return;
        if (isKeyRejected(e)) rejectKey();
        else setError(e);
      },
    );
    return () => {
      live = false;
    };
  }, [teacherKey, classKey, rejectKey]);

  function pickTeacher(id: string) {
    setTeacherId(id);
    const next = school.teachers.find((t) => t.id === id);
    setClassId(next?.classes[0]?.id ?? "");
    setPendingRemove(null);
  }

  async function addStudent() {
    if (!teacher || !klass) return;
    const rollNo = Number(roll);
    if (!Number.isInteger(rollNo) || rollNo < 1) {
      setError(new Error("Enter a roll number."));
      return;
    }
    if (!name.trim()) {
      setError(new Error("Enter the child's name."));
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await api.adminAddStudent(teacher.id, klass.id, { roll_no: rollNo, name: name.trim() });
      setRoll("");
      setName("");
      const r = await api.adminStudents(teacher.id, klass.id);
      setStudents(r.students);
      await onChanged();
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setAdding(false);
    }
  }

  async function setActive(student: ClassStudentRow, active: boolean) {
    if (!teacher || !klass) return;
    setError(null);
    try {
      await api.adminPatchStudent(teacher.id, klass.id, student.id, { active });
      const r = await api.adminStudents(teacher.id, klass.id);
      setStudents(r.students);
      setPendingRemove(null);
      await onChanged();
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    }
  }

  async function addClass() {
    if (!teacher) return;
    setAddingClass(true);
    setError(null);
    try {
      const created = await api.adminAddClass(teacher.id, { grade, section: section.trim() || null });
      setShowClass(false);
      setSection("");
      setClassId(created.id);
      await onChanged();
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setAddingClass(false);
    }
  }

  if (!teacher) {
    return (
      <Card>
        <h2>Class list</h2>
        <p className="muted">This school has no teacher yet.</p>
      </Card>
    );
  }

  const active = (students ?? []).filter((s) => s.active);
  const inactive = (students ?? []).filter((s) => !s.active);

  return (
    <Card>
      <div className="ad-list-head">
        <h2>Class list</h2>
        <Link to={`/admin/teachers/${teacher.id}/roster`} className="ad-back ad-small">
          Upload a CSV instead
        </Link>
      </div>
      <div className="ad-grid">
        <div className="field">
          <label htmlFor="pp-teacher">Teacher</label>
          <select id="pp-teacher" className="input" value={teacher.id} onChange={(e) => pickTeacher(e.target.value)}>
            {school.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {classList(t.classes)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pp-class">Class</label>
          <select id="pp-class" className="input" value={klass?.id ?? ""} onChange={(e) => setClassId(e.target.value)} disabled={!teacher.classes.length}>
            {teacher.classes.length ? (
              teacher.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  Class {c.grade}{c.section ? `-${c.section}` : ""} · {c.enrolled} children
                </option>
              ))
            ) : (
              <option value="">No class yet</option>
            )}
          </select>
        </div>
      </div>

      {klass ? (
        <form
          className="ad-people-add"
          onSubmit={(e) => {
            e.preventDefault();
            void addStudent();
          }}
        >
          <div className="field">
            <label htmlFor="pp-roll">Roll</label>
            <input id="pp-roll" className="input" inputMode="numeric" value={roll} onChange={(e) => setRoll(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pp-name">Child's name</label>
            <input id="pp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <Button type="submit" loading={adding} disabled={!klass}>
            Add to class
          </Button>
        </form>
      ) : (
        <p className="muted">Add a class before adding children.</p>
      )}

      {students === null ? <p className="muted">Loading the class…</p> : null}
      {students && !active.length && klass ? <p className="muted">No children in this class yet.</p> : null}
      {active.length ? (
        <ul className="ad-people">
          {active.map((s) => (
            <li key={s.id}>
              <span className="num ad-roll">{s.roll_no}</span>
              <span>{s.name}</span>
              {pendingRemove === s.id ? (
                <span className="row">
                  <Button variant="danger" className="ad-btn-sm" onClick={() => void setActive(s, false)}>
                    Remove
                  </Button>
                  <Button variant="ghost" className="ad-btn-sm" onClick={() => setPendingRemove(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" className="ad-btn-sm" onClick={() => setPendingRemove(s.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {inactive.length ? (
        <div className="ad-quiet">
          <p className="muted ad-small">Removed from the register. Past records still name them.</p>
          <ul className="ad-people">
            {inactive.map((s) => (
              <li key={s.id}>
                <span className="num ad-roll">{s.roll_no}</span>
                <span className="muted">{s.name}</span>
                <Button variant="secondary" className="ad-btn-sm" onClick={() => void setActive(s, true)}>
                  Put back
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showClass ? (
        <form
          className="ad-people-add"
          onSubmit={(e) => {
            e.preventDefault();
            void addClass();
          }}
        >
          <div className="field">
            <label htmlFor="pp-grade">Grade</label>
            <select id="pp-grade" className="input" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pp-sec">Section</label>
            <input id="pp-sec" className="input" value={section} maxLength={4} onChange={(e) => setSection(e.target.value)} placeholder="A, if any" />
          </div>
          <Button type="submit" loading={addingClass}>
            Add class
          </Button>
        </form>
      ) : (
        <Button variant="ghost" className="ad-btn-sm" onClick={() => setShowClass(true)}>
          Add a class
        </Button>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}
