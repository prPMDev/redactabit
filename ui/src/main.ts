import { redact, Faker, type Mode, type Change } from "./engine";

// ───────── sidebar nav (kept from the old app.js) ─────────
const navLinks = document.querySelectorAll<HTMLAnchorElement>(".nav a");
const screens = document.querySelectorAll<HTMLElement>("[data-screen]");
function show(name: string) {
  navLinks.forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  screens.forEach((s) => { s.style.display = s.dataset.screen === name ? "" : "none"; });
  if (name === "history") renderHistory();
}
navLinks.forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); show(a.dataset.nav!); }));
show("redact");

// ───────── Redact screen elements ─────────
const screen = document.querySelector<HTMLElement>('[data-screen="redact"]')!;
const dropzone = screen.querySelector<HTMLElement>(".dropzone")!;
const optRows = screen.querySelectorAll<HTMLElement>(".options .opt");
const levelGroup = optRows[0].querySelector<HTMLElement>(".segmented")!;
const modeGroup = optRows[1].querySelector<HTMLElement>(".segmented")!;
const customInput = optRows[2].querySelector<HTMLInputElement>(".input")!;
const redactBtn = screen.querySelector<HTMLButtonElement>(".btn--primary.btn--block")!;
const resultEl = screen.querySelector<HTMLElement>(".result")!;

// segmented controls toggle aria-pressed within their own group
function wireSegmented(group: HTMLElement) {
  const btns = group.querySelectorAll<HTMLButtonElement>("button");
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
  }));
}
wireSegmented(levelGroup);
wireSegmented(modeGroup);

function activeLabel(group: HTMLElement): string {
  return (group.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent || "").trim();
}
const LEVELS: Record<string, number> = { Light: 1, Standard: 2, Heavy: 3 };
const MODES: Record<string, Mode> = { Fake: "fake", Mask: "mask", Tag: "redact" };

// ───────── file input (TEXT only this pass) ─────────
let currentText: string | null = null;
let currentName = "document.txt";

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".txt,.csv,.md,.markdown,.json,.xml,.html,.log,text/*";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

function setDropzone(big: string, small: string) {
  dropzone.innerHTML =
    `<div class="icon">📄</div><div class="big">${escapeHtml(big)}</div><div class="small">${escapeHtml(small)}</div>`;
}
function loadFile(file: File) {
  if (/\.pdf$/i.test(file.name)) { setDropzone("PDF support is coming next", "drop a text file for now (TXT · CSV · MD)"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    currentText = String(reader.result ?? "");
    currentName = file.name;
    setDropzone(`📄 ${file.name}`, "loaded — click to choose another");
    redactBtn.disabled = false;
    redactBtn.textContent = "🔒 Redact";
  };
  reader.readAsText(file);
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { const k = (e as KeyboardEvent).key; if (k === "Enter" || k === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => { const f = fileInput.files?.[0]; if (f) loadFile(f); });
["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.style.borderColor = "var(--primary)"; }));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.style.borderColor = ""; }));
dropzone.addEventListener("drop", (e) => { const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) loadFile(f); });

// ───────── redact ─────────
redactBtn.addEventListener("click", () => {
  if (!currentText) return;
  const level = LEVELS[activeLabel(levelGroup)] ?? 2;
  const mode = MODES[activeLabel(modeGroup)] ?? "fake";
  const custom = customInput.value.split(",").map((t) => t.trim()).filter(Boolean);
  const { text, changes } = redact(currentText, level, mode, custom, new Faker("redacto"));
  renderResult(currentText, text, changes);
  logRun(currentName, currentText.length, level, mode, changes);
});

// ───────── render ─────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
// rebuild a pane from the ORIGINAL text + (non-overlapping, ordered) changes
function buildPane(original: string, changes: Change[], useReplacement: boolean, cls: string): string {
  let html = "", pos = 0;
  for (const c of changes) {
    html += escapeHtml(original.slice(pos, c.start));
    html += `<mark class="${cls}">${escapeHtml(useReplacement ? c.fullReplaced : c.fullOriginal)}</mark>`;
    pos = c.end;
  }
  return html + escapeHtml(original.slice(pos));
}
function flash(btn: HTMLButtonElement, msg: string) {
  const old = btn.textContent; btn.textContent = msg;
  setTimeout(() => { btn.textContent = old; }, 1200);
}
function renderResult(original: string, redacted: string, changes: Change[]) {
  if (changes.length === 0) {
    resultEl.className = "result";
    resultEl.innerHTML = `<div class="icon">∅</div><div>No PII patterns matched. Try a higher level, or add Custom terms.</div>`;
    return;
  }
  resultEl.className = "result result--filled";
  resultEl.innerHTML = `
    <div class="result-head">
      <div class="group-h">${changes.length} redaction${changes.length === 1 ? "" : "s"}</div>
      <div class="result-actions">
        <button class="btn btn--secondary" id="copyBtn">Copy redacted</button>
        <button class="btn btn--secondary" id="dlBtn">Download</button>
      </div>
    </div>
    <div class="changelog">${changes.map((c) =>
      `<div class="row"><span class="pat"><b>${escapeHtml(c.pattern)}</b> · ${escapeHtml(c.found)}</span><span class="repl">${escapeHtml(c.replaced)}</span></div>`).join("")}</div>
    <div class="group-h">Compare</div>
    <div class="compare">
      <div class="pane"><div class="pane__head">Original</div><div class="pane__body">${buildPane(original, changes, false, "bar")}</div></div>
      <div class="pane"><div class="pane__head">Redacted · safe to share</div><div class="pane__body">${buildPane(original, changes, true, "repl")}</div></div>
    </div>`;

  resultEl.querySelector<HTMLButtonElement>("#copyBtn")!.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(redacted); flash(btn, "Copied ✓"); }
    catch { flash(btn, "Copy failed"); }
  });
  resultEl.querySelector<HTMLButtonElement>("#dlBtn")!.addEventListener("click", () => {
    const blob = new Blob([redacted], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = currentName.replace(/(\.[^.]+)?$/, "_redacted$1");
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ───────── run log (privacy-safe: metadata + counts ONLY, never the PII) ─────────
const LOG_KEY = "redacto.runs.v1";
interface RunRecord { ts: string; file: string; chars: number; level: number; mode: Mode; total: number; byType: Record<string, number>; }

function readLog(): RunRecord[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as RunRecord[]; } catch { return []; }
}
function logRun(file: string, chars: number, level: number, mode: Mode, changes: Change[]) {
  const byType: Record<string, number> = {};
  for (const c of changes) byType[c.pattern] = (byType[c.pattern] || 0) + 1;
  const rec: RunRecord = { ts: new Date().toISOString(), file, chars, level, mode, total: changes.length, byType };
  const log = readLog();
  log.push(rec);
  if (log.length > 200) log.splice(0, log.length - 200); // cap size
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

const LEVEL_NAME = ["", "Light", "Standard", "Heavy"];
const histList = document.querySelector<HTMLElement>('[data-screen="history"] .hist')!;
function renderHistory() {
  const log = readLog().slice().reverse(); // newest first
  if (log.length === 0) {
    histList.innerHTML = `<div class="hist-item"><div class="hist-item__meta">No runs yet — redact a document and it'll be logged here.</div></div>`;
    return;
  }
  histList.innerHTML = log.map((r) => {
    const when = new Date(r.ts).toLocaleString();
    const breakdown = Object.entries(r.byType).map(([k, v]) => `${escapeHtml(k)}×${v}`).join(" · ") || "—";
    return `<div class="hist-item">
      <div class="hist-item__top"><span class="hist-item__name">${escapeHtml(r.file)}</span><span class="hist-item__date">${escapeHtml(when)}</span></div>
      <div class="hist-item__meta">${r.total} redaction${r.total === 1 ? "" : "s"} · ${LEVEL_NAME[r.level] || r.level} · ${escapeHtml(r.mode)}</div>
      <div class="hist-item__meta">${breakdown}</div>
    </div>`;
  }).join("");
}

document.querySelector<HTMLButtonElement>("#exportLog")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(readLog(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "redacto-log.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

let clearArmed = false;
const clearBtn = document.querySelector<HTMLButtonElement>("#clearHist");
clearBtn?.addEventListener("click", () => {
  if (!clearArmed) { clearArmed = true; clearBtn!.textContent = "Click again to clear"; setTimeout(() => { clearArmed = false; clearBtn!.textContent = "Clear history"; }, 2500); return; }
  localStorage.removeItem(LOG_KEY); clearArmed = false; clearBtn!.textContent = "Clear history"; renderHistory();
});
