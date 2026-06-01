import { redact, Faker, type Mode, type Change } from "./engine";

// ───────── sidebar nav (kept from the old app.js) ─────────
const navLinks = document.querySelectorAll<HTMLAnchorElement>(".nav a");
const screens = document.querySelectorAll<HTMLElement>("[data-screen]");
function show(name: string) {
  navLinks.forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  screens.forEach((s) => { s.style.display = s.dataset.screen === name ? "" : "none"; });
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
