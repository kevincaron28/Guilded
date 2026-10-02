import { describe, expect, it } from "vitest";
import { looksLikeQuestion } from "../src/services/answers.js";
import {
  defaultFaqEntries,
  listUnanswered,
  looksLikePairingQuestion,
  looksLikePoe2Question,
  looksLikeSyncQuestion,
  newDefaultEntries,
  poe2Answer,
  recordUnanswered,
  suggestFaq,
} from "../src/services/faq-extras.js";

describe("faq upgrades", () => {
  it("recognises PoE2, pairing and sync questions", () => {
    expect(looksLikePoe2Question("how does the poe2 companion work?")).toBe(true);
    expect(looksLikePairingQuestion("how do I pair my character?")).toBe(true);
    expect(looksLikeSyncQuestion("why is my sync not updating?")).toBe(true);
    expect(poe2Answer("en").length).toBeGreaterThan(10);
  });

  it("defaults import is idempotent", () => {
    const defaults = defaultFaqEntries("en");
    expect(defaults.length).toBeGreaterThan(0);
    expect(newDefaultEntries(defaults, "en")).toHaveLength(0);
    expect(newDefaultEntries([], "en").length).toBe(defaults.length);
  });

  it("suggests an entry on a near match", () => {
    const entries = [{ triggers: ["companion"] }];
    expect(suggestFaq(entries, "companions")).toBe(entries[0]);
    expect(suggestFaq(entries, "zzzz")).toBeNull();
  });

  it("logs unanswered questions per guild", () => {
    recordUnanswered("g-test", "where is the thing?");
    expect(listUnanswered("g-test")).toContain("where is the thing?");
    expect(listUnanswered("other")).toEqual([]);
  });

  it("accepts topic keywords as questions", () => {
    expect(typeof looksLikeQuestion("poe2 companion", true)).toBe("boolean");
  });
});
