import { useEffect } from "react";
import { Navigate, Route, Routes } from "@/lib/router";
import { Sidebar } from "@/app/sidebar/Sidebar";
import { ToastHost } from "@/overlay/ToastHost";
import { ConfirmHost } from "@/overlay/ConfirmHost";
import { Boundary } from "@/overlay/Boundary";
import { checkAuth, useAuth } from "@/lib/auth";
import { init, dispose } from "@/thread/store";
import { Mark } from "@/icons/Mark";
import { useT } from "@/i18n";
import { Login } from "@/login/Login";
import Conversation from "@/chat";
import SettingsApp from "@/settings";
import { RenameDialog } from "@/chat/RenameDialog";

export default function App() {
  const t = useT();
  const auth = useAuth();
  useEffect(() => {
    void checkAuth();
  }, []);
  useEffect(() => {
    if (auth.state !== "in") {
      return;
    }
    void init();
    return dispose;
  }, [auth.state]);
  if (auth.state === "checking") {
    return (
      <main className="auth-screen">
        <div className="gate-status">
          <Mark size={44} />
          <span className="sheen">{t("gate.connecting")}</span>
        </div>
      </main>
    );
  }
  if (auth.state === "error") {
    return (
      <main className="auth-screen">
        <div className="gate-status">
          <Mark size={44} />
          <p>{auth.error}</p>
          <button className="auth-btn primary" onClick={() => void checkAuth()}>
            {t("gate.retry")}
          </button>
        </div>
      </main>
    );
  }
  if (auth.state !== "in") {
    return <Login />;
  }
  return (
    <Boundary>
      <div className="shell">
        <Sidebar />
        <div className="shell-main">
          <Routes>
            <Route path="/" element={<Navigate to="/conversation" replace />} />
            <Route path="/conversation" element={<Conversation />} />
            <Route path="/settings" element={<SettingsApp />} />
            <Route path="*" element={<Navigate to="/conversation" replace />} />
          </Routes>
        </div>
      </div>
      <ToastHost />
      <ConfirmHost />
      <RenameDialog />
    </Boundary>
  );
}
