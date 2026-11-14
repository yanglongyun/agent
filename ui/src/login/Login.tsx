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
    <main className="gate">
      <div className="aurora" aria-hidden="true" />
      <form
        className="login-card float-in"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Mark size={48} />
        <h1>连接到 agent</h1>
        <p className="login-intro">输入访问令牌，回到你的工作区。</p>
        <label className="field">
          访问令牌
          <input
            className="field-input mono"
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="粘贴访问令牌"
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
              连接
              <Icon name="arrow" size={16} />
            </>
          )}
        </button>
        <p className="login-help">
          令牌在安装时显示，也可以在服务器上执行 <code>agent token</code> 查看。
        </p>
      </form>
    </main>
  );
}
