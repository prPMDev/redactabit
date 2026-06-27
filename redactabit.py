#!/usr/bin/env python3
"""
Redact-a-bit — Local, offline document redaction with realistic fake data.

Upload a PDF or text file, pick your privacy level, and download a clean 
version with sensitive data replaced by realistic fakes, partial masks, 
or [REDACTED] tags. Everything runs locally. Nothing leaves your machine.

Run:   python redactabit.py
Open:  http://localhost:7860

Install: pip install gradio pymupdf  (or: pip install gradio pypdf reportlab)

License: AGPL-3.0-or-later
GitHub:  https://github.com/prPMDev/redactabit
"""

__version__ = "1.1.0"

import re
import random
import string
import hashlib
import tempfile
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

# Privacy guarantee: disable Gradio's outbound telemetry before gradio is imported
# anywhere. A "nothing leaves your machine" tool must not phone home — ever.
os.environ["GRADIO_ANALYTICS_ENABLED"] = "False"

# ============================================================
# FAKE DATA GENERATOR
# Deterministic: same input always produces same fake output.
# Fake SSNs use 800-899 range to avoid ITIN (9XX) conflicts.
# ============================================================

class Faker:
    FIRSTS = ["James","Maria","Robert","Linda","David","Sarah","Michael","Jennifer",
              "William","Patricia","Richard","Elizabeth","Thomas","Susan","Daniel","Karen",
              "Joseph","Nancy","Charles","Betty","Matthew","Dorothy","Andrew","Margaret"]
    LASTS = ["Anderson","Martinez","Thompson","Garcia","Robinson","Wilson","Clark","Lewis",
             "Walker","Hall","Young","King","Wright","Green","Baker","Hill","Nelson","Carter"]
    STREETS = ["Maple","Oak","Cedar","Pine","Elm","Washington","Park","Lake","Sunset",
               "River","Spring","Forest","Valley","Meadow","Ridge","Birch","Willow","Cherry"]
    ST_TYPES = ["St","Ave","Dr","Ln","Rd","Ct","Way","Blvd"]
    DOMAINS = ["email.com","mail.net","inbox.org","post.com","letters.net","mailbox.org"]

    def __init__(self, seed="redactabit"):
        self._seed = seed
        self._cache = {}  # (method_name, original_value) → replacement

    def _r(self, orig):
        h = int(hashlib.sha256(f"{self._seed}:{orig}".encode()).hexdigest()[:8], 16)
        return random.Random(h)

    def ssn(self, o):
        r = self._r(o); return f"{r.randint(800,899)}-{r.randint(10,99)}-{r.randint(1000,9999)}"
    def itin(self, o):
        r = self._r(o); return f"9{r.randint(50,99)}-{r.randint(70,99)}-{r.randint(1000,9999)}"
    def phone(self, o):
        r = self._r(o); return f"(555) {r.randint(100,999)}-{r.randint(1000,9999)}"
    def email(self, o):
        r = self._r(o); return f"{r.choice(self.FIRSTS).lower()}.{r.choice(self.LASTS).lower()}@{r.choice(self.DOMAINS)}"
    def name(self, o):
        r = self._r(o); return f"{r.choice(self.FIRSTS)} {r.choice(self.LASTS)}"
    def street(self, o):
        r = self._r(o); return f"{r.randint(100,9999)} {r.choice(self.STREETS)} {r.choice(self.ST_TYPES)}"
    def account(self, o):
        r = self._r(o); return "Acct #" + ''.join(str(r.randint(0,9)) for _ in range(r.randint(8,12)))
    def routing(self, o):
        r = self._r(o); return "Routing: " + ''.join(str(r.randint(0,9)) for _ in range(9))
    def ein(self, o):
        r = self._r(o); return f"{r.randint(20,89)}-{r.randint(1000000,9999999)}"
    def card(self, o):
        r = self._r(o); return f"4{r.randint(100,999)}-XXXX-XXXX-{r.randint(1000,9999)}"
    def dob(self, o):
        r = self._r(o); return f"DOB: {r.randint(1,12):02d}/{r.randint(1,28):02d}/{r.randint(1960,1998)}"
    def passport(self, o):
        r = self._r(o); return f"Passport# {r.choice(string.ascii_uppercase)}{r.randint(10000000,99999999)}"
    def alien(self, o):
        r = self._r(o); return f"A#{r.randint(100000000,999999999)}"
    def visa(self, o):
        r = self._r(o); return f"Visa# {''.join(r.choice(string.ascii_uppercase) for _ in range(2))}{r.randint(10000000,99999999)}"
    def pan(self, o):
        r = self._r(o); u = string.ascii_uppercase
        return f"{r.choice(u)}{r.choice(u)}{r.choice(u)}Z{r.choice(u)}{r.randint(1000,9999)}{r.choice(u)}"  # 4th char Z = invalid holder type, so never a real PAN
    def refid(self, o):
        r = self._r(o); ch = string.ascii_uppercase + "23456789"
        return "# " + "".join(r.choice(ch) for _ in range(10))
    def cityline(self, o):
        r = self._r(o)
        city = r.choice(["Springdale","Riverton","Fairview","Brookside","Lakewood","Hillcrest"])
        return f"{city}, {r.choice(['OH','IL','TX','CO','WA','GA'])} {r.randint(10000,99999)}"
    def zipcode(self, o):
        r = self._r(o); return str(r.randint(10000,99999))
    def amount(self, o):
        r = self._r(o)
        nums = re.sub(r'[^\d.]', '', o)
        try:
            v = float(nums) if nums else 1000
            f_v = v * r.uniform(0.4, 1.6)
            return f"${f_v:,.2f}"
        except ValueError:
            return f"${r.randint(100,99999):,.2f}"


# Masking functions
def _mask_ssn(o):
    d = re.sub(r'\D','',o); return f"XXX-XX-{d[-4:]}" if len(d)>=4 else "XXX-XX-XXXX"
def _mask_phone(o):
    d = re.sub(r'\D','',o); return f"(XXX) XXX-{d[-4:]}" if len(d)>=4 else "(XXX) XXX-XXXX"
def _mask_email(o):
    p = o.split('@'); return f"{p[0][0]}***@{p[1]}" if len(p)==2 else "***@***.***"
def _mask_acct(o):
    d = re.sub(r'\D','',o); return f"Acct #{'X'*(len(d)-4)}{d[-4:]}" if len(d)>=4 else "Acct #XXXX"
def _mask_card(o):
    d = re.sub(r'\D','',o); return f"XXXX-XXXX-XXXX-{d[-4:]}" if len(d)>=4 else "XXXX-XXXX-XXXX-XXXX"
def _mask_pan(o):
    s = o.strip(); return f"{'X'*(len(s)-4)}{s[-4:]}" if len(s)>=4 else "XXXXXXXXXX"
def _mask_id(o):
    v = re.sub(r'^[#\s:]+', '', o)
    return f"# {'X'*(len(v)-4)}{v[-4:]}" if len(v)>=4 else "# XXXX"
def _mask_name(o):
    return ' '.join(w[0]+'.' for w in o.strip().split() if w)


# ============================================================
# PATTERNS — ordered by specificity (most specific first)
# ============================================================

@dataclass
class Pat:
    name: str
    regex: str
    tag: str              # [REDACTED] mode text
    fake: str             # Faker method name
    mask: object = None   # Mask function (or None → falls back to tag)
    level: int = 1        # Minimum level to activate (1=light, 2=standard, 3=heavy)
    priority: int = 0     # Higher = matched first in overlap resolution
    flags: int = re.IGNORECASE

# Priority ensures that when two patterns match the same text,
# the higher-priority one wins.
PATTERNS = [
    # Level 1 — Critical PII
    Pat("ITIN",           r'\b9\d{2}-\d{2}-\d{4}\b',
        "[ITIN REDACTED]", "itin", _mask_ssn, 1, priority=100),
    Pat("SSN",            r'\b\d{3}-\d{2}-\d{4}\b',
        "[SSN REDACTED]", "ssn", _mask_ssn, 1, priority=90),
    # Optional "Number/No./Num" between label and digits ("Account Number:"); digits may
    # carry single space/dash separators (8-17 digits total).
    Pat("Bank Account",   r'(?i)(?:account|acct|acct\.|a/c)(?:\s*(?:number|no\.?|num\.?))?[\s#:]*(\d(?:[ -]?\d){7,16})',
        "[ACCOUNT REDACTED]", "account", _mask_acct, 1, priority=80),
    Pat("Routing Number", r'(?i)(?:routing|aba|transit)[\s#:]*\d{9}',
        "[ROUTING REDACTED]", "routing", None, 1, priority=80),
    Pat("Credit Card",    r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b',
        "[CARD REDACTED]", "card", _mask_card, 1, priority=85),
    Pat("Alien/USCIS#",   r'(?i)\b(?:alien|uscis|a[-#])\s*\d{7,9}',
        "[IMMIGRATION# REDACTED]", "alien", None, 1, priority=95),
    Pat("Passport",       r'(?i)passport[\s#:]*[A-Z0-9]{6,12}',
        "[PASSPORT REDACTED]", "passport", None, 1, priority=80),
    Pat("Visa Number",    r'(?i)visa[\s#:]*[A-Z0-9]{8,12}',
        "[VISA# REDACTED]", "visa", None, 1, priority=80),
    Pat("PAN (India)",    r'\b[A-Z]{5}[0-9]{4}[A-Z]\b',
        "[PAN REDACTED]", "pan", _mask_pan, 1, priority=88),
    # Generic labeled identifier: "#" + a long caps/digits code is essentially always an ID
    # (Envelope #, Confirmation #, Reference #...). Specific ID rules outrank it on overlaps.
    Pat("Labeled ID",     r'#\s*:?\s*([A-Z0-9][A-Z0-9-]{5,24})\b',
        "[ID REDACTED]", "refid", _mask_id, 1, priority=70, flags=0),

    # Level 2 — Contact & Identity
    Pat("EIN",            r'\b\d{2}-\d{7}\b',
        "[EIN REDACTED]", "ein", None, 2, priority=70),
    Pat("Phone",          r'(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b',
        "[PHONE REDACTED]", "phone", _mask_phone, 2, priority=50),
    Pat("Email",          r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
        "[EMAIL REDACTED]", "email", _mask_email, 2, priority=60),
    # flags=0 (case-sensitive) so ALL-CAPS headers can't pose as Title-Case streets
    # (e.g. "CONTA"+"CT" reading as a bogus "Ct"); [^\S\n] instead of \s so a match
    # can't span newlines and swallow a loose number plus the next line's word.
    Pat("Street Address", r'\b\d{1,6}[^\S\n]+(?:[A-Z][a-z]+[^\S\n]*){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place|Cir|Circle|Ter|Terrace|Pkwy|Parkway|Hwy|Highway|Plaza|Sq|Square|Trl|Trail|Loop)\b\.?',
        "[ADDRESS REDACTED]", "street", None, 2, priority=40, flags=0),
    # ALL-CAPS variant (statements print mail blocks in caps). Caps words + a standalone
    # caps suffix token — still case-sensitive, so prose can't pose as a street.
    Pat("Street Address", r'\b\d{1,6}[^\S\n]+(?:[A-Z]{2,}[^\S\n]+){1,4}(?:ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|RD|ROAD|CT|COURT|WAY|PL|PLACE|CIR|CIRCLE|TER|TERRACE|PKWY|PARKWAY|HWY|HIGHWAY|PLAZA|SQ|SQUARE|TRL|TRAIL|LOOP)\b\.?',
        "[ADDRESS REDACTED]", "street", None, 2, priority=40, flags=0),
    # The classic second address line ("Springfield, IL 62704" / "SPRINGFIELD IL 62704") —
    # city + 2-letter state + ZIP is a strong shape; models miss it inside long docs.
    Pat("City/State ZIP", r'\b[A-Z][a-zA-Z]+(?:[^\S\n]+[A-Z][a-zA-Z]+){0,2},[^\S\n]*[A-Z]{2}[^\S\n]+\d{5}(?:-\d{4})?\b',
        "[ADDRESS REDACTED]", "cityline", None, 2, priority=35, flags=0),
    Pat("City/State ZIP", r'\b[A-Z]{3,}(?:[^\S\n]+[A-Z]{3,}){0,2}[^\S\n]+[A-Z]{2}[^\S\n]+\d{5}(?:-\d{4})?\b',
        "[ADDRESS REDACTED]", "cityline", None, 2, priority=35, flags=0),
    Pat("Date of Birth",  r'(?i)(?:dob|date\s+of\s+birth|birth\s*date|born)[\s:]*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}',
        "[DOB REDACTED]", "dob", None, 2, priority=60),
    Pat("Named Fields",   r'(?i)(?:taxpayer|spouse|dependent|employer|client)[^\S\n:]*:[^\S\n]*([A-Z][a-z]+(?:[^\S\n]+[A-Z][a-z]+){1,3})',
        "[NAME REDACTED]", "name", None, 2, priority=30),

    # Level 3 — Financial & Geographic
    Pat("Dollar Amounts", r'\$[\d,]+\.?\d{0,2}',
        "[AMOUNT REDACTED]", "amount", None, 3, priority=20),
    Pat("Zip Code",       r'\b\d{5}(?:-\d{4})?\b',
        "[ZIP REDACTED]", "zipcode", None, 3, priority=10),
]


# ============================================================
# SINGLE-PASS REDACTION ENGINE
# Collects all matches first, resolves overlaps, then replaces
# from end to start. Prevents pattern A's fake output from
# being re-matched by pattern B.
# ============================================================

def redact(text, level=2, mode="fake", faker=None, custom_terms=None):
    """
    Single-pass redaction. Returns (redacted_text, list_of_changes).
    
    Args:
        text: Input text
        level: 1=light, 2=standard, 3=heavy
        mode: 'fake', 'mask', or 'redact'
        faker: Faker instance (created if None)
        custom_terms: List of additional strings to redact
    """
    if faker is None:
        faker = Faker()

    active = [p for p in PATTERNS if p.level <= level]

    # Step 1: Collect ALL matches from all patterns
    matches = []  # (start, end, pattern, original_text)
    for p in active:
        for m in re.finditer(p.regex, text, p.flags):
            matches.append((m.start(), m.end(), p, m.group()))

    # Add custom terms
    if custom_terms:
        for term in custom_terms:
            if not term.strip():
                continue
            custom_pat = Pat(f"Custom", re.escape(term), "[REDACTED]", "name", _mask_name, 0, priority=200)
            for m in re.finditer(re.escape(term), text, re.IGNORECASE):
                matches.append((m.start(), m.end(), custom_pat, m.group()))

    # Step 2: Sort by start position, then by priority (higher priority wins ties)
    matches.sort(key=lambda x: (x[0], -x[2].priority))

    # Step 3: Remove overlapping matches (greedy: first match at each position wins)
    filtered = []
    last_end = -1
    for start, end, pat, orig in matches:
        if start >= last_end:  # No overlap with previous kept match
            filtered.append((start, end, pat, orig))
            last_end = end

    # Step 4: Replace from end to start (preserves positions)
    changes = []
    for start, end, pat, orig in reversed(filtered):
        if mode == "fake":
            cache_key = (pat.fake, orig)
            if cache_key in faker._cache:
                repl = faker._cache[cache_key]
            else:
                fn = getattr(faker, pat.fake, None)
                repl = fn(orig) if fn else pat.tag
                faker._cache[cache_key] = repl
        elif mode == "mask" and pat.mask:
            repl = pat.mask(orig)
        else:
            repl = pat.tag

        text = text[:start] + repl + text[end:]
        changes.append({
            "pattern": pat.name,
            "found": orig[:6] + "…" + orig[-4:] if len(orig) > 12 else orig[:8] + "…" if len(orig) > 8 else orig,
            "replaced": repl[:30],
            "_full_original": orig,
            "_full_replaced": repl,
        })

    changes.reverse()  # Back to document order
    return text, changes


# ============================================================
# FILE PROCESSORS
# ============================================================

def process_pdf(path, level, mode, faker, custom_terms):
    """Extract text from PDF, redact, return (original_pages, redacted_pages, all_changes)."""
    from pypdf import PdfReader
    reader = PdfReader(path)
    original_pages = []
    redacted_pages = []
    all_changes = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        original_pages.append(text)
        redacted, changes = redact(text, level, mode, faker, custom_terms)
        redacted_pages.append(redacted)
        for c in changes:
            c["page"] = i + 1
        all_changes.extend(changes)
    return original_pages, redacted_pages, all_changes


def save_text_pdf(pages, output_path):
    """Save redacted text pages as a simple PDF."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
        c = canvas.Canvas(output_path, pagesize=letter)
        w, h = letter
        for i, text in enumerate(pages):
            y = h - 50
            for line in text.split('\n'):
                if y < 50:
                    c.showPage()
                    y = h - 50
                while len(line) > 95:
                    c.drawString(40, y, line[:95])
                    line = line[95:]
                    y -= 14
                c.drawString(40, y, line)
                y -= 14
            if i < len(pages) - 1:
                c.showPage()
        c.save()
        return output_path
    except ImportError:
        # Fallback to text
        txt_path = output_path.replace('.pdf', '.txt')
        with open(txt_path, 'w') as f:
            for i, text in enumerate(pages):
                f.write(f"\n{'='*60}\nPAGE {i+1}\n{'='*60}\n\n{text}")
        return txt_path


def _apply_replacements(text, level, mode, faker, custom_terms):
    """Run pattern matching and generate replacement text for a single string.
    Returns (modified_text, changed_bool). Uses the same Faker cache for consistency."""
    active = [p for p in PATTERNS if p.level <= level]
    matches = []
    for p in active:
        for m in re.finditer(p.regex, text, p.flags):
            matches.append((m.start(), m.end(), p, m.group()))
    if custom_terms:
        for term in custom_terms:
            if not term.strip():
                continue
            custom_pat = Pat("Custom", re.escape(term), "[REDACTED]", "name", _mask_name, 0, priority=200)
            for m in re.finditer(re.escape(term), text, re.IGNORECASE):
                matches.append((m.start(), m.end(), custom_pat, m.group()))
    if not matches:
        return text, False
    matches.sort(key=lambda x: (x[0], -x[2].priority))
    filtered = []
    last_end = -1
    for start, end, pat, orig in matches:
        if start >= last_end:
            filtered.append((start, end, pat, orig))
            last_end = end
    result = text
    for start, end, pat, orig in reversed(filtered):
        if mode == "fake":
            cache_key = (pat.fake, orig)
            if cache_key in faker._cache:
                repl = faker._cache[cache_key]
            else:
                fn = getattr(faker, pat.fake, None)
                repl = fn(orig) if fn else pat.tag
                faker._cache[cache_key] = repl
        elif mode == "mask" and pat.mask:
            repl = pat.mask(orig)
        else:
            repl = pat.tag
        result = result[:start] + repl + result[end:]
    return result, result != text


def process_pdf_pymupdf(path, level, mode, faker, custom_terms, output_path):
    """Structure-preserving PDF redaction via PyMuPDF.

    Decoupled approach:
      - Text layer: redact() on full page text for change log + compare view
      - PDF layer: pattern-match directly on each PDF line's joined spans,
        replace in-place. No mapping between the two layers.

    Returns (original_pages, redacted_pages, all_changes, output_path).
    """
    import fitz

    doc = fitz.open(path)
    original_pages = []
    redacted_pages = []
    all_changes = []

    # Pass 1: run text-level redaction on all pages to build change log
    # and collect fragment map for SSNs split across form boxes
    page_changes = []  # per-page changes list
    fragments = {}  # fragment_string → replacement_tag (global across all pages)

    for i, page in enumerate(doc):
        text = page.get_text()
        original_pages.append(text)
        redacted_text, changes = redact(text, level, mode, faker, custom_terms)
        redacted_pages.append(redacted_text)
        for c in changes:
            c["page"] = i + 1
        all_changes.extend(changes)
        page_changes.append(changes)

        # Build fragment map from SSN/ITIN matches
        for c in changes:
            orig = c["_full_original"]
            repl_tag = c["_full_replaced"]
            digits = re.sub(r'\D', '', orig)
            if c["pattern"] in ("SSN", "ITIN") and '-' in orig:
                parts = orig.split('-')
                for part in parts:
                    if len(part) >= 2:
                        fragments[part] = repl_tag
                if len(digits) >= 9:
                    fragments[digits] = repl_tag
            elif len(digits) >= 8:
                fragments[digits] = repl_tag

    # Pass 2: apply redactions to the PDF visual layer
    for i, page in enumerate(doc):
        changes = page_changes[i]

        # Skip pages with no changes AND no fragments to check
        if not changes and not fragments:
            continue

        # PDF layer: work directly on the PDF's own line structure
        page_dict = page.get_text("dict")
        lines_to_redact = []

        for block in page_dict["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                spans = line["spans"]
                if not spans:
                    continue
                # Join all spans in this line — handles arbitrary span splits
                line_text = "".join(s["text"] for s in spans)
                # Run patterns + custom terms against this line's text
                modified, changed = _apply_replacements(
                    line_text, level, mode, faker, custom_terms
                )
                # Also check for SSN/ITIN fragments in form boxes
                for frag, repl_tag in fragments.items():
                    if frag in modified:
                        modified = modified.replace(frag, repl_tag)
                        changed = True
                if changed:
                    lines_to_redact.append({
                        "spans": spans,
                        "bbox": line["bbox"],
                        "modified": modified,
                        "fontsize": spans[0]["size"],
                    })

        # Remove original text for changed lines
        for li in lines_to_redact:
            for span in li["spans"]:
                page.add_redact_annot(fitz.Rect(span["bbox"]), text="", fill=(1, 1, 1))

        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

        # Write replacement text at original positions
        for li in lines_to_redact:
            rect = fitz.Rect(li["bbox"])
            try:
                page.insert_text(
                    fitz.Point(rect.x0, rect.y1 - li["fontsize"] * 0.15),
                    li["modified"],
                    fontsize=li["fontsize"],
                    fontname="helv",
                    color=(0, 0, 0),
                )
            except Exception:
                pass

    doc.save(output_path)
    doc.close()

    return original_pages, redacted_pages, all_changes, output_path


def process_text_file(path, level, mode, faker, custom_terms):
    """Read text file, redact, return (original_text, redacted_text, changes)."""
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    redacted, changes = redact(text, level, mode, faker, custom_terms)
    return text, redacted, changes


# ============================================================
# GRADIO UI
# ============================================================

def build_ui():
    import gradio as gr

    def _filepath(file):
        """Handle both Gradio 5 (file.name) and Gradio 6 (string path)."""
        if file is None:
            return None
        return file if isinstance(file, str) else file.name

    def _build_text_preview(pages, label="PAGE"):
        """Build page-separated text preview, truncating long pages."""
        lines = []
        for i, page_text in enumerate(pages):
            lines.append(f"── {label} {i+1} ──")
            page_lines = page_text.split('\n')
            for line in page_lines[:30]:
                lines.append(line)
            if len(page_lines) > 30:
                lines.append(f"... ({len(page_lines)} lines total)")
            lines.append("")
        return '\n'.join(lines)

    def _build_change_log(changes):
        if changes:
            log_lines = [f"{'Pattern':<22} {'Found':<14} {'Replaced With'}"]
            log_lines.append("─" * 60)
            for c in changes:
                pg = f" (p{c['page']})" if 'page' in c else ""
                log_lines.append(f"{c['pattern']:<22} {c['found']:<14} {c['replaced']}{pg}")
            log_lines.append(f"\n✅ {len(changes)} redactions applied.")
        else:
            log_lines = ["No patterns matched.", "",
                         "Tips:",
                         "• Add names/addresses in 'Custom terms'",
                         "• Try a higher redaction level",
                         "• Check that the file contains readable text"]
        return '\n'.join(log_lines)

    def run_redaction(file, level, mode, custom_terms_str, seed):
        fpath = _filepath(file)
        if fpath is None:
            return gr.skip(), "⚠️ Upload a file first.", "", ""

        faker = Faker(seed=seed or "redactabit")
        custom = [t.strip() for t in custom_terms_str.split(',') if t.strip()] if custom_terms_str else []
        level = int(level.split(' ')[0])  # "1 — Light" → 1

        ext = Path(fpath).suffix.lower()
        base = Path(fpath).stem
        out_dir = os.path.join(Path.home(), "Redactabit_Output")
        os.makedirs(out_dir, exist_ok=True)

        if ext == '.pdf':
            out_path = os.path.join(out_dir, f"{base}_redacted.pdf")
            try:
                import fitz  # noqa: F401
                orig_pages, redacted_pages, changes, saved = \
                    process_pdf_pymupdf(fpath, level, mode, faker, custom, out_path)
            except ImportError:
                try:
                    orig_pages, redacted_pages, changes = process_pdf(fpath, level, mode, faker, custom)
                except Exception as e:
                    return gr.skip(), f"❌ Error: {e}", "", ""
                saved = save_text_pdf(redacted_pages, out_path)
            except Exception as e:
                import traceback; traceback.print_exc()
                return gr.skip(), f"❌ Error: {e}", "", ""
            original_text = _build_text_preview(orig_pages)
            redacted_text = _build_text_preview(redacted_pages)
        else:
            try:
                original, redacted, changes = process_text_file(fpath, level, mode, faker, custom)
            except Exception as e:
                return gr.skip(), f"❌ Error: {e}", "", ""
            out_path = os.path.join(out_dir, f"{base}_redacted{ext}")
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(redacted)
            saved = out_path
            original_text = original[:5000]
            redacted_text = redacted[:5000]

        summary = _build_change_log(changes)
        print(f"  ✅ {len(changes)} redactions → {saved}")
        return saved, summary, original_text, redacted_text

    def preview_only(file, level, mode, custom_terms_str, seed):
        fpath = _filepath(file)
        if fpath is None:
            return "⚠️ Upload a file first.", "", ""

        faker = Faker(seed=seed or "redactabit")
        custom = [t.strip() for t in custom_terms_str.split(',') if t.strip()] if custom_terms_str else []
        level_int = int(level.split(' ')[0])

        ext = Path(fpath).suffix.lower()

        if ext == '.pdf':
            try:
                orig_pages, redacted_pages, changes = process_pdf(fpath, level_int, mode, faker, custom)
            except Exception as e:
                return f"❌ Error: {e}", "", ""
            original_text = _build_text_preview(orig_pages)
            redacted_text = _build_text_preview(redacted_pages)
        else:
            try:
                original, redacted, changes = process_text_file(fpath, level_int, mode, faker, custom)
            except Exception as e:
                return f"❌ Error: {e}", "", ""
            original_text = original[:5000]
            redacted_text = redacted[:5000]

        summary = _build_change_log(changes)
        if changes:
            summary += f"\n\n🔍 Preview only — no file saved."

        return summary, original_text, redacted_text

    # --- UI Layout ---
    with gr.Blocks(analytics_enabled=False) as app:

        gr.HTML("""
        <div class="main-header">
            <h1>🔒 Redact-a-bit</h1>
            <p>Local, offline document redaction. Nothing leaves your machine.</p>
        </div>
        """)

        with gr.Row():
            with gr.Column(scale=1):
                file_input = gr.File(label="Upload PDF or Text File", file_types=[".pdf",".txt",".csv",".md",".json",".xml",".html"])

                level = gr.Dropdown(
                    choices=["1 — Light (SSN, accounts, immigration only)",
                             "2 — Standard (+ phone, email, address, names)",
                             "3 — Heavy (+ amounts, zip codes, everything)"],
                    value="2 — Standard (+ phone, email, address, names)",
                    label="Redaction Level"
                )

                mode = gr.Radio(
                    choices=["fake", "mask", "redact"],
                    value="fake",
                    label="Replacement Mode",
                    info="fake = realistic data · mask = XXX-XX-6789 · redact = [REDACTED] tags"
                )

                custom = gr.Textbox(
                    label="Custom Terms (comma-separated)",
                    placeholder="John Smith, Jane Smith, 123 Main Street, Acme Corp",
                    info="Names, addresses, employers — anything patterns might miss"
                )

                seed = gr.Textbox(
                    label="Seed (optional)",
                    value="redactabit",
                    info="Same seed = same fake data each run. Change for different fakes."
                )

                with gr.Row():
                    preview_btn = gr.Button("👁 Preview", variant="secondary")
                    redact_btn = gr.Button("🔒 Redact & Download", variant="primary")

            with gr.Column(scale=1):
                download_btn = gr.DownloadButton(label="📥 Download Redacted File", visible=False)
                change_log = gr.Textbox(label="Change Log", lines=10, interactive=False)
                with gr.Row():
                    original_box = gr.Textbox(label="Original", lines=15, interactive=False)
                    redacted_box = gr.Textbox(label="Redacted", lines=15, interactive=False)

        # Level descriptions
        gr.HTML("""
        <details style="margin-top:16px;padding:12px 16px;border:1px solid #333;font-size:13px;">
            <summary style="cursor:pointer;font-weight:500;">What each level redacts</summary>
            <div style="margin-top:8px;line-height:1.8;">
                <strong>Level 1 — Light:</strong> SSNs, ITINs, bank accounts, routing numbers, credit cards, passport numbers, visa numbers, alien/USCIS numbers<br>
                <strong>Level 2 — Standard:</strong> + EINs, phone numbers, emails, street addresses, dates of birth, named fields (Taxpayer, Spouse, etc.)<br>
                <strong>Level 3 — Heavy:</strong> + dollar amounts (replaced with similar magnitude), zip codes, any 9-digit numbers<br><br>
                <strong>All levels:</strong> Custom terms you add are always redacted regardless of level.
            </div>
        </details>
        """)

        gr.HTML("""
        <div style="text-align:center;margin-top:16px;font-size:11px;color:#666;">
            Redact-a-bit v1.1 · AGPLv3 · Everything runs locally ·
            <a href="https://github.com/prPMDev/redactabit" style="color:#888;">GitHub</a>
        </div>
        """)

        def run_and_enable_download(file, level, mode, custom_terms_str, seed):
            saved, summary, orig, redc = run_redaction(file, level, mode, custom_terms_str, seed)
            # Update DownloadButton: set the file path and make visible
            if saved and not isinstance(saved, type(gr.skip())):
                btn_update = gr.DownloadButton(value=saved, visible=True,
                                               label=f"📥 Download: {Path(saved).name}")
            else:
                btn_update = gr.skip()
            return btn_update, summary, orig, redc

        # Wire up buttons
        redact_btn.click(
            fn=run_and_enable_download,
            inputs=[file_input, level, mode, custom, seed],
            outputs=[download_btn, change_log, original_box, redacted_box]
        )

        preview_btn.click(
            fn=preview_only,
            inputs=[file_input, level, mode, custom, seed],
            outputs=[change_log, original_box, redacted_box]
        )

    return app


# ============================================================
# MAIN
# ============================================================

def cli():
    """Command-line interface for Redact-a-bit."""
    import argparse

    parser = argparse.ArgumentParser(
        prog="redactabit",
        description="Redact-a-bit — Local, offline document redaction.",
        epilog="Nothing leaves your machine.",
    )
    parser.add_argument("input", help="Input PDF or text file")
    parser.add_argument("output", nargs="?", default=None,
                        help="Output file path (default: <input>_redacted.<ext>)")
    parser.add_argument("-l", "--level", type=int, choices=[1, 2, 3], default=2,
                        help="Redaction level: 1=light, 2=standard (default), 3=heavy")
    parser.add_argument("-m", "--mode", choices=["fake", "mask", "redact"], default="fake",
                        help="Replacement mode (default: fake)")
    parser.add_argument("-s", "--seed", default="redactabit",
                        help="Faker seed for reproducibility")
    parser.add_argument("-c", "--custom", default="",
                        help="Comma-separated custom terms to redact")
    parser.add_argument("--no-prompt", action="store_true",
                        help="Skip interactive prompts, use only --custom terms")
    parser.add_argument("--ui", action="store_true",
                        help="Launch Gradio web UI instead of CLI")

    args = parser.parse_args()

    if args.ui:
        launch_ui()
        return

    # Resolve paths
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"  ERROR: File not found: {input_path}")
        exit(1)

    if args.output:
        output_path = args.output
    else:
        output_path = str(input_path.parent / f"{input_path.stem}_redacted{input_path.suffix}")

    ext = input_path.suffix.lower()
    custom = [t.strip() for t in args.custom.split(',') if t.strip()] if args.custom else []
    faker = Faker(seed=args.seed)

    print(f"\n  Redact-a-bit v{__version__}")
    print(f"  Input:  {input_path}")
    print(f"  Output: {output_path}")
    print(f"  Level:  {args.level}  Mode: {args.mode}  Seed: {args.seed}")

    # Interactive prompts for PII that regex can't catch
    if not args.no_prompt:
        print()
        print("  Regex catches SSNs, phones, emails, EINs automatically.")
        print("  Enter additional PII to redact (press Enter to skip each):")
        print()

        prompts = [
            ("  Names (comma-separated):   ", "e.g. John Smith, Jane Smith"),
            ("  Addresses (each on line):   ", "e.g. 123 Main St"),
            ("  Employers/Companies:        ", "e.g. Amazon, Acme Corp"),
            ("  Other terms:                ", "e.g. case numbers, account IDs"),
        ]
        for prompt, hint in prompts:
            try:
                val = input(f"{prompt}")
            except EOFError:
                val = ""
            if val.strip():
                terms = [t.strip() for t in val.split(',') if t.strip()]
                custom.extend(terms)

        if custom:
            print(f"\n  Custom terms: {len(custom)} items added")
        else:
            print("\n  No custom terms. Only regex patterns will be used.")

    if custom:
        print(f"  Custom: {', '.join(custom)}")
    print()

    if ext == '.pdf':
        try:
            import fitz  # noqa: F401
            orig_pages, redacted_pages, changes, saved = \
                process_pdf_pymupdf(str(input_path), args.level, args.mode, faker, custom, output_path)
            print(f"  OK: {len(changes)} redactions applied (structure-preserving)")
        except ImportError:
            try:
                orig_pages, redacted_pages, changes = \
                    process_pdf(str(input_path), args.level, args.mode, faker, custom)
            except Exception as e:
                print(f"  ERROR: {e}")
                exit(1)
            saved = save_text_pdf(redacted_pages, output_path)
            print(f"  OK: {len(changes)} redactions applied (text-only PDF)")
    else:
        try:
            original, redacted_text, changes = \
                process_text_file(str(input_path), args.level, args.mode, faker, custom)
        except Exception as e:
            print(f"  ERROR: {e}")
            exit(1)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(redacted_text)
        saved = output_path
        print(f"  OK: {len(changes)} redactions applied")

    print(f"  Saved: {saved}")

    if changes:
        print(f"\n  {'Pattern':<22} {'Found':<14} {'Replaced With'}")
        print(f"  {'-' * 58}")
        for c in changes[:20]:
            pg = f" (p{c['page']})" if 'page' in c else ""
            print(f"  {c['pattern']:<22} {c['found']:<14} {c['replaced']}{pg}")
        if len(changes) > 20:
            print(f"  ... and {len(changes) - 20} more")
    else:
        print("\n  No patterns matched.")
    print()


def launch_ui():
    """Launch the Gradio web UI."""
    try:
        import gradio as gr
    except ImportError:
        print("  Gradio not found. Install with: pip install gradio")
        exit(1)

    app = build_ui()
    launch_kwargs = dict(
        server_name="127.0.0.1",  # localhost only — unreachable from other devices on your network
        server_port=7860,
        show_error=True,
        share=False,
        allowed_paths=[tempfile.gettempdir(), os.path.join(Path.home(), "Redactabit_Output")],
    )
    try:
        launch_kwargs["theme"] = gr.themes.Base(
            primary_hue="amber", neutral_hue="gray",
            font=["DM Sans", "system-ui", "sans-serif"],
        )
        launch_kwargs["css"] = ".main-header{text-align:center;margin-bottom:8px} .main-header h1{font-size:28px;margin-bottom:4px} .main-header p{color:#888;font-size:14px} footer{display:none!important}"
    except Exception:
        pass
    app.launch(**launch_kwargs)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] != "--ui":
        cli()
    else:
        launch_ui()
