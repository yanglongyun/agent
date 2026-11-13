import { useState } from "react";

import { Icon, Mark } from "../icons/Icon";
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
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="login-brand">
          <Mark size={34} />
          <span>agentic</span>
        </div>
        <h1>连接工作区</h1>
        <p className="login-intro">使用访问令牌登录，继续你的工作。</p>
        <label className="login-label">
          访问令牌
          <input
            className="field-input mono"
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="访问令牌"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {error && (
          <div className="sheet-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="btn btn-accent login-submit"
          type="submit"
          disabled={!token.trim() || busy}
        >
          {busy ? (
            <>
              <Icon name="loading" className="spin" size={16} />
              正在连接…
            </>
          ) : (
            <>
              连接工作区
              <Icon name="arrow" size={16} />
            </>
          )}
        </button>
        <details className="login-help">
          <summary>在哪里找到访问令牌？</summary>
          <p>
            令牌在安装时显示，也可以在服务器上执行 <code>agent token</code> 查看。
          </p>
        </details>
      </form>
    </div>
  );
}
