import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, session } from "./api/client";
import type { Teacher } from "./api/types";
import { Spinner } from "./components/ui";

interface AuthState {
  teacher: Teacher | null;
  loading: boolean;
  setSession: (token: string, teacher: Teacher) => void;
  refresh: () => Promise<void>;
  setTeacher: (t: Teacher) => void;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(Boolean(session.token));

  const refresh = useCallback(async () => {
    if (!session.token) {
      setTeacher(null);
      setLoading(false);
      return;
    }
    try {
      setTeacher(await api.me());
    } catch {
      session.token = null;
      setTeacher(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: AuthState = {
    teacher,
    loading,
    refresh,
    setTeacher,
    setSession: (token, t) => {
      session.token = token;
      setTeacher(t);
    },
    logout: () => {
      session.token = null;
      setTeacher(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** Teacher-only route. Sends unauthenticated users to /login and un-consented ones to /welcome. */
export function RequireTeacher({ children, allowUnconsented = false }: { children: ReactNode; allowUnconsented?: boolean }) {
  const { teacher, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <Spinner />
      </div>
    );
  if (!teacher) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!teacher.consent_at && !allowUnconsented) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}
