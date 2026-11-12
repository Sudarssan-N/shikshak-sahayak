import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, RequireTeacher } from "./auth";
import { TeacherLayout } from "./components/TeacherLayout";
import LoginPage from "./features/capture/LoginPage";
import SignupPage from "./features/capture/SignupPage";
import WelcomePage from "./features/capture/WelcomePage";
import RecordPage from "./features/capture/RecordPage";
import HomePage from "./features/dashboard/HomePage";
import RecordsPage from "./features/dashboard/RecordsPage";
import RecordDetailPage from "./features/dashboard/RecordDetailPage";
import ReportsPage from "./features/dashboard/ReportsPage";
import SettingsPage from "./features/dashboard/SettingsPage";
import LevelsPage from "./features/dashboard/LevelsPage";
import AdminPage from "./features/admin/AdminPage";
import StatsPage from "./features/stats/StatsPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/admin/*" element={<AdminPage />} />
          {/* teacher, first run */}
          <Route
            path="/welcome"
            element={
              <RequireTeacher allowUnconsented>
                <WelcomePage />
              </RequireTeacher>
            }
          />
          {/* teacher app */}
          <Route
            element={
              <RequireTeacher>
                <TeacherLayout />
              </RequireTeacher>
            }
          >
            <Route path="/" element={<HomePage />} />
            <Route path="/record" element={<RecordPage />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/records/:id" element={<RecordDetailPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/levels" element={<LevelsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
