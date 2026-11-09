import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useLoad } from "./useLoad";

/** Today's mid-day-meal count, ready to send to the PM POSHAN SMS/IVRS system from the teacher's own phone. */
export function MdmCard() {
  const { data } = useLoad(() => api.mdmToday(), []);
  const [copied, setCopied] = useState(false);
  if (!data || data.classes_confirmed === 0) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(data!.sms_body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the text is visible to copy by hand */
    }
  }
  return (
    <section className="db-mdm" aria-labelledby="db-mdm-h">
      <div className="db-mdm-top">
        <div>
          <h2 id="db-mdm-h">Today’s MDM count</h2>
          <p className="db-mdm-sub num">
            {data.classes_confirmed} of {data.classes_total} classes confirmed
            {data.complete ? "" : " · send after all classes"}
          </p>
        </div>
        <p className="db-mdm-num num">
          {data.meals}
          <small>meals</small>
        </p>
      </div>
      <p className="db-mdm-msg">
        <span className="sr-only">Message: </span>
        <code>{data.sms_body}</code>
      </p>
      <div className="db-mdm-actions">
        <a className="btn btn-primary" href={data.sms_url}>
          Send SMS
        </a>
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="db-mdm-note">
        {data.format_note} Only confirmed records count. <Link to="/reports">Monthly MDM register</Link>
      </p>
    </section>
  );
}
