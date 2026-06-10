// File handlers — single source of truth for "which files we accept and how we read them".
// Each handler turns a File into plain text (or throws). Adding a format = one entry
// before the text fallback. The engine never sees files; it only redacts strings.
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface FileHandler {
  id: string;
  match: (f: File) => boolean;          // first match wins; the text handler is the fallback
  read: (f: File) => Promise<string>;   // bytes -> text, or throw
  slow?: boolean;                        // show a "reading…" state while it runs
  accept: string[];                      // contributes to the <input accept> list
  hint: string;                          // dropzone label fragment
}

// Extract text from a PDF locally (pdf.js, no network). Groups items into lines by
// vertical position: raw but readable. Faithful table structure is a later pass.
async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    let lastY: number | null = null;
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string") continue; // skip non-text marks
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line.trimEnd()); line = ""; }
      line += item.str + " ";
      lastY = y;
    }
    if (line.trim()) lines.push(line.trimEnd());
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
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
    match: () => true, // fallback — must stay last
    read: (f) => f.text(),
    accept: [".txt", ".csv", ".md", ".markdown", ".json", ".xml", ".html", ".log", "text/*"],
    hint: "TXT · CSV · MD",
  },
];

export const handlerFor = (f: File): FileHandler => FILE_HANDLERS.find((h) => h.match(f))!;
export const fileAccept = (): string => FILE_HANDLERS.flatMap((h) => h.accept).join(",");
export const fileHint = (): string => FILE_HANDLERS.map((h) => h.hint).join(" · ");
