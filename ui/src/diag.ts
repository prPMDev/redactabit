// Privacy-safe diagnostics. Captures events + errors LOCALLY so a user can copy and
// share a log when reporting an issue. Hard rule for a redaction tool: this NEVER logs
// document text, matched values, redacted output, or file names — only event codes,
// error messages/stacks (capped), counts, timings, versions, and environment. Nothing
// is sent anywhere; export is user-initiated (clipboard, via diagnosticsText).

const KEY = "redacto.diag.v1";
const CAP = 300; // ring buffer: keep the most recent N entries
// Injected by Vite define; the typeof guard keeps plain-node runs (tests) safe.
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

type Level = "info" | "warn" | "error";
interface Entry { t: string; level: Level; event: string; data?: Record<string, unknown>; }

// In-memory ring buffer, parsed from storage ONCE; writes are debounced (errors flush
// immediately) so hot loops (e.g. per-entity warns inside NER windows) don't pay a full
// parse+stringify of the buffer per event. try/catch keeps this node-safe for tests.
let entries: Entry[] = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") as Entry[]; } catch { return []; }
})();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  flushTimer = null;
  entries = entries.slice(-CAP);
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* quota/node — ignore */ }
}

function push(level: Level, event: string, data?: Record<string, unknown>): void {
  entries.push({ t: new Date().toISOString(), level, event, data });
  if (level === "error") { // errors persist NOW — they're most valuable right before a crash
    if (flushTimer) clearTimeout(flushTimer);
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, 250);
  }
}

export function info(event: string, data?: Record<string, unknown>): void { push("info", event, data); }
export function warn(event: string, data?: Record<string, unknown>): void { push("warn", event, data); }

/** Log an error (also mirrors to console for dev visibility). Caps message/stack length. */
export function error(event: string, err: unknown, data?: Record<string, unknown>): void {
  const e = err as { message?: string; name?: string; stack?: string };
  push("error", event, {
    ...data,
    name: e?.name,
    message: (e?.message ? String(e.message) : String(err)).slice(0, 300),
    stack: e?.stack ? String(e.stack).slice(0, 1200) : undefined,
  });
  console.error(`[diag] ${event}:`, err);
}

/** Build the shareable report (metadata only) as a JSON string. */
export function diagnosticsText(): string {
  flush(); // make storage + report consistent with what's in memory
  const report = {
    app: "Redacto",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    env: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      cores: navigator.hardwareConcurrency,
      online: navigator.onLine,
    },
    entries,
  };
  return JSON.stringify(report, null, 2);
}

// Auto-capture failures that would otherwise vanish from the console (browser only).
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    error("uncaught_error", (e as ErrorEvent).error ?? (e as ErrorEvent).message, {
      source: (e as ErrorEvent).filename,
      line: (e as ErrorEvent).lineno,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    error("unhandled_rejection", (e as PromiseRejectionEvent).reason);
  });
  info("app_start", { version: VERSION });
}
