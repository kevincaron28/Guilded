import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { clearLeaderboardCaches } from "./leaderboard-cache-hooks.js";

// "Delete my data" (8.5). Everything about a member is shared, so the only privacy control left is this one request,
// which the Microsoft Store privacy policy and Discord's developer terms require. It removes what identifies the
// person and what belongs to them alone, and anonymises the guild-history rows that other members' records depend on
// (points, loot and raid attendance stay as history, attached to "Deleted member"):
//   - the website account (profile, recruitment card, linked web characters, Battle.net selection, device sign-ins);
//   - every guild character of theirs and what hangs off it (professions, wishlist, gear snapshots, sign-ups);
//   - their personal rows: battleground reports, achievements, milestones, recap schedule, alerts, availability,
//     pairings, verify codes and companion credentials, community badge shelves, guild map positions and help calls;
//   - the Discord id and display name on their member rows, which become "Deleted member" (status LEFT).
// Backups and Discord messages already posted are outside the live database; docs/PRIVACY.md says so.

export const DELETED_MEMBER_NAME = "Deleted member";
/** The word the member types to confirm. */
export const DELETE_CONFIRM_WORD = "DELETE";

export interface DeletionSummary { members: number; characters: number; account: boolean }

/** The placeholder a deleted player's name becomes in a public run (unique per row, so the run keeps its party size). */
export const DELETED_PLAYER_PREFIX = "deleted-player-";

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Older uploads stored only the first name of a two-name character ("Kev" for "Kev Caron"): theirs too, on the same realm (or none stored). */
const firstNameOf = (name: string) => name.trim().includes(" ") ? name.trim().split(/\s+/)[0]! : null;

/** One of the member's characters. `unique`: no other member of their guild has the same name (or, for the first-name alias, the same first name). */
export interface OwnCharacter { name: string; realm: string | null; unique: boolean }
/**
 * Whether a stored name (and realm, "" or null when none is stored) is this character. The name is the full name, or (with `alias`, only
 * for a row tied to the member another way) its first-name alias.
 * With a realm on both sides the realms must be equal; when either side has none the row counts only if the name is unique in the
 * member's guild, so a realm-less row is never taken from another player on another realm.
 */
export const isOwnName = (own: OwnCharacter, stored: string, realm: string | null, alias = false) =>
  (sameName(own.name, stored) || (alias && !!firstNameOf(own.name) && sameName(firstNameOf(own.name)!, stored)))
  && (realm && own.realm ? sameName(own.realm, realm) : own.unique);

/**
 * What can tie a first-name-only legacy row to this member besides the name: their Discord server(s), their member ids and the keys of
 * their full-name characters. A stray first name alone identifies nobody, so without a tie the row is left alone.
 */
export interface DeletionTies { guildIds: string[]; memberIds: string[]; fullKeys: string[] }
const NO_TIES: DeletionTies = { guildIds: [], memberIds: [], fullKeys: [] };

/** Replaces every string equal to one of `names` (any case) inside saved evidence JSON; keys are never touched. */
export function scrubNames<T>(value: T, names: readonly string[], placeholder: string): T {
  const walk = (node: unknown): unknown => typeof node === "string" ? (names.some(name => sameName(node, name)) ? placeholder : node)
    : Array.isArray(node) ? node.map(walk)
    : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).map(([key, inner]) => [key, walk(inner)])) : node;
  return walk(value) as T;
}

type PublicRunTx = Pick<PrismaClient, "publicRunPlayer" | "publicRun" | "publicRunUpload" | "$executeRaw">;
/**
 * The member's characters leave the public runs: each public run player row with one of their names (and the realm, or none stored)
 * becomes "deleted-player-<row id>" with no display name and no guild; the same names are replaced inside that run's saved evidence
 * and its uploads' reporters. The row, class, role and level stay, so the run itself and its party size are unchanged.
 * Rows that stored only the first name of a two-name character ("Kev") are matched only when tied to the member another way: the same run
 * also holds their full-name character, or one of the run's uploads came from their Discord server. Another player who merely shares the
 * first name is left alone.
 */
export async function anonymisePublicRuns(tx: PublicRunTx, characters: OwnCharacter[], ties: DeletionTies = NO_TIES): Promise<number> {
  const names = [...new Set(characters.flatMap(row => [row.name.trim(), firstNameOf(row.name) ?? ""]).filter(Boolean))];
  if (!names.length) return 0;
  const rows = await tx.publicRunPlayer.findMany({ where: { OR: names.map(name => ({ character: { equals: name, mode: "insensitive" as const } })) }, select: { id: true, runId: true, character: true, realm: true }, take: 50_000 });
  const full = rows.filter(row => characters.some(own => isOwnName(own, row.character, row.realm)));
  const aliasOnly = rows.filter(row => !full.includes(row) && characters.some(own => isOwnName(own, row.character, row.realm, true)));
  const fullRuns = new Set(full.map(row => row.runId));
  const aliasRuns = [...new Set(aliasOnly.map(row => row.runId).filter(id => !fullRuns.has(id)))];
  const viaGuild = aliasRuns.length && ties.guildIds.length
    ? new Set((await tx.publicRunUpload.findMany({ where: { runId: { in: aliasRuns }, uploaderKey: { in: ties.guildIds.map(id => `guild:${id}`) } }, select: { runId: true } })).map(row => row.runId))
    : new Set<string>();
  const mine = [...full, ...aliasOnly.filter(row => fullRuns.has(row.runId) || viaGuild.has(row.runId))];
  // Set-based and batched: one statement per 1,000 rows, each row's own unique placeholder (the run keeps its party size).
  for (let at = 0; at < mine.length; at += 1_000) {
    const ids = mine.slice(at, at + 1_000).map(row => row.id);
    await tx.$executeRaw(Prisma.sql`UPDATE "PublicRunPlayer" SET "character" = ${DELETED_PLAYER_PREFIX}::text || "id", "displayName" = NULL, "guild" = NULL WHERE "id" = ANY(${ids}::text[])`);
  }
  const placeholder = (character: string) => `${DELETED_PLAYER_PREFIX}${mine.find(row => sameName(row.character, character))?.id ?? "x"}`;
  for (const runId of new Set(mine.map(row => row.runId))) {
    const own = mine.filter(row => row.runId === runId);
    const used = own.map(row => row.character);
    const run = await tx.publicRun.findUnique({ where: { id: runId }, select: { integrity: true } });
    const swap = <T>(value: T): T => used.reduce((current, name) => scrubNames(current, [name], placeholder(name)), value);
    if (run?.integrity) await tx.publicRun.update({ where: { id: runId }, data: { integrity: swap(run.integrity) as never } });
    for (const upload of await tx.publicRunUpload.findMany({ where: { runId }, select: { id: true, reporters: true, evidence: true } })) {
      await tx.publicRunUpload.update({ where: { id: upload.id }, data: { reporters: upload.reporters.map(name => used.some(u => sameName(u, name)) ? placeholder(name) : name), ...(upload.evidence ? { evidence: swap(upload.evidence) as never } : {}) } });
    }
  }
  return mine.length;
}

/** The member's characters (also the ones they unlinked) with whether each name is theirs alone in their guild. */
async function ownCharacters(db: Pick<PrismaClient, "character">, memberIds: string[]): Promise<{ characters: OwnCharacter[]; ties: DeletionTies }> {
  const rows = await db.character.findMany({ where: { OR: [{ memberId: { in: memberIds } }, { detachedFromMemberId: { in: memberIds }, detachedAt: { not: null } }] }, select: { name: true, realm: true, member: { select: { guildId: true } } } });
  const guildIds = [...new Set(rows.flatMap(row => row.member?.guildId ?? []))];
  const others = guildIds.length ? await db.character.findMany({ where: { member: { guildId: { in: guildIds } }, memberId: { notIn: memberIds } }, select: { name: true }, take: 50_000 }) : [];
  const taken = others.map(row => row.name.trim().toLowerCase());
  const characters = rows.map(row => {
    const full = row.name.trim().toLowerCase(), first = firstNameOf(row.name)?.toLowerCase() ?? null;
    return { name: row.name, realm: row.realm, unique: !taken.some(other => other === full || (first !== null && (other === first || other.startsWith(`${first} `)))) };
  });
  return { characters, ties: { guildIds, memberIds, fullKeys: rows.map(row => row.name.trim().toLowerCase()) } };
}

export async function deleteMyData(database: PrismaClient, discordUserId: string): Promise<DeletionSummary> {
  if (!/^\d{5,25}$/.test(discordUserId)) throw new Error("A Discord user id is required.");
  // The public run and duel rows go first, outside the transaction (set-based, batched, safe to repeat): if this fails nothing else has been
  // deleted yet and the request can simply be repeated, so the deletion never ends half done.
  const memberIds = (await database.member.findMany({ where: { discordUserId }, select: { id: true } })).map(row => row.id);
  const { characters: named, ties } = await ownCharacters(database, memberIds);
  try {
    await anonymisePublicRuns(database, named, ties);
    await anonymisePublicDuels(database, named, ties);
    return await deleteWithinTransaction(database, discordUserId);
  } finally {
    clearLeaderboardCaches(); // the public pages drop what they cached (rosters, observed guilds) at once, even if the transaction failed after the public rows changed
  }
}

async function deleteWithinTransaction(database: PrismaClient, discordUserId: string): Promise<DeletionSummary> {
  return database.$transaction(async tx => {
    const members = await tx.member.findMany({ where: { discordUserId }, select: { id: true } });
    const memberIds = members.map(row => row.id);
    const account = await tx.webAccount.deleteMany({ where: { discordUserId } });
    await tx.communityBadgeSharing.deleteMany({ where: { userId: discordUserId } });
    await tx.publicProfileHidden.deleteMany({ where: { discordUserId } }); // the choice goes with the data (nothing of this person is left to hide)
    const own = { memberId: { in: memberIds } };
    await tx.battlegroundReport.deleteMany({ where: own });
    await tx.battlegroundConsent.deleteMany({ where: own });
    await tx.worldPvpWeek.deleteMany({ where: own });
    await tx.worldPvpEvent.deleteMany({ where: own });
    await tx.memberAchievement.deleteMany({ where: own });
    await tx.tcgAccount.deleteMany({ where: { discordUserId } });
    await tx.tcgCard.deleteMany({ where: { discordUserId } });
    await tx.tcgLog.deleteMany({ where: { discordUserId } });
    await tx.memberMilestone.deleteMany({ where: own });
    await tx.recurringRecap.deleteMany({ where: own });
    await tx.groupAlert.deleteMany({ where: own });
    await tx.webAvailability.deleteMany({ where: own });
    await tx.poeLevelReached.deleteMany({ where: own });
    await tx.poeMapVisit.deleteMany({ where: own });
    await tx.guildMapSighting.deleteMany({ where: own });
    await tx.guildHelpCall.deleteMany({ where: own });
    await tx.characterPairing.deleteMany({ where: own });
    await tx.characterVerifyCode.deleteMany({ where: own });
    await tx.characterVerifyClaim.deleteMany({ where: own });
    // The phone's push registration and its queued notices go with the sign-in (the database also cascades them).
    await tx.mobileDelivery.deleteMany({ where: { device: { credential: own } } });
    await tx.mobileDevice.deleteMany({ where: { credential: own } });
    await tx.companionCredential.deleteMany({ where: own });
    const characters = await tx.character.deleteMany({ where: own });
    // Characters this member unlinked are kept under the holding member (character-move.ts): theirs to delete too.
    await tx.character.deleteMany({ where: { detachedFromMemberId: { in: memberIds }, detachedAt: { not: null } } });
    for (const { id } of members) {
      // The id keeps the (guildId, discordUserId) pair unique and can never match a real Discord account.
      await tx.member.update({ where: { id }, data: { discordUserId: `deleted-${id}`, displayName: DELETED_MEMBER_NAME, status: "LEFT" } });
    }
    return { members: members.length, characters: characters.count, account: account.count > 0 };
  });
}

type PublicDuelTx = Pick<PrismaClient, "publicDuel" | "publicDuelReport">;
/**
 * The member's characters leave the public duel ladder rows: a side of a duel (name, realm key, guild text, member id) becomes
 * "deleted-player-<duel id>-w|l", and the reports they made lose their reporter keys and evidence. The opponent's record, the duel itself and
 * its day and result stay. A first-name-only legacy side ("Kev") is matched only when tied to the member another way: its member id is
 * theirs, or a report of the duel came from their Discord server or from one of their full-name characters. Otherwise it is left alone.
 */
export async function anonymisePublicDuels(tx: PublicDuelTx, characters: OwnCharacter[], ties: DeletionTies = NO_TIES): Promise<number> {
  const names = [...new Set(characters.flatMap(row => [row.name.trim(), firstNameOf(row.name) ?? ""]).filter(Boolean))];
  if (!names.length) return 0;
  const sides = ["winner", "loser"] as const;
  const where = { OR: [...names.flatMap(name => sides.map(side => ({ [`${side}Name`]: { equals: name, mode: "insensitive" as const } })))] };
  const rows = await tx.publicDuel.findMany({ where, select: { id: true, winnerKey: true, loserKey: true, winnerName: true, loserName: true, winnerRealm: true, loserRealm: true, winnerMemberId: true, loserMemberId: true }, take: 50_000 });
  let changed = 0;
  for (const row of rows) {
    const data: Record<string, unknown> = {};
    const mineKeys: string[] = [];
    let tiedByReport: boolean | null = null; // looked up once per duel, only when a first-name-only side needs it
    for (const side of sides) {
      const name = row[`${side}Name`], realm = row[`${side}Realm`], key = row[`${side}Key`], memberId = row[`${side}MemberId`];
      if (!characters.some(own => isOwnName(own, name, realm))) {
        if (!characters.some(own => isOwnName(own, name, realm, true))) continue;
        if (!(memberId && ties.memberIds.includes(memberId))) {
          tiedByReport ??= !!(ties.guildIds.length || ties.fullKeys.length) && (await tx.publicDuelReport.findMany({ where: { duelId: row.id, OR: [...(ties.guildIds.length ? [{ guildId: { in: ties.guildIds } }] : []), ...(ties.fullKeys.length ? [{ reporterCharacterKey: { in: ties.fullKeys } }] : [])] }, select: { id: true }, take: 1 })).length > 0;
          if (!tiedByReport) continue;
        }
      }
      mineKeys.push(key);
      Object.assign(data, { [`${side}Name`]: `${DELETED_PLAYER_PREFIX}${row.id}-${side[0]}`, [`${side}Key`]: `${DELETED_PLAYER_PREFIX}${row.id}-${side[0]}`, [`${side}Guild`]: null, [`${side}MemberId`]: null });
    }
    if (!mineKeys.length) continue;
    await tx.publicDuel.update({ where: { id: row.id }, data: { ...data, pairKey: `${DELETED_PLAYER_PREFIX}${row.id}` } as never });
    for (const report of await tx.publicDuelReport.findMany({ where: { duelId: row.id, reporterCharacterKey: { in: mineKeys } }, select: { id: true } })) {
      await tx.publicDuelReport.update({ where: { id: report.id }, data: { reporterKey: `${DELETED_PLAYER_PREFIX}${report.id}`, reporterCharacterKey: `${DELETED_PLAYER_PREFIX}${report.id}`, deviceId: null, evidence: Prisma.DbNull, nonce: null, chain: null } });
    }
    changed++;
  }
  return changed;
}

/**
 * The companion's "Delete my data" (9.0.1): the member proves who they are with their companion credential
 * (guild or personal) and types the confirm word. Returns null when the credential is unknown or revoked,
 * "confirm" when the word is wrong, else the same summary as the web flow.
 */
export async function deleteMyDataByCredential(database: PrismaClient, tokenHash: string, confirm: unknown): Promise<DeletionSummary | null | "confirm"> {
  const guildCredential = await database.companionCredential.findFirst({ where: { tokenHash, revokedAt: null, member: { status: "ACTIVE" } }, select: { member: { select: { discordUserId: true } } } });
  const personal = guildCredential ? null : await database.webCompanionCredential.findFirst({ where: { tokenHash, revokedAt: null }, select: { account: { select: { discordUserId: true } } } });
  const discordUserId = guildCredential?.member.discordUserId ?? personal?.account.discordUserId;
  if (!discordUserId) return null;
  if (typeof confirm !== "string" || confirm.trim() !== DELETE_CONFIRM_WORD) return "confirm";
  return deleteMyData(database, discordUserId);
}
