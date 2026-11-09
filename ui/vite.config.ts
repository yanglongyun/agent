import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 开发时 vite 只管界面,接口代理到本机运行的 agent serve。
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
      "/api": "http://127.0.0.1:9528",
      "/healthz": "http://127.0.0.1:9528",
    },
  },
});
