// Chrome copy — single source of truth for user-facing strings (English, compile-checked; NOT i18n).
//
// Where a string lives:
//   - a capability's OWN label travels with the capability: redaction modes/levels -> engine.ts
//     (MODES/LEVELS); detection models -> models.ts; file types -> files.ts.
//   - everything else (buttons, states, messages, confirmations) lives HERE.
//
// House style (see docs/architecture-and-content.md):
//   - sentence case for descriptions/messages; Title Case only for buttons + headings.
//   - no em dashes. one canonical phrasing per action (Download, Copy, Clear, Open...).
//   - confirmations trail the checkmark ("Copied ✓"); install is the one leading-mark case ("✓ Installed").

export const COPY = {
  // clipboard + confirmations
  copied: "Copied ✓",
  linkCopied: "Link copied ✓",
  copyFailed: "Couldn't copy",

  // history clear (arm-twice to confirm)
  clearHistory: "Clear history",
  clearArmed: "Click again to clear",
  cleared: "Cleared ✓",

  // model download lifecycle (statusbar + Detection cards)
  dlIdle: "⤓ Download",
  dlBusy: "Downloading…",
  dlDone: "✓ Installed",
  dlRetry: "⤓ Download (retry)",
  dlBadge: "Download",            // dropdown badge for an uninstalled model (was "Get →")
  useModel: "Use this model",     // installed-but-inactive card: click to make it the active model

  // redact button (phase labels narrate the real pipeline; the mode's own verb comes
  // from the engine MODES registry — each mode owns its busy line like it owns its label)
  redactReady: "🔒 Redact",
  redactScanning: "🔒 Scanning for names…",
  redactNoFile: "🔒 Drop a file to start",
  phaseRules: (level: string) => `🔒 Checking ${level} rules…`,
  phaseCustom: "🔒 Finding your custom terms…",

  // dropzone
  dropPrompt: "Drop a file, or click to choose",
  dropLoadedHint: "loaded. Click to choose another",

  // file read states
  pdfReading: "reading PDF…",
  pdfScannedTitle: "No text to read",
  pdfScannedBody: "This looks like a scanned PDF (image only). OCR isn't supported yet.",
  pdfFailTitle: "Couldn't read that file",
  pdfFailBody: "try another file, or paste the text instead",

  // result view
  resultPlaceholder: "Your redacted document will appear here.",
  noMatches: "No sensitive data found. Try a higher level, or add custom terms.",
  paneSafe: "Redacted · safe to share",
  paneUnsafe: "Original · do not share",
  reveal: "Reveal originals",
  hide: "Hide originals",
  copyRedacted: "Copy redacted",
  download: "Download",
  editSettings: "Edit settings",
  newFile: "New file",

  // history view
  histEmpty: "Nothing here yet. Your redactions show up after you run one.",
  reopened: "Reopened from history",
  backToHistory: "← Back to history",
  open: "Open →",

  // info tooltips: the cumulative-levels framing line (per-level hides/keeps comes from
  // the engine LEVELS registry; per-mode lines from MODES — capabilities own their copy)
  tipLevelsIntro: "Each level includes the ones before it.",
} as const;

// Static info-tooltip texts, keyed by the icon's data-tip attribute. Level and mode tips
// are NOT here — they compose from the engine registries at runtime (single source).
export const TIPS: Record<string, string> = {
  customTerms: "Your own words to always redact: an employer, a nickname, a project name. Separate with commas.",
  seed: "Picks which fake values you get. Same set, same fakes, every run. It's not a password and can't un-redact anything.",
  saveTo: "Where your redacted files are saved.",
  clearHistory: "Clears the local history log. Your original files were never saved.",
  source: "Redacto is open source (MIT).",
  support: "No donations. A star or a share helps.",
  diagnostics: "A privacy-safe event log: never your document, the matches, or file names. Copy it to report an issue.",
};
