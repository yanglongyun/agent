// 登录状态。服务端用 HttpOnly Cookie 记会话,前端只知道「在 / 不在」。
import { create } from "zustand";

import { toast } from "../overlay/toast";
import { api, ApiError } from "./api";

export type AuthState = "checking" | "in" | "out" | "error";

export const useAuth = create<{ state: AuthState; error: string }>(() => ({
  state: "checking",
  error: "",
}));

export const setAuthed = (ok: boolean) => useAuth.setState({ state: ok ? "in" : "out" });

export async function checkAuth() {
  useAuth.setState({ state: "checking", error: "" });
  try {
    await api.get("/api/auth/me");
    setAuthed(true);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setAuthed(false);
    } else {
      useAuth.setState({
        state: "error",
        error: error instanceof Error ? error.message : "登录状态检查失败",
      });
    }
  }
}

export async function login(token: string) {
  await api.post("/api/auth/login", { token });
  setAuthed(true);
}

export async function logout() {
  try {
    await api.post("/api/auth/logout");
    setAuthed(false);
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "退出登录失败");
    return false;
  }
}
