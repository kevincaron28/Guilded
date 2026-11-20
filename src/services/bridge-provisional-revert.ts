import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { nameKey } from "./roster-discovery.js";

// 20 November 2026: undoes what the first game-bridge backfill did for WoW's provisional Discord accounts (game-bridge-link.ts).
// That run called ensureMember for every relay author, provisional accounts included, and claimed one discovered character for each
// (claimCharacter -> linkUnclaimed: create the Character with the unclaimed row's fields and professions, delete the UnclaimedCharacter,
// then linkEvidence "game"). For each such junk member (provisional account, created on or after `since`) and each of its characters:
//   1. the UnclaimedCharacter row comes back with the character's fields (unless the roster already re-created one),
//   2. the Character row is deleted (its ProfessionSkill and CharacterRankSeen rows go with it; the professions are kept on the unclaimed row),
// one transaction per character. A character with any other history (runs signed up, pictures, attunements...) or that did not come from
// the bridge is reported and left alone. Then the member's dungeon-run rows go back to memberId null (how a run of an unlinked character
// is stored), its link notice is deleted, and the Member row is deleted only when no row in any table still names it.
// Never touches a member created before `since` or whose Discord account is not in `provisionalIds`.

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

/** Every column that holds a Member id (schema relations plus the plain memberId columns). */
export const MEMBER_ID_COLUMNS: readonly { model: string; field: string }[] = [
  ["activityCoreMember", "memberId"], ["activityResponse", "memberId"], ["addonImport", "pairedMemberId"], ["application", "memberId"],
  ["auctionBid", "memberId"], ["bankRequest", "memberId"], ["battlegroundConsent", "memberId"], ["battlegroundReport", "memberId"],
  ["boardPost", "memberId"], ["character", "memberId"], ["characterPairing", "memberId"], ["characterVerifyClaim", "memberId"],
  ["characterVerifyCode", "memberId"], ["companionCredential", "memberId"], ["companionDevice", "claimedMemberId"], ["craftNotify", "memberId"],
  ["craftOffer", "crafterId"], ["craftRequest", "requesterId"], ["craftRequest", "crafterId"], ["craftRequest", "relayedById"],
  ["deviceClaimOffer", "memberId"], ["dkpTransaction", "memberId"], ["duelResult", "winnerId"], ["duelResult", "loserId"],
  ["dungeonAchievement", "memberId"], ["dungeonGroupSignup", "memberId"], ["dungeonPointTransaction", "memberId"], ["dungeonRunPlayer", "memberId"],
  ["epgpTransaction", "memberId"], ["groupAlert", "memberId"], ["guildHelpCall", "memberId"], ["guildMapSighting", "memberId"],
  ["inspectedCharacterSnapshot", "memberId"], ["lootAward", "memberId"], ["memberAchievement", "memberId"], ["memberLinkNotice", "memberId"],
  ["memberMilestone", "memberId"], ["poeLevelReached", "memberId"], ["poeMapVisit", "memberId"], ["pollVote", "memberId"],
  ["raidAttendance", "memberId"], ["raidCoreMember", "memberId"], ["raidSignup", "memberId"], ["raidSupplyPledge", "memberId"],
  ["recurringRecap", "memberId"], ["syncHealthReport", "memberId"], ["targetedAlertAttempt", "memberId"], ["webAvailability", "memberId"],
  ["worldPvpEvent", "memberId"], ["worldPvpWeek", "memberId"]
].map(([model, field]) => ({ model: model!, field: field! }));

/** Rows that hang off a Character and have no place on an unclaimed row: any of them means "report, do not touch". */
export const CHARACTER_HISTORY: readonly string[] = [
  "battlegroundReport", "webAvailability", "activityCoreMember", "activityResponse", "characterAttunement", "wishlistEntry",
  "inspectedCharacterSnapshot", "raidCoreMember", "raidCoreBackup", "raidSignup", "application", "characterLinkConflict", "characterPicture"
];

type Counter = { count: (args: { where: Record<string, unknown> }) => Promise<number> };
const delegate = (database: Db | Tx, model: string) => (database as unknown as Record<string, Counter>)[model]!;

export interface RevertReport {
  members: number;
  restored: string[];
  kept: { character: string; why: string }[];
  deletedMembers: string[];
  keptMembers: { member: string; rows: string[] }[];
  runsUnlinked: number;
}

export async function revertProvisionalBridgeLinks(
  database: Db,
  input: { guildDiscordId: string; provisionalIds: Iterable<string>; since: Date; apply: boolean; log?: (line: string) => void }
): Promise<RevertReport> {
  const log = input.log ?? (() => undefined);
  const report: RevertReport = { members: 0, restored: [], kept: [], deletedMembers: [], keptMembers: [], runsUnlinked: 0 };
  const ids = [...new Set(input.provisionalIds)];
  const verb = input.apply ? "" : "would be ";
  if (!ids.length) return report;
  const guild = await database.guild.findFirst({ where: { discordId: input.guildDiscordId, scopeKey: "default" }, select: { id: true } });
  if (!guild) { log("This server is not set up in Guilded: nothing to do."); return report; }
  const members = await database.member.findMany({
    where: { guildId: guild.id, discordUserId: { in: ids }, createdAt: { gte: input.since } },
    select: { id: true, displayName: true, discordUserId: true, createdAt: true }
  });
  report.members = members.length;

  for (const member of members) {
    // Guard again per member: only the provisional accounts collected from the channel, only rows the bad run created.
    if (!ids.includes(member.discordUserId) || member.createdAt < input.since) continue;
    const characters = await database.character.findMany({ where: { memberId: member.id }, include: { professions: true } });
    let left = characters.length;
    for (const character of characters) {
      const label = character.displayName ?? character.name;
      if (character.linkEvidence !== "game") { report.kept.push({ character: label, why: `link proof is "${character.linkEvidence ?? "none"}", not the bridge's` }); log(`${label} (${member.displayName}): kept, not a bridge link`); continue; }
      if (character.createdAt < member.createdAt) { report.kept.push({ character: label, why: "older than the member (re-attached history)" }); log(`${label} (${member.displayName}): kept, the row is older than the member (re-attached history, move it by hand)`); continue; }
      const history: string[] = [];
      for (const model of CHARACTER_HISTORY) {
        const count = await delegate(database, model).count({ where: { characterId: character.id } });
        if (count) history.push(`${model} ${count}`);
      }
      if (history.length) { report.kept.push({ character: label, why: history.join(", ") }); log(`${label} (${member.displayName}): kept, it has ${history.join(", ")}`); continue; }
      if (input.apply) {
        await database.$transaction(async (tx) => {
          const key = nameKey(character.name);
          const existing = await tx.unclaimedCharacter.findUnique({ where: { guildId_nameKey: { guildId: character.guildId, nameKey: key } }, select: { id: true } });
          if (!existing) {
            await tx.unclaimedCharacter.create({
              data: {
                guildId: character.guildId, nameKey: key, name: character.name, displayName: character.displayName, legacyName: character.legacyName,
                realm: character.realm, className: character.className, race: character.race, level: character.level, spec: character.spec,
                gameEdition: character.gameEdition,
                professions: character.professions.map((p) => ({ name: p.profession, skillLevel: p.skillLevel })) as unknown as Prisma.InputJsonValue,
                professionsUpdatedAt: character.professionsUpdatedAt, lastSeenAt: character.lastSeenAt ?? character.createdAt,
                guildRankName: character.guildRankName, guildRankAt: character.guildRankAt
              }
            });
          }
          await tx.character.delete({ where: { id: character.id } });
        });
      }
      left -= 1;
      report.restored.push(label);
      log(`${label} (${member.displayName}): ${verb}unlinked, back in the discovered list`);
    }

    // The member itself: what still names it.
    if (left > 0) { report.keptMembers.push({ member: member.displayName, rows: [`character ${left}`] }); log(`Member ${member.displayName}: kept, ${left} character(s) left`); continue; }
    const runs = await database.dungeonRunPlayer.count({ where: { memberId: member.id } });
    if (runs) {
      if (input.apply) await database.dungeonRunPlayer.updateMany({ where: { memberId: member.id }, data: { memberId: null } });
      report.runsUnlinked += runs;
      log(`Member ${member.displayName}: ${runs} dungeon-run row(s) ${verb}stored as unlinked (memberId null)`);
    }
    if (input.apply) await database.memberLinkNotice.deleteMany({ where: { memberId: member.id } });
    const remaining: string[] = [];
    for (const { model, field } of MEMBER_ID_COLUMNS) {
      if (model === "character" && !input.apply) continue; // the dry run did not delete them
      if (!input.apply && (model === "dungeonRunPlayer" || model === "memberLinkNotice")) continue;
      const count = await delegate(database, model).count({ where: { [field]: member.id } });
      if (count) remaining.push(`${model}.${field} ${count}`);
    }
    if (remaining.length) { report.keptMembers.push({ member: member.displayName, rows: remaining }); log(`Member ${member.displayName}: kept, still named by ${remaining.join(", ")}`); continue; }
    if (input.apply) await database.member.delete({ where: { id: member.id } });
    report.deletedMembers.push(member.displayName);
    log(`Member ${member.displayName}: ${verb}deleted`);
  }
  return report;
}
