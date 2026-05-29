# Redacto — Product Requirements Document

## Problem Statement

People need to share sensitive documents (tax returns, financial statements, medical records, legal filings) with professionals, AI tools, and online services. Current options are inadequate:

- **Manual redaction** is slow, error-prone, and misses patterns humans don't think about
- **Online redaction tools** require uploading sensitive documents to third-party servers — defeating the purpose
- **Enterprise solutions** (Adobe Acrobat Pro, etc.) are expensive and overkill for individual use
- **[REDACTED] tags** break document readability and make shared documents hard to work with

Immigrants and visa holders face additional risk: tax filing errors, improperly handled SSNs, or identity exposure can have immigration consequences beyond financial harm.

## Solution

A local, offline document redaction tool that replaces sensitive data with realistic fake data, preserving document structure and readability. Nothing leaves the user's machine.

## Core Principles

1. **Local-only.** No network calls, no telemetry, no cloud dependencies for the core function. This is the product's entire trust proposition.
2. **Fake > Redact.** Replacing `123-45-6789` with `862-23-7081` is more useful than `[SSN REDACTED]` because the document remains structurally readable.
3. **Levels, not settings.** Users shouldn't configure 15 regex toggles. They pick a level (light/standard/heavy) and it just works.
4. **Deterministic.** Same input + same seed = same output. Reproducible for verification.
5. **Single file.** No complex installation. Download one Python file, install deps, run.

## Users

### Primary: Privacy-conscious individuals sharing documents with professionals or AI
- Sharing tax returns with accountants, financial advisors, or AI tools for review
- Sharing financial documents with immigration lawyers
- Sharing medical records with second-opinion services
- Anyone who needs to share a document but not their identity

### Secondary: Developers and teams building on top of the engine
- Using `redact()` as a library function in data pipelines
- Building custom redaction workflows for specific document types
- Integrating into CI/CD for test data generation from production documents

## Features

### v1.0 (Current)

#### Redaction Engine
- **Single-pass architecture** preventing cascading false matches
- **17 built-in patterns** covering US PII: SSN, ITIN, bank accounts, routing numbers, credit cards, EIN, phone, email, street address, DOB, passport, visa number, USCIS/alien number, named fields, dollar amounts, zip codes, 9-digit catch-all
- **Priority-based overlap resolution** (e.g., ITIN 9XX-XX-XXXX wins over generic SSN XXX-XX-XXXX)
- **Custom terms** for user-specified names, addresses, employers, or any string

#### Three Redaction Levels
| Level | Name | Redacts | Keeps |
|-------|------|---------|-------|
| 1 | Light | SSNs, ITINs, bank/card numbers, immigration docs | Phone, email, address, amounts, zip |
| 2 | Standard | + Phone, email, address, DOB, EIN, names | Amounts, zip codes |
| 3 | Heavy | + Dollar amounts, zip codes, 9-digit numbers | Almost nothing |

#### Three Replacement Modes
| Mode | Example | Use Case |
|------|---------|----------|
| fake | `862-23-7081` | Sharing with AI — document reads naturally |
| mask | `XXX-XX-6789` | Verifying correct document — last 4 visible |
| redact | `[SSN REDACTED]` | Formal/legal sharing — explicit markers |

#### Fake Data Generator
- Deterministic: seeded by SHA-256 of original value + global seed
- SSNs use 800-899 range (IRS test range, won't conflict with ITINs)
- Dollar amounts replaced with values in the same order of magnitude
- Names, addresses, emails are plausible but clearly not real individuals

#### File Support
- **PDF** (`.pdf`): Text extraction via pypdf, output via reportlab
- **Text files** (`.txt`, `.csv`, `.md`, `.json`, `.xml`, `.html`)

#### Browser UI (Gradio)
- File upload with drag-and-drop
- Level and mode selectors
- Custom terms input (comma-separated)
- Seed input for reproducibility
- Preview mode (see changes without saving)
- Download redacted file
- Change log showing every redaction made
- Compatible with Gradio 5.x and 6.x

### v1.1 (Planned)

- [ ] CLI mode via argparse (run without Gradio for scripting/pipelines)
- [ ] Batch processing (multiple files in one session)
- [ ] "Compare" view showing original vs redacted side by side
- [ ] Export change log as CSV for audit trails
- [ ] Remember last-used custom terms across sessions (local storage only)

### v2.0 (Future)

- [ ] International patterns: UK National Insurance, Indian Aadhaar/PAN, EU VAT IDs, Canadian SIN
- [ ] Configurable pattern files (YAML/JSON) for custom pattern sets
- [ ] PDF layout preservation (redact in-place rather than regenerating as text)
- [ ] OCR pipeline for scanned PDFs (Tesseract integration)
- [ ] Docker image for zero-install distribution
- [ ] Hugging Face Spaces deployment for demo (with clear disclaimers about data leaving machine)

## Technical Requirements

### Runtime
- Python 3.9+
- Dependencies: `gradio`, `pypdf`, `reportlab`
- Engine core (`redact()`, `Faker`, `PATTERNS`) has zero external dependencies

### Performance
- Redaction of a 50-page PDF should complete in < 5 seconds
- UI should remain responsive during processing
- Memory: should handle files up to 100MB without issues

### Security
- No network calls from the engine or file processors
- Gradio runs with `share=False` by default (localhost only)
- No logging of file contents or redacted data
- No telemetry

### Compatibility
- Windows, macOS, Linux
- Gradio 5.x and 6.x
- Python 3.9, 3.10, 3.11, 3.12, 3.13

## Non-Goals

- This is NOT an enterprise DLP (Data Loss Prevention) tool
- This does NOT guarantee 100% PII detection — it catches common US patterns
- This does NOT preserve PDF visual layout (v1 outputs text-only PDFs)
- This does NOT perform OCR on scanned documents
- This does NOT connect to any cloud service, ever

## Success Metrics

For an open-source tool, success means:
- A user can go from `pip install` to redacted document in under 2 minutes
- The tool catches 95%+ of standard US PII patterns in structured documents
- Zero false positives on common text (dates, zip codes, etc.) at Level 1-2
- Fake data output is realistic enough that redacted documents can be used directly in downstream workflows (AI analysis, advisor review)

## Competitive Landscape

| Tool | Local? | Fake Data? | Free? | Single File? |
|------|--------|------------|-------|-------------|
| **Redacto** | ✅ | ✅ | ✅ | ✅ |
| Adobe Acrobat Pro | ✅ | ❌ | ❌ ($240/yr) | N/A |
| Microsoft Presidio | ✅ | ✅ | ✅ | ❌ (heavy) |
| Online redactors | ❌ | ❌ | Varies | N/A |
| regex + sed | ✅ | ❌ | ✅ | ✅ but no UI |

Redacto's niche: **lightweight, local, fake-data-first, with a UI that non-developers can use.**
