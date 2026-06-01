import { defineConfig } from "vite";

// Front-end lives in ui/; build output goes to ui/dist (Tauri's frontendDist).
// Port 1420 matches tauri.conf.json devUrl. clearScreen:false so Tauri logs stay visible.
export default defineConfig({
  root: "ui",
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
