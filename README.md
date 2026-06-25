# 🔒 Redactabit

**Mask the personal. Paste the rest.**

Redactabit swaps the personal details in a document for realistic fake ones, so the file still reads normally and the numbers still add up. It runs on your own computer.

[Website](https://prpmdev.github.io/redactabit/) · Local and offline · AGPLv3

<!-- Screenshot slot — drop in docs/screenshot-app.png and uncomment -->
<!-- ![Redactabit](docs/screenshot-app.png) -->

## Why

You might want to share a bank statement with your accountant, paste a contract into an AI chatbot, or send records to a lawyer. Usually that means exposing your SSN, account numbers, and address right along with it.

Online redaction tools don't really solve it: you upload the very document you were trying to protect. Blunt `[REDACTED]` bars leave the file unreadable. Redactabit swaps the sensitive parts for believable fakes instead, so the document still makes sense and an AI can still work with it. Your real information just isn't in the copy you share.

(The name is just *redact a bit*: take out what identifies you, leave everything else in place.)

## How it works

Drop in a file, pick a **mode** (how each match is replaced) and a **level** (how much gets touched), then download a clean copy.

```
Name:    Michael Thompson         Name:    Daniel Foster
SSN:     482-19-3756        →      SSN:     837-44-1920
Account: 1029384756                Account: 6647201938
Balance: $48,210.55                Balance: $48,210.55   ← kept
```

That's **Fake** mode. It's not just replacement, though — the same SSN goes three ways depending on the mode you pick:

```
Fake    482-19-3756  →  837-44-1920       a realistic stand-in (best for AI)
Mask    482-19-3756  →  XXX-XX-3756       last 4 kept
Label   482-19-3756  →  [SSN REDACTED]    a plain tag
```

- **Levels.** Light = the critical IDs (SSN, accounts, cards, passport/visa). Standard adds contact and identity (email, phone, address, DOB, named fields). Heavy adds amounts and ZIP codes, so a balance stays at Light/Standard but is replaced at Heavy.
- **Detection.** Built-in patterns catch structured IDs like SSNs, cards, and account numbers. In the desktop app, optional local [GLiNER](https://github.com/urchade/GLiNER) models also pick up names and addresses; they download the first time you use them.
- **Repeatable.** The same input always produces the same fake, so a document stays consistent with itself.

It handles PDFs and text files (`.txt`, `.csv`, `.md`, `.json`, `.xml`, `.html`). There's no OCR yet, so scanned PDFs need a real text layer.

## Get Redactabit

Start on the [website](https://prpmdev.github.io/redactabit/). It always points to the current build.

**Desktop app.** [Download for Windows](https://github.com/prPMDev/redactabit/releases/latest) is a single installer (around 50 MB) that runs the redactor and the optional detection models without needing Python. macOS and Linux are coming.

**Python version**, which works today:

```bash
pip install gradio pymupdf     # dependencies
python redactabit.py              # opens the UI at http://localhost:7860
python redactabit.py statement.pdf -l 2 -m fake   # or run it from the command line
```

## Privacy

Your document stays on your computer. It doesn't upload your file, ask you to sign in, or phone home. The interface only listens on `127.0.0.1`, so nothing else on your network can reach it. The optional detection models download once, and after that it runs with the Wi-Fi off. It's open source (AGPLv3), so you can read the code and confirm all of this for yourself.

## Build from source

```bash
git clone https://github.com/prPMDev/redactabit.git
cd redactabit

# Python version
pip install gradio pymupdf && python redactabit.py

# Desktop app (needs Node, Rust, and your platform's build tools)
npm install && npm run tauri build   # installers land in src-tauri/target/release/bundle/
```

Tests run with `pytest` (the engine) and `npm test` (the desktop engine and detector).

## Where it stands

**Today.** The redaction engine in Python and TypeScript, three levels and three modes, the regex floor plus GLiNER detection, PDF and text support, and repeatable fakes. It's US-focused for now.

**Next.** Signed installers for macOS and Linux, and bundling the model runtime so even the first run works offline.

**Later.** More countries (UK, India, the EU), keeping PDF layout intact, and OCR for scanned files.

## License

AGPLv3 (`AGPL-3.0-or-later`). See [LICENSE](LICENSE). Redactabit is a passion project I don't intend to monetize, so copyleft is a feature, not a cost: use it, fork it, ship it, and keep your version open too. (True PDF redaction is built on [MuPDF](https://mupdf.com), which is AGPL.)

Built by [prPMDev](https://github.com/prPMDev). The detection builds on [GLiNER](https://github.com/urchade/GLiNER) and the desktop app on [Tauri](https://tauri.app). The site borrows its spirit from [Handy](https://handy.computer).
