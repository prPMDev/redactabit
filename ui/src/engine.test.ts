// Safety net for the TS engine. The 167 tests in tests/test_engine.py cover the
// Python engine (redactabit.py), NOT this port — so this guards the Detector refactor.
// Fake VALUES differ from Python (different PRNG), so we assert detection + behavior,
// never exact fake strings.
import { describe, it, expect } from "vitest";
import { redact, redactAsync, Faker, type Detector } from "./engine";

const patterns = (text: string, level = 2, custom: string[] = []): Set<string> =>
  new Set(redact(text, level, "fake", custom).changes.map((c) => c.pattern));
const textOut = (text: string, level = 2, mode: "fake" | "mask" | "redact" = "fake", custom: string[] = []): string =>
  redact(text, level, mode, custom, new Faker("test")).text;

describe("pattern detection (floor)", () => {
  it("SSN", () => expect(patterns("SSN: 123-45-6789", 1)).toContain("SSN"));
  it("ITIN", () => expect(patterns("ITIN: 912-70-1234", 1)).toContain("ITIN"));
  it("email", () => expect(patterns("reach me at a@b.com", 2)).toContain("Email"));
  it("credit card", () => expect(patterns("4532 7711 8890 1234", 1)).toContain("Credit Card"));
  it("labeled bank account", () => expect(patterns("Account: 12345678", 1)).toContain("Bank Account"));
});

describe("overlap resolution", () => {
  it("ITIN wins over SSN on 9XX numbers", () => {
    const p = patterns("Number: 912-70-1234", 1);
    expect(p).toContain("ITIN");
    expect(p).not.toContain("SSN");
  });
});

describe("level gating", () => {
  it("street address inactive at level 1", () =>
    expect(patterns("123 Main Street", 1)).not.toContain("Street Address"));
  it("street address active at level 2", () =>
    expect(patterns("123 Main Street", 2)).toContain("Street Address"));
});

describe("modes", () => {
  it("redact mode uses a uniform, type-free [REDACTED]", () =>
    expect(textOut("SSN: 123-45-6789", 1, "redact")).toContain("[REDACTED]"));
  it("mask mode reveals the last 4", () =>
    expect(textOut("SSN: 123-45-6789", 1, "mask")).toContain("6789"));
  it("fake mode removes the original value", () =>
    expect(textOut("SSN: 123-45-6789", 1, "fake")).not.toContain("123-45-6789"));
});

describe("custom terms", () => {
  it("redacts a user term at any level", () =>
    expect(textOut("Invoice from Acme Corp", 1, "fake", ["Acme Corp"])).not.toContain("Acme Corp"));
});

describe("determinism", () => {
  it("same input + same seed = same output", () => {
    const a = redact("SSN 123-45-6789, a@b.com", 2, "fake", [], new Faker("seed")).text;
    const b = redact("SSN 123-45-6789, a@b.com", 2, "fake", [], new Faker("seed")).text;
    expect(a).toBe(b);
  });
});

describe("single-pass integrity", () => {
  it("the original is gone and matched exactly once", () => {
    const r = redact("SSN: 123-45-6789", 1, "fake", [], new Faker("seed"));
    expect(r.text).not.toContain("123-45-6789");
    expect(r.changes.filter((c) => c.pattern === "SSN").length).toBe(1);
  });
});

describe("detector pipeline (Phase A)", () => {
  it("redactAsync with no extra detectors == sync redact", async () => {
    const text = "SSN 123-45-6789, Account: 12345678, a@b.com";
    const sync = redact(text, 2, "fake", [], new Faker("seed")).text;
    const asyncText = (await redactAsync(text, 2, "fake", [], new Faker("seed"))).text;
    expect(asyncText).toBe(sync);
  });

  it("an extra (model-like) detector adds low-priority spans", async () => {
    const fakeModel: Detector = {
      name: "model",
      ready: () => true,
      detect: (t) => {
        const i = t.indexOf("Marcus");
        return i < 0 ? [] : [{ start: i, end: i + "Marcus".length, label: "Person", priority: 15, fake: "name", mask: null, tag: "[NAME REDACTED]" }];
      },
    };
    const r = await redactAsync("Dear Marcus", 2, "redact", [], new Faker("seed"), [fakeModel]);
    expect(r.text).toContain("[REDACTED]");
    expect(r.text).not.toContain("Marcus");
  });

  it("regex wins overlaps against a lower-priority model span", async () => {
    const greedyModel: Detector = {
      name: "model",
      ready: () => true,
      detect: (t) => [{ start: 0, end: t.length, label: "Person", priority: 15, fake: "name", mask: null, tag: "[NAME REDACTED]" }],
    };
    const r = await redactAsync("123-45-6789", 1, "redact", [], new Faker("seed"), [greedyModel]);
    expect(r.text).toBe("[REDACTED]"); // regex SSN (90) beats the model span (15) — uniform marker
  });
});

describe("mask + fake format invariants (TS-port parity)", () => {
  it("mask reveals the last 4 of a card", () =>
    expect(textOut("Card 4111-1111-1111-1111", 1, "mask")).toContain("XXXX-XXXX-XXXX-1111"));
  it("mask reduces an email to initial + domain", () =>
    expect(textOut("reach john@example.com", 2, "mask")).toContain("j***@example.com"));
  it("mask of a custom term initials the name", () =>
    expect(textOut("hi Mary Jane Watson", 1, "mask", ["Mary Jane Watson"])).toContain("M. J. W."));
  it("fake SSN uses the unissued 800–899 range (never a real SSN)", () =>
    expect(redact("SSN: 123-45-6789", 1, "fake", [], new Faker("x")).text).toMatch(/\b8\d{2}-\d{2}-\d{4}\b/));
  it("fake amount stays within 0.4×–1.6× of the original", () => {
    const v = parseFloat(new Faker("x").amount("$1,000.00").replace(/[^\d.]/g, ""));
    expect(v).toBeGreaterThanOrEqual(400);
    expect(v).toBeLessThanOrEqual(1600);
  });
});

describe("street-address guard parity (the precision fix)", () => {
  it("does not span a newline into an ALL-CAPS header", () =>
    expect(patterns("Mobile: +44 20 7946 0958\n\nCONTACT\n  Phone: (415) 555-0188", 2)).not.toContain("Street Address"));
  it("an ALL-CAPS word is not a street", () => {
    expect(patterns("5 CONTACT", 2)).not.toContain("Street Address");
    expect(patterns("12 EXIT", 2)).not.toContain("Street Address");
  });
  it("clean addresses still match", () => {
    for (const t of ["88 Maple Avenue", "123 Main Street", "5 Oak Ct", "742 Evergreen Terrace", "9 Skyline Pkwy"]) {
      expect(patterns(t, 2)).toContain("Street Address");
    }
  });
  it("ALL-CAPS mail blocks match (statements shout addresses)", () => {
    for (const t of ["742 EVERGREEN TERRACE", "1847 WESTFIELD AVENUE", "988 LAKESHORE DR"]) {
      expect(patterns(t, 2)).toContain("Street Address");
    }
  });
  it("caps prose still does not pose as a street", () => {
    expect(patterns("0958\n\nCONTACT", 2)).not.toContain("Street Address");
    expect(patterns("SOLD 500 SHARES TOTAL PROCEEDS", 2)).not.toContain("Street Address");
  });
  it("city/state/zip lines match in both casings at Standard", () => {
    for (const t of ["Springfield, IL 62704", "Columbus, OH 43215-1101", "SPRINGFIELD IL 62704"]) {
      expect(patterns(t, 2)).toContain("City/State ZIP");
    }
    expect(patterns("TOTAL VALUE 23,048.10", 2)).not.toContain("City/State ZIP");
  });
});

describe("regex boundary fixes", () => {
  it("Alien/USCIS no longer matches 'A-digits' inside a longer word, but legit still matches", () => {
    expect(patterns("invoice NAFTA-2018456 total", 1)).not.toContain("Alien/USCIS#");
    expect(patterns("Alien 123456789", 1)).toContain("Alien/USCIS#");
  });
});

describe("Bank Account label variants (the real-statement leak)", () => {
  it("matches 'Account Number:' / 'Account No.' / separator-formatted digits", () => {
    expect(patterns("Account Number: 123456789012", 1)).toContain("Bank Account");
    expect(patterns("Account No. 1234-5678-9012", 1)).toContain("Bank Account");
    expect(patterns("acct # 12345678", 1)).toContain("Bank Account"); // original form still works
  });
  it("does not match short or unlabeled digit runs", () => {
    expect(patterns("Account Number: 1234567", 1)).not.toContain("Bank Account"); // 7 digits, too short
    expect(patterns("total 123456789012", 1)).not.toContain("Bank Account"); // no label
  });
});

describe("Labeled ID (the Envelope # class)", () => {
  it("redacts '#'-labeled codes regardless of the label word", () => {
    expect(patterns("Envelope # BRTLRKBBBBGGL", 1)).toContain("Labeled ID");
    expect(patterns("Confirmation #: 8GH2-99XK", 1)).toContain("Labeled ID");
    expect(patterns("Reference #X7Q2M9R4", 1)).toContain("Labeled ID");
  });
  it("ignores short or prose tokens after '#'", () => {
    expect(patterns("Page # 12", 1)).not.toContain("Labeled ID");
    expect(patterns("ranked #1 fund", 1)).not.toContain("Labeled ID");
    expect(patterns("# Holdings overview", 1)).not.toContain("Labeled ID"); // lowercase prose
  });
  it("the fake is never the original value", () => {
    const r = redact("Envelope # BRTLRKBBBBGGL", 1, "fake");
    expect(r.text).not.toContain("BRTLRKBBBBGGL");
  });
});

describe("PAN (India)", () => {
  it("redacts a PAN (level 1) and the fake is not the original", () => {
    const r = redact("PAN: ABCDE1234F", 1, "fake");
    expect(r.changes.some((c) => c.pattern === "PAN (India)")).toBe(true);
    expect(r.text).not.toContain("ABCDE1234F");
  });
  it("does not match near-PAN shapes", () => {
    expect(patterns("HELLO12345", 1)).not.toContain("PAN (India)"); // 5 letters + 5 digits, no trailing letter
    expect(patterns("ABCD1234E", 1)).not.toContain("PAN (India)");  // only 4 leading letters
  });
});
