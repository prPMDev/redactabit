# CLAUDE.md — Redact-a-bit

## Project Overview

Redact-a-bit (display wordmark **Redact-a-bit**; one-word identifier **`redactabit`** for the crate,
npm package, bundle id `com.redactabit.app`, domain `redactabit.com`, and repo `prPMDev/redactabit`)
is a local, offline document redaction tool. It strips sensitive PII from PDFs and text files,
replacing matches with realistic fake data, partial masks, or `[REDACTED]` tags. **AGPL-3.0-or-later.**

**Core value prop:** "Nothing leaves your machine." This is not a SaaS product. It runs entirely
locally. This principle is non-negotiable in all design decisions.

It ships **two ways**, built around the same redaction model:

- **Tauri desktop app — the shipped product.** TypeScript/Vite frontend in `ui/` + Rust backend in
  `src-tauri/`. Hybrid detection (built-in regex + optional local GLiNER models) and true
  PDF-as-PDF redaction. This is what end users install and what UAT exercises.
- **`redactabit.py` — the reference / CLI engine.** The original single-file Python app: a
  regex-only engine with a Gradio UI (`--ui`) and an argparse CLI. No ML model. Kept as a
  scriptable CLI and as a correctness reference for the engine; tested in CI.

The two are **independent implementations that share no code** — `ui/src/engine.ts` is a faithful
port of the Python engine, not a wrapper around it. This is an intentional divergence: the desktop
app has a model, the CLI doesn't.

## Architecture

### Shipped desktop app (`ui/` + `src-tauri/`)

Frontend (`ui/src/`), all TypeScript, bundled by Vite and run inside the Tauri WebView:

```
engine.ts          → Shipped redaction engine. Faithful TS port of redactabit.py (sync cyrb53 +
                      mulberry32 for determinism). Imports nothing. Owns the MODES / LEVELS /
                      PATTERNS registries (anything that changes output bytes).
gliner-detector.ts → Hand-rolled GLiNER NER port (onnxruntime-web + @huggingface/tokenizers
                      tokenizer) for local name/address detection. NOT the vulnerable `gliner` npm
                      package — its span pipeline was ported in-house. Includes sweepNames()
                      (a model-confirmed name becomes a document-wide exact term).
pdf-redact.ts      → True PDF-as-PDF redaction: mupdf-wasm removes the PII glyphs from the content
                      stream, pdf-lib draws the fake/mask/tag replacement. Re-extracts the output
                      and REFUSES to save if any original PII string survives (verify-or-refuse).
files.ts           → File-type handlers + PDF text extraction via mupdf-wasm (rows regrouped
                      by baseline). Owns the shared lazy mupdf loader.
catalog.ts         → Builds model definitions from the manifest: a bundled seed
                      (models.seed.json) + a best-effort, fail-silent remote overlay
                      (site/models.json). Offline-first.
models.ts          → Model registry types/definitions.
strings.ts         → Single source of truth for user-facing chrome copy (English, compile-checked).
diag.ts            → Privacy-safe diagnostics log (never the document, matches, or file names).
main.ts            → App shell / wiring (result view, Save / Show-in-folder, history).
```

Backend (`src-tauri/`), Rust:

```
src/lib.rs         → Tauri commands: write_text_file, ensure_dir, write_bytes_file; registers the
                      opener / dialog / log plugins.
src/main.rs        → Entry point.
tauri.conf.json    → productName "Redact-a-bit", identifier com.redactabit.app, window config, CSP,
                      NSIS installer hooks.
windows/hooks.nsh  → NSIS uninstall hook: wipes %LOCALAPPDATA%\com.redactabit.app (downloaded
                      models, history) on a real uninstall, but not on update.
```

`scripts/sync-seed.mjs` copies the canonical `site/models.json` → `ui/src/models.seed.json` on
`predev`/`prebuild` so the catalog has one canonical source and no drift.

**Detection (shipped app)** is hybrid and resolves into the single-pass engine: built-in regex is
the always-on floor (0 MB, high priority, authoritative for structured IDs), optional local GLiNER
models are download-on-demand (cached, offline after first use) and feed in at LOW priority to fill
the fuzzy gaps (names, addresses). Detection is country-scoped, US-first. Launch catalog: built-in
rules + GLiNER PII base (default) + GLiNER multi PII (non-English).

### Reference / CLI engine (`redactabit.py`)

Single file: engine, patterns, Faker, file processors, Gradio UI, and an argparse CLI. Regex-only
(no model).

```
Faker              → Deterministic fake data generator (seeded by original value, cached)
Pat                → Pattern dataclass (regex, level, priority, mode handlers)
PATTERNS           → Ordered list of Pat instances, grouped by level (1/2/3)
redact()           → Single-pass engine: collect matches → resolve overlaps → replace
process_pdf_pymupdf() → Structure-preserving PDF redaction via PyMuPDF (preferred)
process_pdf()      → PDF text extraction via pypdf (fallback)
save_text_pdf()    → Rebuild PDF from redacted text via reportlab (fallback)
process_text_file()→ Plain text file handling
build_ui()         → Gradio interface with compare view (launched with --ui)
__main__ / argparse→ CLI: input [output] -l/--level -m/--mode -s/--seed -c/--custom --no-prompt --ui
```

### Single-Pass Engine (critical design decision — applies to BOTH engines)

The redaction core uses a single-pass architecture to prevent cascading — where Pattern A's fake
output gets re-matched by Pattern B.

1. Collect ALL regex/model matches against the ORIGINAL text
2. Sort by position, then by priority (higher priority wins ties)
3. Remove overlapping matches (greedy: first match at each position wins)
4. Replace from end to start (preserves string positions)

**Never** replace text in multiple passes. All patterns are evaluated against the original text.
(Running *more detectors* over the original — e.g. GLiNER's `sweepNames` — is fine; the ban is on
re-scanning already-modified text.)

### Redaction Levels

- Level 1 (Light): SSNs, ITINs, bank accounts, routing numbers, credit cards, passport/visa/USCIS numbers
- Level 2 (Standard): + EIN, phone, email, street address, DOB, named fields
- Level 3 (Heavy): + dollar amounts, zip codes, 9-digit number catch-all

The shipped app shows intent-named labels (driven by the `LEVELS` registry) rather than
Light/Standard/Heavy; the underlying level semantics are identical.

### Replacement Modes

- `fake` (UI: Fake): Realistic fake data. SSNs use 800-899 range to avoid ITIN (9XX) conflict.
- `mask` (UI: Mask): Partial masking (last 4 digits revealed). Falls back to tag if no mask function defined.
- `redact` (UI: Label): Simple `[TYPE REDACTED]` tags.

### Faker Determinism

Same input + same seed = same fake output every run, in both engines. Python's `Faker` uses SHA-256
of `{seed}:{original_value}:{counter}` to seed a `random.Random` per replacement; the TS port uses
`cyrb53` + `mulberry32` for the same property. This is intentional for reproducibility.

## Dependencies

**Desktop app** (`package.json`): `@tauri-apps/api` + `@tauri-apps/cli` + plugins (`dialog`,
`opener`), `@huggingface/tokenizers`, `onnxruntime-web`, `mupdf`, `pdf-lib`; dev:
`vite`, `typescript`, `vitest`. Rust (`src-tauri/Cargo.toml`): `tauri` 2.x, `serde`/`serde_json`,
`log`, `tauri-plugin-{log,opener,dialog}`.

**Reference engine** (`redactabit.py`): `gradio` (UI), `pymupdf` (preferred PDF) or `pypdf` +
`reportlab` (fallback). The engine itself (`redact()`, `Faker`, `PATTERNS`) is stdlib-only and can
be imported as a library without Gradio.

## Development Commands

```bash
# --- Shipped desktop app ---
npm install
npm run dev            # Vite dev server (frontend only)
npm run tauri dev      # full desktop app (Rust + WebView)
npm run build          # Vite production build → ui/dist
npm run tauri build    # production installer (NSIS/MSI on Windows)
npm test               # vitest (TS engine + detector + pdf-redact)

# --- Reference / CLI engine (Python) ---
pip install gradio pymupdf
python redactabit.py --ui                          # Gradio UI at http://localhost:7860
python redactabit.py statement.pdf -l 2 -m fake    # CLI
pytest tests/ -v                                   # Python engine tests
pytest tests/ --cov=redactabit --cov-report=term-missing

# Quick engine smoke test
python -c "from redactabit import redact; print(redact('SSN: 123-45-6789', level=2, mode='fake'))"
```

CI (`.github/workflows/ci.yml`) runs **both** suites on every push/PR: `tsc --noEmit` + `vitest`,
and `pytest tests/`.

## Gradio Compatibility (reference engine only)

`redactabit.py` supports both Gradio 5.x and 6.x. Key differences handled:
- `theme` and `css` passed to `launch()` not `Blocks()` (Gradio 6 change)
- `show_copy_button` removed from `Textbox` (dropped in Gradio 6)
- File inputs handled as both string paths (Gradio 6) and objects with `.name` (Gradio 5) via `_filepath()` helper

If adding new Gradio components, test on both versions or use try/except wrappers.

## Testing Strategy

- **TS (shipped app):** `vitest` over `ui/src/*.test.ts` — `engine.test.ts`,
  `gliner-detector.test.ts`, `pdf-redact.test.ts`.
- **Python (reference engine):** `pytest` over `tests/test_engine.py`.

Both harnesses cover the same engine contract:

1. **Pattern coverage**: Every pattern has at least one positive and one negative test
2. **Level gating**: Verify patterns only activate at their declared level
3. **Mode output**: Same input tested across fake/mask/redact modes
4. **Overlap resolution**: Overlapping patterns (e.g., ITIN vs SSN) resolved correctly
5. **Single-pass integrity**: Fake output from one pattern must NOT be re-matched by another
6. **Determinism**: Same input + same seed = same output across runs
7. **Custom terms**: User-provided terms redacted correctly at all levels
8. **Edge cases**: Empty input, no matches, all-matches, Unicode, very long text

When adding a new pattern, add corresponding test cases (positive match, negative non-match, level
gating) in **both** suites to keep the engines in parity.

## Code Style

- No classes for the engine — functional style with dataclasses (Python) / plain functions (TS)
- Type hints on public functions (Python); the TS engine imports nothing
- f-strings for formatting (Python); match the surrounding TS idiom on the frontend
- `redactabit.py` is single-file by design — do not split unless it exceeds ~800 lines
- Comments explain "why" not "what"

## Common Tasks

### Adding a New Pattern

1. Add the pattern to **both** engines: a `Pat()` entry in `redactabit.py`'s `PATTERNS`, and the
   matching entry in `ui/src/engine.ts`'s pattern registry (keep parity, or note the divergence)
2. Choose priority (higher = wins in overlap conflicts)
3. Add a fake generator + mask function if the existing ones don't fit
4. Add test cases in **both** `tests/test_engine.py` and `ui/src/engine.test.ts`
5. Test on a real document

### Adding a New Replacement Mode

1. Add the mode to the `MODES` registry (`engine.ts`) and the `mode` choices in `redact()` /
   `build_ui()` (Python)
2. Add the replacement logic branch in the Step 4 loop
3. Add test cases in both suites

## Known Limitations

- No OCR — scanned PDFs with no embedded text won't work in either engine
- Patterns are US-centric (SSN, US phone, US addresses); detection is country-scoped, US-first
- **Shipped app PDF redaction** (mupdf-wasm + pdf-lib): replacement is drawn in Helvetica (not the
  original font); long fakes may overflow; line-split matches fail safe (refuse to save); rotated
  text is out of scope
- **Reference engine PDF**: PyMuPDF may miss redactions if extracted text differs from visual text;
  the pypdf/reportlab fallback outputs text-only PDFs
- Zip code pattern at Level 3 can catch other 5-digit numbers; EIN (XX-XXXXXXX) can match other
  hyphenated number formats

## Roadmap (not yet built)

- [x] True PDF-as-PDF redaction (mupdf-wasm content-stream removal) in the shipped app
- [x] CLI mode for the reference engine (argparse)
- [ ] International patterns (UK NI numbers, Indian Aadhaar, EU VAT IDs) as regex packs
- [ ] Configurable pattern file (YAML/JSON) for custom pattern sets
- [ ] Drag-and-drop batch processing (multiple files)
- [ ] macOS and Linux desktop builds
