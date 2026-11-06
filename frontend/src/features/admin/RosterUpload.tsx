import { useId, useRef, useState, type DragEvent } from "react";
import { api } from "../../api/client";
import type { ClassSection, RosterUploadResult } from "../../api/types";
import { Button, ErrorNote, classLabel } from "../../components/ui";
import { EXPECTED_COLUMNS, downloadText, previewCsv, sampleCsv, type CsvPreview } from "./csv";
import { isKeyRejected, sortClasses, useAdmin } from "./shared";

const MAX_BYTES = 1024 * 1024;

export function RosterUpload({
  teacherId,
  teacherName,
  classes,
  onUploaded,
}: {
  teacherId: string;
  teacherName: string;
  classes: { grade: number; section: string | null }[];
  onUploaded?: (r: RosterUploadResult) => void;
}) {
  const { rejectKey } = useAdmin();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<RosterUploadResult | null>(null);

  async function choose(f: File | undefined) {
    setError(null);
    setFileError(null);
    setPreview(null);
    setFile(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setFileError(`"${f.name}" is not a CSV file. In Excel or Google Sheets use File → Download / Save as → CSV.`);
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError("File is larger than 1 MB. A class roster should be a few KB — check you picked the right file.");
      return;
    }
    const text = await f.text();
    const p = previewCsv(text);
    if (!p.total) {
      setFileError("The file has a header but no student rows.");
      return;
    }
    setFile(f);
    setPreview(p);
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const r = await api.adminUploadRoster(teacherId, file);
      setResult(r);
      onUploaded?.(r);
    } catch (e) {
      if (isKeyRejected(e)) rejectKey();
      else setError(e);
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setResult(null);
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files[0]);
  }

  if (result) return <UploadResult result={result} onRetry={reset} />;

  return (
    <div className="stack">
      <div className="ad-format">
        <p>
          One row per student. Columns, in this order:{" "}
          <code className="ad-code">{EXPECTED_COLUMNS.join(",")}</code>
        </p>
        <p className="muted ad-small">
          <code>section</code> may be left empty for single-section classes. Grades must match the classes you added (
          {classes.length ? classes.map((c) => classLabel(c.grade, c.section)).join(", ") : "none yet"}).
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            downloadText(`roster-sample-${teacherName.split(" ")[0].toLowerCase() || "teacher"}.csv`, sampleCsv(classes))
          }
        >
          Download sample CSV
        </Button>
      </div>

      <div
        className={`ad-drop ${dragging ? "is-drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="ad-drop-title">Drag the roster CSV here</p>
        <p className="muted ad-small">or</p>
        <input
          ref={inputRef}
          id={inputId}
          className="sr-only"
          type="file"
          accept=".csv,text/csv"
          aria-describedby={fileError ? `${inputId}-err` : undefined}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <label htmlFor={inputId} className="btn btn-secondary ad-file-btn">
          Choose file
        </label>
        {file ? (
          <p className="ad-small">
            Selected: <strong>{file.name}</strong> · <span className="num">{preview?.total}</span> student rows
          </p>
        ) : null}
      </div>
      <div aria-live="polite">
        {fileError ? (
          <p id={`${inputId}-err`} className="ad-inline-err">
            {fileError}
          </p>
        ) : null}
      </div>

      {preview ? <PreviewTable preview={preview} /> : null}

      <ErrorNote error={error} />
      {file ? (
        <div className="row">
          <Button type="button" onClick={upload} loading={uploading}>
            Upload {preview?.total} students
          </Button>
          <Button type="button" variant="ghost" onClick={reset} disabled={uploading}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PreviewTable({ preview }: { preview: CsvPreview }) {
  const cols = Math.max(preview.header.length, ...preview.rows.map((r) => r.length));
  return (
    <div className="stack">
      {preview.missing.length ? (
        <p className="ad-warn" role="status">
          Header is missing <strong>{preview.missing.join(", ")}</strong>. The first line must be{" "}
          <code>{EXPECTED_COLUMNS.join(",")}</code> — rows will probably be rejected.
        </p>
      ) : preview.unknown.length ? (
        <p className="ad-warn" role="status">
          Extra column(s) <strong>{preview.unknown.join(", ")}</strong> will be ignored or rejected by the server.
        </p>
      ) : null}
      <div className="ad-table-wrap">
        <table className="ad-table ad-table-plain">
          <caption className="ad-caption">
            Preview: first {preview.rows.length} of <span className="num">{preview.total}</span> rows (nothing uploaded
            yet)
          </caption>
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, i) => (
                <th key={i} scope="col">
                  {preview.header[i] ?? `(column ${i + 1})`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r, i) => (
              <tr key={i}>
                {Array.from({ length: cols }, (_, j) => (
                  <td key={j} className={j === 0 || preview.header[j] === "grade" ? "num" : undefined}>
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UploadResult({ result, onRetry }: { result: RosterUploadResult; onRetry: () => void }) {
  const classes: ClassSection[] = sortClasses(result.classes);
  return (
    <div className="stack" aria-live="polite">
      <div className={`ad-result ${result.rejected.length ? "has-rejects" : "ok"}`} role="status">
        <p className="ad-result-big">
          <span className="num">{result.accepted}</span> {result.accepted === 1 ? "student" : "students"} added
          {result.rejected.length ? (
            <>
              {" "}
              · <span className="num">{result.rejected.length}</span>{" "}
              {result.rejected.length === 1 ? "row" : "rows"} rejected
            </>
          ) : null}
        </p>
        {classes.length ? (
          <ul className="ad-chips">
            {classes.map((c) => (
              <li key={c.id}>
                {classLabel(c.grade, c.section)}: <strong className="num">{c.enrolled}</strong> enrolled
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {result.rejected.length ? (
        <>
          <div className="ad-table-wrap">
            <table className="ad-table ad-table-plain">
              <caption className="ad-caption">Rejected rows — fix these in the CSV, then upload it again</caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Row as uploaded</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.rejected.map((r) => (
                  <tr key={r.row}>
                    <td className="num">{r.row}</td>
                    <td>
                      <code className="ad-raw">{r.raw || "(empty)"}</code>
                    </td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <Button type="button" variant="secondary" onClick={onRetry}>
              Upload corrected CSV
            </Button>
          </div>
        </>
      ) : (
        <div className="row">
          <Button type="button" variant="ghost" onClick={onRetry}>
            Upload a different file
          </Button>
        </div>
      )}
    </div>
  );
}
