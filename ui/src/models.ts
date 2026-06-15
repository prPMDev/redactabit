// Model types + the always-on built-in floor. The actual model CATALOG (which models exist, their
// URLs/thresholds/labels) is DATA, not code — it lives in a JSON manifest loaded at runtime by
// catalog.ts, so it can be updated without an app release. This file holds only what must stay in
// code: the ModelDef shape and BUILTIN (the regex floor that must survive a broken/absent manifest).
import type { Detector } from "./engine";

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

// The always-on floor: built-in regex rules. Not installable, no separate detector (it runs inside
// the engine), and intentionally NOT in the manifest — it's the guaranteed fallback if the manifest
// is missing or malformed. Shown as the "Rules only" state in the statusbar.
export const BUILTIN: ModelDef = {
  id: "none",
  detector: null,
  storeKey: null,
  available: true,
  chip: { label: "Rules only", desc: "Fast. Finds SSNs, cards, and accounts." },
  card: { name: "Built-in rules", desc: "Finds SSNs, cards, and accounts.", size: "0 MB", accuracy: 0, speed: 0 },
};
