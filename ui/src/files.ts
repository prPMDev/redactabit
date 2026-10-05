// File handlers — single source of truth for "which files we accept and how we read them".
// Each handler turns a File into plain text (or throws). Adding a format = one entry
// before the text fallback. The engine never sees files; it only redacts strings.

export interface FileHandler {
  id: string;
  match: (f: File) => boolean;          // first match wins; the text handler is the fallback
  read: (f: File) => Promise<string>;   // bytes -> text, or throw
  slow?: boolean;                        // show a "reading…" state while it runs
  accept: string[];                      // contributes to the <input accept> list
  hint: string;                          // dropzone label fragment
}

// mupdf loads its own ~10 MB wasm, so it is dynamic-imported: out of the main bundle until the
// first PDF is opened. pdf-redact.ts reuses this loader for the save path.
export async function loadMupdf(): Promise<any> {
  const mod: any = await import("mupdf");
  const mupdf = mod.default ?? mod;
  if (mupdf.ready && typeof mupdf.ready.then === "function") await mupdf.ready; // some builds init async
  return mupdf;
}

// Extract text from a PDF locally (mupdf, no network). mupdf ends a line at every wide gap
// (table cells, label/value columns), so its lines are regrouped into rows by baseline: the
// same-line rules ("Taxpayer: Jane Doe") need the whole row. Raw but readable; faithful table
// structure is a later pass.
// ponytail: runs on the main thread (~2 ms/page); yield between pages if huge PDFs stutter.
async function extractPdfText(file: File): Promise<string> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(await file.arrayBuffer(), "application/pdf");
  try {
    // Without its password every page reads as empty, which would be reported as "scanned".
    if (doc.needsPassword()) throw new Error("password-protected PDF");
    const pages: string[] = [];
    for (let p = 0; p < doc.countPages(); p++) {
      const page = doc.loadPage(p), stext = page.toStructuredText();
      const blocks = JSON.parse(stext.asJSON()).blocks as { lines?: { y: number; text: string }[] }[];
      // Free the wasm copies now: finalizers can't run inside this sync loop, so a long PDF would
      // otherwise hold every page's text at once (~115 MB for 400 dense pages).
      stext.destroy(); page.destroy();
      const lines: string[] = [];
      let line = "";
      let lastY: number | null = null;
      for (const l of blocks.flatMap((b) => b.lines ?? [])) { // image blocks carry no lines
        if (lastY !== null && Math.abs(l.y - lastY) > 2 && line) { lines.push(line.trimEnd()); line = ""; }
        line += l.text + " ";
        lastY = l.y;
      }
      if (line.trim()) lines.push(line.trimEnd());
      pages.push(lines.join("\n"));
    }
    return pages.join("\n\n");
  } finally {
    doc.destroy();
  }
}

export const FILE_HANDLERS: FileHandler[] = [
  {
    id: "pdf",
    match: (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf",
    read: extractPdfText,
    slow: true,
    accept: [".pdf", "application/pdf"],
    hint: "PDF",
  },
  {
    id: "text",
    // Plain text only. Structured formats (CSV/JSON/XML/HTML) are deliberately NOT supported:
    // we'd redact them as text and a fake value (e.g. an address with a comma) can corrupt their
    // structure — and Redactabit makes AI-ready redactions, not faithful structured copies. Anything
    // not matched here is unsupported: handlerFor returns undefined and the UI shows a clear message.
    match: (f) => /\.(txt|md|markdown|log)$/i.test(f.name) || f.type === "text/plain",
    read: (f) => f.text(),
    accept: [".txt", ".md", ".markdown", ".log", "text/plain"],
    hint: "TXT · MD",
  },
];

export const handlerFor = (f: File): FileHandler | undefined => FILE_HANDLERS.find((h) => h.match(f));
export const fileAccept = (): string => FILE_HANDLERS.flatMap((h) => h.accept).join(",");
export const fileHint = (): string => FILE_HANDLERS.map((h) => h.hint).join(" · ");
