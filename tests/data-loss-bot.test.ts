import { describe, expect, it, vi } from "vitest";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { applyDiscoveredCharacters } from "../src/services/roster-discovery.js";
import { syncProfessionSnapshot } from "../src/services/profession-snapshot.js";
import { resolveDuelNames, characterKey } from "../src/services/duel-global.js";
import { mergeCopies } from "../src/services/public-run-merge.js";
import { enrichStoredRun } from "../src/services/dungeon-import.js";

const at = 1_790_000_000;
const base = { source: "t", exportedAt: at } as Record<string, unknown>;

describe("upload limits and partial uploads", () => {
  it("accepts 5000 milestones and 5000 duels, 800 recipe sets, and a runs-only request", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ i }));
    const parsed = parseAddonSnapshot({ ...base, milestones: rows, duelResults: rows, externalDuels: rows });
    expect(parsed.milestones).toHaveLength(5000);
    const runsOnly = parseAddonSnapshot({ ...base, dungeonRuns: [{ id: "a" }] });
    expect(runsOnly.dungeonRuns).toHaveLength(1);
    expect(runsOnly.milestones).toEqual([]);
    expect(runsOnly.characters).toEqual([]);
    expect(runsOnly.guildInfo).toBeUndefined();
    expect(runsOnly.guildRoster).toBeUndefined();
  });
  it("keeps dungeonRuns at 500", () => {
    expect(() => parseAddonSnapshot({ ...base, dungeonRuns: Array.from({ length: 501 }, () => ({})) })).toThrow();
  });
});

describe("relayed digests never erase or rewind", () => {
  const old = new Date(Date.now() - 5 * 86_400_000);
  const entry = (extra: Record<string, unknown>) => ({ name: "Kev Caron", realm: "R", class: "Mage", race: "", level: 0, spec: "", professions: [], observedAt: old, ...extra }) as never;
  it("a linked character keeps its higher level and later last seen", async () => {
    const update = vi.fn();
    const tx = { character: { update, findUnique: vi.fn(async () => ({ professionsUpdatedAt: null })) }, unclaimedCharacter: { findMany: vi.fn(async () => []) }, professionSkill: { findMany: vi.fn(async () => []), upsert: vi.fn(), deleteMany: vi.fn() }, recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() } };
    const linked = [{ id: "c1", name: "Kev Caron", realm: "R", level: 40, lastSeenAt: new Date() }];
    await applyDiscoveredCharacters(tx as never, "g", [entry({ level: 30, spec: "Fire" })], linked as never);
    const data = update.mock.calls[0]?.[0]?.data ?? {};
    expect(data.level).toBeUndefined();
    expect(data.lastSeenAt).toBeUndefined();
    expect(data.spec).toBe("Fire");
  });
  it("a linked character's last seen is the digest's own time, forward only", async () => {
    const update = vi.fn();
    const tx = { character: { update, findUnique: vi.fn(async () => ({ professionsUpdatedAt: null })) }, unclaimedCharacter: { findMany: vi.fn(async () => []) }, professionSkill: { findMany: vi.fn(async () => []), upsert: vi.fn(), deleteMany: vi.fn() }, recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() } };
    const linked = [{ id: "c1", name: "Kev Caron", realm: "R", level: 10, lastSeenAt: new Date(old.getTime() - 86_400_000) }];
    await applyDiscoveredCharacters(tx as never, "g", [entry({ level: 12 })], linked as never);
    const data = update.mock.calls[0]![0].data;
    expect(data.level).toBe(12);
    expect(data.lastSeenAt).toEqual(old);
  });
  it("an unclaimed character keeps race, level and spec a poorer digest lacks", async () => {
    const upsert = vi.fn();
    const stored = { id: "u1", nameKey: "kev caron", professionsUpdatedAt: null, lastSeenAt: new Date(), className: "Mage", race: "Human", level: 33, spec: "Frost", displayName: null, guildRankName: null };
    const tx = { character: { update: vi.fn() }, unclaimedCharacter: { findMany: vi.fn(async () => [stored]), upsert, updateMany: vi.fn() } };
    await applyDiscoveredCharacters(tx as never, "g", [entry({ level: 20 })], [] as never);
    const update = upsert.mock.calls[0]![0].update;
    for (const key of ["race", "level", "spec", "professions", "lastSeenAt"]) expect(update).not.toHaveProperty(key);
  });
  it("skill levels only go up from an incomplete report", async () => {
    const upsert = vi.fn();
    const db = { character: { findUnique: vi.fn(async () => ({ professionsUpdatedAt: null })), update: vi.fn() },
      professionSkill: { findMany: vi.fn(async () => [{ profession: "Mining", skillLevel: 250 }]), deleteMany: vi.fn(), upsert }, recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() } };
    await syncProfessionSnapshot(db as never, "g", { id: "c", name: "R", realm: "x" }, [{ name: "Mining", skillLevel: 200 }], false, new Date());
    expect(upsert.mock.calls[0]![0].update).toEqual({ skillLevel: 250 });
  });
});

describe("duel ladder names", () => {
  it("a bare first name resolves to the single full name, doubled names included, ambiguity stays", () => {
    const m = resolveDuelNames([{ name: "Kev", realm: "R" }, { name: "Kev Caron", realm: "R" }, { name: "Xaldin", realm: "R" }, { name: "Al", realm: "R" }], ["Xaldin Xaldin"]);
    expect(characterKey(m.get("kev|R")!, "R")).toBe(characterKey("Kev Caron", "R"));
    expect(m.get("xaldin|R")).toBe("Xaldin Xaldin");
    const amb = resolveDuelNames([{ name: "Al", realm: "R" }], ["Al One", "Al Two"]);
    expect(amb.get("al|R")).toBe("Al");
  });
});

describe("public run merge fills every field", () => {
  it("guild, faction, spec and deaths come from the other copy", () => {
    const player = (extra: Record<string, unknown>) => ({ character: "Kev Caron", realm: "R", className: "Mage", role: "dps", level: 60, ...extra });
    const run = (id: string, players: unknown[], confirmations: number) => ({ runId: id, gameEdition: "forever", instanceId: 1, difficultyId: 1, durationSec: 600, endedAt: new Date(1_000_000), confirmations, players, evidence: undefined, deaths: null }) as never;
    const out = mergeCopies([run("a", [player({})], 2), run("b", [player({ guild: "Gold", faction: "ALLIANCE", spec: "Fire", deaths: 3 })], 1)]);
    const p = (out[0] as unknown as { players: Record<string, unknown>[] }).players[0]!;
    expect(p).toMatchObject({ guild: "Gold", faction: "ALLIANCE", spec: "Fire", deaths: 3 });
  });
});

describe("a later report enriches a stored run", () => {
  it("fills gaps and never overwrites a value with null", async () => {
    const update = vi.fn();
    const stored = { id: "r1", competitionData: { players: [{ name: "Kev Caron", level: null, minLevel: 58, integrity: 1 }], encounters: [] },
      players: [{ id: "p1", character: "Kev Caron", class: null, role: "DPS", deaths: 1, inGuild: false, guild: null }] };
    const run = { deathPoints: [{ map: 1, x: 0.5, y: 0.5 }], challenge: { level: 3 }, players: [{ character: "Kev Caron", realm: "R", level: 60, minLevel: null, spec: "Fire", faction: "ALLIANCE", class: "MAGE", role: undefined, deaths: 4, inGuild: true, guild: "Gold" }] };
    const changed = await enrichStoredRun({ dungeonRun: { update } } as never, stored, run as never);
    expect(changed).toBe(true);
    const cd = update.mock.calls[0]![0].data.competitionData;
    expect(cd.deathPoints).toHaveLength(1);
    expect(cd.challenge).toEqual({ level: 3 });
    expect(cd.players[0]).toMatchObject({ level: 60, minLevel: 58, spec: "Fire", faction: "ALLIANCE" });
    const rowUpdate = update.mock.calls[1]![0].data.players.update.data;
    expect(rowUpdate).toMatchObject({ guild: "Gold", class: "MAGE", deaths: 4, inGuild: true });
    expect(rowUpdate).not.toHaveProperty("role");
  });
});

import { deviceUploadSchema } from "../src/services/companion-device.js";
describe("device upload carries more", () => {
  it("accepts spec, professions and external duels but ignores rank", () => {
    const out = deviceUploadSchema.parse({ characters: [{ name: "Kev Caron", realm: "R", spec: "Fire", professions: [{ name: "Mining", skillLevel: 100 }], guildRankName: "GM" }], externalDuels: [{ a: 1 }] });
    expect(out.characters[0]).toMatchObject({ spec: "Fire" });
    expect(out.characters[0]).not.toHaveProperty("guildRankName");
    expect(out.externalDuels).toHaveLength(1);
  });
});
