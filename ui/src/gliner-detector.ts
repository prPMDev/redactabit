// GLiNER detector — zero-shot NER (names/addresses) run locally in the webview.
//
// This is a hand-rolled port of GLiNER.js's span pipeline (MIT, github Ingvarstep/GLiNER.js:
// src/lib/{processor,decoder,model}.ts) onto OUR OWN runtime — the @huggingface/transformers
// tokenizer + its onnxruntime-web — instead of taking the `gliner` npm package as a dependency.
// Why: that package pins the old @xenova/transformers stack, which drags a CRITICAL, unpatchable
// protobufjs RCE (GHSA-xq3m-2v4x-88gg) + a second ML runtime. We reuse what the app already ships:
// no new deps, no new vulnerabilities, one clean stack. Capability validated in docs/gliner-spike/.
//
// The model returns CHARACTER offsets for each span, so (unlike bert-NER) there is no fragile
// word-relocation step — offsets map straight onto the original text.
//
// The class is model-agnostic: WHICH GLiNER build to run (HF repo, ONNX file, local bundle)
// comes from the models.ts registry, so adding gliner_medium = one new MODELS entry.
import { type Detector, type RawMatch, MODEL_PRIORITY, escapeRegExp } from "./engine";
import * as diag from "./diag";

const MAX_WIDTH = 12;        // GLiNER span width (config.max_width — 12 across the family)
const MAX_WORDS = 384;       // default words/chunk; per-model override via GlinerModelSource.maxWords

// One label the model is asked to find, and how a hit is redacted. Each MODEL brings its
// own label set (the registry owns it): PII-tuned builds have rich taxonomies ("account
// number", "location street"), generalists use broad ones ("person"). A label with neither
// fake nor tag is classify-but-KEEP — requested so the model doesn't mislabel that text as
// something we redact (e.g. "organization" keeps fund/merchant names intact).
export interface GlinerLabel {
  name: string;              // verbatim prompt string; ARRAY ORDER = model class id, do not sort
  fake?: string;             // Faker method ("" or absent -> falls back to tag in fake mode)
  mask?: RawMatch["mask"];   // partial-mask fn for mask mode (absent -> tag)
  tag?: string;              // redact-mode output (absent but fake set -> derived from name)
  sweep?: boolean;           // confirmed spans become document-wide terms (names)
}
const redacts = (l: GlinerLabel): boolean => l.fake !== undefined || l.tag !== undefined;
const tagOf = (l: GlinerLabel): string => l.tag ?? `[${l.name.toUpperCase()} REDACTED]`;

// ── word splitter (port of GLiNER.js WhitespaceTokenSplitter) ──
const WORD_RE = /\w+(?:[-_]\w+)*|\S/g;
export function splitWords(text: string): { words: string[]; starts: number[]; ends: number[] } {
  const words: string[] = [], starts: number[] = [], ends: number[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) { words.push(m[0]); starts.push(m.index); ends.push(WORD_RE.lastIndex); }
  return { words, starts, ends };
}

// ── encode: words + entity labels -> model token inputs (port of Processor.encodeInputs) ──
// Builds the prompt "<<ENT>> label1 <<ENT>> label2 ... <<SEP>> word1 word2 ..." and the
// words_mask that marks the FIRST subword of each content word with its 1-based word index.
export interface Tok { encode(t: string): number[]; sep_token_id: number; }
export function encode(tok: Tok, words: string[], entities: string[]): { inputIds: number[]; attentionMask: number[]; wordsMask: number[] } {
  const prompt: string[] = [];
  for (const e of entities) { prompt.push("<<ENT>>"); prompt.push(e); }
  prompt.push("<<SEP>>");
  const promptLen = prompt.length;
  const seq = prompt.concat(words);

  const inputIds = [1], attentionMask = [1], wordsMask = [0]; // leading CLS/bos
  let c = 1;
  seq.forEach((word, wordId) => {
    const sub = tok.encode(word).slice(1, -1); // strip the tokenizer's own bos/eos
    sub.forEach((id, tokenId) => {
      attentionMask.push(1);
      wordsMask.push(wordId < promptLen ? 0 : tokenId === 0 ? c++ : 0);
      inputIds.push(id);
    });
  });
  wordsMask.push(0); inputIds.push(tok.sep_token_id); attentionMask.push(1); // trailing SEP
  return { inputIds, attentionMask, wordsMask };
}

// All (start,width) spans over `nWords` words (port of SpanProcessor.prepareSpans).
export function spanGrid(nWords: number): { spanIdx: number[][]; spanMask: boolean[] } {
  const spanIdx: number[][] = [], spanMask: boolean[] = [];
  for (let i = 0; i < nWords; i++)
    for (let j = 0; j < MAX_WIDTH; j++) {
      spanIdx.push([i, Math.min(i + j, nWords - 1)]);
      spanMask.push(true); // always valid here — in the reference only batch PADDING made this false
    }
  return { spanIdx, spanMask };
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

// Statements SHOUT names ("JORDAN MERCER"); GLiNER is trained on natural casing, so
// title-case all-caps words for INFERENCE only — offsets/slices still come from the
// original text (the word list length is unchanged, so word indices map 1:1).
export const titleCaseShout = (w: string): string =>
  /^[A-Z]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w;

// Yield until the browser has had a chance to PAINT a progress update (rAF = next frame),
// raced with a short timeout so hidden pages and tests (which get no frames) never stall.
// A bare setTimeout(0) is not enough: the next inference chunk re-blocks the main thread
// before the renderer fits a frame in, and the progress fill never becomes visible.
export const frameYield = (): Promise<void> => new Promise((r) => {
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(fin, 0));
  setTimeout(fin, 50);
});

export type Span = [string, number, number, string, number]; // [text, startChar, endChar, label, score]

// Greedy non-overlapping selection (flat NER) — port of BaseDecoder.greedySearch.
export function greedyFlat(spans: Span[]): Span[] {
  const overlaps = (a: Span, b: Span) => !(a[1] > b[2] || b[1] > a[2]);
  const out: Span[] = [];
  for (const s of spans.slice().sort((a, b) => b[4] - a[4]))
    if (!out.some((o) => overlaps(s, o))) out.push(s);
  return out.sort((a, b) => a[1] - b[1]);
}

// Decode the flat `logits` tensor into char-offset spans (port of SpanDecoder.decode, batch=1).
export function decodeSpans(
  logits: Float32Array | number[], inputLength: number, numEntities: number,
  text: string, wordStarts: number[], wordEnds: number[], idToClass: Record<number, string>, threshold: number,
): Span[] {
  const startTokenPad = MAX_WIDTH * numEntities;
  const endTokenPad = numEntities;
  const found: Span[] = [];
  for (let id = 0; id < logits.length; id++) {
    const prob = sigmoid(logits[id] as number);
    if (prob < threshold) continue;
    const startToken = Math.floor(id / startTokenPad) % inputLength;
    const endToken = startToken + (Math.floor(id / endTokenPad) % MAX_WIDTH);
    const entity = id % numEntities;
    if (startToken >= wordStarts.length || endToken >= wordEnds.length) continue;
    const s = wordStarts[startToken], e = wordEnds[endToken];
    found.push([text.slice(s, e), s, e, idToClass[entity + 1], prob]);
  }
  return greedyFlat(found);
}

// Consistency sweep: a name the model confirmed ANYWHERE becomes a document-wide term —
// every other occurrence (any casing, any layout) is redacted too. Long dense documents
// hide names from the model in transaction lines; layout can't change the spelling.
// Sweeps the full confirmed name AND its tokens (>=3 chars), so "MERCER, JORDAN A" and
// surname-only mentions fall once "Jordan Mercer" is confirmed. Recall > precision.
// Which labels sweep comes from the model's label config (sweep: true — name-like labels).
export function sweepNames(text: string, found: RawMatch[], labels: GlinerLabel[]): RawMatch[] {
  const sweepers = labels.filter((l) => l.sweep && redacts(l));
  const terms = new Map<string, GlinerLabel>(); // confirmed string -> the label entry that emits it
  for (const l of sweepers) {
    for (const m of found) {
      if (m.label !== `NER:${l.name}`) continue;
      const t = text.slice(m.start, m.end).trim();
      if (t.length >= 3 && !terms.has(t)) terms.set(t, l);
      for (const part of t.split(/\s+/))
        if (part.length >= 3 && /^[A-Za-z][A-Za-z'.-]*$/.test(part) && !terms.has(part)) terms.set(part, l);
    }
  }
  const seen = new Set(found.map((m) => `${m.start}:${m.end}`));
  const out: RawMatch[] = [];
  for (const [name, l] of terms) {
    for (const m of text.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"))) {
      const key = `${m.index}:${m.index + m[0].length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ start: m.index, end: m.index + m[0].length, label: `NER:${l.name}`, priority: MODEL_PRIORITY, fake: l.fake ?? "", mask: l.mask ?? null, tag: tagOf(l) });
    }
  }
  return out;
}

type GlinerSession = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | number[] }>> };
type TensorCtor = new (type: string, data: unknown, dims: number[]) => unknown;

export interface GlinerModelSource {
  repo: string;        // HF repo id (tokenizer + download fallback)
  file: string;        // ONNX file within the repo
  localFile?: string;  // bundled copy served from /public (instant + offline), tried first
  threshold?: number;
  labels: GlinerLabel[]; // the model's prompt labels + redaction mapping (order = class id)
  maxWords?: number;   // words/chunk override (e.g. mdeberta multi_pii caps at 384 TOTAL incl. prompt)
}

export class GLiNERDetector implements Detector {
  name = "gliner"; // identity lives in models.ts ids; the "NER:" label prefix is what diagnostics/chips key on
  private session: GlinerSession | null = null;
  private tok: Tok | null = null;
  private Tensor: TensorCtor | null = null;
  private loading: Promise<void> | null = null;
  threshold: number;

  constructor(private src: GlinerModelSource) {
    this.threshold = src.threshold ?? 0.3; // recall-leaning (the spike-validated setting)
  }

  ready(): boolean { return this.session !== null && this.tok !== null; }

  /** Load tokenizer + ONNX session once (idempotent), reusing the app's transformers.js runtime. */
  load(onProgress?: (p: unknown) => void): Promise<void> {
    if (this.session && this.tok) return Promise.resolve();
    if (!this.loading) {
      this.loading = (async () => {
        const { AutoTokenizer, env } = await import("@huggingface/transformers");
        env.allowLocalModels = false;
        // Import onnxruntime-web directly (the SAME hoisted instance transformers.js uses): we need
        // InferenceSession + Tensor, and transformers only exposes the ORT *config* (env.backends.onnx).
        const ort = await import("onnxruntime-web");
        this.Tensor = ort.Tensor as unknown as TensorCtor;
        this.tok = (await AutoTokenizer.from_pretrained(this.src.repo, { progress_callback: onProgress })) as unknown as Tok;
        // GLiNER's prompt needs <<ENT>>/<<SEP>> as single special tokens; if the tokenizer doesn't
        // know them the prompt is malformed -> weak recall (not a mislocation). Surface it once.
        if (this.tok.encode("<<ENT>>").length !== 3 || this.tok.encode("<<SEP>>").length !== 3)
          diag.warn("gliner_special_tokens_missing", {});
        const bytes = await fetchModel(this.src, onProgress);
        this.session = (await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] })) as unknown as GlinerSession;
      })().catch((e) => { this.loading = null; throw e; });
    }
    return this.loading;
  }

  private tensor(type: string, data: unknown, dims: number[]) {
    return new this.Tensor!(type, data, dims);
  }

  /** Detect names/addresses as low-priority spans; regex still wins overlaps. */
  async detect(text: string, onProgress?: (frac: number) => void): Promise<RawMatch[]> {
    if (!this.session || !this.tok) return [];
    const { words, starts, ends } = splitWords(text);
    const labels = this.src.labels;
    const names = labels.map((l) => l.name);
    const byLabel = new Map(labels.map((l) => [l.name, l]));
    // Chunks OVERLAP by 32 words so a name sitting on a seam can't be split (a split name = a
    // leak); duplicate spans from the overlap dedupe via `seen` + the engine's resolver.
    const maxWords = this.src.maxWords ?? MAX_WORDS;
    const STEP_WORDS = maxWords - 32;
    const totalChunks = Math.max(1, Math.ceil(words.length / STEP_WORDS)); // for progress reporting
    const idToClass: Record<number, string> = {};
    names.forEach((c, i) => { idToClass[i + 1] = c; });

    const out: RawMatch[] = [];
    const seen = new Set<string>();
    const groups: Record<string, number> = {};
    let kept = 0, windows = 0;

    // Chunk by words (each chunk keeps ABSOLUTE char offsets, so spans map to the original text).
    // A GLiNER failure must degrade to regex-only, not fail the whole redaction.
    try {
      for (let base = 0; base < words.length; base += STEP_WORDS) {
        const wEnd = Math.min(base + maxWords, words.length);
        const cWords = words.slice(base, wEnd), cStarts = starts.slice(base, wEnd), cEnds = ends.slice(base, wEnd);
        windows++;

        const { inputIds, attentionMask, wordsMask } = encode(this.tok, cWords.map(titleCaseShout), names);
        const { spanIdx, spanMask } = spanGrid(cWords.length);
        const nTok = inputIds.length, nSpan = spanIdx.length;
        const i64 = (a: number[]) => BigInt64Array.from(a, BigInt);

        const feeds = {
          input_ids: this.tensor("int64", i64(inputIds), [1, nTok]),
          attention_mask: this.tensor("int64", i64(attentionMask), [1, nTok]),
          words_mask: this.tensor("int64", i64(wordsMask), [1, nTok]),
          text_lengths: this.tensor("int64", i64([cWords.length]), [1, 1]),
          span_idx: this.tensor("int64", i64(spanIdx.flat()), [1, nSpan, 2]),
          span_mask: this.tensor("bool", Uint8Array.from(spanMask, (b) => (b ? 1 : 0)), [1, nSpan]),
        };
        const res = await this.session.run(feeds);
        const spans = decodeSpans(res.logits.data, cWords.length, names.length, text, cStarts, cEnds, idToClass, this.threshold);

        for (const [, s, e, label] of spans) {
          groups[label] = (groups[label] || 0) + 1;
          const l = byLabel.get(label);
          if (!l || !redacts(l)) continue; // classify-but-keep (e.g. organization)
          const key = `${s}:${e}`;
          if (seen.has(key)) continue;
          seen.add(key);
          kept++;
          out.push({ start: s, end: e, label: `NER:${label}`, priority: MODEL_PRIORITY, fake: l.fake ?? "", mask: l.mask ?? null, tag: tagOf(l) });
        }
        // Report progress + wait for a frame so the fill actually paints between chunks.
        if (onProgress) { onProgress(Math.min(1, windows / totalChunks)); await frameYield(); }
        if (wEnd >= words.length) break; // done (the overlap step would otherwise re-run the tail)
      }
    } catch (err) {
      diag.error("gliner_detect_failed", err); // degrade to regex-only
    }
    // Names confirmed anywhere cover their other occurrences document-wide (layout-proof).
    const swept = sweepNames(text, out, labels);
    out.push(...swept);
    diag.info("gliner_detect", { inChars: text.length, windows, kept, swept: swept.length, groups });
    return out;
  }
}

/** Fetch the ONNX weights: the local bundle first (instant + offline), else HF (browser-cached after). */
async function fetchModel(src: GlinerModelSource, onProgress?: (p: unknown) => void): Promise<Uint8Array> {
  if (src.localFile) {
    try {
      const local = await fetch(src.localFile);
      if (local.ok) return new Uint8Array(await local.arrayBuffer());
    } catch { /* not bundled — fall through to the HF download */ }
  }
  const r = await fetch(`https://huggingface.co/${src.repo}/resolve/main/${src.file}`);
  if (!r.ok) throw new Error(`GLiNER model download failed: ${r.status} for ${src.file}`);
  const total = Number(r.headers.get("content-length"));
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  // Stream into a single preallocated buffer (no chunk list + reassembly — the model is ~175 MB,
  // double-buffering would spike peak memory by the same amount again).
  const buf = new Uint8Array(total);
  const reader = r.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf.set(value, loaded); loaded += value.length;
    onProgress?.({ status: "progress", progress: (loaded / total) * 100, file: src.file });
  }
  return buf;
}
