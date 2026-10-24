import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./authContextValue";
import menus from "./menu";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import ChangePassword from "./pages/ChangePassword";
import Dashboard from "./pages/Dashboard";
import Placeholder from "./pages/Placeholder";
import Organization from "./pages/Organization";
import Users from "./pages/Users";
import Employees from "./pages/Employees";
import Attendance from "./pages/Attendance";
import LeaveInbox from "./pages/LeaveInbox";
import Payroll from "./pages/Payroll";
import MyAttendance from "./pages/MyAttendance";
import MyLeave from "./pages/MyLeave";
import Payslips from "./pages/Payslips";
import Profile from "./pages/Profile";
import Announcements from "./pages/Announcements";
import Notifications from "./pages/Notifications";
import AuditLog from "./pages/AuditLog";

function Protected({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword)
    return <Navigate to="/change-password" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();

  const isStaff = user && user.role !== "employee";

  const pages = {
    "/organization": <Organization />,
    "/users": <Users />,
    "/employees": <Employees />,
    "/payroll": <Payroll />,
    "/attendance": isStaff ? <Attendance /> : <MyAttendance />,
    "/leave": isStaff ? <LeaveInbox /> : <MyLeave />,
    "/payslips": <Payslips />,
    "/profile": <Profile />,
    "/announcements": <Announcements />,
    "/notifications": <Notifications />,
    "/audit": <AuditLog />,
  };

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/change-password"
        element={user ? <ChangePassword /> : <Navigate to="/login" replace />}
      />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        {user &&
          menus[user.role]
            .filter((item) => item.path !== "/")
            .map((item) => (
              <Route
                key={item.path}
                path={item.path}
                element={pages[item.path] || <Placeholder title={item.label} />}
              />
            ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
