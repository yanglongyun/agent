import { useState } from "react";
import { login } from "@/lib/auth";
import { Icon } from "@/icons/Icon";
import { Mark } from "@/icons/Mark";
import { useT } from "@/i18n";

// 口令登录：服务端校验后种 HttpOnly Cookie，前端只负责收集输入。
export function Login() {
  const t = useT();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (!token.trim() || busy) {
      return;
    }
    setBusy(true);
    setError("");
    login(token.trim())
      .catch((failure) => setError(failure instanceof Error ? failure.message : t("login.failed")))
      .finally(() => setBusy(false));
  };
  return (
    <main className="auth-screen">
      <div className="auth-card">
        <Mark size={56} />
        <h1>Agent</h1>
        <p className="auth-sub">{t("login.tagline")}</p>
        <form
          className="setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            className="input"
            type="password"
            autoFocus
            value={token}
            placeholder={t("login.tokenPlaceholder")}
            aria-label={t("login.tokenPlaceholder")}
            onChange={(event) => setToken(event.target.value)}
          />
          <button className="auth-btn primary" disabled={!token.trim() || busy}>
            {busy ? t("login.signingIn") : t("login.signIn")}
            <Icon name="chevronRight" size={15} />
          </button>
        </form>
        {error && <p className="auth-error">{error}</p>}
        <p className="auth-hint">{t("login.hint")}</p>
      </div>
    </main>
  );
}
