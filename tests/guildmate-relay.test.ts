import { describe, expect, it } from "vitest";
import { applyGuildmateRelay, relayableDungeonRuns, RELAYED_RUNS_PER_UPLOAD } from "../src/services/guildmate-relay.js";
import { personalSnapshot } from "../src/services/companion-access.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { parseAddonExportText } from "../companion/lua-export-content.mjs";

// Track K (8.5): a paired member's upload relays guildmates' self-reported digests and witnessed
// dungeon runs, without ever linking characters or replacing newer first-hand data.

const NOW = new Date("2026-12-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

interface Row { id: string; name: string; realm: string; memberId: string; gameEdition: string; level: number | null; className: string; race: string | null; professionsUpdatedAt: Date | null; relayedAt?: Date; relayedById?: string }

function fakeDatabase(rows: Row[]) {
  const skills: { characterId: string; profession: string; skillLevel: number }[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const tx = {
    character: {
      findMany: async () => rows.map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        Object.assign(rows.find((row) => row.id === where.id)!, data);
        return rows.find((row) => row.id === where.id);
      },
      create: async () => { throw new Error("the relay must never create a character"); }
    },
    professionSkill: {
      deleteMany: async ({ where }: { where: { characterId: string; profession: { notIn: string[] } } }) => {
        for (let i = skills.length - 1; i >= 0; i--) if (skills[i]!.characterId === where.characterId && !where.profession.notIn.includes(skills[i]!.profession)) skills.splice(i, 1);
      },
      upsert: async ({ create }: { create: { characterId: string; profession: string; skillLevel: number } }) => {
        const existing = skills.find((skill) => skill.characterId === create.characterId && skill.profession === create.profession);
        if (existing) existing.skillLevel = create.skillLevel; else skills.push({ ...create });
      }
    },
    recipeKnown: { deleteMany: async () => ({ count: 0 }) },
    professionCooldown: { deleteMany: async () => ({ count: 0 }) }
  };
  const database = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
  return { database: database as never, rows, skills, updates };
}

const linked = (overrides: Partial<Row> = {}): Row => ({ id: "c1", name: "Lebowski", realm: "Realm", memberId: "m-dude", gameEdition: "forever",
  level: 20, className: "WARRIOR", race: "Human", professionsUpdatedAt: new Date("2026-12-01T00:00:00Z"), ...overrides });

function snapshot(characters: Record<string, unknown>[]) {
  return parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", characters });
}
const heard = (overrides: Record<string, unknown> = {}) => ({ name: "Lebowski", realm: "Realm", class: "WARRIOR", race: "Human", level: 24,
  observedAt: "2026-12-20T10:00:00Z", professionsComplete: true, professionsAt: "2026-12-19T00:00:00Z",
  professions: [{ name: "Mining", skillLevel: 120 }], ...overrides });

describe("guildmate relay: characters", () => {
  it("raises the level and replaces older professions of a linked guildmate, stamped with who relayed it", async () => {
    const db = fakeDatabase([linked()]);
    const result = await applyGuildmateRelay(db.database, "g", "m-walter", snapshot([heard()]), NOW);
    expect(result).toEqual({ updated: 1, professions: 1, unlinked: 0, ignored: 0 });
    expect(db.rows[0]).toMatchObject({ level: 24, relayedAt: NOW, relayedById: "m-walter", professionsUpdatedAt: new Date("2026-12-19T00:00:00Z") });
    expect(db.skills).toEqual([{ characterId: "c1", profession: "Mining", skillLevel: 120 }]);
  });

  it("never lowers a level and never replaces newer first-hand professions", async () => {
    const db = fakeDatabase([linked({ level: 30, professionsUpdatedAt: new Date("2026-12-20T09:00:00Z") })]);
    const result = await applyGuildmateRelay(db.database, "g", "m-walter", snapshot([heard({ level: 24 })]), NOW);
    expect(result).toEqual({ updated: 0, professions: 0, unlinked: 0, ignored: 1 });
    expect(db.updates).toEqual([]);
    expect(db.skills).toEqual([]);
  });

  it("never links or creates an unlinked guildmate, and leaves the uploader's own characters to their own upload", async () => {
    const db = fakeDatabase([linked({ memberId: "m-walter" })]);
    const result = await applyGuildmateRelay(db.database, "g", "m-walter", snapshot([heard(), heard({ name: "Donny" })]), NOW);
    expect(result).toEqual({ updated: 0, professions: 0, unlinked: 1, ignored: 1 });
    expect(db.updates).toEqual([]);
  });

  it("ignores digests with no time heard, stale ones and ones from the future", async () => {
    const db = fakeDatabase([linked()]);
    const result = await applyGuildmateRelay(db.database, "g", "m-walter", snapshot([
      heard({ observedAt: undefined }),
      heard({ observedAt: "2026-10-01T00:00:00Z" }),
      heard({ observedAt: "2026-12-21T12:00:00Z" })
    ]), NOW);
    expect(result).toEqual({ updated: 0, professions: 0, unlinked: 0, ignored: 2 });
    expect(db.updates).toEqual([]);
  });

  it("an incomplete profession list never replaces anything", async () => {
    const db = fakeDatabase([linked({ level: 24 })]);
    const result = await applyGuildmateRelay(db.database, "g", "m-walter", snapshot([heard({ professionsComplete: false })]), NOW);
    expect(result.professions).toBe(0);
    expect(db.skills).toEqual([]);
  });
});

describe("guildmate relay: dungeon runs", () => {
  const run = (overrides: Record<string, unknown> = {}) => ({ id: "QG-1", endedAt: nowSec - 3600,
    players: [{ character: "Lebowski", realm: "Realm" }, { character: "Donny", realm: "Realm" }], ...overrides });
  const owned = new Set(["walter"]);

  it("keeps runs the uploader played and runs reported by someone who played them", () => {
    const mine = run({ id: "mine", players: [{ character: "Walter", realm: "Realm" }] });
    const witnessed = run({ id: "witnessed", reporterNames: ["Lebowski"] });
    expect(relayableDungeonRuns([mine, witnessed], owned, nowSec).map((r) => (r as { id: string }).id)).toEqual(["mine", "witnessed"]);
  });

  it("drops runs nobody in them reported, old runs and runs from the future", () => {
    const runs = [
      run({ id: "unwitnessed" }),
      run({ id: "stranger", reporterNames: ["Maude"] }),
      run({ id: "old", reporterNames: ["Lebowski"], endedAt: nowSec - 40 * 86400 }),
      run({ id: "future", reporterNames: ["Lebowski"], endedAt: nowSec + 3600 }),
      { forged: true }
    ];
    expect(relayableDungeonRuns(runs, owned, nowSec)).toEqual([]);
  });

  it("caps a member's upload to the newest runs", () => {
    const runs = Array.from({ length: RELAYED_RUNS_PER_UPLOAD + 5 }, (_, i) => run({ id: `r${i}`, reporterNames: ["Donny"], endedAt: nowSec - 60 * i }));
    const kept = relayableDungeonRuns(runs, owned, nowSec);
    expect(kept).toHaveLength(RELAYED_RUNS_PER_UPLOAD);
    expect((kept[0] as { id: string }).id).toBe("r0");
  });

  it("a member's upload now carries witnessed runs but still no ledger, prices or other players' readiness", () => {
    const parsed = parseAddonSnapshot({ source: "Guilded", exportedAt: new Date(), gameEdition: "forever",
      epgpTransactions: [{ character: "Walter", realm: "Realm", epAmount: 999, type: "EP_AWARD", reason: "forged" }],
      readiness: [{ character: "Walter", realm: "Realm" }, { character: "Donny", realm: "Realm" }],
      dungeonRuns: [run({ id: "witnessed", reporterNames: ["Donny"], endedAt: Math.floor(Date.now() / 1000) - 60 }), run({ id: "unwitnessed", endedAt: Math.floor(Date.now() / 1000) - 60 })] });
    const result = personalSnapshot(parsed, [{ name: "Walter", realm: "Realm" }]);
    expect(result.dungeonRuns.map((r) => (r as { id: string }).id)).toEqual(["witnessed"]);
    expect(result.epgpTransactions).toEqual([]);
    expect(result.readiness.map((r) => r.character)).toEqual(["Walter"]);
    expect(result.characters).toEqual([]);
  });
});

describe("companion export provenance", () => {
  it("says when the uploader's addon heard each guildmate's digest", () => {
    const lua = `GuildedDB = { character = { name = "Walter", realm = "Realm", class = "WARRIOR", gameEdition = "forever" },
      peerRoster = { ["Lebowski"] = { identity = { class = "WARRIOR", race = "Human", level = 24, spec = "" }, professions = "Mining:120",
        professionsComplete = true, professionsAt = 1797000000, seenAt = 1797001000, updatedAt = "2026-12-20T10:00:00Z" } } }`;
    const exported = parseAddonExportText(lua, "Realm") as { characters: { name: string; observedAt?: string; level: number }[] };
    const lebowski = exported.characters.find((c) => c.name === "Lebowski");
    expect(lebowski).toMatchObject({ level: 24, observedAt: new Date(1797001000 * 1000).toISOString() });
    expect(snapshot([lebowski!]).characters[0]!.observedAt).toEqual(new Date(1797001000 * 1000));
  });
});
