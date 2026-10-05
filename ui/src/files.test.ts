// Guards the PDF reader: rows are regrouped (mupdf ends a line at every wide gap) and a locked
// PDF is refused instead of being read as empty. Fixtures are built in memory.
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { handlerFor, loadMupdf } from "./files";

async function pdf(draw: [text: string, x: number, y: number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  for (const [text, x, y] of draw) page.drawText(text, { x, y, size: 10, font });
  return doc.save();
}
const read = (bytes: Uint8Array): Promise<string> => {
  const f = new File([bytes as unknown as BlobPart], "t.pdf", { type: "application/pdf" });
  return handlerFor(f)!.read(f);
};

describe("PDF text extraction", () => {
  it("keeps a label and its far-right value on one row, and rows on separate lines", async () => {
    const bytes = await pdf([["Taxpayer:", 50, 700], ["Jordan Mercer", 300, 700], ["SSN: 123-45-6789", 50, 685]]);
    expect(await read(bytes)).toBe("Taxpayer: Jordan Mercer\nSSN: 123-45-6789");
  });

  it("refuses a password-protected PDF", async () => {
    const mupdf = await loadMupdf();
    const locked: Uint8Array = mupdf.Document.openDocument(await pdf([["secret", 50, 700]]), "application/pdf")
      .saveToBuffer("encrypt=aes-256,user-password=pw").asUint8Array().slice();
    await expect(read(locked)).rejects.toThrow(/password/);
  });
});
