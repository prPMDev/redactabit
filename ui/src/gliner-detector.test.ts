// Guards the hand-rolled GLiNER port's pure logic (no model download): the leak-critical
// span placement (decode), the encode words_mask, word offsets, and greedy overlap — plus
// what the engine does with the model's numeric-ID spans (synthetic spans, same no-model rule).
import { describe, it, expect } from "vitest";
import { splitWords, encode, greedyFlat, decodeSpans, titleCaseShout, sweepNames, type GlinerLabel, type Span, type Tok } from "./gliner-detector";
import { redactAsync, plausibleId, Faker, MODEL_PRIORITY, type Detector, type RawMatch } from "./engine";
import seed from "./models.seed.json";

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

// Labels come from the SHIPPED manifest, so these also pin that both models' card/account
// labels still carry the Faker kinds the guard keys on.
const labelsOf = (id: string): GlinerLabel[] => seed.models.find((m) => m.id === id)!.source.labels;
// A span exactly as GLiNERDetector.detect() emits it.
const span = (text: string, sub: string, label: string, labels = labelsOf("gliner-pii")): RawMatch => {
  const l = labels.find((x) => x.name === label)!;
  const start = text.indexOf(sub);
  return { start, end: start + sub.length, label: `NER:${label}`, priority: MODEL_PRIORITY, fake: l.fake ?? "", mask: null, tag: l.tag ?? "" };
};

describe("GLiNER spans — a numeric-ID label has to fit the number (keep the numbers below Heavy)", () => {
  // The 2026-10-04 GLiNER PII base run (Standard, Fake), replayed from its decoded spans.
  const TEXT = [
    "Meeting notes, 12 March.",
    "Priya Venkataraman called about the refund and asked that Marcus Oyelaran be copied.",
    "The check was mailed to Elena Kowalczyk at her home in Lakewood.",
    "PAYMENT RECEIVED FROM OYELARAN, MARCUS ref 88213",
    "Later, Priya confirmed the amount of $1,250.00 with Dr. Kowalczyk.",
  ].join("\n");
  const OBSERVED: [label: string, sub: string][] = [
    ["name", "Priya Venkataraman"], ["name", "Marcus Oyelaran"], ["name", "Elena Kowalczyk"], ["location city", "Lakewood"],
    ["account number", "88213"], ["credit card", "$1,250.00"], ["name", "Dr. Kowalczyk"],
  ];
  const model: Detector = { name: "gliner", ready: () => true, detect: (t) => OBSERVED.map(([label, sub]) => span(t, sub, label)) };
  // -> the output text + which detector (if any) redacted a given original string
  const run = async (level: number) => {
    const r = await redactAsync(TEXT, level, "fake", [], new Faker("seed"), [model]);
    return { text: r.text, by: (sub: string) => r.changes.find((c) => c.fullOriginal === sub)?.pattern };
  };

  it("Standard keeps the amount and the short reference; every name and the city still go", async () => {
    const { text, by } = await run(2);
    expect(text).toContain("the amount of $1,250.00 with");
    expect(text).toContain("ref 88213");
    for (const sub of ["Priya Venkataraman", "Marcus Oyelaran", "Elena Kowalczyk", "Dr. Kowalczyk"]) expect(by(sub)).toBe("NER:name");
    expect(by("Lakewood")).toBe("NER:location city");
  });

  it("Light keeps them too (it promises all amounts)", async () => {
    const { text } = await run(1);
    expect(text).toContain("$1,250.00");
    expect(text).toContain("ref 88213");
  });

  it("Heavy is untouched: the amount goes via the Dollar Amounts rule, the reference via the model", async () => {
    const { text, by } = await run(3);
    expect(by("$1,250.00")).toBe("Dollar Amounts"); // regex (20) outranks the model span (15)
    expect(by("88213")).toBe("NER:account number"); // no numeric keeps at Heavy -> the model is taken at its word
    expect(text).not.toContain("$1,250.00");
  });

  const ok = (text: string, sub: string, label: string, labels?: GlinerLabel[]) => plausibleId(text, span(text, sub, label, labels));

  it("rejects a card/account label on an amount or on too short a number", () => {
    expect(ok("the amount of $1,250.00 with", "$1,250.00", "credit card")).toBe(false);
    expect(ok("the amount of $1,250.00 with", "1,250.00", "credit card")).toBe(false); // symbol just outside the span
    expect(ok("balance $1,234,567.89 today", "$1,234,567.89", "account number")).toBe(false); // enough digits, still an amount
    expect(ok("balance $(1,234,567.89) today", "1,234,567.89", "bank account")).toBe(false); // accounting negative
    expect(ok("MARCUS ref 88213", "88213", "account number")).toBe(false);
    expect(ok("MARCUS ref 88213", "88213", "bank account")).toBe(false);
    expect(ok("code 4111 1111 today", "4111 1111", "credit card")).toBe(false); // 8 digits: an account maybe, never a card
  });

  it("accepts plausible IDs, including shapes the built-in rules miss", () => {
    expect(ok("Amex 3782 822463 10005 on file", "3782 822463 10005", "credit card")).toBe(true); // 15 digits, not 4-4-4-4
    expect(ok("paid from 000123456789 today", "000123456789", "account number")).toBe(true); // no "account" keyword nearby
    expect(ok("12345678 $50.00", "12345678", "bank account")).toBe(true); // a symbol AFTER the number is the next column
  });

  it("never second-guesses a span with letters, or a name/address label (recall first)", () => {
    expect(ok("card XXXX-XXXX-XXXX-1234", "XXXX-XXXX-XXXX-1234", "credit card")).toBe(true); // masked: 4 digits
    expect(ok("brokerage U1234567", "U1234567", "account number")).toBe(true); // alphanumeric: 7 digits
    expect(ok("lives at 742 Evergreen Terrace", "742", "location street")).toBe(true);
    expect(ok("owes $5 Bill", "$5 Bill", "name")).toBe(true);
  });

  it("covers the multi-PII model's labels the same way (keyed by Faker kind, not label name)", () => {
    const multi = labelsOf("gliner-multi-pii");
    expect(ok("Betrag €1.250,00 fällig", "€1.250,00", "credit card number", multi)).toBe(false);
    expect(ok("Referenz 88213", "88213", "bank account number", multi)).toBe(false);
    expect(ok("Konto 1234567890", "1234567890", "bank account number", multi)).toBe(true);
    expect(ok("Karte 4111 1111 1111 1111", "4111 1111 1111 1111", "credit card number", multi)).toBe(true);
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
