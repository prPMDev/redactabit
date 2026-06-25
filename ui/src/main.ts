import { redactAsync, Faker, LEVELS, MODES, DEFAULT_LEVEL, DEFAULT_MODE, type Mode, type Change, type RedactPhase } from "./engine";
import { COPY, TIPS, CHIP_LABELS } from "./strings";
import { getModels, getBuiltin, getModel, isInstalled, installedModels, subscribe, initCatalog, type ModelDef } from "./catalog";
import { handlerFor, fileAccept, fileHint } from "./files";
import * as diag from "./diag";

// ───────── external opens + diagnostics (a Tauri webview is not a browser) ─────────
// Links and blob-downloads don't behave like a browser in WebView2, so URLs/folders go
// through the Tauri opener plugin and diagnostics copy to the clipboard. Everything is
// dynamically imported with a fallback so the plain browser build (npm run dev) still works.
const REPO_URL = "https://github.com/prPMDev/redactabit";

// Version spans (About + statusbar) fill from the single source (package.json via Vite define).
document.querySelectorAll<HTMLElement>("[data-version]").forEach((el) => { el.textContent = `v${__APP_VERSION__}`; });

async function openUrlExternal(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (e) {
    diag.error("open_url_failed", e);
    try { window.open(url, "_blank"); } catch { /* ignore */ }
  }
}

async function openAppDir(which: "data" | "log") {
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    const { appLocalDataDir, appLogDir } = await import("@tauri-apps/api/path");
    // Reveal the LOCAL app dir (where the webview storage + logs actually live). The
    // Roaming appDataDir is never created, so revealing it would fail.
    await revealItemInDir(which === "log" ? await appLogDir() : await appLocalDataDir());
  } catch (e) {
    diag.error("open_dir_failed", e, { which });
  }
}

// ───────── save redacted files to a real folder (Tauri) ─────────
// In the packaged app, "Save" writes the redacted text to a user-chosen folder via a tiny Rust
// command and reveals it; the folder defaults to <Downloads>/Redactabit and is remembered. In the
// plain browser build (npm run dev) there's no Tauri backend, so each step throws and callers
// fall back to the blob download — same airplane-mode-safe, dynamic-import pattern as the opens.
const SAVE_DIR_KEY = "redactabit.saveDir.v1";
async function defaultSaveDir(): Promise<string> {
  const { downloadDir, join } = await import("@tauri-apps/api/path");
  return await join(await downloadDir(), "Redactabit");
}
async function currentSaveDir(): Promise<string> {
  return localStorage.getItem(SAVE_DIR_KEY) || (await defaultSaveDir());
}
// Write <name>_redacted.txt into the save folder. Returns the full path, or null when there's
// no Tauri backend (browser dev) so the caller can fall back to a download. Quiet by design:
// it never pops the file explorer — revealing is on demand via revealSaveTarget().

// Saved-file naming: <base>_<Level>_<Mode>_redacted.<ext> (issue #4). redactMeta holds the
// current view's level/mode labels (set at render time), so all four save/download helpers
// agree — including a reopened history item, which carries its OWN level/mode, not the live controls.
let redactMeta = { level: "", mode: "" };
function redactedName(name: string, level: string, mode: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "");
  return [base, safe(level), safe(mode), "redacted"].filter(Boolean).join("_") + "." + ext;
}
let lastSavedPath: string | null = null;
async function saveToFolder(name: string, text: string): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { join } = await import("@tauri-apps/api/path");
    const full = await join(await currentSaveDir(), redactedName(name, redactMeta.level, redactMeta.mode, "txt"));
    await invoke("write_text_file", { path: full, contents: text });
    lastSavedPath = full;
    diag.info("file_saved", {});
    return full;
  } catch (e) {
    diag.error("save_failed", e);
    return null;
  }
}
// On-demand reveal: open the file explorer at the last saved file, or the save folder if
// nothing has been saved yet. Only ever called from a "Show in folder" click.
async function revealSaveTarget() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    if (lastSavedPath) { await revealItemInDir(lastSavedPath); return; }
    const dir = await currentSaveDir();
    try { await invoke("ensure_dir", { path: dir }); } catch { /* may exist / browser dev */ }
    await revealItemInDir(dir);
  } catch (e) { diag.error("reveal_failed", e); }
}
// After a successful folder-save, swap Save → Show in folder (sequential — never both at once;
// "Show in folder" makes no sense until there's a saved file to reveal).
function markSaved(saveBtn: HTMLButtonElement, showFolderBtn: HTMLButtonElement) {
  saveBtn.textContent = COPY.saved;
  setTimeout(() => { saveBtn.style.display = "none"; showFolderBtn.style.display = ""; }, 1000);
}
// Shared wiring for the result/history "Save" button: write to the folder (then "Show in folder"
// takes its place), else download (browser dev, no folder).
function wireSaveButton(saveBtn: HTMLButtonElement, showFolderBtn: HTMLButtonElement, name: string, text: string) {
  saveBtn.addEventListener("click", async () => {
    const full = await saveToFolder(name, text);
    if (full) markSaved(saveBtn, showFolderBtn);
    else downloadText(name, text);
  });
}
// Binary twins of saveToFolder/downloadText, for the redacted PDF output.
async function saveBytesToFolder(name: string, bytes: Uint8Array): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { join } = await import("@tauri-apps/api/path");
    const full = await join(await currentSaveDir(), redactedName(name, redactMeta.level, redactMeta.mode, "pdf"));
    await invoke("write_bytes_file", { path: full, contents: Array.from(bytes) });
    lastSavedPath = full;
    diag.info("file_saved", { pdf: true });
    return full;
  } catch (e) {
    diag.error("save_bytes_failed", e);
    return null;
  }
}
function downloadBytes(name: string, bytes: Uint8Array) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
  a.download = redactedName(name, redactMeta.level, redactMeta.mode, "pdf");
  a.click();
  URL.revokeObjectURL(a.href);
}

// Advanced › "Save redacted files to": show the folder, let the user change it, reveal it.
const saveDirInput = document.querySelector<HTMLInputElement>("#saveDirInput");
async function refreshSaveDirInput() {
  if (!saveDirInput) return;
  try { saveDirInput.value = await currentSaveDir(); } catch { saveDirInput.value = "Downloads/Redactabit"; }
}
void refreshSaveDirInput();
document.querySelector<HTMLButtonElement>("#pickSaveDir")?.addEventListener("click", async () => {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ directory: true, multiple: false });
    if (typeof sel === "string") { localStorage.setItem(SAVE_DIR_KEY, sel); void refreshSaveDirInput(); }
  } catch (e) { diag.error("pick_dir_failed", e); }
});
document.querySelector<HTMLButtonElement>("#openSaveDir")?.addEventListener("click", async () => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    const dir = await currentSaveDir();
    try { await invoke("ensure_dir", { path: dir }); } catch { /* may already exist / browser dev */ }
    await revealItemInDir(dir);
  } catch (e) { diag.error("open_savedir_failed", e); }
});

// Copy the privacy-safe diagnostics log to the clipboard (blob downloads don't fire in WebView2).
document.querySelector<HTMLButtonElement>("#exportDiag")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(diag.diagnosticsText());
    flash(btn, COPY.copied, true);
  } catch (err) {
    diag.error("diag_copy_failed", err);
    flash(btn, COPY.copyFailed, true);
  }
});

// About + status-bar actions.
document.querySelector<HTMLButtonElement>("#githubBtn")?.addEventListener("click", () => openUrlExternal(REPO_URL));
document.querySelector<HTMLButtonElement>("#starBtn")?.addEventListener("click", () => openUrlExternal(REPO_URL));
document.querySelector<HTMLButtonElement>("#shareBtn")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  try { await navigator.clipboard.writeText(REPO_URL); flash(btn, COPY.linkCopied, true); }
  catch { openUrlExternal(REPO_URL); }
});
document.querySelector<HTMLButtonElement>("#openDataBtn")?.addEventListener("click", () => openAppDir("data"));
document.querySelector<HTMLButtonElement>("#openLogBtn")?.addEventListener("click", () => openAppDir("log"));
document.querySelector<HTMLAnchorElement>("#updatesLink")?.addEventListener("click", (e) => { e.preventDefault(); openUrlExternal(REPO_URL + "/releases"); });

// ───────── sidebar nav (kept from the old app.js) ─────────
const navLinks = document.querySelectorAll<HTMLAnchorElement>(".nav a");
const screens = document.querySelectorAll<HTMLElement>("[data-screen]");
function show(name: string) {
  navLinks.forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  screens.forEach((s) => { s.style.display = s.dataset.screen === name ? "" : "none"; });
  if (name === "history") renderHistory();
  if (name === "models") placeModelCards();
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

function activeLabel(group: HTMLElement): string {
  return (group.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent || "").trim();
}
// Level/mode lookups derived from the engine registries (single source of truth).
const levelValue = (lbl: string): number => LEVELS.find((l) => l.label === lbl)?.id ?? DEFAULT_LEVEL;
const modeValue = (lbl: string): Mode => (MODES.find((m) => m.label === lbl)?.id as Mode) ?? DEFAULT_MODE;
const levelLabel = (id: number): string => LEVELS.find((l) => l.id === id)?.label ?? String(id);
const modeLabel = (id: string): string => MODES.find((m) => m.id === id)?.label ?? id;

// Segmented controls render from the registries, then toggle aria-pressed within their group.
function renderSegmented(group: HTMLElement, defs: readonly { label: string }[], activeLbl: string) {
  group.innerHTML = defs.map((d) => `<button aria-pressed="${d.label === activeLbl}">${d.label}</button>`).join("");
}
function wireSegmented(group: HTMLElement) {
  const btns = group.querySelectorAll<HTMLButtonElement>("button");
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
  }));
}
renderSegmented(levelGroup, LEVELS, levelLabel(DEFAULT_LEVEL));
renderSegmented(modeGroup, MODES, modeLabel(DEFAULT_MODE));
wireSegmented(levelGroup);
wireSegmented(modeGroup);

// ───────── info tooltips (one shared styled panel; hover/focus shows, click pins) ─────────
// Replaces the native title= bubbles (hover-only, delayed, unstyled, dead on click).
// Content: level/mode tips compose from the engine registries — the level tip says what
// each tier hides AND keeps (the "keeps" is the product promise, not a gap); static tips
// come from TIPS in strings.ts, keyed by the icon's data-tip attribute.
const tipEl = document.createElement("div");
tipEl.className = "tooltip";
tipEl.setAttribute("role", "tooltip");
tipEl.id = "tip";
tipEl.hidden = true;
document.body.appendChild(tipEl);
let tipPinned = false;
let tipFor: HTMLElement | null = null;

const levelTipHtml = (): string =>
  `<div class="tooltip__row">${escapeHtml(COPY.tipLevelsIntro)}</div>` +
  LEVELS.map((l, i) =>
    `<div class="tooltip__row"><b>${escapeHtml(l.label)}</b> ${i ? "also hides" : "hides"} ${escapeHtml(l.hides)}. ` +
    `<span class="tooltip__keeps">Keeps ${escapeHtml(l.keeps)}.</span></div>`).join("");
const modeTipHtml = (): string =>
  MODES.map((m) => `<div class="tooltip__row"><b>${escapeHtml(m.label)}</b> ${escapeHtml(m.hint)}</div>`).join("");
function tipHtmlFor(key: string): string {
  if (key === "level") return levelTipHtml();
  if (key === "mode") return modeTipHtml();
  return TIPS[key] ? `<div class="tooltip__row">${escapeHtml(TIPS[key])}</div>` : "";
}
function showTip(trigger: HTMLElement) {
  const html = tipHtmlFor(trigger.dataset.tip || "");
  if (!html) return;
  tipFor = trigger;
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  trigger.setAttribute("aria-describedby", "tip");
  // measure, then place above the trigger; flip below when cramped; clamp to the viewport
  tipEl.style.left = "0px"; tipEl.style.top = "0px";
  const r = trigger.getBoundingClientRect();
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
  let y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(y)}px`;
  requestAnimationFrame(() => tipEl.classList.add("show"));
}
function hideTip(force = false) {
  if (tipPinned && !force) return;
  tipPinned = false;
  tipFor?.removeAttribute("aria-describedby");
  tipFor = null;
  tipEl.classList.remove("show");
  tipEl.hidden = true;
}
document.querySelectorAll<HTMLElement>(".info[data-tip]").forEach((t) => {
  t.addEventListener("pointerenter", () => { if (!tipPinned) showTip(t); });
  t.addEventListener("pointerleave", () => hideTip());
  t.addEventListener("focus", () => { if (!tipPinned) showTip(t); });
  t.addEventListener("blur", () => hideTip());
  t.addEventListener("click", (e) => {
    e.stopPropagation();
    if (tipPinned && tipFor === t) { hideTip(true); return; }   // second click unpins
    tipPinned = false;
    showTip(t);
    tipPinned = true;
  });
  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); t.click(); }
  });
});
document.addEventListener("click", (e) => {                     // click away → unpin
  if (tipPinned && !(e.target as HTMLElement).closest(".info[data-tip]")) hideTip(true);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(true); });

// ───────── preferences: remember last-used level/mode + fake-data set ─────────
// (one source of truth: the Redact screen; Advanced no longer duplicates these)
const PREF_KEY = "redactabit.prefs.v1";
const seedInput = document.querySelector<HTMLInputElement>("#seedInput");
function setSegmentedValue(group: HTMLElement, label: string) {
  group.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.setAttribute("aria-pressed", String((b.textContent || "").trim() === label)));
}
function savePrefs() {
  localStorage.setItem(PREF_KEY, JSON.stringify({
    level: activeLabel(levelGroup), mode: activeLabel(modeGroup), seed: seedInput?.value || "redactabit",
  }));
}
(function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    if (p.level) setSegmentedValue(levelGroup, p.level);
    if (p.mode) setSegmentedValue(modeGroup, p.mode);
    if (p.seed && seedInput) seedInput.value = p.seed;
  } catch { /* first run */ }
})();
[levelGroup, modeGroup].forEach((g) => g.addEventListener("click", savePrefs));
document.querySelector<HTMLButtonElement>("#regenSeed")?.addEventListener("click", () => {
  if (!seedInput) return;
  seedInput.value = Math.random().toString(36).slice(2, 10);
  savePrefs();
});

// ───────── file input (text + PDF) ─────────
let currentText: string | null = null;
let currentName = "document.txt";
let currentFile: File | null = null; // original file kept so a PDF can be re-redacted AS a PDF at save time
let currentIsPdf = false;

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = fileAccept();
fileInput.style.display = "none";
document.body.appendChild(fileInput);

function setDropzone(big: string, small: string) {
  dropzone.innerHTML =
    `<div class="icon">📄</div><div class="big">${escapeHtml(big)}</div><div class="small">${escapeHtml(small)}</div>`;
}

function fileLoaded(name: string, text: string) {
  currentText = text;
  currentName = name;
  setDropzone(`📄 ${name}`, COPY.dropLoadedHint);
  redactBtn.disabled = false;
  redactBtn.textContent = COPY.redactReady;
}

// Pick the handler (PDF, text fallback, ...) and turn the file into text. The handler
// registry (files.ts) owns the formats; this only drives the dropzone states.
async function loadFile(file: File) {
  const handler = handlerFor(file);
  if (handler.slow) { setDropzone(`📄 ${file.name}`, COPY.pdfReading); redactBtn.disabled = true; }
  try {
    const text = await handler.read(file);
    if (!text.trim()) { setDropzone(COPY.pdfScannedTitle, COPY.pdfScannedBody); return; }
    currentFile = file;
    currentIsPdf = handler.id === "pdf";
    fileLoaded(file.name, text);
  } catch (err) {
    diag.error("file_read_failed", err, { handler: handler.id });
    setDropzone(COPY.pdfFailTitle, COPY.pdfFailBody);
  }
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { const k = (e as KeyboardEvent).key; if (k === "Enter" || k === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => { const f = fileInput.files?.[0]; if (f) loadFile(f); });
["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.style.borderColor = "var(--primary)"; }));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.style.borderColor = ""; }));
dropzone.addEventListener("drop", (e) => { const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) loadFile(f); });
setDropzone(COPY.dropPrompt, fileHint()); // initial prompt + accepted formats, from the file-handler registry

// ───────── redact ─────────
// A2 progress UI: only for model runs (regex-only is instant). The fill (--progress)
// advances per detection pass; the shimmer (a CSS transform) stays alive through the brief
// main-thread freeze while the model runs, so the button never looks hung.
//
// Two timing rules make it actually VISIBLE:
// 1. Wait for a painted frame before inference starts — model inference blocks the main
//    thread, and awaits alone never yield to the renderer, so without this the redacting
//    state would never reach the screen (the original "nothing shows" bug).
// 2. Keep the state up ≥ MIN_PROGRESS_MS — a warm model on a short doc can finish in
//    ~200ms, which reads as a glitch, not progress.
const MIN_PROGRESS_MS = 450;
function nextPaint(): Promise<void> {
  return Promise.race([
    new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0))),
    new Promise<void>((r) => setTimeout(r, 120)), // rAF can throttle in hidden windows
  ]);
}
function startRedactProgress(initialLabel: string) {
  phaseQueue.length = 0;
  redactBtn.classList.add("redacting");
  redactBtn.style.setProperty("--progress", "0.04");
  redactBtn.innerHTML = `<span class="btn__bar"></span><span class="btn__shimmer"></span><span class="btn__label">${escapeHtml(initialLabel)}</span>`;
}
function setRedactProgress(frac: number) {
  // unitless 0..1: the bar is scaleX(var(--progress)), composited so it glides during blocks
  redactBtn.style.setProperty("--progress", String(Math.min(1, Math.max(0.04, frac))));
}
function stopRedactProgress() {
  redactBtn.classList.remove("redacting");
  redactBtn.style.removeProperty("--progress");
}
// Narrate the real pipeline phases on the button label. The instant phases (rules,
// custom terms) still get ≥PHASE_MS on screen so the story is readable; the bar keeps
// tracking real progress underneath the words.
const PHASE_MS = 240;
const phaseQueue: string[] = [];
let phaseDraining = false;
function queuePhaseLabel(label: string) {
  phaseQueue.push(label);
  if (!phaseDraining) void drainPhaseLabels();
}
async function drainPhaseLabels() {
  phaseDraining = true;
  while (phaseQueue.length) {
    const label = phaseQueue.shift()!;
    const el = redactBtn.querySelector<HTMLElement>(".btn__label");
    if (el) el.textContent = label;
    await new Promise((r) => setTimeout(r, PHASE_MS));
  }
  phaseDraining = false;
}
redactBtn.addEventListener("click", async () => {
  if (!currentText) return;
  const level = levelValue(activeLabel(levelGroup));
  const mode = modeValue(activeLabel(modeGroup));
  const custom = customInput.value.split(",").map((t) => t.trim()).filter(Boolean);
  const activeDef = getModel(activeModel());                        // one active smart model (built-in rules always run)
  const extra = activeDef?.detector?.ready() ? [activeDef.detector] : [];
  const label = redactBtn.textContent;
  redactBtn.disabled = true;
  const showProgress = extra.length > 0;                            // only a model run takes time
  const t0 = performance.now();
  const levelLbl = activeLabel(levelGroup);
  // Phase -> status line: rules/custom from COPY, model scan from COPY, and the apply
  // verb from the mode's own registry entry (each mode owns its busy line).
  const phaseLabel = (p: RedactPhase): string =>
    p === "rules" ? COPY.phaseRules(levelLbl)
    : p === "custom" ? COPY.phaseCustom
    : p === "model" ? COPY.redactScanning
    : `🔒 ${MODES.find((m) => m.id === mode)?.busy ?? ""}`;
  // The engine re-emits "rules" immediately; queueing it (same text as the initial label,
  // so no visible change) is what buys the first phase its ≥PHASE_MS on screen.
  let lastPhase: RedactPhase | undefined;
  if (showProgress) { startRedactProgress(phaseLabel("rules")); await nextPaint(); } // paint BEFORE inference can block
  const onProgress = showProgress
    ? (f: number, p?: RedactPhase) => {
        setRedactProgress(f);
        if (p && p !== lastPhase) { lastPhase = p; queuePhaseLabel(phaseLabel(p)); }
      }
    : undefined;
  try {
    const { text, changes } = await redactAsync(currentText, level, mode, custom, new Faker(seedInput?.value || "redactabit"), extra, onProgress);
    if (showProgress) {                                             // let the narration + fill finish on screen
      setRedactProgress(1);
      while (phaseDraining) await new Promise((r) => setTimeout(r, 60));
      const left = MIN_PROGRESS_MS - (performance.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    }
    renderResult(currentText, text, changes);
    logRun(currentName, currentText.length, level, mode, changes, text);
    savePrefs();
    diag.info("redaction_done", { level, mode, total: changes.length, chars: currentText.length, model: extra.length > 0, nerHits: changes.filter((c) => c.pattern.startsWith("NER:")).length });
  } catch (err) {
    diag.error("redaction_failed", err, { level, mode });
  } finally {
    stopRedactProgress();
    redactBtn.disabled = false;
    redactBtn.textContent = label || COPY.redactReady;
  }
});

// ───────── detection model: catalog, download, status (registry-driven) ─────────
const statusModel = document.querySelector<HTMLElement>(".statusbar .model");
const modelsScreenEl = document.querySelector<HTMLElement>('[data-screen="models"]');
const dGroupReady = document.querySelector<HTMLElement>('[data-grp="ready"]');
const dGroupAvail = document.querySelector<HTMLElement>('[data-grp="available"]');
const dListReady = document.querySelector<HTMLElement>('[data-list="ready"]');
const dListAvail = document.querySelector<HTMLElement>('[data-list="available"]');

// The always-on floor (built-in rules), shown as the baseline strip — text from the registry.
const baseTxt = document.querySelector<HTMLElement>(".baseline__txt");
const baseTag = document.querySelector<HTMLElement>(".baseline__tag");
if (baseTxt) baseTxt.textContent = getBuiltin().card.desc;
if (baseTag) baseTag.textContent = getBuiltin().card.size;

// One smart model is active at a time (Handy-style); built-in rules are always the floor.
// Stored in "redactabit.detect.active" (a model id, or BUILTIN.id for rules-only).
function activeModel(): string {
  const a = localStorage.getItem("redactabit.detect.active");
  if (a === getBuiltin().id) return getBuiltin().id;
  const def = a ? getModel(a) : undefined;
  if (def && isInstalled(def)) return def.id;
  return installedModels()[0]?.id ?? getBuiltin().id; // default: the installed model, else rules-only
}
function setActiveModel(id: string) {
  localStorage.setItem("redactabit.detect.active", id);
  renderModelChip();
  placeModelCards();
}

// One renderer builds every Detection card from a model def (data-driven).
function modelCardHtml(m: ModelDef, installed: boolean, active: boolean): string {
  const store = m.storeKey ? ` data-store="${m.storeKey}"` : "";
  const badge = active ? `<span class="pill pill--active active-badge">✓ Active</span>` : "";
  // Installed cards get a "Remove" (delete the downloaded weights) grouped with their action button.
  const remove = `<button class="linkbtn" data-remove-model="${m.id}">${COPY.removeModel}</button>`;
  const group = (btn: string) => `<span style="display:inline-flex;gap:14px;align-items:center">${btn}${remove}</span>`;
  const foot = !m.available
    ? `<span>${escapeHtml(m.card.size)}</span><button class="linkbtn" disabled style="opacity:.5">Later</button>`
    : !installed
      ? `<span>${escapeHtml(m.card.size)}</span><button class="linkbtn" data-dl-model="${m.id}">${COPY.dlIdle}</button>`
      : active
        ? `<span>${escapeHtml(m.card.size)}</span>${group(`<button class="linkbtn" disabled>${COPY.dlDone}</button>`)}`
        // installed but not active -> the card-level switcher (mirrors the statusbar menu)
        : `<span>${escapeHtml(m.card.size)}</span>${group(`<button class="linkbtn" data-use-model="${m.id}">${COPY.useModel}</button>`)}`;
  return `<div class="model-card${active ? " model-card--active" : ""}" data-model="${m.id}"${store}>
    <div class="model-card__top">
      <div><div class="model-card__name">${escapeHtml(m.card.name)}${badge}</div><div class="model-card__desc">${escapeHtml(m.card.desc)}</div></div>
      <div class="meters"><div class="meter">accuracy<div class="track"><div class="fill" style="width:${m.card.accuracy}%"></div></div></div><div class="meter">speed<div class="track"><div class="fill" style="width:${m.card.speed}%"></div></div></div></div>
    </div>
    <div class="model-card__foot">${foot}</div>
  </div>`;
}

// Render the catalog into "Ready to use" (installed) vs "Available to download". Called at
// boot and after a download/active switch (no MutationObserver — we re-render explicitly).
let placingModels = false;
function placeModelCards() {
  if (placingModels || !dListReady || !dListAvail) return;
  placingModels = true;
  const active = activeModel();
  const ready: string[] = [], avail: string[] = [];
  for (const m of getModels()) {
    const inst = isInstalled(m);
    (inst ? ready : avail).push(modelCardHtml(m, inst, inst && m.id === active));
  }
  dListReady.innerHTML = ready.join("");
  dListAvail.innerHTML = avail.join("");
  if (dGroupReady) dGroupReady.hidden = ready.length === 0;
  if (dGroupAvail) dGroupAvail.hidden = avail.length === 0;
  placingModels = false;
}

// Statusbar chip + switcher menu, built from [built-in rules, ...available models].
function renderModelChip() {
  if (!statusModel) return;
  const active = activeModel();
  const label = (getModel(active) ?? getBuiltin()).chip.label;
  const row = (m: ModelDef) => {
    const on = active === m.id;
    const installed = m.id === getBuiltin().id || isInstalled(m);
    const right = on ? `<span class="model-menu__badge">Active</span>`
      : installed ? `` : `<span class="model-menu__badge model-menu__badge--dl">${COPY.dlBadge}</span>`;
    return `<button type="button" class="model-menu__item${on ? " is-active" : ""}" data-model="${m.id}"${installed ? "" : ' data-dl="1"'}>`
      + `<span class="model-menu__text"><span class="model-menu__name">${escapeHtml(m.chip.label)}</span>`
      + `<span class="model-menu__desc">${escapeHtml(m.chip.desc)}</span></span>${right}</button>`;
  };
  statusModel.innerHTML =
    `<span class="dot"></span><span class="model__label">${escapeHtml(label)}</span><span class="caret">▴</span>`
    + `<div class="model-menu" hidden>`
    + [getBuiltin(), ...getModels().filter((m) => m.available)].map(row).join("")
    + `</div>`;
}

// Detection-card clicks: ⤓ Download installs; "Use this model" (or clicking anywhere on an
// installed, inactive card) switches the active model — same effect as the statusbar menu.
modelsScreenEl?.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  // "Remove" (arm-twice) — checked first so it doesn't also fire the card's switch-active click.
  const rmBtn = target.closest<HTMLButtonElement>("button[data-remove-model]");
  if (rmBtn) {
    e.stopPropagation();
    const m = getModel(rmBtn.dataset.removeModel!);
    if (!m) return;
    if (rmBtn.dataset.armed !== "1") {
      rmBtn.dataset.armed = "1";
      rmBtn.textContent = COPY.removeArmed;
      setTimeout(() => { if (rmBtn.isConnected) { rmBtn.dataset.armed = "0"; rmBtn.textContent = COPY.removeModel; } }, 2500);
      return;
    }
    if (m.id === activeModel()) setActiveModel(getBuiltin().id); // removed the active model -> fall back to rules-only
    try { await m.detector?.remove?.(); } catch (err) { diag.error("model_remove_failed", err, { model: m.id }); }
    if (m.storeKey) localStorage.removeItem(m.storeKey);
    diag.info("model_removed", { model: m.id });
    placeModelCards();
    renderModelChip();
    return;
  }
  const btn = target.closest<HTMLButtonElement>("button[data-dl-model]");
  if (!btn) {
    const useBtn = target.closest<HTMLElement>("[data-use-model]");
    const card = useBtn ?? target.closest<HTMLElement>(".model-card[data-model]");
    const id = useBtn?.dataset.useModel ?? card?.dataset.model;
    const m = id ? getModel(id) : undefined;
    if (m && isInstalled(m) && m.id !== activeModel()) setActiveModel(m.id);
    return;
  }
  const m = getModel(btn.dataset.dlModel!);
  const det = m?.detector;
  if (!m || !det?.load || det.ready()) return;
  btn.disabled = true;
  btn.textContent = COPY.dlBusy;
  try {
    await det.load((p) => {
      const ev = p as { status?: string; progress?: number };
      if (ev?.status === "progress" && typeof ev.progress === "number") btn.textContent = `${COPY.dlBusy} ${Math.round(ev.progress)}%`;
    });
    if (m.storeKey) localStorage.setItem(m.storeKey, "1");
    setActiveModel(m.id);            // re-renders the chip + cards (now "✓ Installed" + Active)
    diag.info("model_installed", { model: m.id });
  } catch (err) {
    diag.error("model_download_failed", err, { model: m.id });
    btn.textContent = COPY.dlRetry;
    btn.disabled = false;
  }
});

// Restore installs across launches: auto-load each installed model from cache (fast, no
// re-fetch). If a cache is gone, drop the flag so the card offers Download again.
for (const m of installedModels()) {
  m.detector?.load?.().catch((err) => {
    diag.error("model_autoload_failed", err, { model: m.id });
    if (m.storeKey) localStorage.removeItem(m.storeKey);
    placeModelCards();
  });
}
placeModelCards();
statusModel?.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>(".model-menu__item");
  const menu = statusModel.querySelector<HTMLElement>(".model-menu");
  if (item) {
    if (menu) menu.hidden = true;
    if (item.dataset.dl) { show("models"); return; }   // not installed → go download it
    setActiveModel(item.dataset.model!);
    return;
  }
  if (menu) menu.hidden = !menu.hidden;                  // click the chip → toggle the menu
});
// Statusbar chip: the same styled tooltip on hover/focus (click is reserved for the menu,
// so no click-pin here; opening the menu hides the hover tip so they never overlap).
statusModel?.addEventListener("pointerenter", () => {
  const menu = statusModel.querySelector<HTMLElement>(".model-menu");
  if (!tipPinned && (!menu || menu.hidden)) showTip(statusModel);
});
statusModel?.addEventListener("pointerleave", () => hideTip());
statusModel?.addEventListener("click", () => hideTip(true));
document.addEventListener("click", (e) => {              // click outside → close
  if (statusModel && !statusModel.contains(e.target as Node)) {
    const menu = statusModel.querySelector<HTMLElement>(".model-menu");
    if (menu && !menu.hidden) menu.hidden = true;
  }
});
renderModelChip();

// The catalog is seeded synchronously above (offline-safe). Refresh it from the remote manifest in
// the background; if it changed, re-render the cards + chip. Best-effort and fail-silent, so the
// airplane-mode guarantee holds (an inbound definition pull, never outbound user data).
subscribe(() => { placeModelCards(); renderModelChip(); });
initCatalog();

// ───────── render ─────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
// Build the redacted output: the ORIGINAL text with each (non-overlapping, ordered)
// match wrapped in a highlight. Every mark carries BOTH the safe value and the real
// one, so "Reveal originals" can flip each span in place without a re-render.
function buildOutput(original: string, changes: Change[]): string {
  let html = "", pos = 0;
  for (const c of changes) {
    html += escapeHtml(original.slice(pos, c.start));
    const orig = escapeHtml(c.fullOriginal), repl = escapeHtml(c.fullReplaced);
    html += `<mark class="repl" data-type="${escapeHtml(c.pattern)}" data-orig="${orig}" data-repl="${repl}" title="was: ${orig}">${repl}</mark>`;
    pos = c.end;
  }
  return html + escapeHtml(original.slice(pos));
}
function flash(btn: HTMLButtonElement, msg: string, disable = false) {
  const old = btn.textContent; btn.textContent = msg;
  if (disable) btn.disabled = true;
  setTimeout(() => { btn.textContent = old; if (disable) btn.disabled = false; }, 1200);
}
// One place to save redacted text as a download (used by Result + History).
function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = redactedName(name, redactMeta.level, redactMeta.mode, "txt");
  a.click();
  URL.revokeObjectURL(a.href);
}
// Humanize a raw pattern name for DISPLAY (result chips + History breakdown): strip the
// "NER:" prefix, map the cryptic internal names (CHIP_LABELS), capitalize. The raw name stays
// the key everywhere (chip data-type, byType), so navigation + grouping are unaffected.
function chipLabel(pattern: string): string {
  const base = pattern.replace(/^NER:/, "");
  const friendly = CHIP_LABELS[pattern] ?? CHIP_LABELS[base] ?? base;
  return friendly.charAt(0).toUpperCase() + friendly.slice(1);
}
function renderResult(original: string, redacted: string, changes: Change[]) {
  if (changes.length === 0) {
    screen.classList.remove("redacted");
    resultEl.className = "result";
    resultEl.innerHTML = `<div class="icon">∅</div><div>${escapeHtml(COPY.noMatches)}</div>`;
    return;
  }
  resultEl.className = "result result--filled";
  screen.classList.add("redacted");
  redactMeta = { level: activeLabel(levelGroup), mode: activeLabel(modeGroup) };
  const typeCount = new Set(changes.map((c) => c.pattern)).size;

  // type → count, for the at-a-glance summary chips (scales to any number of items).
  // chipLabel (module-level) humanizes the DISPLAY; data-type keeps the raw name for navigation.
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(c.pattern, (counts.get(c.pattern) ?? 0) + 1);
  const chips = [...counts.entries()]
    .map(([name, n]) => { const lbl = chipLabel(name); return `<button type="button" class="chip" data-type="${escapeHtml(name)}" title="Find ${escapeHtml(lbl)} in the output">${escapeHtml(lbl)}${n > 1 ? ` <span class="chip__n">×${n}</span>` : ""}</button>`; }).join("");

  resultEl.innerHTML = `
    <div class="inputbar">
      <span class="inputbar__file">📄 ${escapeHtml(currentName)}</span>
      <span class="inputbar__meta">${escapeHtml(activeLabel(levelGroup))} · ${escapeHtml(activeLabel(modeGroup))}</span>
      <button class="linkbtn" id="editBtn">${COPY.editSettings}</button>
      <button class="linkbtn" id="newFileBtn">${COPY.newFile}</button>
    </div>
    <div class="result-head">
      <div class="group-h">✓ ${changes.length} redacted · ${typeCount} type${typeCount === 1 ? "" : "s"}</div>
      <div class="result-actions">
        <button class="btn btn--secondary" id="revealBtn" aria-pressed="false">${COPY.reveal}</button>
        <button class="btn btn--secondary" id="copyBtn">${COPY.copyRedacted}</button>
        <button class="btn btn--secondary" id="saveBtn">${COPY.save}</button>
        <button class="btn btn--secondary" id="showFolderBtn" style="display:none">${COPY.showInFolder}</button>
      </div>
    </div>
    <div class="chips">${chips}</div>
    <div class="pane pane--output">
      <div class="pane__head">${COPY.paneSafe}</div>
      <div class="pane__body output">${buildOutput(original, changes)}</div>
    </div>`;

  document.querySelector<HTMLElement>(".content")!.scrollTop = 0;

  // Reveal originals: flip every highlighted span between its safe value and the real
  // one, in place. Amber styling (via .revealed) warns this view is NOT safe to share.
  const outPane = resultEl.querySelector<HTMLElement>(".pane--output")!;
  const outHead = outPane.querySelector<HTMLElement>(".pane__head")!;
  resultEl.querySelector<HTMLButtonElement>("#revealBtn")!.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? COPY.hide : COPY.reveal;
    outPane.classList.toggle("revealed", on);
    outHead.textContent = on ? COPY.paneUnsafe : COPY.paneSafe;
    outPane.querySelectorAll<HTMLElement>("mark.repl").forEach((m) => {
      m.textContent = on ? (m.dataset.orig ?? "") : (m.dataset.repl ?? "");
    });
  });

  // Chips = legend + navigator: click a type to scroll to and flash its
  // redactions in the output; repeat-clicks cycle through multiple instances.
  const outBody = resultEl.querySelector<HTMLElement>(".pane__body.output")!;
  const allMarks = [...outBody.querySelectorAll<HTMLElement>("mark.repl")];
  resultEl.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const marks = allMarks.filter((m) => m.dataset.type === chip.dataset.type);
      if (!marks.length) return;
      const i = Number(chip.dataset.idx ?? "0") % marks.length;
      chip.dataset.idx = String(i + 1);
      allMarks.forEach((m) => m.classList.remove("flash"));
      void outBody.offsetWidth; // reflow so the animation re-fires on repeat clicks
      marks.forEach((m) => m.classList.add("flash"));
      marks[i].scrollIntoView({ block: "center", behavior: "smooth" });
      resultEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--active"));
      chip.classList.add("chip--active");
    });
  });

  // "Edit settings" keeps the loaded file (tweak level/mode/seed → Redact again);
  // "New file" also opens the picker. (Past runs are recoverable from History.)
  const backToInput = (pickFile: boolean) => {
    screen.classList.remove("redacted");
    resultEl.className = "result";
    resultEl.innerHTML = `<div class="icon">⤓</div><div>${COPY.resultPlaceholder}</div>`;
    document.querySelector<HTMLElement>(".content")!.scrollTop = 0;
    if (pickFile) { currentFile = null; currentIsPdf = false; fileInput.click(); } // "New file": drop stale bytes
  };
  resultEl.querySelector<HTMLButtonElement>("#editBtn")!.addEventListener("click", () => backToInput(false));
  resultEl.querySelector<HTMLButtonElement>("#newFileBtn")!.addEventListener("click", () => backToInput(true));

  resultEl.querySelector<HTMLButtonElement>("#copyBtn")!.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(redacted); flash(btn, COPY.copied); }
    catch { flash(btn, COPY.copyFailed); }
  });
  const saveBtn = resultEl.querySelector<HTMLButtonElement>("#saveBtn")!;
  const showFolderBtn = resultEl.querySelector<HTMLButtonElement>("#showFolderBtn")!;
  showFolderBtn.addEventListener("click", () => void revealSaveTarget());
  if (currentIsPdf && currentFile) {
    // PDF in → redacted PDF out: truly remove the PII (mupdf) + draw the replacements (pdf-lib),
    // then save bytes. Refuse to save if anything survives re-extraction. Text preview above stays
    // as the verification UI. (pdf-redact is dynamic-imported so mupdf/pdf-lib stay out of the main bundle.)
    const pdfFile = currentFile, name = currentName;
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = COPY.redactingPdf;
      try {
        const { redactPdf } = await import("./pdf-redact");
        const repl = changes.map((c) => ({ original: c.fullOriginal, replacement: c.fullReplaced }));
        const src = new Uint8Array(await pdfFile.arrayBuffer());
        const { bytes, survivors } = await redactPdf(src, repl);
        saveBtn.textContent = COPY.save;
        if (survivors.length) { diag.error("pdf_redact_survivors", null, { count: survivors.length }); flash(saveBtn, COPY.pdfLeakError); return; }
        const full = await saveBytesToFolder(name, bytes);
        if (full) markSaved(saveBtn, showFolderBtn); else downloadBytes(name, bytes);
      } catch (e) {
        diag.error("pdf_redact_failed", e);
        saveBtn.textContent = COPY.save;
        flash(saveBtn, COPY.pdfLeakError);
      } finally {
        saveBtn.disabled = false;
      }
    });
  } else {
    wireSaveButton(saveBtn, showFolderBtn, currentName, redacted);
  }
}

// ───────── run log (privacy-safe: metadata + counts ONLY, never the PII) ─────────
const LOG_KEY = "redactabit.runs.v1";
interface RunRecord { ts: string; file: string; chars: number; level: number; mode: Mode; total: number; byType: Record<string, number>; redacted?: string; }

function readLog(): RunRecord[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as RunRecord[]; } catch { return []; }
}
function logRun(file: string, chars: number, level: number, mode: Mode, changes: Change[], redacted: string) {
  const byType: Record<string, number> = {};
  for (const c of changes) byType[c.pattern] = (byType[c.pattern] || 0) + 1;
  // Store the redacted (SAFE) output so the run can be reopened, never the original.
  const rec: RunRecord = { ts: new Date().toISOString(), file, chars, level, mode, total: changes.length, byType, redacted: redacted.slice(0, 1_000_000) };
  const log = readLog();
  log.push(rec);
  if (log.length > 200) log.splice(0, log.length - 200); // cap count
  // Quota-safe write: if localStorage is full, drop the oldest runs until it fits.
  // Drop the oldest HALF per retry — bounds retries to ~log2(n) stringifies, not n.
  for (let attempt = log; attempt.length; attempt = attempt.slice(Math.ceil(attempt.length / 2))) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(attempt)); break; } catch { /* quota: retry smaller */ }
  }
}

const histList = document.querySelector<HTMLElement>('[data-screen="history"] .hist')!;

// Reopen a past run: show its stored redacted output (read-only) in the result view.
// No highlights/reveal; originals were never stored, so this is the safe doc only.
function showHistoryItem(rec: RunRecord) {
  const txt = rec.redacted || "";
  const when = new Date(rec.ts).toLocaleString();
  show("redact");
  screen.classList.add("redacted");
  resultEl.className = "result result--filled";
  redactMeta = { level: levelLabel(rec.level), mode: modeLabel(rec.mode) };
  resultEl.innerHTML = `
    <div class="inputbar">
      <span class="inputbar__file">📄 ${escapeHtml(rec.file)}</span>
      <span class="inputbar__meta">${rec.total} redacted · ${escapeHtml(levelLabel(rec.level))} · ${escapeHtml(modeLabel(rec.mode))} · ${escapeHtml(when)}</span>
      <button class="linkbtn" id="backHistBtn">${COPY.backToHistory}</button>
    </div>
    <div class="result-head">
      <div class="group-h">${COPY.reopened}</div>
      <div class="result-actions">
        <button class="btn btn--secondary" id="copyBtn">${COPY.copyRedacted}</button>
        <button class="btn btn--secondary" id="saveBtn">${COPY.save}</button>
        <button class="btn btn--secondary" id="showFolderBtn" style="display:none">${COPY.showInFolder}</button>
      </div>
    </div>
    <div class="pane pane--output">
      <div class="pane__head">${COPY.paneSafe}</div>
      <div class="pane__body output">${escapeHtml(txt)}</div>
    </div>`;
  document.querySelector<HTMLElement>(".content")!.scrollTop = 0;
  resultEl.querySelector<HTMLButtonElement>("#backHistBtn")!.addEventListener("click", () => {
    screen.classList.remove("redacted");
    resultEl.className = "result";
    resultEl.innerHTML = `<div class="icon">⤓</div><div>${COPY.resultPlaceholder}</div>`;
    show("history");
  });
  resultEl.querySelector<HTMLButtonElement>("#copyBtn")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(txt); flash(b, COPY.copied); } catch { flash(b, COPY.copyFailed); }
  });
  const histShowFolder = resultEl.querySelector<HTMLButtonElement>("#showFolderBtn")!;
  histShowFolder.addEventListener("click", () => void revealSaveTarget());
  wireSaveButton(resultEl.querySelector<HTMLButtonElement>("#saveBtn")!, histShowFolder, rec.file, txt);
}

function renderHistory() {
  const log = readLog().slice().reverse(); // newest first
  if (log.length === 0) {
    histList.innerHTML = `<div class="hist-item"><div class="hist-item__meta">${COPY.histEmpty}</div></div>`;
    return;
  }
  histList.innerHTML = log.map((r, i) => {
    const when = new Date(r.ts).toLocaleString();
    const breakdown = Object.entries(r.byType).map(([k, v]) => `${escapeHtml(chipLabel(k))}×${v}`).join(" · ") || "no matches";
    const openable = typeof r.redacted === "string" && r.redacted.length > 0;
    return `<div class="hist-item${openable ? " hist-item--open" : ""}" data-i="${i}"${openable ? ' role="button" tabindex="0"' : ""}>
      <div class="hist-item__top"><span class="hist-item__name">${escapeHtml(r.file)}</span><span class="hist-item__date">${escapeHtml(when)}</span></div>
      <div class="hist-item__meta">${r.total} redaction${r.total === 1 ? "" : "s"} · ${escapeHtml(levelLabel(r.level))} · ${escapeHtml(modeLabel(r.mode))}${openable ? ` · <span class="hist-item__open">${COPY.open}</span>` : ""}</div>
      <div class="hist-item__meta">${breakdown}</div>
    </div>`;
  }).join("");
  histList.querySelectorAll<HTMLElement>(".hist-item--open").forEach((el) => {
    const open = () => showHistoryItem(log[Number(el.dataset.i)]);
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => { const k = (e as KeyboardEvent).key; if (k === "Enter" || k === " ") { e.preventDefault(); open(); } });
  });
}

document.querySelector<HTMLButtonElement>("#exportLog")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(readLog(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "redactabit-log.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

// Arm-twice-to-confirm clear buttons (History + Advanced) share one wiring; an optional
// doneMsg flashes after clearing.
function wireArmedClear(sel: string, doneMsg?: string) {
  const btn = document.querySelector<HTMLButtonElement>(sel);
  let armed = false;
  btn?.addEventListener("click", () => {
    if (!armed) { armed = true; btn.textContent = COPY.clearArmed; setTimeout(() => { armed = false; btn.textContent = COPY.clearHistory; }, 2500); return; }
    localStorage.removeItem(LOG_KEY); armed = false; renderHistory();
    btn.textContent = doneMsg ?? COPY.clearHistory;
    if (doneMsg) setTimeout(() => { btn.textContent = COPY.clearHistory; }, 1500);
  });
}
wireArmedClear("#clearHist", COPY.cleared); // History tab is the single home for clearing
