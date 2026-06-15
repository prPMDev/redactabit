# 🔒 Frisket

**Mask the personal. Paste the rest.**

Frisket swaps the personal details in a document for realistic fake ones, so the file still reads normally and the numbers still add up. It runs on your own computer.

[Website](https://prpmdev.github.io/frisket/) · Local and offline · MIT licensed

<!-- Screenshot slot — drop in docs/screenshot-app.png and uncomment -->
<!-- ![Frisket](docs/screenshot-app.png) -->

## Why

You might want to share a bank statement with your accountant, paste a contract into an AI chatbot, or send records to a lawyer. Usually that means exposing your SSN, account numbers, and address right along with it.

Online redaction tools don't really solve it: you upload the very document you were trying to protect. Blunt `[REDACTED]` bars leave the file unreadable. Frisket swaps the sensitive parts for believable fakes instead, so the document still makes sense and an AI can still work with it. Your real information just isn't in the copy you share.

(A frisket, in printing, is the mask that keeps ink off the parts of a page meant to stay clean. Same idea here.)

## How it works

Drop in a file, choose how much to take out, and download a clean copy.

```
Name:    Michael Thompson         Name:    Daniel Foster
SSN:     482-19-3756        →      SSN:     837-44-1920
Account: 1029384756                Account: 6647201938
Balance: $48,210.55                Balance: $48,210.55   ← kept
```

- **Levels.** Light covers the critical IDs, Standard adds contact and identity details, and Heavy also takes amounts and locations.
- **Modes.** `fake` writes realistic replacements (best for AI), `mask` shows only the last four characters, and `redact` drops in plain tags.
- **Detection.** Built-in patterns catch structured IDs like SSNs, cards, and account numbers. In the desktop app, optional local [GLiNER](https://github.com/urchade/GLiNER) models also pick up names and addresses; they download the first time you use them.
- **Repeatable.** The same input always produces the same fake, so a document stays consistent with itself.

It handles PDFs and text files (`.txt`, `.csv`, `.md`, `.json`, `.xml`, `.html`). There's no OCR yet, so scanned PDFs need a real text layer.

## Get Frisket

Start on the [website](https://prpmdev.github.io/frisket/). It always points to the current build.

**Desktop app.** [Download for Windows](https://github.com/prPMDev/frisket/releases/latest) is a single installer (around 50 MB) that runs the redactor and the optional detection models without needing Python. macOS and Linux are coming.

**Python version**, which works today:

```bash
pip install gradio pymupdf     # dependencies
python frisket.py              # opens the UI at http://localhost:7860
python frisket.py statement.pdf -l 2 -m fake   # or run it from the command line
```

## Privacy

Your document stays on your computer. It doesn't upload your file, ask you to sign in, or phone home. The interface only listens on `127.0.0.1`, so nothing else on your network can reach it. The optional detection models download once, and after that it runs with the Wi-Fi off. It's MIT-licensed, so you can read the code and confirm all of this for yourself.

## Build from source

```bash
git clone https://github.com/prPMDev/frisket.git
cd frisket

# Python version
pip install gradio pymupdf && python frisket.py

# Desktop app (needs Node, Rust, and your platform's build tools)
npm install && npm run tauri build   # installers land in src-tauri/target/release/bundle/
```

Tests run with `pytest` (the engine) and `npm test` (the desktop engine and detector).

## Where it stands

**Today.** The redaction engine in Python and TypeScript, three levels and three modes, the regex floor plus GLiNER detection, PDF and text support, and repeatable fakes. It's US-focused for now.

**Next.** Signed installers for macOS and Linux, and bundling the model runtime so even the first run works offline.

**Later.** More countries (UK, India, the EU), keeping PDF layout intact, and OCR for scanned files.

## License

MIT. Use it, fork it, ship it. See [LICENSE](LICENSE).

Built by [prPMDev](https://github.com/prPMDev). The detection builds on [GLiNER](https://github.com/urchade/GLiNER) and the desktop app on [Tauri](https://tauri.app). The site borrows its spirit from [Handy](https://handy.computer).
