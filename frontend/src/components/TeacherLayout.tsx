import { NavLink, Outlet } from "react-router-dom";
import "./TeacherLayout.css";

/** Phone-first shell: content column + bottom tab bar with the big Record button in the middle. */
export function TeacherLayout() {
  return (
    <div className="tl">
      <main className="tl-main">
        <Outlet />
      </main>
      <nav className="tl-nav" aria-label="Main">
        <NavLink to="/" end>
          <span aria-hidden>⌂</span>Home
        </NavLink>
        <NavLink to="/records">
          <span aria-hidden>☰</span>Records
        </NavLink>
        <NavLink to="/record" className="tl-record">
          <span aria-hidden>●</span>Record
        </NavLink>
        <NavLink to="/reports">
          <span aria-hidden>⎙</span>Reports
        </NavLink>
        <NavLink to="/settings">
          <span aria-hidden>⚙</span>Me
        </NavLink>
      </nav>
    </div>
  );
}
