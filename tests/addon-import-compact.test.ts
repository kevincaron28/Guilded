import { describe, expect, it } from "vitest";
import { compactPayload } from "../src/services/addon-import.js";

describe("compactPayload", () => {
  it("keeps a summary and drops the raw rows", () => {
    const payload = { source: "Guilded", exportedAt: "2026-11-09T00:00:00.000Z", gameEdition: "forever", dungeonRuns: [{ id: "a" }, { id: "b" }], transactions: [], characters: [{ name: "X" }] };
    const compact = compactPayload(payload) as Record<string, unknown>;
    expect(compact).toEqual({ compacted: true, source: "Guilded", exportedAt: "2026-11-09T00:00:00.000Z", gameEdition: "forever", counts: { dungeonRuns: 2, characters: 1 } });
    expect(JSON.stringify(compact)).not.toContain('"id"');
  });
  it("copes with an unexpected payload", () => {
    expect(compactPayload(null)).toMatchObject({ compacted: true, counts: {} });
    expect(compactPayload({ exportedAt: new Date("2026-11-09T00:00:00Z") })).toMatchObject({ exportedAt: "2026-11-09T00:00:00.000Z" });
  });
});
