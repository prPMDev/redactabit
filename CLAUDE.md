# CLAUDE.md — Redacto

## Project Overview

Redacto is a local, offline document redaction tool. It strips sensitive PII from PDFs and text files, replacing matches with realistic fake data, partial masks, or [REDACTED] tags. Gradio-based browser UI. Single-file Python architecture. MIT licensed.

**Core value prop:** "Nothing leaves your machine." This is not a SaaS product. It runs entirely locally. This principle is non-negotiable in all design decisions.

## Architecture

Single-file: `redacto.py` contains everything — engine, patterns, faker, file processors, and Gradio UI.

### Key Components

```
Faker              → Deterministic fake data generator (seeded by original value, cached)
Pat                → Pattern dataclass (regex, level, priority, mode handlers)
PATTERNS           → Ordered list of Pat instances, grouped by level (1/2/3)
redact()           → Single-pass engine: collect matches → resolve overlaps → replace
process_pdf_pymupdf() → Structure-preserving PDF redaction via PyMuPDF (preferred)
process_pdf()      → PDF text extraction via pypdf (fallback)
save_text_pdf()    → Rebuild PDF from redacted text via reportlab (fallback)
process_text_file()→ Plain text file handling
build_ui()         → Gradio interface with compare view
```

### Single-Pass Engine (critical design decision)

The `redact()` function uses a single-pass architecture to prevent cascading — where Pattern A's fake output gets re-matched by Pattern B.

1. Collect ALL regex matches from all active patterns
2. Sort by position, then by priority (higher priority wins ties)
3. Remove overlapping matches (greedy: first match at each position wins)
4. Replace from end to start (preserves string positions)

**Never** replace text in multiple passes. All patterns must be evaluated against the original text.

### Redaction Levels

- Level 1 (Light): SSNs, ITINs, bank accounts, routing numbers, credit cards, passport/visa/USCIS numbers
- Level 2 (Standard): + EIN, phone, email, street address, DOB, named fields
- Level 3 (Heavy): + dollar amounts, zip codes, 9-digit number catch-all

### Replacement Modes

- `fake`: Realistic fake data. SSNs use 800-899 range to avoid ITIN (9XX) conflict.
- `mask`: Partial masking (last 4 digits revealed). Falls back to tag if no mask function defined.
- `redact`: Simple [TYPE REDACTED] tags.

### Faker Determinism

`Faker` uses SHA-256 of `{seed}:{original_value}:{counter}` to create a seeded `random.Random` per replacement. Same input + same seed = same fake output every run. This is intentional for reproducibility.

## Dependencies

- `gradio` — Browser UI (supports Gradio 5.x and 6.x)
- `pymupdf` — PDF read/write with structure-preserving redaction (preferred)
- `pypdf` + `reportlab` — Fallback PDF handling when PyMuPDF not installed

Stdlib only for the engine itself (`re`, `random`, `hashlib`, `dataclasses`). The engine (`redact()`, `Faker`, `PATTERNS`) has zero external dependencies and can be used as a library without Gradio.

## Development Commands

```bash
# Run the app
python redacto.py

# Run tests
pytest tests/ -v

# Run tests with coverage
pytest tests/ --cov=redacto --cov-report=term-missing

# Quick engine smoke test
python -c "from redacto import redact; print(redact('SSN: 123-45-6789', level=2, mode='fake'))"
```

## Gradio Compatibility

The code supports both Gradio 5.x and 6.x. Key differences handled:
- `theme` and `css` passed to `launch()` not `Blocks()` (Gradio 6 change)
- `show_copy_button` removed from `Textbox` (dropped in Gradio 6)
- File inputs handled as both string paths (Gradio 6) and objects with `.name` (Gradio 5) via `_filepath()` helper

If adding new Gradio components, test on both versions or use try/except wrappers.

## Testing Strategy

Tests are in `tests/test_engine.py`. The test harness covers:

1. **Pattern coverage**: Every pattern in PATTERNS has at least one positive and one negative test
2. **Level gating**: Verify patterns only activate at their declared level
3. **Mode output**: Same input tested across fake/mask/redact modes
4. **Overlap resolution**: Overlapping patterns (e.g., ITIN vs SSN) resolved correctly
5. **Single-pass integrity**: Fake output from one pattern must NOT be re-matched by another
6. **Determinism**: Same input + same seed = same output across runs
7. **Custom terms**: User-provided terms redacted correctly at all levels
8. **Edge cases**: Empty input, no matches, all-matches, Unicode, very long text

When adding a new pattern, add corresponding test cases in all three categories (positive match, negative non-match, level gating).

## Code Style

- No classes for the engine — functional style with dataclasses for data containers
- Type hints on public functions
- f-strings for formatting
- Single-file architecture is intentional — do not split into modules unless the file exceeds ~800 lines
- Comments explain "why" not "what"

## Common Tasks

### Adding a New Pattern

1. Add a `Pat()` entry to `PATTERNS` list at the appropriate level position
2. Choose priority (higher = wins in overlap conflicts)
3. Add a fake generator method to `Faker` if the existing ones don't fit
4. Add a mask function if partial masking makes sense for this data type
5. Add test cases in `tests/test_engine.py`
6. Test with `--preview` on a real document

### Adding a New Replacement Mode

1. Add the mode name to the `mode` parameter choices in `redact()` and `build_ui()`
2. Add the replacement logic branch in the Step 4 loop of `redact()`
3. Update Gradio Radio choices and info text
4. Add test cases

### Updating for New Gradio Version

1. Check `build_ui()` for deprecated parameters
2. Check `_filepath()` handles the new file input format
3. Check `launch()` kwargs are still valid
4. Test UI manually — automated Gradio testing is fragile

## Known Limitations

- PDF structure preservation requires PyMuPDF; falls back to text-only without it
- PyMuPDF may miss some redactions if extracted text differs from visual text (logged as visual misses)
- Patterns are US-centric (SSN, US phone, US addresses)
- No OCR — scanned PDFs with no embedded text won't work
- Zip code pattern at Level 3 can catch other 5-digit numbers (dates, counts)
- EIN pattern (XX-XXXXXXX) can match other hyphenated number formats

## Roadmap (not yet built)

- [x] Preserve PDF layout using PyMuPDF structure-preserving redaction
- [x] Compare view (side-by-side original vs redacted)
- [ ] International patterns (UK NI numbers, Indian Aadhaar, EU VAT IDs)
- [ ] CLI mode alongside Gradio (argparse entrypoint)
- [ ] Configurable pattern file (YAML/JSON) for custom pattern sets
- [ ] Drag-and-drop batch processing (multiple files)
- [ ] Docker container for zero-install sharing
