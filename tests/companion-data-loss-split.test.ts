import { describe, expect, it } from "vitest";
import { splitExport, chunkRows, SPLIT_MAX_BYTES } from "../companion/upload-split.mjs";
import { pruneAcknowledged, acknowledgements } from "../companion/delta.mjs";
import { exportMilestones, exportDuelResults } from "../companion/lua-export-content.mjs";

type Part = { label: string; export: { dungeonRuns?: unknown[]; characters?: unknown[]; milestones?: unknown[]; epgpTransactions?: unknown[]; recipes?: unknown[]; recipeNames?: Record<string, string> } };
const split = splitExport as (exported: unknown) => Part[];
const base = { source: "Guilded", gameEdition: "forever", exportedAt: "2026-11-19T00:00:00Z", addonVersion: "9.4.1", transactions: [], epgpTransactions: [], raids: [], loot: [] };
const runs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, state: "COMPLETED" }));

describe("splitExport", () => {
  it("leaves a small export as one request", () => {
    const parts = split({ ...base, dungeonRuns: runs(10) });
    expect(parts).toHaveLength(1);
  });
  it("caps runs and characters at 400 per request and sends the roster part first", () => {
    const characters = Array.from({ length: 950 }, (_, i) => ({ name: `c${i}` }));
    const parts = split({ ...base, characters, dungeonRuns: runs(1000), epgpTransactions: [{ a: 1 }] });
    expect(parts[0]!.label).toBe("roster and ledger");
    expect(parts[0]!.export.epgpTransactions).toHaveLength(1);
    expect(parts[0]!.export.dungeonRuns).toBeUndefined();
    for (const part of parts) {
      expect((part.export.dungeonRuns ?? []).length).toBeLessThanOrEqual(400);
      expect((part.export.characters ?? []).length).toBeLessThanOrEqual(400);
      expect(JSON.stringify(part.export).length).toBeLessThan(SPLIT_MAX_BYTES);
    }
    expect(parts.flatMap((p) => p.export.dungeonRuns ?? [])).toHaveLength(1000);
    expect(parts.flatMap((p: Part) => p.export.characters ?? [])).toHaveLength(950);
  });
  it("splits by bytes and keeps every milestone", () => {
    const milestones = Array.from({ length: 3000 }, (_, i) => ({ character: "x", ref: `ach:${i}`, label: "y".repeat(400) }));
    const parts = split({ ...base, milestones });
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.flatMap((p: Part) => p.export.milestones ?? [])).toHaveLength(3000);
    for (const part of parts.slice(1)) expect(JSON.stringify(part.export).length).toBeLessThan(SPLIT_MAX_BYTES);
  });
  it("sends each recipe request with only its own names", () => {
    const recipes = Array.from({ length: 900 }, (_, i) => ({ character: `c${i}`, profession: "Cooking", keys: [i + 1] }));
    const recipeNames = Object.fromEntries(recipes.map((r) => [String(r.keys[0]), `n${r.keys[0]}`]));
    const parts = split({ ...base, recipes, recipeNames });
    const sets = parts.filter((p: Part) => p.export.recipes);
    expect(sets.every((p: Part) => (p.export.recipes ?? []).length <= 400)).toBe(true);
    expect(Object.keys(sets[0]!.export.recipeNames ?? {})).toHaveLength((sets[0]!.export.recipes ?? []).length);
  });
  it("chunkRows puts an oversized row alone", () => {
    expect(chunkRows([{ a: "x".repeat(100) }, { a: "y" }], 10, 50)).toHaveLength(2);
  });
});

describe("exports are not truncated", () => {
  it("exports every duel and milestone", () => {
    const results: Record<string, unknown> = {};
    for (let i = 0; i < 700; i++) results[String(i)] = { winner: "A", loser: "B", at: 1_700_000_000 + i, reason: "knockout" };
    expect(exportDuelResults({ duels: { results } })).toHaveLength(700);
    const log: Record<string, unknown> = {};
    for (let i = 0; i < 900; i++) log[String(i)] = { kind: "level", ref: `level:${i}`, value: i, at: 1_700_000_000 + i };
    expect(exportMilestones({ milestones: { chars: { a: { name: "A", log } } } })).toHaveLength(900);
  });
});

describe("pruneKnownRuns keeps full copies until sent", () => {
  const full = { id: "r1", state: "COMPLETED", deathPoints: [{ x: 0.1, y: 0.1, map: 1 }] };
  const thin = { id: "r2", state: "COMPLETED" };
  const ack = { ...acknowledgements({ personal: { acceptedRunRefs: ["r1", "r2"] } }), carry: new Set() };
  it("prunes a thin run, not an unsent full one", () => {
    const { exported } = pruneAcknowledged({ dungeonRuns: [full, thin] }, ack, new Set(), Date.now(), { resendRuns: false });
    expect(exported.dungeonRuns.map((r: { id: string }) => r.id)).toEqual(["r1"]);
  });
  it("prunes the full run once this companion sent it", () => {
    const { exported } = pruneAcknowledged({ dungeonRuns: [full, thin] }, ack, new Set(), Date.now(), { resendRuns: false, fullSent: new Set(["r1"]) });
    expect(exported.dungeonRuns).toHaveLength(0);
  });
});
