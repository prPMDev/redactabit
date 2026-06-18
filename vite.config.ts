import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

// Front-end lives in ui/; build output goes to ui/dist (Tauri's frontendDist).
// Port 1420 matches tauri.conf.json devUrl. clearScreen:false so Tauri logs stay visible.
export default defineConfig({
  root: "ui",
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  // Single version source: package.json (Cargo.toml/tauri.conf.json stay manual — see release checklist).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // transformers.js + onnxruntime-web ship their own ESM + wasm; don't let Vite pre-bundle
  // them (it breaks the import.meta.url-based wasm path resolution).
  optimizeDeps: { exclude: ["@huggingface/transformers", "onnxruntime-web", "mupdf"] },
});
