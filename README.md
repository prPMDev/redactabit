# 🔒 Frisket

**Local, offline document redaction with realistic fake data.**

Strip SSNs, bank accounts, and sensitive PII from PDFs and text files — replacing them with realistic fake data that keeps documents readable. Everything runs on your machine. Nothing is sent anywhere.

<!-- ![Frisket Screenshot](screenshot.png) -->
<!-- TODO: Add screenshot after first run -->

## Why

You need to share a tax return with your accountant, upload a financial document to an AI tool, or send records to a lawyer. You shouldn't have to expose your SSN, bank account, or home address to do it.

Online redaction tools defeat the purpose — you're uploading sensitive documents to a stranger's server. `[REDACTED]` tags break document readability. Manual redaction misses things.

Frisket replaces sensitive data with **realistic fakes** so your documents remain structurally intact and useful, while your identity stays private.

## Quick Start

```bash
# Install
pip install gradio pypdf reportlab

# Run
python frisket.py

# Open http://localhost:7860
```

Or install as a package:

```bash
pip install .
frisket
```

## How It Works

Upload a file → pick a level and mode → download the clean version.

### Redaction Levels

| Level | Name | What's Redacted | What's Kept |
|-------|------|----------------|-------------|
| **1** | Light | SSNs, ITINs, bank accounts, routing numbers, credit cards, passport/visa/USCIS numbers | Phone, email, address, employer, EIN, amounts, zip |
| **2** | Standard | + Phone, email, street address, DOB, EIN, named fields | Dollar amounts, zip codes, city, state |
| **3** | Heavy | + Dollar amounts, zip codes, all 9-digit numbers | Almost nothing |

Custom terms (names, addresses, employers) are always redacted regardless of level.

### Replacement Modes

| Mode | SSN Example | Best For |
|------|------------|----------|
| **fake** | `862-23-7081` | Sharing with AI tools — document reads naturally |
| **mask** | `XXX-XX-6789` | Verifying you have the right document |
| **redact** | `[SSN REDACTED]` | Formal/legal sharing |

### Fake Data

- **Deterministic**: Same input + same seed = same fake output every run
- **Non-conflicting**: Fake SSNs use 800-899 range (won't collide with real ITINs)
- **Proportional**: Dollar amounts stay in the same order of magnitude ($287K → $165K)
- **Plausible**: Names, addresses, and emails look real but aren't

## Supported Files

- **PDF** (`.pdf`) — text extraction + redacted text PDF output
- **Text** (`.txt`, `.csv`, `.md`, `.json`, `.xml`, `.html`)

## Development

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/frisket.git
cd frisket
pip install -e ".[dev]"
```

### Run Tests

```bash
# All tests
pytest

# With coverage
pytest --cov=frisket --cov-report=term-missing

# Specific test class
pytest tests/test_engine.py::TestPatternPositive -v
```

### Test Categories

| Category | What It Tests |
|----------|--------------|
| `TestPatternPositive` | Every pattern matches its intended format |
| `TestPatternNegative` | Patterns don't fire on non-matching text |
| `TestLevelGating` | Patterns only activate at their declared level |
| `TestModes` | fake/mask/redact produce correct output formats |
| `TestOverlap` | Priority-based resolution when patterns overlap |
| `TestSinglePass` | Fake output isn't re-matched by other patterns |
| `TestDeterminism` | Same input + seed = same output across runs |
| `TestCustomTerms` | User-provided terms work at all levels |
| `TestEdgeCases` | Empty input, Unicode, very long text |
| `TestFaker` | Fake data generators produce valid formats |

### Project Structure

```
frisket/
├── frisket.py          # Everything — engine, patterns, faker, UI
├── pyproject.toml        # Package config, dependencies, scripts
├── README.md             # This file
├── PRD.md                # Product requirements document
├── LICENSE               # MIT
├── .gitignore
└── tests/
    ├── __init__.py
    └── test_engine.py    # Full test suite
```

### Adding a Pattern

1. Add a `Pat()` to `PATTERNS` at the correct level position
2. Set priority (higher wins in overlaps)
3. Add a `Faker` method if needed
4. Add a mask function if partial masking makes sense
5. Add tests in `test_engine.py` (positive, negative, level gating)
6. Test with `--preview` on a real document

## Architecture

Single-file by design. The redaction engine uses a **single-pass** approach:

1. **Collect** all regex matches from all active patterns against original text
2. **Sort** by position, then priority (higher priority wins overlapping matches)
3. **Filter** overlaps (greedy: first match at each position wins)
4. **Replace** from end to start (preserves string positions)

This prevents cascading — where Pattern A's fake output gets re-matched by Pattern B. The engine core (`redact()`, `Faker`, `PATTERNS`) has zero external dependencies and can be imported as a library.

## Limitations

- PDF output is text-only (original visual layout not preserved)
- Patterns are US-centric (SSN, US phone, US addresses)
- No OCR — scanned PDFs without embedded text won't work
- Not a substitute for professional review — always check output manually

## License

MIT — Use it, fork it, modify it, sell it. No restrictions.
