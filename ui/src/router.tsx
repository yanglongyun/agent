import { useEffect } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./lib/auth";
import { LogsApp } from "./logs/LogsApp";
import { LogsOverview } from "./logs/LogsOverview";
import { OwnerDetail } from "./logs/OwnerDetail";
import { Login } from "./login/Login";
import { AppBar } from "./shell/AppBar";
import { rememberLocation } from "./shell/apps";
import { Settings } from "./shell/Settings";
import { Sidebar } from "./shell/Sidebar";
import { ThreadView } from "./thread";

function ProtectedLayout() {
  const auth = useAuth((state) => state.state);
  const location = useLocation();
  useEffect(() => {
    rememberLocation(location.pathname + location.search);
  }, [location.pathname, location.search]);
  if (auth !== "in") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

// 对话应用：左侧会话列表 + 对话。其他应用没有这个侧栏。
function ChatLayout() {
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
        <Route element={<ChatLayout />}>
          <Route path="/" element={<ThreadView />} />
          <Route path="/sessions/:id" element={<ThreadView />} />
        </Route>
        <Route path="/logs" element={<LogsApp />}>
          <Route index element={<LogsOverview />} />
          <Route path="overview" element={<LogsOverview />} />
          <Route path=":kind/:id" element={<OwnerDetail />} />
        </Route>
        <Route path="/settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <section className="thread">
              <AppBar title="页面不存在" />
              <main className="route-error">
                <h1>页面不存在</h1>
                <Link to="/">返回新对话</Link>
              </main>
            </section>
          }
        />
      </Route>
    </Routes>
  );
}
