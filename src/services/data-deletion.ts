import type { PrismaClient } from "../generated/prisma/client.js";

// "Delete my data" (8.5). Everything about a member is shared, so the only privacy control left is this one request,
// which the Microsoft Store privacy policy and Discord's developer terms require. It removes what identifies the
// person and what belongs to them alone, and anonymises the guild-history rows that other members' records depend on
// (points, loot and raid attendance stay as history, attached to "Deleted member"):
//   - the website account (profile, recruitment card, linked web characters, Battle.net selection, device sign-ins);
//   - every guild character of theirs and what hangs off it (professions, wishlist, gear snapshots, sign-ups);
//   - their personal rows: battleground reports, achievements, milestones, recap schedule, alerts, availability,
//     pairings, verify codes and companion credentials, community badge shelves;
//   - the Discord id and display name on their member rows, which become "Deleted member" (status LEFT).
// Backups and Discord messages already posted are outside the live database; docs/PRIVACY.md says so.

export const DELETED_MEMBER_NAME = "Deleted member";
/** The word the member types to confirm. */
export const DELETE_CONFIRM_WORD = "DELETE";

export interface DeletionSummary { members: number; characters: number; account: boolean }

export async function deleteMyData(database: PrismaClient, discordUserId: string): Promise<DeletionSummary> {
  if (!/^\d{5,25}$/.test(discordUserId)) throw new Error("A Discord user id is required.");
  return database.$transaction(async tx => {
    const members = await tx.member.findMany({ where: { discordUserId }, select: { id: true } });
    const memberIds = members.map(row => row.id);
    const account = await tx.webAccount.deleteMany({ where: { discordUserId } });
    await tx.communityBadgeSharing.deleteMany({ where: { userId: discordUserId } });
    const own = { memberId: { in: memberIds } };
    await tx.battlegroundReport.deleteMany({ where: own });
    await tx.battlegroundConsent.deleteMany({ where: own });
    await tx.memberAchievement.deleteMany({ where: own });
    await tx.memberMilestone.deleteMany({ where: own });
    await tx.recurringRecap.deleteMany({ where: own });
    await tx.groupAlert.deleteMany({ where: own });
    await tx.webAvailability.deleteMany({ where: own });
    await tx.poeLevelReached.deleteMany({ where: own });
    await tx.poeMapVisit.deleteMany({ where: own });
    await tx.characterPairing.deleteMany({ where: own });
    await tx.characterVerifyCode.deleteMany({ where: own });
    await tx.characterVerifyClaim.deleteMany({ where: own });
    await tx.companionCredential.deleteMany({ where: own });
    const characters = await tx.character.deleteMany({ where: own });
    for (const { id } of members) {
      // The id keeps the (guildId, discordUserId) pair unique and can never match a real Discord account.
      await tx.member.update({ where: { id }, data: { discordUserId: `deleted-${id}`, displayName: DELETED_MEMBER_NAME, status: "LEFT" } });
    }
    return { members: members.length, characters: characters.count, account: account.count > 0 };
  });
}
