import { Link, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { RosterUpload } from "./RosterUpload";
import { useAdminTeachers } from "./TeacherList";
import { classList } from "./shared";

/** Upload (or re-upload) a roster for a teacher who is already registered. */
export function TeacherRosterPage() {
  const { id } = useParams();
  const { teachers, error, loading, reload } = useAdminTeachers();
  const teacher = teachers?.find((t) => t.id === id);

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
  if (!teacher) {
    return (
      <EmptyState title="Teacher not found">
        <Link to="/admin" className="btn btn-secondary">
          Back to teacher list
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <Link to="/admin" className="ad-back">
        ← All teachers
      </Link>
      <Card className="ad-wizard-card">
        <div className="stack">
          <div>
            <h2>Class roster · {teacher.name}</h2>
            <p className="muted num">
              {teacher.school.name} · Classes {classList(teacher.classes)} ·{" "}
              {teacher.roster_size ? `${teacher.roster_size} students on file now` : "no roster yet"}
            </p>
          </div>
          <RosterUpload
            teacherId={teacher.id}
            teacherName={teacher.name}
            classes={teacher.classes}
            onUploaded={() => void reload()}
          />
        </div>
      </Card>
    </div>
  );
}
