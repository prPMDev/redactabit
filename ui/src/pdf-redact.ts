// True PDF redaction: mupdf REMOVES the PII (the safety), pdf-lib DRAWS the replacement (the
// visual). mupdf.js Redact annotations can't draw replacement text, so we split the job —
// mupdf for content-stream removal (proven in the Phase-2 spike), pdf-lib (MIT) for a white box
// + Helvetica replacement, mirroring the legacy frisket.py PyMuPDF behavior (frisket.py:468-487).
// main.ts dynamic-imports this module only on a PDF save, so mupdf/pdf-lib stay out of the main
// bundle; mupdf itself is dynamic-imported here (it loads its own wasm).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface ReplacePair { original: string; replacement: string; }
interface Placement { pageIndex: number; rect: [number, number, number, number]; replacement: string; }

// Bounding rect [x0,y0,x1,y1] of a mupdf search quad, tolerant of its shape (flat [8] numbers,
// array of points, or a {ul,ur,ll,lr} object).
export function rectOfQuad(q: any): [number, number, number, number] {
  let nums: number[] = [];
  if (Array.isArray(q) && typeof q[0] === "number") nums = q as number[];
  else if (Array.isArray(q)) nums = (q as any[]).flatMap((p) => (Array.isArray(p) ? p : [p.x, p.y]));
  else if (q && q.ul) nums = [q.ul.x, q.ul.y, q.ur.x, q.ur.y, q.ll.x, q.ll.y, q.lr.x, q.lr.y];
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

async function loadMupdf(): Promise<any> {
  const mod: any = await import("mupdf");
  const mupdf = mod.default ?? mod;
  if (mupdf.ready && typeof mupdf.ready.then === "function") await mupdf.ready; // some builds init async
  return mupdf;
}

// Remove every occurrence of each `original` (true content-stream removal via mupdf), then draw its
// `replacement` (fake/mask/tag) where it was. Returns the new PDF bytes + any `original` strings
// that STILL survive re-extraction (a redaction miss → the caller must refuse to save).
export async function redactPdf(src: Uint8Array, repl: ReplacePair[]): Promise<{ bytes: Uint8Array; survivors: string[] }> {
  // Dedup by original (same value → same fake, deterministic); skip trivially short strings.
  const map = new Map<string, string>();
  for (const r of repl) if (r.original.trim().length >= 3 && !map.has(r.original)) map.set(r.original, r.replacement);
  const originals = [...map.keys()];

  const mupdf = await loadMupdf();

  // Pass 1 — mupdf: locate + truly remove, recording where to draw each replacement.
  const doc = mupdf.Document.openDocument(src, "application/pdf");
  const placements: Placement[] = [];
  const nPages = doc.countPages();
  for (let i = 0; i < nPages; i++) {
    const page = doc.loadPage(i);
    for (const original of originals) {
      for (const q of page.search(original) || []) {
        const rect = rectOfQuad(q);
        page.createAnnotation("Redact").setRect(rect);
        placements.push({ pageIndex: i, rect, replacement: map.get(original)! });
      }
    }
    page.applyRedactions();
  }
  const removed: Uint8Array = doc.saveToBuffer("").asUint8Array(); // FULL save (never "incremental")

  // Pass 2 — pdf-lib: white box + replacement text (Helvetica black) at each placement.
  // mupdf space is y-down/top-left; pdf-lib is y-up/bottom-left → flip with the page height.
  const out = await PDFDocument.load(removed);
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  for (const p of placements) {
    const page = pages[p.pageIndex];
    if (!page) continue;
    const [x0, yTop, x1, yBottom] = p.rect;
    const H = page.getHeight();
    const w = x1 - x0, h = yBottom - yTop;
    const size = Math.max(4, h * 0.85);
    page.drawRectangle({ x: x0, y: H - yBottom, width: w, height: h, color: rgb(1, 1, 1) });
    page.drawText(p.replacement, { x: x0, y: H - yBottom + 0.15 * size, size, font: helv, color: rgb(0, 0, 0) });
  }
  const bytes = await out.save();

  // Verify TRUE removal: re-open the FINAL bytes and search each original — any hit is a survivor.
  // (The drawn replacements are expected to be present; we only assert the ORIGINALS are gone.)
  const survivors: string[] = [];
  try {
    const check = mupdf.Document.openDocument(bytes, "application/pdf");
    const cn = check.countPages();
    for (const original of originals) {
      let found = false;
      for (let i = 0; i < cn && !found; i++) if ((check.loadPage(i).search(original) || []).length) found = true;
      if (found) survivors.push(original);
    }
  } catch (e) {
    throw new Error("redaction verification failed: " + (e as Error).message); // can't verify → unsafe
  }
  return { bytes, survivors };
}
