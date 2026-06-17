import { describe, it, expect } from "vitest";
import { rectOfQuad } from "./pdf-redact";

// rectOfQuad is the only pure piece (redactPdf needs mupdf-wasm + a PDF fixture, exercised by the
// local de-risk script docs/pdf-spike/check-redact.mjs and the dev-app e2e).
describe("rectOfQuad — bounding rect of a mupdf search quad", () => {
  const expected: [number, number, number, number] = [10, 20, 50, 30];

  it("flat [8] numbers", () => {
    expect(rectOfQuad([10, 20, 50, 20, 10, 30, 50, 30])).toEqual(expected);
  });
  it("array of [x,y] points", () => {
    expect(rectOfQuad([[10, 20], [50, 20], [10, 30], [50, 30]])).toEqual(expected);
  });
  it("{ul,ur,ll,lr} object", () => {
    expect(rectOfQuad({ ul: { x: 10, y: 20 }, ur: { x: 50, y: 20 }, ll: { x: 10, y: 30 }, lr: { x: 50, y: 30 } })).toEqual(expected);
  });
  it("normalizes min/max regardless of corner order", () => {
    expect(rectOfQuad([50, 30, 10, 20, 50, 20, 10, 30])).toEqual(expected);
  });
});
