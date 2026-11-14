import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { Icon } from "./icons/Icon";
import { useAuth } from "./lib/auth";
import { LogsOverview } from "./logs/LogsOverview";
import { OwnerDetail } from "./logs/OwnerDetail";
import { Login } from "./login/Login";
import { NotesView } from "./notes/NotesView";
import { Settings } from "./settings/Settings";
import { rememberLocation } from "./shell/apps";
import { Frame } from "./shell/Frame";
import { StageHead } from "./shell/heads";
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
  // 外壳只有一份：导航、当前应用的列表栏和舞台。切换应用时外壳不重建。
  return <Frame />;
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

function NotFound() {
  return (
    <section className="stage">
      <StageHead title="页面不存在" />
      <main className="route-error">
        <Icon name="alert" size={28} />
        <h2>页面不存在</h2>
        <p>这个地址没有对应的页面。</p>
        <div className="route-error-actions">
          <Link className="btn btn-accent" to="/">
            返回新对话
          </Link>
        </div>
      </main>
    </section>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<ThreadView />} />
        <Route path="/sessions/:id" element={<ThreadView />} />
        <Route path="/logs" element={<LogsOverview />} />
        <Route path="/logs/overview" element={<LogsOverview />} />
        <Route path="/logs/:kind/:id" element={<OwnerDetail />} />
        <Route path="/notes" element={<NotesView />} />
        <Route path="/notes/:id" element={<NotesView />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
