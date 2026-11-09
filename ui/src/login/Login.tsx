import { useState } from "react";

import { Mark } from "../icons/Icon";
import { login } from "../lib/auth";

export function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = token.trim();
    if (!value || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await login(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form
        className="sheet login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="login-brand">
          <Mark size={34} />
          <span>agentic</span>
        </div>
        <p className="sheet-note">
          请输入访问令牌。令牌在安装时输出,也可在服务器上执行 <code>agent token</code> 查看。
        </p>
        <input
          className="field-input mono"
          type="password"
          autoFocus
          autoComplete="off"
          placeholder="访问令牌"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        {error && <div className="sheet-error">{error}</div>}
        <button
          className="btn btn-accent login-submit"
          type="submit"
          disabled={!token.trim() || busy}
        >
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
