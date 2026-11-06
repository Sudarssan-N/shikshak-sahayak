// Shared primitives. Features import from here; add new shared pieces in a new file, not by editing these.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Flag, RecordStatus, Severity } from "../api/types";
import "./ui.css";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  block,
  loading,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; loading?: boolean }) {
  return (
    <button
      className={`btn btn-${variant} ${block ? "btn-block" : ""} ${className}`}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner small /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = "", tone }: { children: ReactNode; className?: string; tone?: Severity | "good" }) {
  return <section className={`card ${tone ? `card-${tone}` : ""} ${className}`}>{children}</section>;
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={`spinner ${small ? "spinner-sm" : ""}`} role="status" aria-label="Loading" />;
}

const STATUS_LABEL: Record<RecordStatus, string> = {
  draft: "Draft",
  flagged: "Needs check",
  confirmed: "Confirmed",
  superseded: "Replaced",
};

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

const SEVERITY_LABEL: Record<Severity, string> = { block: "Must fix", warn: "Check", info: "Note" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge badge-sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

/** Open flags, Block first. Pass `all` to include resolved ones (dimmed). */
export function FlagList({ flags, all = false }: { flags: Flag[]; all?: boolean }) {
  const order: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
  const shown = flags
    .filter((f) => all || f.resolution === "open")
    .sort((a, b) => order[a.severity] - order[b.severity]);
  if (!shown.length) return null;
  return (
    <ul className="flag-list">
      {shown.map((f) => (
        <li key={f.id} className={`flag flag-${f.severity} ${f.resolution !== "open" ? "flag-resolved" : ""}`}>
          <SeverityBadge severity={f.severity} />
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p className="error-note" role="alert">
      {msg}
    </p>
  );
}

export function classLabel(grade: number, section: string | null) {
  return `Class ${grade}${section ? `-${section}` : ""}`;
}

export function formatDate(iso: string | null) {
  if (!iso) return "No date";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
