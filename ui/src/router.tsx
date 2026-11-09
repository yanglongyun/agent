import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./lib/auth";
import { Login } from "./login/Login";
import { Sidebar } from "./shell/Sidebar";
import { Settings } from "./shell/Settings";
import { ThreadView } from "./thread";

function ProtectedLayout() {
  const auth = useAuth((state) => state.state);
  const location = useLocation();
  if (auth !== "in") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <>
      <Sidebar />
      <Outlet />
    </>
  );
}

function LoginPage() {
  const auth = useAuth((state) => state.state);
  const location = useLocation();
  if (auth === "in") {
    const from = location.state?.from;
    // 登录后只允许回到本站页面。
    const destination =
      typeof from === "string" &&
      from.startsWith("/") &&
      !from.startsWith("//") &&
      !from.includes("\\") &&
      from !== "/login"
        ? from
        : "/";
    return <Navigate to={destination} replace />;
  }
  return <Login />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<ThreadView />} />
        <Route path="/sessions/:id" element={<ThreadView />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <main className="route-error">
              <h1>页面不存在</h1>
              <Link to="/">返回新对话</Link>
            </main>
          }
        />
      </Route>
    </Routes>
  );
}
