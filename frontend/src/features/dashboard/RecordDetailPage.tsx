import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { DailyRecord } from "../../api/types";
import { Button, Card, ErrorNote, PageHeader, Spinner, StatusBadge, classLabel, formatDate } from "../../components/ui";
import { formatDateTime } from "./dates";
import { ConfirmButton, DetailFlags, EditNumbers, NameResolver } from "./DetailParts";
import { useLoad } from "./useLoad";
import "./dashboard.css";

export default function RecordDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: record, error, loading, reload, setData } = useLoad(() => api.record(id), [id]);
  const [editing, setEditing] = useState(false);
  const [announce, setAnnounce] = useState("");

  function onUpdate(r: DailyRecord, msg: string) {
    setEditing(false);
    setAnnounce(msg);
    if (r.id !== id) navigate(`/records/${r.id}`, { replace: true });
    else setData(r);
  }

  if (loading && !record)
    return (
      <div className="row" aria-live="polite">
        <Spinner /> <span className="muted">Loading record…</span>
      </div>
    );
  if (error || !record)
    return (
      <div className="db-page">
        <Link to="/records">‹ All records</Link>
        <ErrorNote error={error ?? "Record not found."} />
        <Button variant="secondary" onClick={() => void reload()}>Try again</Button>
      </div>
    );

  return (
    <div className="db-page">
      <Link to="/records" className="btn btn-ghost" style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
        ‹ All records
      </Link>
      <PageHeader
        title={classLabel(record.grade, record.section)}
        subtitle={formatDate(record.record_date)}
        action={<StatusBadge status={record.status} />}
      />
      <p className="sr-only" aria-live="polite">{announce}</p>

      {record.status === "superseded" ? (
        <p className="db-banner">Replaced by a newer version. This copy is kept for your records only.</p>
      ) : null}

      <RecordBody record={record} />

      {record.unresolved_names.length > 0 && record.status !== "superseded" ? (
        <section className="db-section" aria-labelledby="db-names-h">
          <h2 id="db-names-h">Names to match</h2>
          <NameResolver record={record} onUpdate={onUpdate} />
        </section>
      ) : null}

      {record.flags.length > 0 ? (
        <section className="db-section" aria-labelledby="db-flags-h">
          <h2 id="db-flags-h">Checks</h2>
          <DetailFlags flags={record.flags} />
        </section>
      ) : null}

      {record.status !== "superseded" ? (
        <Card>
          {editing ? (
            <EditNumbers record={record} onUpdate={onUpdate} onCancel={() => setEditing(false)} />
          ) : (
            <div className="db-actions">
              {record.status !== "confirmed" ? <ConfirmButton record={record} onUpdate={onUpdate} /> : null}
              <Button variant="secondary" block onClick={() => setEditing(true)}>
                {record.status === "confirmed" ? "Correct numbers" : "Edit numbers"}
              </Button>
            </div>
          )}
        </Card>
      ) : null}

      <dl className="db-kv muted" style={{ fontSize: "0.9rem" }}>
        <dt>Version</dt>
        <dd>{record.version}</dd>
        <dt>Created</dt>
        <dd>{formatDateTime(record.created_at)}</dd>
        <dt>Confirmed</dt>
        <dd>{record.confirmed_at ? formatDateTime(record.confirmed_at) : "Not yet"}</dd>
      </dl>
    </div>
  );
}

function RecordBody({ record: r }: { record: DailyRecord }) {
  const missing = new Set(r.missing_fields);
  const show = (v: number | null, field: string) => (v == null ? (missing.has(field) ? "Missing" : "—") : v);
  return (
    <>
      <dl className="db-stats">
        <div className="db-stat">
          <dt>Present</dt>
          <dd>
            {show(r.present, "present")}
            {r.enrolled != null ? <span className="muted" style={{ fontSize: "0.9rem", fontWeight: 400 }}>/{r.enrolled}</span> : null}
          </dd>
        </div>
        <div className="db-stat">
          <dt>Absent</dt>
          <dd>{r.present != null && r.enrolled != null ? (r.enrolled >= r.present ? r.enrolled - r.present : "—") : r.absent.length}</dd>
        </div>
        <div className="db-stat">
          <dt>Meals</dt>
          <dd>{show(r.meals_served, "meals_served")}</dd>
        </div>
      </dl>

      <section className="db-section" aria-labelledby="db-absent-h">
        <h2 id="db-absent-h">Absent students</h2>
        {r.absent.length ? (
          <ul className="db-names card" style={{ padding: "4px 14px" }}>
            {r.absent.map((s) => (
              <li key={s.student_id}>
                <span className="db-roll">{s.roll_no}</span>
                <span>{s.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No names given.</p>
        )}
      </section>

      <section className="db-section" aria-labelledby="db-lessons-h">
        <h2 id="db-lessons-h">Lessons</h2>
        {r.lessons.length ? (
          <ul className="db-names card" style={{ padding: "4px 14px" }}>
            {r.lessons.map((l, i) => (
              <li key={i}>
                <span style={{ flex: 1 }}>
                  <strong>{l.subject ?? "Subject not said"}</strong>
                  {l.lesson_ref ? ` · ${l.lesson_ref}` : ""}
                </span>
                {l.status ? <span className="muted">{l.status === "completed" ? "Completed" : "Started"}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No lessons mentioned.</p>
        )}
      </section>
    </>
  );
}
