import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 开发时 vite 只管界面,接口代理到本机运行的 agent serve。
// 需要接到另一个实例时设置 AGENT_API，例如 AGENT_API=http://127.0.0.1:9511。
const target = process.env.AGENT_API || "http://127.0.0.1:9500";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    proxy: {
      // 保留浏览器的 Host：服务端按 Origin 与 Host 是否一致拦截跨站写请求。
      "/api": { target, changeOrigin: false },
      "/healthz": { target, changeOrigin: false },
    },
  },
});
