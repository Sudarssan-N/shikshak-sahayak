import { useNavigate } from "react-router-dom";
import type { Language } from "../../api/types";
import { useAuth } from "../../auth";
import { Button, Card, PageHeader } from "../../components/ui";
import { DeleteData, RosterViewer } from "./SettingsParts";
import "./dashboard.css";

const LANG: Record<Language, string> = { hi: "हिन्दी (Hindi)", en: "English", mr: "मराठी (Marathi)", kn: "ಕನ್ನಡ (Kannada)" };

export default function SettingsPage() {
  const { teacher, logout } = useAuth();
  const navigate = useNavigate();
  if (!teacher) return null;

  return (
    <div className="db-page">
      <PageHeader title="Me" />

      <Card>
        <h2>{teacher.name}</h2>
        <dl className="db-kv">
          <dt>School</dt>
          <dd>{teacher.school.name}</dd>
          <dt>School area</dt>
          <dd>{teacher.school.boundary ? `${teacher.school.boundary.radius_m} m around the school` : "Not set yet"}</dd>
          <dt>State</dt>
          <dd>{teacher.school.state}</dd>
          {teacher.school.udise_code ? (
            <>
              <dt>UDISE</dt>
              <dd>{teacher.school.udise_code}</dd>
            </>
          ) : null}
          <dt>Language</dt>
          <dd>{LANG[teacher.language] ?? teacher.language}</dd>
          <dt>Confirmed</dt>
          <dd>{teacher.records_confirmed} records</dd>
        </dl>
      </Card>

      <section className="db-section" aria-labelledby="db-roster-h">
        <h2 id="db-roster-h">My class lists</h2>
        <RosterViewer />
      </section>

      <section className="db-section" aria-labelledby="db-privacy-h">
        <h2 id="db-privacy-h">Your data, your control</h2>
        <ul className="db-privacy">
          <li>You own your class lists and records. We never contact students or parents.</li>
          <li>We keep only names and roll numbers you already write in the register. No photos or addresses.</li>
          <li>Voice recordings are deleted once the words are written down, within 24 hours at most.</li>
          <li>Registers use only records you confirmed. No student scores or comparisons between teachers.</li>
          <li>Your head teacher sees the class list and the times you mark login and logout. Children’s attendance stays with you.</li>
          <li>Location is read only when you mark login, logout or confirm a class record, to check the school area. The phone does not follow you through the day.</li>
          <li>Public numbers on the stats page are totals only and never show who you are.</li>
        </ul>
      </section>

      <Button variant="secondary" block onClick={() => { logout(); navigate("/login", { replace: true }); }}>
        Log out
      </Button>

      <DeleteData />
    </div>
  );
}
