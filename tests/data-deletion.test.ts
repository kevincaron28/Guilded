import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { DELETED_MEMBER_NAME, deleteMyData } from "../src/services/data-deletion.js";

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
    character: del("character", 3)
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, db: db as unknown as PrismaClient, calls };
}

describe("Delete my data", () => {
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
