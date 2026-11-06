import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import "./TeacherLayout.css";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** Phone-first shell: content column + floating dark tab bar with the raised Record button in the middle. */
export function TeacherLayout() {
  return (
    <div className="tl">
      <main className="tl-main">
        <Outlet />
      </main>
      <nav className="tl-nav" aria-label="Main">
        <NavLink to="/" end>
          <Icon>
            <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
          </Icon>
          Home
        </NavLink>
        <NavLink to="/records">
          <Icon>
            <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
          </Icon>
          Records
        </NavLink>
        <NavLink to="/record" className="tl-record" aria-label="Record">
          <span className="tl-record-btn">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </span>
        </NavLink>
        <NavLink to="/reports">
          <Icon>
            <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
            <path d="M14 3v5h5M9 13h6M9 17h6" />
          </Icon>
          Reports
        </NavLink>
        <NavLink to="/settings">
          <Icon>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </Icon>
          Me
        </NavLink>
      </nav>
    </div>
  );
}
