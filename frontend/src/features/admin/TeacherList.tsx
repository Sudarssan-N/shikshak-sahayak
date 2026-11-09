import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminTeacher } from "../../api/types";
import { Button, EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { classList, formatShortDate, isKeyRejected, languageLabel, useAdmin } from "./shared";

export function useAdminTeachers() {
  const { rejectKey } = useAdmin();
  const [teachers, setTeachers] = useState<AdminTeacher[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTeachers(await api.adminTeachers());
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setLoading(false);
    }
  }, [rejectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { teachers, error, loading, reload: load };
}

export function TeacherList() {
  const { teachers, error, loading, reload } = useAdminTeachers();

  if (loading && !teachers) {
    return (
      <div className="ad-center">
        <Spinner />
      </div>
    );
  }
  if (error && !teachers) {
    return (
      <div className="stack">
        <ErrorNote error={error} />
        <div>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const list = [...(teachers ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const consented = list.filter((t) => t.consent_at).length;
  const withRoster = list.filter((t) => t.roster_size > 0).length;

  return (
    <div className="stack">
      <div className="ad-list-head">
        <div>
          <h2>Teachers</h2>
          {list.length ? (
            <p className="muted num">
              {list.length} registered · {withRoster} with roster · {consented} consent given
            </p>
          ) : null}
        </div>
        <div className="row">
          <Button variant="ghost" onClick={reload} loading={loading}>
            Refresh
          </Button>
          <Link to="/admin/onboard" className="btn btn-primary">
            + Onboard a teacher
          </Link>
        </div>
      </div>

      <ErrorNote error={error} />

      {!list.length ? (
        <EmptyState title="No teachers yet">
          <p>Onboarding takes about 5 minutes per teacher: profile, class roster, then a practice voice note.</p>
          <Link to="/admin/onboard" className="btn btn-primary">
            Onboard the first teacher
          </Link>
        </EmptyState>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table ad-table-cards">
            <thead>
              <tr>
                <th scope="col">Teacher</th>
                <th scope="col">Phone</th>
                <th scope="col">School</th>
                <th scope="col">Language</th>
                <th scope="col">Classes</th>
                <th scope="col" className="ad-right">
                  Roster
                </th>
                <th scope="col">Area</th>
                <th scope="col">Consent</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <th scope="row" data-label="Teacher">
                    {t.name}
                  </th>
                  <td data-label="Phone" className="num">
                    ••••{t.phone_last4}
                  </td>
                  <td data-label="School">
                    <div>
                      {t.school.name}
                      <span className="muted ad-small ad-block">
                        {t.school.state}
                        {t.school.udise_code ? ` · UDISE ${t.school.udise_code}` : ""}
                      </span>
                    </div>
                  </td>
                  <td data-label="Language">{languageLabel(t.language)}</td>
                  <td data-label="Classes" className="num">
                    {classList(t.classes)}
                  </td>
                  <td data-label="Roster" className="num ad-right">
                    {t.roster_size ? t.roster_size : <span className="ad-pill ad-pill-warn">No roster</span>}
                  </td>
                  <td data-label="Area">
                    {t.school.boundary ? (
                      <span className="ad-pill ad-pill-good">{t.school.boundary.radius_m} m</span>
                    ) : (
                      <span className="ad-pill ad-pill-warn">No area</span>
                    )}
                  </td>
                  <td data-label="Consent">
                    {t.consent_at ? (
                      <span className="ad-pill ad-pill-good" title={new Date(t.consent_at).toLocaleString("en-IN")}>
                        Given · {formatShortDate(t.consent_at)}
                      </span>
                    ) : (
                      <span className="ad-pill">Pending</span>
                    )}
                  </td>
                  <td data-label="" className="ad-actions">
                    <Link to={`/admin/school?teacher=${t.id}`} className="btn btn-secondary ad-btn-sm">
                      Class & hours
                      <span className="sr-only"> for {t.name}</span>
                    </Link>
                    <Link to={`/admin/teachers/${t.id}/roster`} className="btn btn-ghost ad-btn-sm">
                      {t.roster_size ? "CSV" : "Upload CSV"}
                      <span className="sr-only"> roster for {t.name}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted ad-small ad-quiet">
        The school desk shows the class list you maintain and teacher login and logout hours. It does not open
        children’s attendance, meals or voice notes. Consent turns to “Given” after the teacher reads the data note
        on first login.
      </p>
    </div>
  );
}
