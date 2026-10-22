import { describe, expect, it } from "vitest";
import { assessRaidReadiness } from "../src/services/readiness.js";
import { buildReadinessLines, chunkLines } from "../src/services/readiness-board.js";

const now = new Date("2026-10-22T12:00:00Z");
const snapshot = { status: "READY", character: { name: "Espionne", level: 60 }, inspectedAt: now, findings: [] };

describe("raid eligibility is separate from the addon gear check", () => {
  it.each([1, 30, 59])("does not mark a level %i character raid ready", level => {
    expect(assessRaidReadiness({ ...snapshot, character: { level } }, now).status).toBe("LEVELLING");
  });
  it("requires a known level and a fresh, complete check", () => {
    expect(assessRaidReadiness(snapshot, now).status).toBe("READY");
    for (const level of [null, 0, NaN]) expect(assessRaidReadiness({ ...snapshot, character: { level } }, now).status).toBe("UNKNOWN");
    for (const offset of [-86400001, 300001]) {
      expect(assessRaidReadiness({ ...snapshot, inspectedAt: new Date(+now + offset) }, now).status).toBe("UNKNOWN");
    }
    expect(assessRaidReadiness({ ...snapshot, status: "UNKNOWN" }, now).status).toBe("UNKNOWN");
    expect(assessRaidReadiness({ ...snapshot, findings: [{ severity: "ERROR", message: "Broken gear" }] }, now).status).toBe("NOT_READY");
  });
  it("groups levelling characters separately and suppresses obsolete gear errors for them", async () => {
    const checks = [
      { ...snapshot, character: { name: "Espionne", level: 30 } },
      { ...snapshot, status: "NOT_READY", character: { name: "Highpriest", level: 25 }, findings: [{ severity: "ERROR", message: "Missing Head equipment." }] },
      { ...snapshot, character: { name: "Oldcheck", level: 60 }, inspectedAt: new Date(+now - 86400001) }
    ];
    const db = { member: { findMany: async () => checks.map((_, i) => ({ id: i, displayName: String(i) })) }, inspectedCharacterSnapshot: { findFirst: async ({ where }: { where: { memberId: number } }) => checks[where.memberId] } };
    const lines = await buildReadinessLines(db as never, "guild", { now });
    expect(lines[0]).toBe("**0 gear ready · 0 need attention · 2 levelling · 1 need sync**");
    const text = lines.join("\n");
    expect(text).toContain("Level 30/60 — 30 levels to go");
    expect(text).toContain("Levelling — not raid eligible (2)");
    expect(text).not.toContain("Missing Head");
    expect(text).toContain("expire after 24 hours");
  });
  it("keeps all content when a single member block exceeds a message", () => {
    const long = "x".repeat(4500);
    const chunks = chunkLines([long], 1900);
    expect(chunks.join("")).toBe(long);
    expect(chunks.every(chunk => chunk.length <= 1900)).toBe(true);
  });
});
