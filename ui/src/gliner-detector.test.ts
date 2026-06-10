// Guards the hand-rolled GLiNER port's pure logic (no model download): the leak-critical
// span placement (decode), the encode words_mask, word offsets, and greedy overlap.
import { describe, it, expect } from "vitest";
import { splitWords, encode, greedyFlat, decodeSpans, titleCaseShout, sweepNames, type GlinerLabel, type Span, type Tok } from "./gliner-detector";
import type { RawMatch } from "./engine";

// The label config used by the sweep tests — mirrors the gliner_small registry entry.
const SWEEP_LABELS: GlinerLabel[] = [
  { name: "person", fake: "name", tag: "[NAME REDACTED]", sweep: true },
  { name: "address", fake: "street", tag: "[ADDRESS REDACTED]" },
  { name: "organization" },
];

describe("GLiNER port — word offsets", () => {
  it("splits words with correct char offsets (hyphens stay together)", () => {
    const { words, starts, ends } = splitWords("Alice Bob-Smith");
    expect(words).toEqual(["Alice", "Bob-Smith"]);
    expect(starts).toEqual([0, 6]);
    expect(ends).toEqual([5, 15]);
  });
});

describe("GLiNER port — ALL-CAPS normalization for inference", () => {
  it("title-cases shouting words, leaves natural casing and short tokens alone", () => {
    expect(titleCaseShout("MERCER")).toBe("Mercer");
    expect(titleCaseShout("VENKATARAMAN")).toBe("Venkataraman");
    expect(titleCaseShout("McDonald")).toBe("McDonald"); // mixed case untouched
    expect(titleCaseShout("Wei")).toBe("Wei");
    expect(titleCaseShout("A")).toBe("A"); // single letter untouched (initials)
    expect(titleCaseShout("123")).toBe("123");
  });
});

describe("GLiNER port — decode (leak-critical span placement)", () => {
  it("maps logits to the exact char span", () => {
    // words: Alice[0,5] Bob[6,9] Carol[10,15]; 1 entity ("person"); MAX_WIDTH=12
    const text = "Alice Bob Carol";
    const logits = new Float32Array(3 * 12 * 1).fill(-10);
    logits[0] = 10; // start=0,width=0,ent=0 -> "Alice"
    logits[13] = 10; // start=1,width=1,ent=0 -> "Bob Carol"
    const spans = decodeSpans(logits, 3, 1, text, [0, 6, 10], [5, 9, 15], { 1: "person" }, 0.5);
    expect(spans).toHaveLength(2);
    expect(text.slice(spans[0][1], spans[0][2])).toBe("Alice"); // sorted by start
    expect(text.slice(spans[1][1], spans[1][2])).toBe("Bob Carol");
    expect(spans.every((s) => s[3] === "person")).toBe(true);
  });

  it("drops sub-threshold logits", () => {
    const logits = new Float32Array(3 * 12 * 1).fill(-10);
    logits[0] = 10; // strong
    logits[13] = -0.5; // sigmoid ~0.38 < 0.5 -> dropped
    const spans = decodeSpans(logits, 3, 1, "Alice Bob Carol", [0, 6, 10], [5, 9, 15], { 1: "person" }, 0.5);
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBe("Alice");
  });
});

describe("GLiNER port — consistency sweep (confirmed names cover the whole document)", () => {
  const person = (text: string, sub: string): RawMatch => {
    const start = text.indexOf(sub);
    return { start, end: start + sub.length, label: "NER:person", priority: 15, fake: "name", mask: null, tag: "[NAME REDACTED]" };
  };

  it("redacts later occurrences the model missed — any casing, surname-only too", () => {
    const text = "Holder: Jordan Mercer.\nACH FROM JORDAN MERCER.\nTRANSFER TO MERCER HOUSEHOLD.";
    const swept = sweepNames(text, [person(text, "Jordan Mercer")], SWEEP_LABELS);
    const covers = (sub: string) => {
      const i = text.indexOf(sub);
      return swept.some((s) => !(s.end <= i || s.start >= i + sub.length));
    };
    expect(covers("JORDAN MERCER")).toBe(true); // ALL-CAPS later occurrence
    expect(covers("MERCER HOUSEHOLD")).toBe(true); // surname-only mention
  });

  it("does not duplicate spans the model already found, and ignores org spans", () => {
    const text = "Jordan Mercer at Vanguard";
    const found = [person(text, "Jordan Mercer")];
    const org: RawMatch = { start: text.indexOf("Vanguard"), end: text.length, label: "NER:organization", priority: 15, fake: "", mask: null, tag: "[ORG]" };
    const swept = sweepNames(text, [...found, org], SWEEP_LABELS);
    expect(swept.some((s) => text.slice(s.start, s.end) === "Vanguard")).toBe(false); // orgs never sweep
    expect(swept.some((s) => s.start === found[0].start && s.end === found[0].end)).toBe(false); // no dup
  });

  it("skips short tokens (initials) so 'A' never sweeps", () => {
    const text = "Jordan A Mercer bought A SHARE CLASS A FUND";
    const swept = sweepNames(text, [person(text, "Jordan A Mercer")], SWEEP_LABELS);
    expect(swept.some((s) => text.slice(s.start, s.end) === "A")).toBe(false);
  });

  it("sweep is per-label config: sweep:false labels never sweep; swept spans carry the label's mapping", () => {
    const text = "Holder: Jordan Mercer. ACH FROM JORDAN MERCER.";
    const found = [person(text, "Jordan Mercer")];
    // same labels but person not marked sweep -> nothing swept
    expect(sweepNames(text, found, [{ name: "person", fake: "name", tag: "[NAME REDACTED]" }])).toHaveLength(0);
    // custom mapping (mask + tag) flows onto swept spans
    const maskFn = (o: string) => o[0] + "***";
    const swept = sweepNames(text, found, [{ name: "person", fake: "name", mask: maskFn, tag: "[P]", sweep: true }]);
    expect(swept.length).toBeGreaterThan(0);
    expect(swept.every((s) => s.label === "NER:person" && s.tag === "[P]" && s.mask === maskFn)).toBe(true);
  });

  it("derives a tag from the label name when a sweep label has fake but no tag", () => {
    const text = "Holder: Jordan Mercer. JORDAN MERCER again.";
    const swept = sweepNames(text, [person(text, "Jordan Mercer")], [{ name: "person", fake: "name", sweep: true }]);
    expect(swept.length).toBeGreaterThan(0);
    expect(swept.every((s) => s.tag === "[PERSON REDACTED]")).toBe(true);
  });
});

describe("GLiNER port — greedy flat selection", () => {
  it("keeps the highest-score span, drops overlaps, sorts by start", () => {
    const spans: Span[] = [
      ["A", 0, 5, "person", 0.6],
      ["B", 3, 8, "person", 0.9], // overlaps A, higher score -> wins
      ["C", 10, 15, "person", 0.5], // no overlap -> kept
    ];
    expect(greedyFlat(spans).map((s) => s[0])).toEqual(["B", "C"]);
  });
});

describe("GLiNER port — encode words_mask", () => {
  it("marks the first subword of each content word, zero for the prompt", () => {
    // stub tokenizer: encode -> [bos, ...one-id-per-char, eos]
    const tok: Tok = { encode: (s) => [101, ...[...s].map((c) => c.charCodeAt(0)), 102], sep_token_id: 102 };
    const { inputIds, wordsMask } = encode(tok, ["ab", "c"], ["x"]);
    expect(wordsMask.filter((m) => m !== 0)).toEqual([1, 2]); // two content words, incrementing
    expect(inputIds[0]).toBe(1); // leading CLS/bos
    expect(inputIds[inputIds.length - 1]).toBe(102); // trailing SEP
  });
});
