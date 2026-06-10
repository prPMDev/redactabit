// Detection models — the catalog the UI renders + the source the redact pipeline reads.
// UI-side (a model dynamic-imports heavy libs); the engine only ever sees Detector
// instances. Exactly one smart model is active at a time (Handy-style); built-in rules
// are always the floor. Adding a model = one entry in MODELS (+ shipping its Detector).
import type { Detector } from "./engine";
import { GLiNERDetector } from "./gliner-detector";

// A detector the UI can install on demand (load() downloads/caches the weights; idempotent).
export type LoadableDetector = Detector & { load(onProgress?: (p: unknown) => void): Promise<void> };

export interface ModelDef {
  id: string;                 // stored as the active id in localStorage
  detector: LoadableDetector | null;  // null = runs in the engine (built-in); detector.load() installs it
  storeKey: string | null;    // localStorage install flag; null = not installable
  available: boolean;         // false = "Coming later"
  chip: { label: string; desc: string };                                   // statusbar
  card: { name: string; desc: string; size: string; accuracy: number; speed: number }; // Detection screen
}

// The always-on floor: built-in regex rules. Not installable, no separate detector (it
// runs inside the engine). Shown as the "Rules only" state in the statusbar.
export const BUILTIN: ModelDef = {
  id: "none",
  detector: null,
  storeKey: null,
  available: true,
  chip: { label: "Rules only", desc: "Fast. Finds SSNs, cards, and accounts." },
  card: { name: "Built-in rules", desc: "Finds SSNs, cards, and accounts.", size: "0 MB", accuracy: 0, speed: 0 },
};

// Real model names as identities (Handy-parity: "Parakeet V3", not a friendly alias);
// the desc line carries the plain-language "what it finds".
export const MODELS: ModelDef[] = [
  {
    id: "gliner-pii",
    // THE DEFAULT CARD — won the calibration gate 2026-06-10 (docs/gliner-spike/run_calibration.py):
    // at threshold 0.25 it matches or beats gliner_small-v2.1 on every fixture column and wins
    // in-document recall (5/6 vs 4/6) + structured-ID bonus, zero over-redaction. gliner_small's
    // card was removed (clean catalog: each card needs a distinct why).
    // PII-specialized fine-tune (Knowledgator, 2025): native PII taxonomy instead of prompted
    // generics. Labels chosen for NET-new recall over the regex floor — never request labels
    // that redact financial substance (money, organization, url, case/policy numbers).
    detector: new GLiNERDetector({
      repo: "knowledgator/gliner-pii-base-v1.0",
      file: "onnx/model_quint8.onnx",
      threshold: 0.25, // gate-tuned: 0.3 (card-official) dropped short names like "Wei Zhang" (0.27)
      labels: [
        { name: "name", fake: "name", tag: "[NAME REDACTED]", sweep: true },
        { name: "first name", fake: "name", tag: "[NAME REDACTED]", sweep: true },
        { name: "last name", fake: "name", tag: "[NAME REDACTED]", sweep: true },
        { name: "location address", fake: "street", tag: "[ADDRESS REDACTED]" },
        { name: "location street", fake: "street", tag: "[ADDRESS REDACTED]" },
        { name: "location city", fake: "cityline", tag: "[ADDRESS REDACTED]" },
        { name: "dob", fake: "dob", tag: "[DOB REDACTED]" },
        { name: "account number", fake: "account", tag: "[ACCOUNT REDACTED]" },
        { name: "bank account", fake: "account", tag: "[ACCOUNT REDACTED]" },
        { name: "credit card", fake: "card", tag: "[CARD REDACTED]" },
        { name: "passport number", fake: "passport", tag: "[PASSPORT REDACTED]" },
        { name: "driver license", tag: "[DRIVER LICENSE REDACTED]" },
        { name: "username", tag: "[USERNAME REDACTED]" },
      ],
    }),
    storeKey: "redacto.model.gliner-pii.v1",
    available: true,
    chip: { label: "GLiNER PII base", desc: "Trained to find personal data: names, addresses, IDs." },
    card: {
      name: "GLiNER PII base",
      desc: "Trained specifically on personal data: names, addresses, accounts, IDs. Runs on your machine.",
      size: "~197 MB · downloads once",
      accuracy: 93, speed: 62,
    },
  },
  {
    id: "gliner-multi-pii",
    // Multilingual PII fine-tune (mDeBERTa backbone, en/fr/de/es/it/pt + 100-language
    // pretraining). Its context cap is 384 words TOTAL, so chunks shrink to leave room for
    // the label prompt. Gate findings 2026-06-10: this model's scores run LOW and dilute as
    // labels grow -> trimmed 8-label set + threshold 0.1 (calibrated; over-redaction none).
    // It trails the default on ENGLISH fixtures — its card is the non-English-documents tier.
    detector: new GLiNERDetector({
      repo: "onnx-community/gliner_multi_pii-v1",
      file: "onnx/model_int8.onnx",
      threshold: 0.1,
      maxWords: 340,
      labels: [
        { name: "person", fake: "name", tag: "[NAME REDACTED]", sweep: true },
        { name: "address", fake: "street", tag: "[ADDRESS REDACTED]" },
        { name: "date of birth", fake: "dob", tag: "[DOB REDACTED]" },
        { name: "email", fake: "email", tag: "[EMAIL REDACTED]" },
        { name: "social security number", fake: "ssn", tag: "[SSN REDACTED]" },
        { name: "bank account number", fake: "account", tag: "[ACCOUNT REDACTED]" },
        { name: "credit card number", fake: "card", tag: "[CARD REDACTED]" },
        { name: "iban", tag: "[IBAN REDACTED]" },
      ],
    }),
    storeKey: "redacto.model.gliner-multi-pii.v1",
    available: true,
    chip: { label: "GLiNER multi PII", desc: "For documents in French, German, Spanish, Italian, Portuguese." },
    card: {
      name: "GLiNER multi PII",
      desc: "For non-English documents: French, German, Spanish, Italian, Portuguese. Runs on your machine.",
      size: "~349 MB · downloads once",
      accuracy: 86, speed: 50,
    },
  },
];

// ── helpers (read by the chip, dropdown, cards, and the redact pipeline) ──
export const getModel = (id: string): ModelDef | undefined =>
  id === BUILTIN.id ? BUILTIN : MODELS.find((m) => m.id === id);
export const isInstalled = (m: ModelDef): boolean =>
  !!m.storeKey && localStorage.getItem(m.storeKey) === "1";
export const installedModels = (): ModelDef[] => MODELS.filter(isInstalled);
