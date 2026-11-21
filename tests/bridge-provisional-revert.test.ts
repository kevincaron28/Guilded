import { describe, expect, it } from "vitest";
import { CHARACTER_HISTORY, MEMBER_ID_COLUMNS, revertProvisionalBridgeLinks } from "../src/services/bridge-provisional-revert.js";

type Row = Record<string, unknown>;
const since = new Date("2026-11-20T00:00:00Z");
const junkAt = new Date("2026-11-20T00:08:00Z");

// A small in-memory database: every model the revert touches, equality filters only (plus `in` and `gte`).
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const model of new Set([...MEMBER_ID_COLUMNS.map((c) => c.model), ...CHARACTER_HISTORY, "guild", "member", "unclaimedCharacter", "professionSkill"])) tables[model] = [];
  for (const [model, rows] of Object.entries(seed)) tables[model] = rows.map((row) => ({ ...row }));
  const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([key, want]) => {
    if (want && typeof want === "object" && !(want instanceof Date)) {
      const w = want as { in?: unknown[]; gte?: Date };
      if (w.in) return w.in.includes(row[key]);
      if (w.gte) return (row[key] as Date) >= w.gte;
    }
    return row[key] === want;
  });
  const api = (model: string) => ({
    count: async ({ where }: { where: Row }) => tables[model]!.filter((row) => matches(row, where)).length,
    findFirst: async ({ where }: { where: Row }) => tables[model]!.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where, include }: { where: Row; include?: Row }) => tables[model]!.filter((row) => matches(row, where)).map((row) =>
      include?.["professions"] ? { ...row, professions: tables["professionSkill"]!.filter((p) => p["characterId"] === row["id"]) } : row),
    findUnique: async ({ where }: { where: Row }) => {
      const flat = (where["guildId_nameKey"] as Row | undefined) ?? where;
      return tables[model]!.find((row) => matches(row, flat)) ?? null;
    },
    create: async ({ data }: { data: Row }) => { const row = { id: `${model}-${tables[model]!.length + 1}`, ...data }; tables[model]!.push(row); return row; },
    delete: async ({ where }: { where: Row }) => {
      const i = tables[model]!.findIndex((row) => matches(row, where));
      const [row] = tables[model]!.splice(i, 1);
      if (model === "character") tables["professionSkill"] = tables["professionSkill"]!.filter((p) => p["characterId"] !== row!["id"]); // cascade
      return row;
    },
    deleteMany: async ({ where }: { where: Row }) => { const before = tables[model]!.length; tables[model] = tables[model]!.filter((row) => !matches(row, where)); return { count: before - tables[model]!.length }; },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const rows = tables[model]!.filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; }
  });
  const database: Record<string, unknown> = { tables };
  for (const model of Object.keys(tables)) database[model] = api(model);
  database["$transaction"] = async (fn: (tx: unknown) => Promise<unknown>) => fn(database);
  return database as { tables: Record<string, Row[]> } & Record<string, never>;
}

const character = (id: string, memberId: string, name: string, extra: Row = {}): Row => ({
  id, memberId, guildId: "g1", name, displayName: name, legacyName: null, realm: "Forever", className: "Priest", race: "Human", level: 23, spec: null,
  gameEdition: "forever", lastSeenAt: new Date("2026-11-19T22:00:00Z"), professionsUpdatedAt: new Date("2026-11-19T21:00:00Z"),
  guildRankName: "Initiate", guildRankAt: new Date("2026-11-19T20:00:00Z"), linkEvidence: "game", createdAt: junkAt, ...extra
});

function world() {
  return fakeDb({
    guild: [{ id: "g1", discordId: "d1", scopeKey: "default" }],
    member: [
      { id: "junk", guildId: "g1", discordUserId: "p1", displayName: "Mister Haragot", createdAt: junkAt },
      { id: "real", guildId: "g1", discordUserId: "u1", displayName: "Kev", createdAt: new Date("2026-10-01T00:00:00Z") },
      { id: "busy", guildId: "g1", discordUserId: "p2", displayName: "Ana Belle", createdAt: junkAt }
    ],
    character: [
      character("c1", "junk", "Mister Haragot"),
      character("c2", "real", "Lebowski Holyroller", { createdAt: new Date("2026-10-02T00:00:00Z") }),
      character("c3", "busy", "Ana Belle")
    ],
    professionSkill: [{ id: "ps1", characterId: "c1", profession: "Cooking", skillLevel: 75 }],
    dungeonRunPlayer: [{ id: "r1", runId: "run1", character: "Mister Haragot", memberId: "junk" }],
    memberLinkNotice: [{ memberId: "junk", characterIds: "c1" }],
    pollVote: [{ id: "v1", memberId: "busy" }]
  });
}

describe("reverting the bridge links of provisional accounts", () => {
  it("dry run changes nothing and says what would happen", async () => {
    const database = world();
    const report = await revertProvisionalBridgeLinks(database as never, { guildDiscordId: "d1", provisionalIds: ["p1", "p2"], since, apply: false });
    expect(report.restored).toEqual(["Mister Haragot", "Ana Belle"]);
    expect(report.deletedMembers).toEqual(["Mister Haragot"]);
    expect(database.tables["character"]).toHaveLength(3);
    expect(database.tables["unclaimedCharacter"]).toHaveLength(0);
    expect(database.tables["member"]).toHaveLength(3);
  });

  it("a junk member with one character: the character is an unclaimed row again and the member is gone", async () => {
    const database = world();
    const report = await revertProvisionalBridgeLinks(database as never, { guildDiscordId: "d1", provisionalIds: ["p1"], since, apply: true });
    expect(report.restored).toEqual(["Mister Haragot"]);
    expect(database.tables["unclaimedCharacter"]).toEqual([expect.objectContaining({
      guildId: "g1", nameKey: "mister haragot", name: "Mister Haragot", displayName: "Mister Haragot", realm: "Forever", className: "Priest",
      race: "Human", level: 23, gameEdition: "forever", lastSeenAt: new Date("2026-11-19T22:00:00Z"), professionsUpdatedAt: new Date("2026-11-19T21:00:00Z"),
      guildRankName: "Initiate", guildRankAt: new Date("2026-11-19T20:00:00Z"), professions: [{ name: "Cooking", skillLevel: 75 }]
    })]);
    expect(database.tables["character"]!.map((c) => c["id"])).toEqual(["c2", "c3"]);
    expect(database.tables["professionSkill"]).toHaveLength(0);
    expect(database.tables["dungeonRunPlayer"]![0]!["memberId"]).toBeNull();
    expect(database.tables["memberLinkNotice"]).toHaveLength(0);
    expect(database.tables["member"]!.map((m) => m["id"])).toEqual(["real", "busy"]);
    expect(report.deletedMembers).toEqual(["Mister Haragot"]);
  });

  it("never touches a real member, even when its id is passed or its character is a game link", async () => {
    const database = world();
    database.tables["character"]![1]!["linkEvidence"] = "game";
    const report = await revertProvisionalBridgeLinks(database as never, { guildDiscordId: "d1", provisionalIds: ["u1"], since, apply: true });
    expect(report.members).toBe(0);
    expect(database.tables["character"]).toHaveLength(3);
    expect(database.tables["member"]).toHaveLength(3);
  });

  it("a member with extra rows is reported, not deleted; a character with history is kept", async () => {
    const database = world();
    database.tables["characterAttunement"]!.push({ id: "a1", characterId: "c1", name: "Onyxia" });
    const report = await revertProvisionalBridgeLinks(database as never, { guildDiscordId: "d1", provisionalIds: ["p1", "p2"], since, apply: true });
    expect(report.kept).toEqual([{ character: "Mister Haragot", why: "characterAttunement 1" }]);
    expect(report.restored).toEqual(["Ana Belle"]);
    expect(report.keptMembers).toEqual([{ member: "Mister Haragot", rows: ["character 1"] }, { member: "Ana Belle", rows: ["pollVote.memberId 1"] }]);
    expect(report.deletedMembers).toEqual([]);
    expect(database.tables["member"]).toHaveLength(3);
    expect(database.tables["character"]!.map((c) => c["id"])).toEqual(["c1", "c2"]);
    expect(database.tables["unclaimedCharacter"]!.map((u) => u["name"])).toEqual(["Ana Belle"]);
  });

  it("keeps an existing unclaimed row instead of a duplicate, and skips a character not linked by the bridge", async () => {
    const database = world();
    database.tables["unclaimedCharacter"]!.push({ id: "u-old", guildId: "g1", nameKey: "mister haragot", name: "Mister Haragot" });
    database.tables["character"]!.push(character("c4", "junk", "Other Name", { linkEvidence: "named" }));
    const report = await revertProvisionalBridgeLinks(database as never, { guildDiscordId: "d1", provisionalIds: ["p1"], since, apply: true });
    expect(database.tables["unclaimedCharacter"]).toHaveLength(1);
    expect(report.kept).toEqual([{ character: "Other Name", why: 'link proof is "named", not the bridge\'s' }]);
    expect(database.tables["member"]!.some((m) => m["id"] === "junk")).toBe(true);
  });

  it("ignores a provisional member created before --since", async () => {
    const database = world();
    database.tables["member"]![0]!["createdAt"] = new Date("2026-11-19T10:00:00Z");
    const report = await revertProvisionalBridgeLinks(database as never, { guildDiscordId: "d1", provisionalIds: ["p1"], since, apply: true });
    expect(report.members).toBe(0);
    expect(database.tables["character"]).toHaveLength(3);
  });
});
