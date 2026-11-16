import { describe, expect, it, vi } from "vitest";
import { registerLeaderboardCache } from "../src/services/leaderboard-cache-hooks.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { anonymisePublicDuels, anonymisePublicRuns, DELETED_MEMBER_NAME, DELETED_PLAYER_PREFIX, deleteMyData, isOwnName, scrubNames } from "../src/services/data-deletion.js";

function fixture() {
  const calls: string[] = [];
  const del = (name: string, count = 0) => ({ deleteMany: vi.fn(async (arg: unknown) => { calls.push(name); void arg; return { count }; }) });
  const tx = {
    member: { findMany: vi.fn(async () => [{ id: "m1" }, { id: "m2" }]), update: vi.fn(async () => ({})) },
    webAccount: del("webAccount", 1), communityBadgeSharing: del("communityBadgeSharing"),
    battlegroundReport: del("battlegroundReport"), battlegroundConsent: del("battlegroundConsent"), memberAchievement: del("memberAchievement"), tcgAccount: del("tcgAccount"), tcgCard: del("tcgCard"), tcgLog: del("tcgLog"),
    memberMilestone: del("memberMilestone"), recurringRecap: del("recurringRecap"), groupAlert: del("groupAlert"), webAvailability: del("webAvailability"),
    poeLevelReached: del("poeLevelReached"), poeMapVisit: del("poeMapVisit"), guildMapSighting: del("guildMapSighting"), guildHelpCall: del("guildHelpCall"), worldPvpWeek: del("worldPvpWeek"), worldPvpEvent: del("worldPvpEvent"), characterPairing: del("characterPairing"),
    characterVerifyCode: del("characterVerifyCode"), characterVerifyClaim: del("characterVerifyClaim"), companionCredential: del("companionCredential"),
    mobileDelivery: del("mobileDelivery"), mobileDevice: del("mobileDevice"),
    character: del("character", 3)
  };
  const top = {
    member: { findMany: vi.fn(async () => [{ id: "m1" }, { id: "m2" }]) },
    character: { findMany: vi.fn(async () => [{ name: "Kev Caron", realm: "Doomhowl", member: { guildId: "g1" } }]) },
    publicRunPlayer: { findMany: vi.fn(async () => []) }, publicRun: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) }, publicRunUpload: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    publicDuel: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) }, publicDuelReport: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async (...args: unknown[]) => { void args; return 0; })
  };
  const db = { ...top, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, top, db: db as unknown as PrismaClient, calls };
}

describe("Delete my data", () => {
  it("removes the phone's push registration and queued notices before the sign-in they belong to", async () => {
    const f = fixture();
    await deleteMyData(f.db, "123456789012345678");
    const own = { memberId: { in: ["m1", "m2"] } };
    expect(f.tx.mobileDelivery.deleteMany).toHaveBeenCalledWith({ where: { device: { credential: own } } });
    expect(f.tx.mobileDevice.deleteMany).toHaveBeenCalledWith({ where: { credential: own } });
    const order = ["mobileDelivery", "mobileDevice", "companionCredential"].map(name => f.calls.indexOf(name));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("removes the account and personal rows, then anonymises the member rows", async () => {
    const f = fixture();
    const summary = await deleteMyData(f.db, "123456789012345678");
    expect(summary).toEqual({ members: 2, characters: 3, account: true });
    expect(f.calls).toEqual(expect.arrayContaining(["webAccount", "battlegroundReport", "memberAchievement", "tcgAccount", "tcgCard", "tcgLog", "companionCredential", "character", "communityBadgeSharing", "guildMapSighting", "guildHelpCall"]));
    expect(f.tx.webAccount.deleteMany).toHaveBeenCalledWith({ where: { discordUserId: "123456789012345678" } });
    expect(f.tx.battlegroundReport.deleteMany).toHaveBeenCalledWith({ where: { memberId: { in: ["m1", "m2"] } } });
    expect(f.tx.member.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { discordUserId: "deleted-m1", displayName: DELETED_MEMBER_NAME, status: "LEFT" } });
    expect(f.tx.member.update).toHaveBeenCalledTimes(2);
  });
  it("refuses anything that is not a Discord id, touching nothing", async () => {
    const f = fixture();
    for (const bad of ["", "abc", "1", "1 OR 1=1"]) await expect(deleteMyData(f.db, bad)).rejects.toThrow("Discord user id");
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("Delete my data: public dungeon runs", () => {
  it("anonymises the member's characters in public run rows, evidence and reporters, keeping the run and party size", async () => {
    const rows = [{ id: "p1", runId: "r1", character: "Kev Caron", realm: "Doomhowl" }, { id: "p2", runId: "r1", character: "Other Player", realm: "Doomhowl" }, { id: "p3", runId: "r2", character: "kev caron", realm: "" }];
    const players = { findMany: vi.fn(async () => rows) };
    const raw = vi.fn(async (...args: unknown[]) => { void args; return 2; });
    const runs = { findUnique: vi.fn(async () => ({ integrity: { players: [{ character: "Kev Caron", realm: "Doomhowl" }, { character: "Other Player" }] } })), update: vi.fn(async () => ({})) };
    const uploads = { findMany: vi.fn(async () => [{ id: "u1", reporters: ["kev caron", "other player"], evidence: { players: [{ character: "Kev Caron" }] } }]), update: vi.fn(async () => ({})) };
    const done = await anonymisePublicRuns({ publicRunPlayer: players, publicRun: runs, publicRunUpload: uploads, $executeRaw: raw } as never, [{ name: "Kev Caron", realm: "Doomhowl", unique: true }]);
    expect(done).toBe(2);
    // one set-based statement for both rows, each row's own placeholder built from its id in SQL
    expect(raw).toHaveBeenCalledTimes(1);
    const call = raw.mock.calls[0]![0] as unknown as { strings: string[]; values: unknown[] };
    expect(call.strings.join("?")).toContain('"character" = ');
    expect(call.values).toEqual([DELETED_PLAYER_PREFIX, ["p1", "p3"]]);
    const integrity = (runs.update.mock.calls[0] as unknown as [{ data: { integrity: { players: { character: string }[] } } }])[0].data.integrity;
    expect(integrity.players.map(p => p.character)).toEqual([`${DELETED_PLAYER_PREFIX}p1`, "Other Player"]);
    const upload = (uploads.update.mock.calls[0] as unknown as [{ data: { reporters: string[]; evidence: { players: { character: string }[] } } }])[0].data;
    expect(upload.reporters).toEqual([`${DELETED_PLAYER_PREFIX}p1`, "other player"]);
    expect(upload.evidence.players[0]!.character).toBe(`${DELETED_PLAYER_PREFIX}p1`);
  });
  it("does nothing without characters and scrubs names inside nested JSON", async () => {
    expect(await anonymisePublicRuns({} as never, [])).toBe(0);
    expect(scrubNames({ a: ["Kev", { b: "KEV" }], c: "Amy" }, ["kev"], "X")).toEqual({ a: ["X", { b: "X" }], c: "Amy" });
  });
  it("runs inside Delete my data, before the member's characters are deleted", async () => {
    const f = fixture();
    await deleteMyData(f.db, "123456789012345678");
    expect(f.top.character.findMany).toHaveBeenCalled();
    expect(f.top.publicRunPlayer.findMany).toHaveBeenCalled();
  });
});

describe("Delete my data: public duels and first-name legacy rows", () => {
  it("anonymises the member's side of a duel (name, key, guild, member id, report keys and evidence) and keeps the opponent", async () => {
    const duels = { findMany: vi.fn(async () => [{ id: "d1", winnerKey: "kev caron", loserKey: "amy", winnerName: "Kev Caron", loserName: "Amy", winnerRealm: "Doomhowl", loserRealm: "Doomhowl" },
      { id: "d2", winnerKey: "bob", loserKey: "kev", winnerName: "Bob", loserName: "Kev", winnerRealm: "Doomhowl", loserRealm: "" }]), update: vi.fn(async () => ({})) };
    const reports = { findMany: vi.fn(async () => [{ id: "rep1" }]), update: vi.fn(async () => ({})) };
    const done = await anonymisePublicDuels({ publicDuel: duels, publicDuelReport: reports } as never, [{ name: "Kev Caron", realm: "Doomhowl", unique: true }]);
    expect(done).toBe(2);
    const first = (duels.update.mock.calls[0] as unknown as [{ where: { id: string }; data: Record<string, unknown> }])[0];
    expect(first.data).toMatchObject({ winnerName: `${DELETED_PLAYER_PREFIX}d1-w`, winnerKey: `${DELETED_PLAYER_PREFIX}d1-w`, winnerGuild: null, winnerMemberId: null, pairKey: `${DELETED_PLAYER_PREFIX}d1` });
    expect(first.data).not.toHaveProperty("loserName"); // Amy stays
    // the legacy first-name-only row ("Kev", no realm stored) is theirs too
    const second = (duels.update.mock.calls[1] as unknown as [{ data: Record<string, unknown> }])[0];
    expect(second.data).toMatchObject({ loserName: `${DELETED_PLAYER_PREFIX}d2-l` });
    expect(reports.update).toHaveBeenCalledWith({ where: { id: "rep1" }, data: expect.objectContaining({ reporterKey: `${DELETED_PLAYER_PREFIX}rep1`, deviceId: null, nonce: null, chain: null }) });
  });
  it("matches a first-name-only legacy public run row only on the member's realm, and a realm-less row only when the name is unique in their guild", async () => {
    const rowsOf = () => [{ id: "p1", runId: "r1", character: "Kev", realm: "Doomhowl" }, { id: "p2", runId: "r1", character: "Kev", realm: "Other" }, { id: "p4", runId: "r2", character: "Kev", realm: "" }];
    const run = (unique: boolean) => {
      const raw = vi.fn(async (...args: unknown[]) => { void args; return 1; });
      const db = { publicRunPlayer: { findMany: vi.fn(async () => rowsOf()) }, publicRun: { findUnique: vi.fn(async () => null), update: vi.fn() }, publicRunUpload: { findMany: vi.fn(async () => []), update: vi.fn() }, $executeRaw: raw };
      return anonymisePublicRuns(db as never, [{ name: "Kev Caron", realm: "Doomhowl", unique }]).then((done) => ({ done, ids: (raw.mock.calls[0]?.[0] as unknown as { values: unknown[] } | undefined)?.values[1] }));
    };
    expect(await run(true)).toEqual({ done: 2, ids: ["p1", "p4"] }); // the other realm is never taken
    expect(await run(false)).toEqual({ done: 1, ids: ["p1"] }); // a guildmate shares the name: the realm-less row stays
  });
  it("isOwnName compares realms when both sides have one", () => {
    expect(isOwnName({ name: "Kev Caron", realm: "A", unique: false }, "Kev Caron", "A")).toBe(true);
    expect(isOwnName({ name: "Kev Caron", realm: "A", unique: true }, "Kev Caron", "B")).toBe(false);
    expect(isOwnName({ name: "Kev Caron", realm: null, unique: true }, "Kev", "B")).toBe(true);
  });
  it("marks a guildmate's same first name as not unique and clears the public pages' caches after deleting", async () => {
    const f = fixture();
    f.top.character.findMany.mockResolvedValueOnce([{ name: "Kev Caron", realm: "Doomhowl", member: { guildId: "g1" } }]).mockResolvedValueOnce([{ name: "Kev Smith" }] as never);
    f.top.publicRunPlayer.findMany.mockResolvedValueOnce([{ id: "p9", runId: "r1", character: "Kev", realm: "" }] as never);
    const cleared = vi.fn();
    registerLeaderboardCache(cleared);
    await deleteMyData(f.db, "123456789012345678");
    expect(cleared).toHaveBeenCalled();
    expect(f.top.$executeRaw).not.toHaveBeenCalled(); // "Kev" with no realm is not unique in the guild, so it stays
  });
});
