import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminSchool } from "../../api/types";
import { Button, EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { BoundaryPanel } from "./BoundaryPanel";
import { HoursPanel } from "./HoursPanel";
import { PeoplePanel } from "./PeoplePanel";
import { isKeyRejected, useAdmin } from "./shared";

/** Head-teacher desk: the school circle, login/logout hours, and who is in each class. */
export function SchoolDesk() {
  const { rejectKey } = useAdmin();
  const [params] = useSearchParams();
  const focus = params.get("teacher");
  const [schools, setSchools] = useState<AdminSchool[] | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.adminSchools();
      setSchools(list);
      setSchoolId((cur) => {
        if (cur && list.some((s) => s.id === cur)) return cur;
        const focused = list.find((s) => s.teachers.some((t) => t.id === focus));
        return focused?.id ?? list[0]?.id ?? null;
      });
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setLoading(false);
    }
  }, [focus, rejectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !schools) {
    return (
      <div className="ad-center">
        <Spinner />
      </div>
    );
  }
  if (error && !schools) {
    return (
      <div className="stack">
        <ErrorNote error={error} />
        <Button variant="secondary" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }
  if (!schools?.length || !schoolId) {
    return (
      <EmptyState title="No school yet">
        <p>Onboard a teacher first. Their school shows up here, ready for a class list and a school area.</p>
        <Link to="/admin/onboard" className="btn btn-primary">Onboard a teacher</Link>
      </EmptyState>
    );
  }

  const school = schools.find((s) => s.id === schoolId) ?? schools[0];

  return (
    <div className="stack">
      <div className="ad-list-head">
        <div>
          <h2>School desk</h2>
          <p className="muted">
            Add children to a class, correct login and logout hours, and set the circle around the school.
            Teachers mark attendance only from inside that circle.
          </p>
        </div>
        {schools.length > 1 ? (
          <div className="field">
            <label htmlFor="desk-school">School</label>
            <select id="desk-school" className="input" value={school.id} onChange={(e) => setSchoolId(e.target.value)}>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.teachers.length} teacher{s.teachers.length === 1 ? "" : "s"}
                  {s.boundary ? " · area set" : " · no area"}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="muted ad-small">
            {school.name}, {school.state}
            {school.udise_code ? ` · UDISE ${school.udise_code}` : ""}
          </p>
        )}
      </div>
      {!school.boundary ? (
        <p className="ad-warn">This school has no area yet. Set the circle before teachers mark login or class attendance on site.</p>
      ) : null}
      <div className="ad-desk">
        <BoundaryPanel key={school.id} school={school} onChanged={load} />
        <div className="ad-desk-main">
          <HoursPanel key={`${school.id}-h`} school={school} />
          <PeoplePanel key={`${school.id}-p`} school={school} focusTeacher={focus} onChanged={load} />
        </div>
      </div>
    </div>
  );
}
