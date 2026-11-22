import { describe, expect, it } from "vitest";
import { pvpSub } from "../src/services/world-pvp-sub.js";
import { applyFailureText, classifyApplyFailure } from "../src/services/import-apply-failure.js";
import { goldText } from "../src/services/guild-bank.js";

// 22 Nov 2026 Discord audit: wording found on the live servers.
const en = (a: string) => a, fr = (_: string, b: string) => b;

describe("world PvP line on recap cards", () => {
  it("lists only what happened, so it fits the column", () => {
    expect(pvpSub({ kills: 3, defends: 0, helped: 0 }, fr)).toBe("3 victoires");
    expect(pvpSub({ kills: 1, defends: 2, helped: 1 }, en)).toBe("1 kill · 2 defends · 1 call answered");
    expect(pvpSub({ kills: 0, defends: 0, helped: 0 }, fr)).toBe("Aucun combat encore");
  });
});

describe("import failures in French officer logs", () => {
  it("translates the database reasons and keeps the code", () => {
    const failure = classifyApplyFailure(Object.assign(new Error("Transaction API error"), { code: "P2028" }));
    expect(applyFailureText(failure, "fr")).toBe("La base de données était occupée par d'autres envois et l'import a expiré (P2028).");
    expect(applyFailureText(failure, "en")).toBe(failure.message);
  });
  it("keeps the import's own rule text as written", () => {
    const failure = classifyApplyFailure(new Error("This upload has no characters."));
    expect(applyFailureText(failure, "fr")).toBe("This upload has no characters.");
  });
});

describe("gold amounts", () => {
  it("drop empty parts everywhere", () => {
    expect(goldText(5_000_000n)).toBe("500g");
    expect(goldText(1_254_000)).toBe("125g 40s");
    expect(goldText(1200)).toBe("12s");
    expect(goldText(0)).toBe("0c");
    expect(goldText(12_345_678_90n)).toBe("123,456g");
  });
});
