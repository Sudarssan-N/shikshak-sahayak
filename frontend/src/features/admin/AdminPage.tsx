import { useCallback, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, session } from "../../api/client";
import { Button } from "../../components/ui";
import { KeyGate } from "./KeyGate";
import { OnboardWizard } from "./OnboardWizard";
import { TeacherList } from "./TeacherList";
import { TeacherRosterPage } from "./TeacherRosterPage";
import { AdminCtx, isKeyRejected } from "./shared";
import "./admin.css";

/** Pilot-lead console: /admin (teacher list), /admin/onboard, /admin/teachers/:id/roster. */
export default function AdminPage() {
  const [key, setKey] = useState<string | null>(() => session.adminKey);
  const [rejected, setRejected] = useState(false);

  const rejectKey = useCallback(() => {
    session.adminKey = null;
    setKey(null);
    setRejected(true);
  }, []);
  const ctx = useMemo(() => ({ rejectKey }), [rejectKey]);

  // Check the key once before entering, so a wrong key is caught here rather than mid-onboarding.
  async function save(k: string) {
    session.adminKey = k;
    try {
      await api.adminTeachers();
    } catch (e) {
      if (isKeyRejected(e)) {
        rejectKey();
        return;
      }
      // Any other failure (server down, etc.) is shown by the page itself.
    }
    setRejected(false);
    setKey(k);
  }

  function forget() {
    session.adminKey = null;
    setRejected(false);
    setKey(null);
  }

  return (
    <div className="ad-page">
      <header className="ad-top">
        <Link to="/admin" className="ad-brand">
          <span className="ad-brand-mark" aria-hidden="true">
            शि
          </span>
          <span>
            Shikshak Sahayak
            <span className="ad-brand-sub">Pilot lead</span>
          </span>
        </Link>
        {key ? (
          <nav className="ad-nav" aria-label="Pilot lead">
            <NavLink to="/admin" end>
              Teachers
            </NavLink>
            <NavLink to="/admin/onboard">Onboard</NavLink>
            <Link to="/stats">Impact</Link>
            <Button variant="ghost" className="ad-btn-sm" onClick={forget}>
              Forget key
            </Button>
          </nav>
        ) : null}
      </header>

      <main className="ad-main">
        {!key ? (
          <KeyGate rejected={rejected} onSave={save} />
        ) : (
          <AdminCtx.Provider value={ctx}>
            {/* key={key} remounts children after a new key is saved, so lists refetch. */}
            <Routes key={key}>
              <Route index element={<TeacherList />} />
              <Route path="onboard" element={<OnboardWizard />} />
              <Route path="teachers/:id/roster" element={<TeacherRosterPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </AdminCtx.Provider>
        )}
      </main>
    </div>
  );
}
