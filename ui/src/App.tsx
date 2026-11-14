import * as Tooltip from "@radix-ui/react-tooltip";
import { Mark } from "./icons/Icon";
import { useEffect } from "react";

import { AppRoutes } from "./router";
import { ToastHost } from "./overlay/toast";
import { checkAuth, useAuth } from "./lib/auth";
import { init, dispose } from "./thread/store";

export function App() {
  const { state: auth, error } = useAuth();

  useEffect(() => {
    void checkAuth();
  }, []);
  useEffect(() => {
    if (auth !== "in") {
      return;
    }
    void init();
    return dispose;
  }, [auth]);

  if (auth === "checking") {
    return (
      <main className="gate">
        <div className="gate-status">
          <Mark size={44} />
          <span className="sheen">正在连接工作区…</span>
        </div>
      </main>
    );
  }
  if (auth === "error") {
    return (
      <main className="gate">
        <div className="gate-status">
          <Mark size={44} />
          <p>{error}</p>
          <button className="btn btn-accent" onClick={() => void checkAuth()}>
            重新连接
          </button>
        </div>
      </main>
    );
  }
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={100}>
      <AppRoutes />
      <ToastHost />
    </Tooltip.Provider>
  );
}
