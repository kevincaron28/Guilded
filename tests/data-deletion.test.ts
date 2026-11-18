import { describe, expect, it, vi } from "vitest";
import { registerLeaderboardCache } from "../src/services/leaderboard-cache-hooks.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { anonymiseRaidKills, anonymisePublicDuels, anonymisePublicRuns, DELETED_MEMBER_NAME, DELETED_PLAYER_PREFIX, deleteMyData, isOwnName, scrubNames } from "../src/services/data-deletion.js";

function fixture() {
  const calls: string[] = [];
  const del = (name: string, count = 0) => ({ deleteMany: vi.fn(async (arg: unknown) => { calls.push(name); void arg; return { count }; }) });
  const tx = {
    member: { findMany: vi.fn(async () => [{ id: "m1" }, { id: "m2" }]), update: vi.fn(async () => ({})) },
    webAccount: del("webAccount", 1), communityBadgeSharing: del("communityBadgeSharing"), publicProfileHidden: del("publicProfileHidden"),
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
    raidKill: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
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
    expect(f.calls).toEqual(expect.arrayContaining(["webAccount", "battlegroundReport", "memberAchievement", "tcgAccount", "tcgCard", "tcgLog", "companionCredential", "character", "communityBadgeSharing", "publicProfileHidden", "guildMapSighting", "guildHelpCall"]));
    expect(f.tx.publicProfileHidden.deleteMany).toHaveBeenCalledWith({ where: { discordUserId: "123456789012345678" } });
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

describe("Delete my data: raid kills", () => {
  it("takes the member's characters out of the raid group list and keeps the kill and its count", async () => {
    const rows = [{ id: "k1", members: ["kev caron", "alice", "bea"] }];
    const findMany = vi.fn(async () => rows.splice(0));
    const update = vi.fn(async () => ({}));
    const changed = await anonymiseRaidKills({ raidKill: { findMany, update } } as never, [{ name: "Kev Caron", realm: "", unique: true }]);
    expect(changed).toBe(1);
    expect(update).toHaveBeenCalledWith({ where: { id: "k1" }, data: { members: ["alice", "bea"] } });
    expect(JSON.stringify(update.mock.calls)).not.toContain("guildCount");
  });
  it("runs as part of Delete my data", async () => {
    const f = fixture();
    await deleteMyData(f.db, "123456789012345678");
    expect(f.top.raidKill.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { members: { hasSome: ["kev caron"] } } }));
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
    expect(done).toBe(1);
    const first = (duels.update.mock.calls[0] as unknown as [{ where: { id: string }; data: Record<string, unknown> }])[0];
    expect(first.data).toMatchObject({ winnerName: `${DELETED_PLAYER_PREFIX}d1-w`, winnerKey: `${DELETED_PLAYER_PREFIX}d1-w`, winnerGuild: null, winnerMemberId: null, pairKey: `${DELETED_PLAYER_PREFIX}d1` });
    expect(first.data).not.toHaveProperty("loserName"); // Amy stays
    expect(duels.update).toHaveBeenCalledTimes(1); // the lone first-name row ("Kev", nothing ties it to them) is left alone
    expect(reports.update).toHaveBeenCalledWith({ where: { id: "rep1" }, data: expect.objectContaining({ reporterKey: `${DELETED_PLAYER_PREFIX}rep1`, deviceId: null, nonce: null, chain: null }) });
  });
  it("takes a first-name-only legacy run row only when tied to the member (same run as their full name, or their server's upload), never a stray same first name", async () => {
    const rowsOf = () => [
      { id: "p1", runId: "r1", character: "Kev Caron", realm: "Doomhowl" }, { id: "p2", runId: "r1", character: "Kev", realm: "Doomhowl" }, // same run as the full name: tied
      { id: "p3", runId: "r2", character: "Kev", realm: "Doomhowl" }, // uploaded by their server: tied
      { id: "p4", runId: "r3", character: "Kev", realm: "Doomhowl" }, // nothing ties it: another Kev
      { id: "p5", runId: "r1", character: "Kev", realm: "Other" }];
    const raw = vi.fn(async (...args: unknown[]) => { void args; return 1; });
    const uploads = { findMany: vi.fn(async (arg: { where: { runId: { in: string[] }; uploaderKey: { in: string[] } } }) => { void arg; return [{ runId: "r2", id: "u", reporters: [], evidence: null }]; }), update: vi.fn() };
    const db = { publicRunPlayer: { findMany: vi.fn(async () => rowsOf()) }, publicRun: { findUnique: vi.fn(async () => null), update: vi.fn() }, publicRunUpload: uploads, $executeRaw: raw };
    const done = await anonymisePublicRuns(db as never, [{ name: "Kev Caron", realm: "Doomhowl", unique: true }], { guildIds: ["g1"], memberIds: ["m1"], fullKeys: ["kev caron"] });
    expect((raw.mock.calls[0]![0] as unknown as { values: unknown[] }).values[1]).toEqual(["p1", "p2", "p3"]);
    expect(done).toBe(3);
    expect(uploads.findMany.mock.calls[0]![0].where).toMatchObject({ runId: { in: ["r2", "r3"] }, uploaderKey: { in: ["guild:g1"] } });
    // with no ties at all the lone first-name rows stay
    const none = vi.fn(async (...args: unknown[]) => { void args; return 1; });
    expect(await anonymisePublicRuns({ ...db, publicRunPlayer: { findMany: vi.fn(async () => [{ id: "p4", runId: "r3", character: "Kev", realm: "Doomhowl" }]) }, $executeRaw: none } as never, [{ name: "Kev Caron", realm: "Doomhowl", unique: true }])).toBe(0);
    expect(none).not.toHaveBeenCalled();
  });
  it("takes a first-name-only duel side only with a tie (member id, their server's report or their character's report)", async () => {
    const row = (id: string, memberId: string | null) => ({ id, winnerKey: "kev", loserKey: "amy", winnerName: "Kev", loserName: "Amy", winnerRealm: "Doomhowl", loserRealm: "Doomhowl", winnerMemberId: memberId, loserMemberId: null });
    const run = async (duel: ReturnType<typeof row>, reports: { id: string }[], ties = { guildIds: ["g1"], memberIds: ["m1"], fullKeys: ["kev caron"] }) => {
      const duels = { findMany: vi.fn(async () => [duel]), update: vi.fn(async () => ({})) };
      const rep = { findMany: vi.fn(async () => reports), update: vi.fn(async () => ({})) };
      const done = await anonymisePublicDuels({ publicDuel: duels, publicDuelReport: rep } as never, [{ name: "Kev Caron", realm: "Doomhowl", unique: true }], ties);
      return { done, rep, duels };
    };
    expect((await run(row("d1", "m1"), [])).done).toBe(1); // their member id
    const byReport = await run(row("d2", null), [{ id: "r1" }]);
    expect(byReport.done).toBe(1); // their server or character reported it
    expect((byReport.rep.findMany.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }])[0].where.OR).toEqual([{ guildId: { in: ["g1"] } }, { reporterCharacterKey: { in: ["kev caron"] } }]);
    expect((await run(row("d3", "someone-else"), [])).done).toBe(0); // a stray Kev nothing ties to them stays
    expect((await run(row("d4", null), [], { guildIds: [], memberIds: [], fullKeys: [] })).done).toBe(0);
  });
  it("isOwnName compares realms when both sides have one", () => {
    expect(isOwnName({ name: "Kev Caron", realm: "A", unique: false }, "Kev Caron", "A")).toBe(true);
    expect(isOwnName({ name: "Kev Caron", realm: "A", unique: true }, "Kev Caron", "B")).toBe(false);
    expect(isOwnName({ name: "Kev Caron", realm: null, unique: true }, "Kev", "B")).toBe(false); // the first-name alias needs a tie
    expect(isOwnName({ name: "Kev Caron", realm: null, unique: true }, "Kev", "B", true)).toBe(true);
  });
  it("clears the public pages' caches even when the core transaction throws after the public rows were anonymised", async () => {
    const f = fixture();
    (f.db as unknown as { $transaction: unknown }).$transaction = vi.fn(async () => { throw new Error("db down"); });
    const cleared = vi.fn();
    registerLeaderboardCache(cleared);
    await expect(deleteMyData(f.db, "123456789012345678")).rejects.toThrow("db down");
    expect(cleared).toHaveBeenCalled();
  });
  it("clears the public pages' caches after deleting", async () => {
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
