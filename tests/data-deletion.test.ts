import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { anonymisePublicRuns, DELETED_MEMBER_NAME, DELETED_PLAYER_PREFIX, deleteMyData, scrubNames } from "../src/services/data-deletion.js";

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
    character: { ...del("character", 3), findMany: vi.fn(async () => [{ name: "Kev Caron", realm: "Doomhowl" }]) },
    publicRunPlayer: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) }, publicRun: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) }, publicRunUpload: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) }
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, db: db as unknown as PrismaClient, calls };
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
    const players = { findMany: vi.fn(async () => rows), update: vi.fn(async () => ({})) };
    const runs = { findUnique: vi.fn(async () => ({ integrity: { players: [{ character: "Kev Caron", realm: "Doomhowl" }, { character: "Other Player" }] } })), update: vi.fn(async () => ({})) };
    const uploads = { findMany: vi.fn(async () => [{ id: "u1", reporters: ["kev caron", "other player"], evidence: { players: [{ character: "Kev Caron" }] } }]), update: vi.fn(async () => ({})) };
    const done = await anonymisePublicRuns({ publicRunPlayer: players, publicRun: runs, publicRunUpload: uploads } as never, [{ name: "Kev Caron", realm: "Doomhowl" }]);
    expect(done).toBe(2);
    expect(players.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { character: `${DELETED_PLAYER_PREFIX}p1`, displayName: null, guild: null } });
    expect(players.update).toHaveBeenCalledWith({ where: { id: "p3" }, data: { character: `${DELETED_PLAYER_PREFIX}p3`, displayName: null, guild: null } });
    expect(players.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p2" } }));
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
    expect(f.tx.character.findMany).toHaveBeenCalled();
    expect(f.tx.publicRunPlayer.findMany).toHaveBeenCalled();
  });
});
