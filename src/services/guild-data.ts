import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { AddonSnapshot } from "../integrations/addon.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { gameEditionOf } from "./game-edition.js";
import { findCharacter } from "./character-match.js";

// What the game shows every member about the whole guild (8.5, docs/GUILD_DATA_INVENTORY.md):
// the roster (level, class, rank, last online), the guild event log and the MOTD/info text.
// Any paired member's upload brings it, so members who never install Guilded still reach the
// race board, last seen, roster gaps, statistics and the promotion panel.
//
// Rules:
//   * Latest wins, never double counted: a roster row is replaced only by a newer reading
//     (observedAt); an event is stored once (same kind, names and rank within 3 hours).
//   * Levels only go up; last seen only moves forward; nothing is dated in the future.
//   * Rank is applied only from an OFFICER's upload: rank drives Discord rank roles, and a
//     member's saved file could be edited. The roster table keeps every reading for display.
//   * Never links a character to a member and never deletes anything; "left the guild" is
//     concluded only from the newest COMPLETE roster (offline members shown).

export const SAME_EVENT_MS = 3 * 3600 * 1000;
const FUTURE_SLACK_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 30 * 86_400_000;

const nameSchema = z.string().trim().min(1).max(80).refine((value) => !/[|\p{Cc}]/u.test(value));
const memberSchema = z.object({
  name: nameSchema,
  level: z.number().int().min(1).max(100).optional(),
  class: z.string().regex(/^[A-Z]{1,20}$/).optional(),
  rankName: z.string().trim().min(1).max(60).optional(),
  rankIndex: z.number().int().min(0).max(19).optional(),
  online: z.boolean().default(false),
  lastOnline: z.number().int().positive().optional()
});
const eventSchema = z.object({
  type: z.enum(["invite", "join", "promote", "demote", "remove", "quit"]),
  actor: nameSchema,
  target: nameSchema.optional(),
  rank: z.string().trim().min(1).max(60).optional(),
  at: z.number().int().positive()
});

export interface GuildDataResult { roster: number; skippedOlder: boolean; left: number; characters: number; unclaimed: number; events: number; duplicateEvents: number; text: boolean; ranksDated: number }

type Tx = Pick<Prisma.TransactionClient, "guildRosterEntry" | "guildEventEntry" | "guildText" | "character" | "unclaimedCharacter" | "characterRankSeen">;

const toDate = (epoch: number | undefined) => epoch === undefined ? undefined : new Date(epoch * 1000);
const later = (a: Date | null | undefined, b: Date | undefined) => b && (!a || b > a) ? b : undefined;
const titleClass = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

/** Applies one upload's guild data inside the caller's transaction. */
export async function applyGuildData(tx: Tx, guildId: string, uploader: { memberId: string | null; officer: boolean },
  snapshot: Pick<AddonSnapshot, "guildRoster" | "guildEvents" | "guildInfo" | "gameEdition" | "interface">, now = new Date()): Promise<GuildDataResult> {
  const result: GuildDataResult = { roster: 0, skippedOlder: false, left: 0, characters: 0, unclaimed: 0, events: 0, duplicateEvents: 0, text: false, ranksDated: 0 };
  const edition = gameEditionOf(snapshot);
  const fresh = (at: Date) => at.getTime() <= now.getTime() + FUTURE_SLACK_MS && now.getTime() - at.getTime() <= MAX_AGE_MS;
  const reportedById = uploader.memberId;

  // Roster: every member, with or without the addon.
  const roster = snapshot.guildRoster;
  const observedAt = roster ? new Date(roster.at * 1000) : null;
  if (roster && observedAt && fresh(observedAt)) {
    const members = roster.members.flatMap((raw) => { const parsed = memberSchema.safeParse(raw); return parsed.success ? [parsed.data] : []; });
    const stored = await tx.guildRosterEntry.findMany({ where: { guildId, gameEdition: edition } });
    const newest = stored.reduce<Date | null>((max, row) => !max || row.observedAt > max ? row.observedAt : max, null);
    if (newest && observedAt <= newest) result.skippedOlder = true;
    const byKey = new Map(stored.map((row) => [row.nameKey, row]));
    const characters = await tx.character.findMany({ where: { member: { guildId }, gameEdition: edition },
      select: { id: true, name: true, realm: true, gameEdition: true, displayName: true, level: true, className: true, lastSeenAt: true, guildRankName: true } });
    const unclaimed = await tx.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition }, select: { id: true, nameKey: true, level: true, lastSeenAt: true } });
    const unclaimedByKey = new Map(unclaimed.map((row) => [row.nameKey, row]));
    const seenKeys = new Set<string>();
    for (const member of members) {
      const key = String(characterKey(member.name, "", edition));
      seenKeys.add(key);
      const lastOnline = toDate(member.online ? Math.trunc(observedAt.getTime() / 1000) : member.lastOnline);
      const lastOnlineOk = lastOnline && lastOnline.getTime() <= now.getTime() + FUTURE_SLACK_MS ? lastOnline : undefined;
      const previous = byKey.get(key);
      if (!previous || previous.observedAt < observedAt) {
        const data = { name: member.name, level: member.level ?? previous?.level ?? null, className: member.class ?? previous?.className ?? null,
          rankName: member.rankName ?? null, rankIndex: member.rankIndex ?? null,
          lastOnlineAt: later(previous?.lastOnlineAt, lastOnlineOk) ?? previous?.lastOnlineAt ?? null, inGuild: true, observedAt, reportedById };
        await tx.guildRosterEntry.upsert({ where: { guildId_gameEdition_nameKey: { guildId, gameEdition: edition, nameKey: key } },
          create: { guildId, gameEdition: edition, nameKey: key, ...data }, update: data });
        result.roster++;
      }
      // The same facts on the bot's own characters: level up only, last seen forward only.
      const character = findCharacter(characters, member.name, "", edition);
      if (character) {
        const update: Prisma.CharacterUpdateInput = {};
        if (member.level && member.level > (character.level ?? 0)) update.level = member.level;
        if (member.class && (!character.className || character.className === "UNKNOWN")) update.className = titleClass(member.class);
        const seen = later(character.lastSeenAt, lastOnlineOk);
        if (seen) update.lastSeenAt = seen;
        if (uploader.officer && member.rankName !== undefined && member.rankIndex !== undefined) {
          update.guildRankName = member.rankName; update.guildRankIndex = member.rankIndex; update.guildRankAt = observedAt;
        }
        if (Object.keys(update).length) {
          await tx.character.update({ where: { id: character.id }, data: update });
          Object.assign(character, update);
          result.characters++;
        }
        continue;
      }
      const existing = unclaimedByKey.get(key);
      const seen = later(existing?.lastSeenAt, lastOnlineOk);
      if (existing) {
        const update: Prisma.UnclaimedCharacterUpdateInput = {};
        if (member.level && member.level > (existing.level ?? 0)) update.level = member.level;
        if (seen) update.lastSeenAt = seen;
        if (uploader.officer && member.rankName !== undefined) { update.guildRankName = member.rankName; update.guildRankAt = observedAt; }
        if (Object.keys(update).length) { await tx.unclaimedCharacter.update({ where: { id: existing.id }, data: update }); result.unclaimed++; }
      } else if (member.class && !result.skippedOlder) {
        // A guild member nobody linked yet: listed as unlinked (never linked to anyone here).
        await tx.unclaimedCharacter.create({ data: { guildId, gameEdition: edition, nameKey: key, name: member.name, realm: "",
          className: titleClass(member.class), ...(member.level ? { level: member.level } : {}), lastSeenAt: lastOnlineOk ?? observedAt,
          ...(uploader.officer && member.rankName !== undefined ? { guildRankName: member.rankName, guildRankAt: observedAt } : {}) } });
        unclaimedByKey.set(key, { id: "", nameKey: key, level: member.level ?? null, lastSeenAt: lastOnlineOk ?? observedAt });
        result.unclaimed++;
      }
    }
    // Only the newest complete roster may say someone left.
    if (roster.complete && !result.skippedOlder && seenKeys.size) {
      const gone = stored.filter((row) => row.inGuild && !seenKeys.has(row.nameKey)).map((row) => row.id);
      if (gone.length) result.left = (await tx.guildRosterEntry.updateMany({ where: { id: { in: gone } }, data: { inGuild: false, observedAt } })).count;
    }
  }

  // Event log: stored once whoever reads it.
  const events = snapshot.guildEvents.flatMap((raw) => { const parsed = eventSchema.safeParse(raw); return parsed.success ? [parsed.data] : []; })
    .map((event) => ({ ...event, when: new Date(event.at * 1000) })).filter((event) => event.when.getTime() <= now.getTime() + FUTURE_SLACK_MS);
  if (events.length) {
    const earliest = new Date(Math.min(...events.map((e) => e.when.getTime())) - SAME_EVENT_MS);
    const known = await tx.guildEventEntry.findMany({ where: { guildId, gameEdition: edition, at: { gte: earliest } } });
    const same = (a: { kind: string; actor: string; target: string | null; rank: string | null; at: Date }, b: typeof a) =>
      a.kind === b.kind && a.actor.toLowerCase() === b.actor.toLowerCase() && (a.target ?? "").toLowerCase() === (b.target ?? "").toLowerCase()
      && (a.rank ?? "") === (b.rank ?? "") && Math.abs(a.at.getTime() - b.at.getTime()) <= SAME_EVENT_MS;
    for (const event of events) {
      const row = { kind: event.type, actor: event.actor, target: event.target ?? null, rank: event.rank ?? null, at: event.when };
      if (known.some((stored) => same(stored, row))) { result.duplicateEvents++; continue; }
      await tx.guildEventEntry.create({ data: { guildId, gameEdition: edition, ...row, reportedById } });
      known.push({ ...row, id: "", guildId, gameEdition: edition, reportedById, createdAt: now });
      result.events++;
    }
  }
  result.ranksDated = await dateRanksFromLog(tx, guildId, edition);

  // MOTD and info text: the newest reading wins.
  const text = snapshot.guildInfo;
  if (text && (text.motd !== undefined || text.info !== undefined)) {
    const at = new Date(text.at * 1000);
    const current = await tx.guildText.findUnique({ where: { guildId } });
    if (fresh(at) && (!current || current.observedAt < at)) {
      const data = { motd: text.motd ?? null, info: text.info ?? null, observedAt: at, reportedById };
      await tx.guildText.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
      result.text = true;
    }
  }
  return result;
}

/**
 * The promotion panel's "in this rank since" (CharacterRankSeen) from the game's own log: the
 * latest promotion or demotion to a character's current rank, else their join for a character
 * never promoted. Only moves the date earlier than what was observed, never changes a rank.
 */
export async function dateRanksFromLog(tx: Pick<Tx, "guildEventEntry" | "character" | "characterRankSeen">, guildId: string, edition: string): Promise<number> {
  const characters = await tx.character.findMany({ where: { member: { guildId }, gameEdition: edition, guildRankName: { not: null } },
    select: { id: true, name: true, guildRankName: true, rankSeen: { select: { rankName: true, since: true } } } });
  if (!characters.length) return 0;
  const events = await tx.guildEventEntry.findMany({ where: { guildId, gameEdition: edition, kind: { in: ["promote", "demote", "join"] } }, orderBy: { at: "desc" } });
  let dated = 0;
  for (const character of characters) {
    const name = character.name.toLowerCase();
    const moves = events.filter((e) => (e.kind === "promote" || e.kind === "demote") && (e.target ?? "").toLowerCase() === name);
    const match = moves.find((e) => e.rank === character.guildRankName)
      ?? (moves.length ? undefined : events.find((e) => e.kind === "join" && e.actor.toLowerCase() === name));
    if (!match) continue;
    const seen = character.rankSeen;
    if (seen && seen.rankName === character.guildRankName && seen.since <= match.at) continue;
    await tx.characterRankSeen.upsert({ where: { characterId: character.id },
      create: { characterId: character.id, rankName: character.guildRankName!, since: match.at },
      update: { rankName: character.guildRankName!, since: match.at } });
    dated++;
  }
  return dated;
}
