import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { findCharacter } from "./character-match.js";

// Linking audit T3 (docs/plans/LINKING_AUDIT_2026-11-10.md, owner decisions of 10 November 2026).
//
// Proof order. A link remembers what proved it (Character.linkEvidence), weakest to strongest:
//   named     typed in, /character claim, a Discord name match, an invite request
//   companion the member's own signed-in companion uploaded it
//   heard     a guildmate's addon heard the member's /guilded verify code from that character
//   officer   an officer linked or moved it by hand, or an officer's own addon heard the code
// (A device-reported character is weaker than all of them and is never a Character row.)
// A stronger claim takes the character from a weaker one: the row keeps its id, so its history
// (pictures, wishlist, professions, attunements, rank history, signups) follows it. Both members get a
// DM with an undo and the officer log gets a line (link-conflict-dm.ts). Equal proof never moves by
// itself: it waits for an officer (/officer character move). Weaker proof is told once.
//
// Unlink detaches. The row moves to the server's hidden holding member with detachedAt set, and
// comes back with its history when the character is linked again or an officer moves it.

type Tx = Prisma.TransactionClient;

export const LINK_EVIDENCE = ["named", "companion", "heard", "officer"] as const;
export type LinkEvidence = typeof LINK_EVIDENCE[number];

export const evidenceRank = (evidence: LinkEvidence): number => LINK_EVIDENCE.indexOf(evidence) + 1;
const isEvidence = (value: unknown): value is LinkEvidence => LINK_EVIDENCE.includes(value as LinkEvidence);

/**
 * What proved this link. Rows linked before the column existed are read from what they do have: a
 * LINKED verify claim is an officer's addon, PROVISIONAL a guildmate's, confirmedAt the member's own
 * companion (an officer's hand link from before is not told apart from it), anything else a name.
 */
export function evidenceOf(character: { linkEvidence?: string | null; confirmedAt?: Date | null }, claimStatus?: string | null): LinkEvidence {
  if (isEvidence(character.linkEvidence)) return character.linkEvidence;
  if (claimStatus === "LINKED") return "officer";
  if (claimStatus === "PROVISIONAL") return "heard";
  return character.confirmedAt ? "companion" : "named";
}

/** Whether this proof alone makes a link confirmed when it is written (character-trust.ts reads it back). */
const confirms = (evidence: LinkEvidence) => evidence === "officer" || evidence === "companion";

// The holding member: one per server, never a real Discord account (same idea as "deleted-<id>" in
// data-deletion.ts). LEFT and isTest keep it out of rosters, ranks, nicknames and standings.
export const HOLDING_MEMBER_PREFIX = "detached-";
export const HOLDING_MEMBER_NAME = "Unlinked characters";
export const isHoldingMember = (member: { discordUserId: string }) => member.discordUserId.startsWith(HOLDING_MEMBER_PREFIX);

export async function holdingMember(tx: Tx, guildId: string): Promise<{ id: string }> {
  const discordUserId = `${HOLDING_MEMBER_PREFIX}${guildId}`;
  return tx.member.upsert({
    where: { guildId_discordUserId: { guildId, discordUserId } },
    create: { guildId, discordUserId, displayName: HOLDING_MEMBER_NAME, status: "LEFT", isTest: true },
    update: {},
    select: { id: true }
  });
}

/** Detached rows only. database.ts hides them from every read that does not ask for them like this. */
export const DETACHED = { detachedAt: { not: null } } as const;
/** Linked and detached rows together (the linking code must see a detached row to bring it back). */
export const WITH_DETACHED = { OR: [{ detachedAt: null }, { detachedAt: { not: null } }] };

const claimKey = (character: { name: string; realm: string; gameEdition?: string | null }) => characterKey(character.name, character.realm, character.gameEdition ?? "forever");

async function setClaim(tx: Tx, guildId: string, memberId: string, nameKey: string, status: string): Promise<void> {
  await tx.characterVerifyClaim.upsert({
    where: { guildId_memberId_nameKey: { guildId, memberId, nameKey } },
    create: { guildId, memberId, nameKey, status },
    update: { status }
  });
}

// The member who lost their main gets another one: highest level, then by name.
async function promoteMain(tx: Tx, memberId: string): Promise<void> {
  const next = await tx.character.findFirst({ where: { memberId, detachedAt: null }, orderBy: [{ level: { sort: "desc", nulls: "last" } }, { name: "asc" }], select: { id: true } });
  if (next) await tx.character.update({ where: { id: next.id }, data: { isMain: true } });
}

export interface MoveReason {
  evidence: LinkEvidence;
  /** officer: a decision (the previous owner's uploads and code never take it back). proof: stronger evidence. undo, relink: putting it back. */
  by: "officer" | "proof" | "undo" | "relink";
}
export interface MoveResult { character: { id: string; name: string; isMain: boolean; memberId: string }; fromMemberId: string; wasDetached: boolean }

/**
 * Gives a character to another member without deleting anything: same row, same id, same history.
 * Also brings a detached character back. Ownership, the main flag, the proof and the verify claims of
 * both members change together, so call it inside a transaction. Null when the character is gone.
 */
export async function moveCharacter(tx: Tx, characterId: string, toMemberId: string, reason: MoveReason): Promise<MoveResult | null> {
  const character = await tx.character.findUnique({ where: { id: characterId } });
  if (!character) return null;
  const fromMemberId = character.memberId;
  const wasDetached = Boolean(character.detachedAt);
  const guildId = character.guildId;
  const key = claimKey(character);
  const sameOwner = fromMemberId === toMemberId && !wasDetached;
  const isMain = sameOwner ? character.isMain : (await tx.character.count({ where: { memberId: toMemberId, isMain: true, detachedAt: null } })) === 0;
  const updated = await tx.character.update({
    where: { id: characterId },
    data: {
      memberId: toMemberId, isMain, linkEvidence: reason.evidence,
      confirmedAt: confirms(reason.evidence) ? character.confirmedAt ?? new Date() : null,
      detachedAt: null, detachedFromMemberId: null
    }
  });
  if (sameOwner) return { character: updated, fromMemberId, wasDetached };
  if (!wasDetached) {
    if (character.isMain) await promoteMain(tx, fromMemberId);
    // An officer's decision is final for the previous owner; a /guilded verify code that turned out to
    // be someone else's character must not link it back either.
    const previous = (await tx.characterVerifyClaim.findMany({ where: { guildId, nameKey: { in: [key] } }, select: { memberId: true, status: true } }))
      .find((claim) => claim.memberId === fromMemberId);
    if (reason.by === "officer" || previous?.status === "PROVISIONAL" || previous?.status === "LINKED") await setClaim(tx, guildId, fromMemberId, key, "REMOVED");
  }
  // The new owner: an earlier "not mine" or officer removal no longer stands.
  if (reason.evidence === "officer") await setClaim(tx, guildId, toMemberId, key, "LINKED");
  else if (reason.evidence === "heard") await setClaim(tx, guildId, toMemberId, key, "PROVISIONAL");
  else await tx.characterVerifyClaim.deleteMany({ where: { guildId, memberId: toMemberId, nameKey: key, status: { in: ["BLOCKED", "REMOVED"] } } });
  await tx.unclaimedCharacter.deleteMany({ where: { guildId, nameKey: key } });
  return { character: updated, fromMemberId, wasDetached };
}

/**
 * /character unlink: the character leaves its member and keeps its history. The caller records why
 * (blockVerifiedCharacter: BLOCKED for the member's own unlink, REMOVED for an officer's).
 */
export async function detachCharacter(tx: Tx, characterId: string, now = new Date()): Promise<{ fromMemberId: string } | null> {
  const character = await tx.character.findUnique({ where: { id: characterId }, include: { member: { select: { guildId: true } } } });
  if (!character || character.detachedAt) return null;
  const holding = await holdingMember(tx, character.member.guildId);
  await tx.character.update({ where: { id: characterId }, data: { memberId: holding.id, isMain: false, detachedAt: now, detachedFromMemberId: character.memberId } });
  if (character.isMain) await promoteMain(tx, character.memberId);
  await tx.characterLinkConflict.updateMany({ where: { characterId, status: { in: ["OPEN", "MOVED", "WEAKER"] } }, data: { status: "RESOLVED" } });
  return { fromMemberId: character.memberId };
}

/** The detached character with this name in this server, if any. */
export async function findDetached(tx: Tx, guildId: string, name: string, realm: string, gameEdition = "forever") {
  const rows = (await tx.character.findMany({ where: { guildId, ...DETACHED } })).filter((row) => row.detachedAt);
  return findCharacter(rows, name, realm, gameEdition) ?? null;
}

/** Linking a name that was unlinked before: the old row comes back (history included) instead of a new one. */
export async function reattachDetached(tx: Tx, guildId: string, memberId: string, ref: { name: string; realm: string; gameEdition?: string | null }, evidence: LinkEvidence): Promise<MoveResult | null> {
  const detached = await findDetached(tx, guildId, ref.name, ref.realm, ref.gameEdition ?? "forever");
  return detached ? moveCharacter(tx, detached.id, memberId, { evidence, by: "relink" }) : null;
}

export type ContestOutcome = "moved" | "queued" | "weaker" | "declined";

/**
 * A member's claim on a character another member holds. Stronger proof moves it (MOVED, undo by DM);
 * equal proof waits for an officer (OPEN); weaker proof is told once (WEAKER). "declined": this member
 * unlinked it, an officer took it from them, or the question is already with the officers.
 * The rows it writes are announced by tellLinkConflicts (link-conflict-dm.ts).
 */
export async function contestCharacter(tx: Tx, input: {
  guildId: string; claimantMemberId: string; evidence: LinkEvidence;
  character: { id: string; memberId: string; name: string; realm: string; gameEdition?: string | null; linkEvidence?: string | null; confirmedAt?: Date | null };
}): Promise<ContestOutcome> {
  const { guildId, claimantMemberId, evidence, character } = input;
  const key = claimKey(character);
  const claims = await tx.characterVerifyClaim.findMany({ where: { guildId, nameKey: { in: [key] } }, select: { memberId: true, status: true } });
  const statusOf = (memberId: string) => claims.find((claim) => claim.memberId === memberId)?.status ?? null;
  const mine = statusOf(claimantMemberId);
  if (mine === "BLOCKED" || mine === "REMOVED") return "declined";
  const ownerEvidence = evidenceOf(character, statusOf(character.memberId));
  const where = { characterId_claimantMemberId: { characterId: character.id, claimantMemberId } };
  const earlier = await tx.characterLinkConflict.findUnique({ where });
  // Undone, decided by an officer, or already waiting for one: nothing moves by itself any more.
  if (earlier && earlier.status !== "WEAKER" && earlier.status !== "MOVED") return earlier.status === "OPEN" ? "queued" : "declined";
  const difference = evidenceRank(evidence) - evidenceRank(ownerEvidence);
  const status = difference > 0 ? "MOVED" : difference === 0 ? "OPEN" : "WEAKER";
  if (earlier?.status === status && earlier.ownerMemberId === character.memberId) return status === "MOVED" ? "declined" : "weaker";
  if (status === "MOVED" && !await moveCharacter(tx, character.id, claimantMemberId, { evidence, by: "proof" })) return "declined";
  const data = { guildId, ownerMemberId: character.memberId, ownerEvidence, claimantEvidence: evidence, status, notifiedAt: null };
  await tx.characterLinkConflict.upsert({ where, create: { characterId: character.id, claimantMemberId, ...data }, update: data });
  return status === "MOVED" ? "moved" : status === "OPEN" ? "queued" : "weaker";
}

/** /officer character move: the officer decides. Works on a linked or a detached character and closes its queue. */
export async function officerMoveCharacter(database: PrismaClient, characterId: string, toMemberId: string): Promise<MoveResult | null> {
  return database.$transaction(async (tx) => {
    const moved = await moveCharacter(tx, characterId, toMemberId, { evidence: "officer", by: "officer" });
    if (moved) await tx.characterLinkConflict.updateMany({ where: { characterId, status: { in: ["OPEN", "MOVED", "WEAKER"] } }, data: { status: "RESOLVED" } });
    return moved;
  });
}

export type UndoOutcome =
  | { status: "gone" | "not-yours" }
  | { status: "undone" | "contested"; guildId: string; characterName: string; ownerMemberId: string; claimantMemberId: string };

/**
 * The undo button of a move DM. The member who received the character ("not mine") gives it back and
 * is not offered it again. The member who lost it takes it back and the question goes to the officers:
 * the stronger proof does not move it a second time.
 */
export async function undoMove(database: PrismaClient, conflictId: string, discordUserId: string): Promise<UndoOutcome> {
  return database.$transaction(async (tx) => {
    const conflict = await tx.characterLinkConflict.findUnique({ where: { id: conflictId }, include: { character: true } });
    if (!conflict || conflict.status !== "MOVED" || conflict.character.memberId !== conflict.claimantMemberId || conflict.character.detachedAt) return { status: "gone" as const };
    const members = await tx.member.findMany({ where: { id: { in: [conflict.ownerMemberId, conflict.claimantMemberId] } }, select: { id: true, discordUserId: true, status: true } });
    const presser = members.find((member) => member.discordUserId === discordUserId);
    const owner = members.find((member) => member.id === conflict.ownerMemberId);
    if (!presser) return { status: "not-yours" as const };
    if (!owner || isHoldingMember(owner)) return { status: "gone" as const };
    const evidence = isEvidence(conflict.ownerEvidence) ? conflict.ownerEvidence : "named";
    if (!await moveCharacter(tx, conflict.characterId, conflict.ownerMemberId, { evidence, by: "undo" })) return { status: "gone" as const };
    const byClaimant = presser.id === conflict.claimantMemberId;
    if (byClaimant) await setClaim(tx, conflict.guildId, conflict.claimantMemberId, claimKey(conflict.character), "BLOCKED");
    await tx.characterLinkConflict.update({ where: { id: conflict.id }, data: { status: byClaimant ? "UNDONE" : "OPEN", notifiedAt: new Date() } });
    return { status: byClaimant ? "undone" as const : "contested" as const, guildId: conflict.guildId, characterName: conflict.character.displayName ?? conflict.character.name,
      ownerMemberId: conflict.ownerMemberId, claimantMemberId: conflict.claimantMemberId };
  });
}
