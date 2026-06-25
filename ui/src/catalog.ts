// The runtime model catalog. Model DEFINITIONS are data, not code: they live in a JSON manifest
// so a model's URL/threshold/labels — or which models exist — can be updated WITHOUT shipping a
// new app release (edit site/models.json + push; GitHub Pages serves it; installed apps pick it up).
//
// Two layers, so the app is offline-first AND remotely updatable:
//   1. SEED (models.seed.json, imported synchronously) — an instant, always-present catalog at
//      module load. A build-time copy of site/models.json (see scripts/sync-seed.mjs). This is why
//      the UI needs no loading state: the catalog is populated before first paint, airplane-mode safe.
//   2. REMOTE (site/models.json on GitHub Pages) — the canonical, editable source. Fetched
//      best-effort at boot; on success it overlays the seed and notifies the UI to re-render.
//
// What stays in CODE (the minimal hardcoded set): BUILTIN (the always-on regex floor — must survive
// a broken/absent manifest), the one MANIFEST_URL bootstrap constant, and the Faker/mask methods
// (engine.ts) that labels reference by string name. Everything else is manifest data.
import { GLiNERDetector, type GlinerModelSource, type GlinerLabel } from "./gliner-detector";
import { BUILTIN, type ModelDef } from "./models";
import seed from "./models.seed.json";
import * as diag from "./diag";

// The one bootstrap constant: where the live manifest lives. (Allowed in tauri.conf.json CSP.)
const MANIFEST_URL = "https://prpmdev.github.io/redactabit/models.json";

// ── manifest shape (the JSON contract) ──
interface ManifestSource {
  repo: string;        // HF repo id (tokenizer + default weights URL)
  file: string;        // ONNX file within the repo
  modelUrl?: string;   // optional: direct weights URL (Releases/R2/anywhere); absent -> HF-derived
  threshold?: number;
  maxWords?: number;
  labels: GlinerLabel[]; // ORDER = model class id — the validator preserves it, never reorders
}
interface ManifestEntry {
  id: string;
  available?: boolean;
  source: ManifestSource;
  chip: { label: string; desc: string };
  card: { name: string; desc: string; size: string; accuracy: number; speed: number };
}
interface Manifest { version: number; models: ManifestEntry[]; }

// ── validation (hand-rolled, no schema dep — matches house style) ──
// Reject the WHOLE manifest only if the top-level shape is wrong; otherwise drop a single bad
// entry and keep the rest, so one malformed model never blanks a good catalog.
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validateEntry(e: unknown): ManifestEntry | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (!str(o.id)) return null;
  const s = o.source as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return null;
  if (!str(s.repo) || !str(s.file)) return null;
  if (!Array.isArray(s.labels) || s.labels.length === 0) return null;
  // A malformed label rejects the whole ENTRY (not just the label): dropping one would shift the
  // class-id order and silently mislabel every subsequent span.
  const labels: GlinerLabel[] = [];
  for (const raw of s.labels) {
    if (!raw || typeof raw !== "object") return null;
    const l = raw as Record<string, unknown>;
    if (!str(l.name)) return null;
    const label: GlinerLabel = { name: l.name };
    if (str(l.fake)) label.fake = l.fake;
    if (str(l.tag)) label.tag = l.tag;
    if (typeof l.sweep === "boolean") label.sweep = l.sweep;
    labels.push(label);
  }
  const chip = o.chip as Record<string, unknown> | undefined;
  if (!chip || !str(chip.label) || !str(chip.desc)) return null;
  const card = o.card as Record<string, unknown> | undefined;
  if (!card || !str(card.name) || !str(card.desc) || !str(card.size) || !num(card.accuracy) || !num(card.speed))
    return null;
  const source: ManifestSource = { repo: s.repo, file: s.file, labels };
  if (str(s.modelUrl)) source.modelUrl = s.modelUrl;
  if (num(s.threshold)) source.threshold = s.threshold;
  if (num(s.maxWords)) source.maxWords = s.maxWords;
  return {
    id: o.id,
    available: typeof o.available === "boolean" ? o.available : true,
    source,
    chip: { label: chip.label, desc: chip.desc },
    card: { name: card.name, desc: card.desc, size: card.size, accuracy: card.accuracy, speed: card.speed },
  };
}

function validateManifest(raw: unknown): Manifest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.models)) return null;
  const models: ManifestEntry[] = [];
  const ids = new Set<string>();
  for (const e of r.models) {
    const v = validateEntry(e);
    if (!v) { diag.warn("manifest_entry_invalid", {}); continue; }
    if (ids.has(v.id)) { diag.warn("manifest_entry_dupe", { id: v.id }); continue; }
    ids.add(v.id);
    models.push(v);
  }
  return { version: num(r.version) ? r.version : 1, models };
}

// ── build ModelDef (data -> a live, loadable detector) ──
function buildModelDef(e: ManifestEntry): ModelDef {
  const source: GlinerModelSource = { repo: e.source.repo, file: e.source.file, labels: e.source.labels };
  if (e.source.modelUrl !== undefined) source.modelUrl = e.source.modelUrl;
  if (e.source.threshold !== undefined) source.threshold = e.source.threshold;
  if (e.source.maxWords !== undefined) source.maxWords = e.source.maxWords;
  return {
    id: e.id,
    detector: new GLiNERDetector(source),
    storeKey: `redactabit.model.${e.id}.v1`, // derived, not stored per-entry
    available: e.available ?? true,
    chip: e.chip,
    card: e.card,
  };
}

// ── catalog state + identity-preserving refresh ──
let models: ModelDef[] = [];
let sigById = new Map<string, string>(); // id -> source signature, to detect genuine changes

// Bytes/loading identity: if unchanged, the already-built detector (possibly mid-download or with a
// live ONNX session) is reused across a refresh rather than torn down.
const sourceSig = (e: ManifestEntry): string => JSON.stringify([
  e.source.repo, e.source.file, e.source.modelUrl ?? null, e.source.threshold ?? null,
  e.source.maxWords ?? null, e.source.labels,
]);

function applyManifest(m: Manifest): void {
  const prevById = new Map(models.map((d) => [d.id, d]));
  const nextSig = new Map<string, string>();
  models = m.models.map((e) => {
    const sig = sourceSig(e);
    nextSig.set(e.id, sig);
    const prev = prevById.get(e.id);
    if (prev && sigById.get(e.id) === sig) return prev; // unchanged source -> keep the live detector
    return buildModelDef(e); // new id or genuinely changed weights -> fresh detector
  });
  sigById = nextSig;
}

// Seed synchronously at module load (offline-safe baseline). validate the seed too — it's only
// trusted because the build copies it from the validated canonical, but defense in depth is free.
applyManifest(validateManifest(seed) ?? { version: 1, models: [] });

// ── subscribe/notify (tiny; no event-emitter dep) ──
const subs = new Set<() => void>();
export function subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
const notify = (): void => subs.forEach((fn) => fn());

// ── public accessors (the contract main.ts consumes) ──
export const getModels = (): ModelDef[] => models;
export const getBuiltin = (): ModelDef => BUILTIN;
export const getModel = (id: string): ModelDef | undefined =>
  id === BUILTIN.id ? BUILTIN : models.find((m) => m.id === id);
export const isInstalled = (m: ModelDef): boolean =>
  !!m.storeKey && localStorage.getItem(m.storeKey) === "1";
export const installedModels = (): ModelDef[] => models.filter(isInstalled);

// Best-effort background refresh from the remote manifest. Fail-silent (offline keeps the seed),
// no identifiers sent — an inbound definition pull, never outbound user data. Honors airplane-mode.
export function initCatalog(): void {
  fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
    .then((raw) => {
      const valid = validateManifest(raw);
      if (!valid) { diag.warn("manifest_invalid", {}); return; }
      applyManifest(valid);
      notify();
      diag.info("manifest_refreshed", { models: models.length });
    })
    .catch(() => { diag.info("manifest_fetch_skipped", {}); });
}

export type { ModelDef };
