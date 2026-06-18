// Frisket redaction engine — faithful TypeScript port of frisket.py.
// Pure logic (regex + string ops); runs entirely in the webview. Nothing leaves the machine.
//
// Determinism: Python used SHA-256 -> random.Random. Here we use a synchronous
// string hash (cyrb53) -> mulberry32 PRNG. Same (seed, input) => same fake every run,
// but the exact fake VALUES differ from the Python build (intended — fresh impl).

// `Mode` is derived from the MODES registry below (single source of truth).

export interface Change {
  pattern: string;
  found: string;        // truncated for display
  replaced: string;     // truncated for display
  fullOriginal: string; // full matched text
  fullReplaced: string; // full replacement
  start: number;        // original match start offset
  end: number;          // original match end offset
}

export interface RedactResult {
  text: string;
  changes: Change[];
}

type MaskFn = (o: string) => string;

interface Pat {
  name: string;
  regex: RegExp;        // must carry the global flag
  tag: string;
  fake: string;         // Faker method name ("" = none)
  mask: MaskFn | null;
  level: number;        // 1=light, 2=standard, 3=heavy
  priority: number;     // higher wins overlap ties
}

// ── Deterministic PRNG ───────────────────────────────────────
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  randint: (a: number, b: number) => number;     // inclusive, like Python
  choice: <T>(arr: readonly T[]) => T;
  uniform: (a: number, b: number) => number;
}

// ── Faker (port of frisket.py Faker) ─────────────────────────
const FIRSTS = ["James","Maria","Robert","Linda","David","Sarah","Michael","Jennifer","William","Patricia","Richard","Elizabeth","Thomas","Susan","Daniel","Karen","Joseph","Nancy","Charles","Betty","Matthew","Dorothy","Andrew","Margaret"];
const LASTS = ["Anderson","Martinez","Thompson","Garcia","Robinson","Wilson","Clark","Lewis","Walker","Hall","Young","King","Wright","Green","Baker","Hill","Nelson","Carter"];
const STREETS = ["Maple","Oak","Cedar","Pine","Elm","Washington","Park","Lake","Sunset","River","Spring","Forest","Valley","Meadow","Ridge","Birch","Willow","Cherry"];
const ST_TYPES = ["St","Ave","Dr","Ln","Rd","Ct","Way","Blvd"];
const DOMAINS = ["email.com","mail.net","inbox.org","post.com","letters.net","mailbox.org"];
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class Faker {
  private seed: string;
  private cache = new Map<string, string>();
  constructor(seed = "frisket") { this.seed = seed; }

  private r(orig: string): Rng {
    const next = mulberry32(cyrb53(`${this.seed}:${orig}`));
    return {
      randint: (a, b) => a + Math.floor(next() * (b - a + 1)),
      choice: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
      uniform: (a, b) => a + next() * (b - a),
    };
  }
  private pad2(n: number): string { return n < 10 ? "0" + n : "" + n; }

  ssn(o: string) { const r = this.r(o); return `${r.randint(800,899)}-${r.randint(10,99)}-${r.randint(1000,9999)}`; }
  itin(o: string) { const r = this.r(o); return `9${r.randint(50,99)}-${r.randint(70,99)}-${r.randint(1000,9999)}`; }
  phone(o: string) { const r = this.r(o); return `(555) ${r.randint(100,999)}-${r.randint(1000,9999)}`; }
  email(o: string) { const r = this.r(o); return `${r.choice(FIRSTS).toLowerCase()}.${r.choice(LASTS).toLowerCase()}@${r.choice(DOMAINS)}`; }
  name(o: string) { const r = this.r(o); return `${r.choice(FIRSTS)} ${r.choice(LASTS)}`; }
  street(o: string) { const r = this.r(o); return `${r.randint(100,9999)} ${r.choice(STREETS)} ${r.choice(ST_TYPES)}`; }
  account(o: string) { const r = this.r(o); const n = r.randint(8,12); let s = ""; for (let i = 0; i < n; i++) s += r.randint(0,9); return "Acct #" + s; }
  routing(o: string) { const r = this.r(o); let s = ""; for (let i = 0; i < 9; i++) s += r.randint(0,9); return "Routing: " + s; }
  ein(o: string) { const r = this.r(o); return `${r.randint(20,89)}-${r.randint(1000000,9999999)}`; }
  card(o: string) { const r = this.r(o); return `4${r.randint(100,999)}-XXXX-XXXX-${r.randint(1000,9999)}`; }
  dob(o: string) { const r = this.r(o); return `DOB: ${this.pad2(r.randint(1,12))}/${this.pad2(r.randint(1,28))}/${r.randint(1960,1998)}`; }
  passport(o: string) { const r = this.r(o); return `Passport# ${r.choice(UPPER.split(""))}${r.randint(10000000,99999999)}`; }
  alien(o: string) { const r = this.r(o); return `A#${r.randint(100000000,999999999)}`; }
  visa(o: string) { const r = this.r(o); return `Visa# ${r.choice(UPPER.split(""))}${r.choice(UPPER.split(""))}${r.randint(10000000,99999999)}`; }
  pan(o: string) { const r = this.r(o); const L = () => r.choice(UPPER.split("")); return `${L()}${L()}${L()}Z${L()}${r.randint(1000, 9999)}${L()}`; } // India PAN shape; 4th char Z = invalid holder type, so the fake can never be a real PAN
  cityline(o: string) { const r = this.r(o); return `${r.choice(["Springdale","Riverton","Fairview","Brookside","Lakewood","Hillcrest"])}, ${r.choice(["OH","IL","TX","CO","WA","GA"])} ${r.randint(10000, 99999)}`; }
  refid(o: string) { const r = this.r(o); const CH = (UPPER + "23456789").split(""); let s = ""; for (let i = 0; i < 10; i++) s += r.choice(CH); return "# " + s; }
  zipcode(o: string) { const r = this.r(o); return `${r.randint(10000,99999)}`; }
  amount(o: string) {
    const r = this.r(o);
    const nums = o.replace(/[^\d.]/g, "");
    let v = parseFloat(nums); if (!isFinite(v)) v = 1000;
    const fv = v * r.uniform(0.4, 1.6);
    return "$" + fv.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // cache wrapper: same (method, original) => same fake across the document
  apply(method: string, orig: string): string {
    const key = `${method}\u0000${orig}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const fn = (this as unknown as Record<string, (o: string) => string>)[method];
    const repl = typeof fn === "function" ? fn.call(this, orig) : "";
    this.cache.set(key, repl);
    return repl;
  }
}

// ── Masks (port of frisket.py) ───────────────────────────────
const digits = (o: string) => o.replace(/\D/g, "");
const maskSsn: MaskFn = (o) => { const d = digits(o); return d.length >= 4 ? `XXX-XX-${d.slice(-4)}` : "XXX-XX-XXXX"; };
const maskPhone: MaskFn = (o) => { const d = digits(o); return d.length >= 4 ? `(XXX) XXX-${d.slice(-4)}` : "(XXX) XXX-XXXX"; };
const maskEmail: MaskFn = (o) => { const p = o.split("@"); return p.length === 2 ? `${p[0][0]}***@${p[1]}` : "***@***.***"; };
const maskAcct: MaskFn = (o) => { const d = digits(o); return d.length >= 4 ? `Acct #${"X".repeat(d.length - 4)}${d.slice(-4)}` : "Acct #XXXX"; };
const maskCard: MaskFn = (o) => { const d = digits(o); return d.length >= 4 ? `XXXX-XXXX-XXXX-${d.slice(-4)}` : "XXXX-XXXX-XXXX-XXXX"; };
const maskPan: MaskFn = (o) => { const s = o.trim(); return s.length >= 4 ? "X".repeat(s.length - 4) + s.slice(-4) : "XXXXXXXXXX"; };
const maskName: MaskFn = (o) => o.trim().split(/\s+/).filter(Boolean).map((w) => w[0] + ".").join(" ");
const maskId: MaskFn = (o) => { const v = o.replace(/^[#\s:]+/, ""); return v.length >= 4 ? `# ${"X".repeat(v.length - 4)}${v.slice(-4)}` : "# XXXX"; };

// ── Patterns (port of frisket.py PATTERNS; names/levels/priorities preserved) ──
const PATTERNS: Pat[] = [
  // Level 1
  { name: "ITIN", regex: /\b9\d{2}-\d{2}-\d{4}\b/g, tag: "[ITIN REDACTED]", fake: "itin", mask: maskSsn, level: 1, priority: 100 },
  { name: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g, tag: "[SSN REDACTED]", fake: "ssn", mask: maskSsn, level: 1, priority: 90 },
  // Optional "Number/No./Num" between the label and digits (real statements write "Account Number:"),
  // and digits may carry single space/dash separators (8–17 digits total).
  { name: "Bank Account", regex: /(?:account|acct|acct\.|a\/c)(?:\s*(?:number|no\.?|num\.?))?[\s#:]*(\d(?:[ -]?\d){7,16})/gi, tag: "[ACCOUNT REDACTED]", fake: "account", mask: maskAcct, level: 1, priority: 80 },
  { name: "Routing Number", regex: /(?:routing|aba|transit)[\s#:]*\d{9}/gi, tag: "[ROUTING REDACTED]", fake: "routing", mask: null, level: 1, priority: 80 },
  { name: "Credit Card", regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, tag: "[CARD REDACTED]", fake: "card", mask: maskCard, level: 1, priority: 85 },
  { name: "Alien/USCIS#", regex: /\b(?:alien|uscis|a[-#])\s*\d{7,9}/gi, tag: "[IMMIGRATION# REDACTED]", fake: "alien", mask: null, level: 1, priority: 95 },
  { name: "Passport", regex: /passport[\s#:]*[A-Z0-9]{6,12}/gi, tag: "[PASSPORT REDACTED]", fake: "passport", mask: null, level: 1, priority: 80 },
  { name: "Visa Number", regex: /visa[\s#:]*[A-Z0-9]{8,12}/gi, tag: "[VISA# REDACTED]", fake: "visa", mask: null, level: 1, priority: 80 },
  { name: "PAN (India)", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, tag: "[PAN REDACTED]", fake: "pan", mask: maskPan, level: 1, priority: 88 },
  // Generic labeled identifier: "#" followed by a long code is essentially always an ID
  // (Envelope #, Confirmation #, Reference #, Member #...) — an open class no per-label
  // rule can cover. Caps/digits only (6+ chars) so prose after "#" never matches; the
  // specific ID rules above (account/card/alien) outrank it on overlaps.
  { name: "Labeled ID", regex: /#\s*:?\s*([A-Z0-9][A-Z0-9-]{5,24})\b/g, tag: "[ID REDACTED]", fake: "refid", mask: maskId, level: 1, priority: 70 },
  // Level 2
  { name: "EIN", regex: /\b\d{2}-\d{7}\b/g, tag: "[EIN REDACTED]", fake: "ein", mask: null, level: 2, priority: 70 },
  { name: "Phone", regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, tag: "[PHONE REDACTED]", fake: "phone", mask: maskPhone, level: 2, priority: 50 },
  { name: "Email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, tag: "[EMAIL REDACTED]", fake: "email", mask: maskEmail, level: 2, priority: 60 },
  // Case-sensitive (no /i) + [^\S\n] (not \s) so ALL-CAPS headers can't pose as streets
  // and a match can't span newlines to swallow a loose number + the next line. Mirrors frisket.py.
  { name: "Street Address", regex: /\b\d{1,6}[^\S\n]+(?:[A-Z][a-z]+[^\S\n]*){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place|Cir|Circle|Ter|Terrace|Pkwy|Parkway|Hwy|Highway|Plaza|Sq|Square|Trl|Trail|Loop)\b\.?/g, tag: "[ADDRESS REDACTED]", fake: "street", mask: null, level: 2, priority: 40 },
  // ALL-CAPS variant (statements print mail blocks in caps: "742 EVERGREEN TERRACE").
  // Caps words + a standalone caps suffix token — still case-sensitive, so prose can't
  // pose as a street the way "CONTA"+"CT" once did; [^\S\n] keeps it on one line.
  { name: "Street Address", regex: /\b\d{1,6}[^\S\n]+(?:[A-Z]{2,}[^\S\n]+){1,4}(?:ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|RD|ROAD|CT|COURT|WAY|PL|PLACE|CIR|CIRCLE|TER|TERRACE|PKWY|PARKWAY|HWY|HIGHWAY|PLAZA|SQ|SQUARE|TRL|TRAIL|LOOP)\b\.?/g, tag: "[ADDRESS REDACTED]", fake: "street", mask: null, level: 2, priority: 40 },
  // The classic second address line ("Springfield, IL 62704" / "SPRINGFIELD IL 62704") —
  // city + 2-letter state + ZIP is a strong shape; the model misses it inside long docs.
  { name: "City/State ZIP", regex: /\b[A-Z][a-zA-Z]+(?:[^\S\n]+[A-Z][a-zA-Z]+){0,2},[^\S\n]*[A-Z]{2}[^\S\n]+\d{5}(?:-\d{4})?\b/g, tag: "[ADDRESS REDACTED]", fake: "cityline", mask: null, level: 2, priority: 35 },
  { name: "City/State ZIP", regex: /\b[A-Z]{3,}(?:[^\S\n]+[A-Z]{3,}){0,2}[^\S\n]+[A-Z]{2}[^\S\n]+\d{5}(?:-\d{4})?\b/g, tag: "[ADDRESS REDACTED]", fake: "cityline", mask: null, level: 2, priority: 35 },
  { name: "Date of Birth", regex: /(?:dob|date\s+of\s+birth|birth\s*date|born)[\s:]*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/gi, tag: "[DOB REDACTED]", fake: "dob", mask: null, level: 2, priority: 60 },
  { name: "Named Fields", regex: /(?:taxpayer|spouse|dependent|employer|client)[^\S\n:]*:[^\S\n]*([A-Z][a-z]+(?:[^\S\n]+[A-Z][a-z]+){1,3})/gi, tag: "[NAME REDACTED]", fake: "name", mask: null, level: 2, priority: 30 },
  // Level 3
  { name: "Dollar Amounts", regex: /\$[\d,]+\.?\d{0,2}/g, tag: "[AMOUNT REDACTED]", fake: "amount", mask: null, level: 3, priority: 20 },
  { name: "Zip Code", regex: /\b\d{5}(?:-\d{4})?\b/g, tag: "[ZIP REDACTED]", fake: "zipcode", mask: null, level: 3, priority: 10 },
];

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A detector reports candidate PII spans against the ORIGINAL text. Detectors only
// ADD candidates; the single-pass resolver arbitrates + replaces (once).
export interface RawMatch {
  start: number;
  end: number;
  label: string;        // -> Change.pattern
  priority: number;     // higher wins overlap ties (regex 10-100, custom 200, model 1-25)
  fake: string;         // Faker method name ("" = none -> falls back to tag)
  mask: MaskFn | null;  // partial-mask fn (null -> falls back to tag)
  tag: string;          // redact-mode output + fallback
  confidence?: number;  // optional (model spans); unused by the resolver today
}

export interface Detector {
  name: string;
  ready(): boolean;     // false = still loading (e.g. model download) -> skipped
  // Optional one-time setup (e.g. model download); the registry/UI calls it on install.
  load?(onProgress?: (p: unknown) => void): Promise<void>;
  // onProgress (0..1) lets a slow detector report sub-progress (e.g. NER, per window).
  detect(text: string, onProgress?: (frac: number) => void): RawMatch[] | Promise<RawMatch[]>;
  // Optional teardown: free the in-memory model + delete its cached weights (reclaim disk).
  remove?(): Promise<void>;
}

// Priority for model-emitted spans: LOW, so exact regex (10-100) and custom terms (200)
// win overlaps; standalone model finds (names, places) still land.
export const MODEL_PRIORITY = 15;

// ── Engine registries (single source of truth; the UI renders its controls from these) ──
// Levels = sensitivity tiers, CUMULATIVE: each level includes everything below it
// (RegexDetector fires a rule when its level <= the active level). `hides` is what THIS
// tier adds; `keeps` names what is deliberately NOT hidden yet — saying the "keeps" out
// loud is the point (strip identity, keep the numbers), otherwise it reads as a gap.
export interface LevelDef { id: number; label: string; hides: string; keeps: string; }
export const LEVELS: readonly LevelDef[] = [
  { id: 1, label: "Light",    hides: "ID numbers: SSNs, accounts, cards, passports, labeled IDs", keeps: "names, contact details, and all amounts" },
  { id: 2, label: "Standard", hides: "names, emails, phones, addresses, birth dates",             keeps: "dollar amounts and dates, so AI can still analyze them" },
  { id: 3, label: "Heavy",    hides: "dollar amounts and zip codes",                              keeps: "only non-identifying text" },
];
export const DEFAULT_LEVEL = 2;

// Replacement modes. Each mode owns HOW a matched span becomes its replacement, so
// resolve() dispatches through this map instead of branching. Adding a mode is one
// entry here; `Mode` is derived from the array, so the type and data can never drift.
export interface ModeDef {
  id: string;     // value stored in prefs/history + passed to redact()
  label: string;  // the control label shown in the UI
  hint: string;   // one-line "what this mode gives you" (tooltip)
  busy: string;   // in-progress status verb shown while this mode is being applied
  apply: (m: RawMatch, orig: string, fk: Faker) => string;
}
// Uniform, type-free output marker. A per-type tag ("[ACCOUNT REDACTED]") tells a reader
// exactly what sat there — that's a leak. Every redaction reads the same "[REDACTED]".
// (Detectors still set m.tag; it's internal metadata now, no longer surfaced in the output.)
const REDACTED = "[REDACTED]";
export const MODES = [
  { id: "fake",   label: "Fake",  hint: "Realistic stand-ins. The doc stays readable for AI.", busy: "Replacing with fake data…",   apply: (m: RawMatch, orig: string, fk: Faker) => (m.fake ? fk.apply(m.fake, orig) || REDACTED : REDACTED) },
  { id: "mask",   label: "Mask",  hint: "Keeps only the last digits, like XXX-XX-6789.",       busy: "Masking to the last digits…", apply: (m: RawMatch, orig: string) => (m.mask ? m.mask(orig) : REDACTED) },
  { id: "redact", label: "Label", hint: "A plain [REDACTED] tag in place of the value.",       busy: "Adding [REDACTED] labels…",   apply: () => REDACTED },
] as const satisfies readonly ModeDef[];
export type Mode = (typeof MODES)[number]["id"];
export const DEFAULT_MODE: Mode = "fake";
const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<Mode, ModeDef>;

const CUSTOM_PAT = (): Pat => ({ name: "Custom", regex: /x/g, tag: "[REDACTED]", fake: "name", mask: maskName, level: 0, priority: 200 });

// ── Built-in detectors ───────────────────────────────────────
// Regex floor: the exact-ID patterns (and, until Phase C, the fuzzy ones too).
export class RegexDetector implements Detector {
  name = "regex";
  constructor(private level: number = 2) {}
  ready(): boolean { return true; }
  detect(text: string): RawMatch[] {
    const out: RawMatch[] = [];
    for (const p of PATTERNS) {
      if (p.level > this.level) continue;
      for (const m of text.matchAll(p.regex)) {
        out.push({ start: m.index!, end: m.index! + m[0].length, label: p.name, priority: p.priority, fake: p.fake, mask: p.mask, tag: p.tag });
      }
    }
    return out;
  }
}

// User-supplied terms — always redacted, highest priority.
export class CustomTermsDetector implements Detector {
  name = "custom";
  constructor(private terms: string[] = []) {}
  ready(): boolean { return true; }
  detect(text: string): RawMatch[] {
    const out: RawMatch[] = [];
    const cp = CUSTOM_PAT();
    for (const term of this.terms) {
      if (!term.trim()) continue;
      for (const m of text.matchAll(new RegExp(escapeRegExp(term), "gi"))) {
        out.push({ start: m.index!, end: m.index! + m[0].length, label: cp.name, priority: cp.priority, fake: cp.fake, mask: cp.mask, tag: cp.tag });
      }
    }
    return out;
  }
}

/**
 * Single-pass resolver (behavior unchanged): sort by (start, -priority) ->
 * greedy de-overlap (first wins) -> replace end->start, applying the mode.
 * Detectors feed candidates; this never re-reads modified text (prevents cascading).
 */
function resolve(text: string, raw: RawMatch[], mode: Mode, fk: Faker): RedactResult {
  // Step 2: sort by start, then priority desc
  raw.sort((a, b) => a.start - b.start || b.priority - a.priority);

  // Step 3: greedy de-overlap (first match at each position wins)
  const filtered: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
  }

  // Step 4: replace end -> start (preserves positions)
  let result = text;
  const changes: Change[] = [];
  for (let i = filtered.length - 1; i >= 0; i--) {
    const m = filtered[i];
    const orig = text.slice(m.start, m.end);
    const md = MODE_BY_ID[mode] ?? MODE_BY_ID.redact;  // unknown id -> safe [TAG] fallback
    const repl = md.apply(m, orig, fk);
    result = result.slice(0, m.start) + repl + result.slice(m.end);
    changes.push({ pattern: m.label, found: orig, replaced: repl, fullOriginal: orig, fullReplaced: repl, start: m.start, end: m.end });
  }
  changes.reverse(); // back to document order
  return { text: result, changes };
}

/**
 * Synchronous redaction — regex + custom terms only (tests/CLI parity).
 * Single-pass port of frisket.py redact(). Signature + output unchanged.
 */
export function redact(
  text: string,
  level: number = 2,
  mode: Mode = "fake",
  customTerms: string[] = [],
  faker?: Faker,
): RedactResult {
  const fk = faker ?? new Faker();
  const raw: RawMatch[] = [
    ...new RegexDetector(level).detect(text),
    ...new CustomTermsDetector(customTerms).detect(text),
  ];
  return resolve(text, raw, mode, fk);
}

/**
 * Async redaction — same resolver, but also runs extra (possibly async) detectors
 * such as a downloaded NER model. Not-ready detectors are skipped (regex-only
 * meanwhile). The UI uses this; the pure engine + tests use sync redact().
 */
// The real pipeline stages, reported through onProgress so the UI can narrate them:
// level-gated rules -> custom terms (when any) -> model scan (the slow part) -> apply mode.
export type RedactPhase = "rules" | "custom" | "model" | "apply";

export async function redactAsync(
  text: string,
  level: number = 2,
  mode: Mode = "fake",
  customTerms: string[] = [],
  faker?: Faker,
  extraDetectors: Detector[] = [],
  onProgress?: (frac: number, phase?: RedactPhase) => void,
): Promise<RedactResult> {
  const fk = faker ?? new Faker();
  const raw: RawMatch[] = [];
  // Built-in rules + custom terms are instant — they give the bar its head start.
  onProgress?.(0.02, "rules");
  raw.push(...(await new RegexDetector(level).detect(text)));
  if (customTerms.length) onProgress?.(0.04, "custom");
  raw.push(...(await new CustomTermsDetector(customTerms).detect(text)));
  // The extra detectors (downloaded models) are the slow part — they own 6%..92%.
  const extras = extraDetectors.filter((d) => d.ready());
  if (extras.length) onProgress?.(0.06, "model");
  for (let i = 0; i < extras.length; i++) {
    const base = 0.06 + 0.86 * (i / extras.length), span = 0.86 / extras.length;
    const cb = onProgress ? (f: number) => onProgress(base + span * Math.min(1, Math.max(0, f)), "model") : undefined;
    raw.push(...(await extras[i].detect(text, cb)));
    onProgress?.(0.06 + 0.86 * ((i + 1) / extras.length), "model");
  }
  onProgress?.(0.94, "apply");
  const result = resolve(text, raw, mode, fk);
  onProgress?.(1, "apply");
  return result;
}
