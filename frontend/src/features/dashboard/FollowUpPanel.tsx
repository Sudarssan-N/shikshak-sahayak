import { api } from "../../api/client";
import type { FollowUpChild } from "../../api/types";
import { classLabel, formatDate } from "../../components/ui";
import { useLoad } from "./useLoad";

/** Dropout early-warning on Home: children who keep missing school, from confirmed records only. */
export function FollowUpPanel() {
  const { data, error } = useLoad(() => api.followUp(), []);
  if (error || !data) return null; // never block Home on this panel
  const kids = data.children;
  return (
    <section className="db-section" aria-labelledby="db-fu-h">
      <div className="db-section-head">
        <h2 id="db-fu-h">Children to follow up</h2>
        {kids.length ? <span className="db-count db-count-warn num">{kids.length}</span> : null}
      </div>
      {kids.length === 0 ? (
        <p className="db-fu-empty">
          No child has missed {data.streak_min} school days in a row or dropped below {data.pct_min}% this month.
        </p>
      ) : (
        <>
          <ul className="db-list">
            {kids.slice(0, 5).map((k) => (
              <FollowUpRow key={k.student_id} child={k} />
            ))}
          </ul>
          <p className="db-fu-note">
            A home visit or a call to the parents in the first week of absence is the best chance to bring a child back.
          </p>
        </>
      )}
    </section>
  );
}

function FollowUpRow({ child: k }: { child: FollowUpChild }) {
  const urgent = k.streak >= 5 || k.attendance_pct < 50;
  return (
    <li className="db-fu-row">
      <span className={`db-fu-streak ${urgent ? "db-fu-urgent" : ""}`} aria-hidden>
        <strong className="num">{k.streak >= 3 ? k.streak : `${k.attendance_pct}%`}</strong>
        <small>{k.streak >= 3 ? "days" : "came"}</small>
      </span>
      <span className="db-row-main">
        <span className="db-row-title">
          {k.name} <span className="muted num">#{k.roll_no}</span>
        </span>
        <span className="db-row-meta">
          <span>{classLabel(k.grade, k.section)}</span>
          <span>{k.reasons.join(" · ")}</span>
          {k.last_present ? <span>last came {formatDate(k.last_present)}</span> : null}
        </span>
      </span>
    </li>
  );
}
