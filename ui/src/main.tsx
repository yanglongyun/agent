import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "@/lib/router";
import App from "./App";
import { applyTheme, useTheme } from "@/app/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/auth.css";
import "./styles/agent.css";
import "./app/shell.css";
import "./app/sidebar/sidebar.css";
import "./chat/chat.css";
import "./settings/settings.css";
import "./tasks/tasks.css";

applyTheme(useTheme.getState().theme);

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
