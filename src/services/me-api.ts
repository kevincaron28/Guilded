import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAuditService } from "./audit.js";
import { setMainCharacter } from "./character-main.js";
import { unlinkNotMine } from "./companion-link-dm.js";
import { markMemberChanged } from "./member-sync-events.js";
import { meCharacterList, type MeCharacter } from "./me-characters.js";
import { PROMOTION_VOICE_DAYS } from "./promotion.js";
import { promotionProgressFor, type PromotionProgress } from "./promotion-status.js";

// The phone app's "My characters" and "What I still need to be promoted" (mobile 0.5.0). The same data and the same two actions as
// My Guilded on the website (me-characters.ts, me-character-actions.ts, promotion-status.ts), behind the companion credential
// instead of the web session. The caller (companion-api.ts) has already turned the credential into a Discord user id.
// A character id is never trusted: it is re-read and must belong to that user and still be linked. Any other id, existing or
// not, answers the same refusal without a name.

const ID = /^[a-z0-9]{20,40}$/;

type CharacterDb = Pick<PrismaClient, "character" | "member" | "guildSettings" | "characterVerifyClaim" | "auditLog" | "$transaction">;
export type MeActionResult = { status: "ok" } | { status: "forbidden" } | { status: "gone" } | { status: "failed" };

export async function meCharactersFor(database: Pick<PrismaClient, "character" | "characterVerifyClaim" | "guildRosterEntry">, discordUserId: string): Promise<{ characters: MeCharacter[] }> {
  const characters = await meCharacterList(database)(discordUserId);
  // The armory name is a website link helper; the phone does not need it.
  return { characters: characters.map(({ armoryName: _armoryName, ...rest }) => rest as MeCharacter) };
}

async function own(database: CharacterDb, discordUserId: string, id: unknown) {
  if (typeof id !== "string" || !ID.test(id)) return null;
  const row = await database.character.findUnique({
    where: { id },
    select: { id: true, name: true, detachedAt: true, member: { select: { id: true, guildId: true, discordUserId: true, status: true } } }
  });
  if (!row || row.detachedAt || row.member.status === "LEFT" || row.member.discordUserId !== discordUserId) return null;
  return row;
}

export async function makeMainFor(database: CharacterDb, discordUserId: string, characterId: unknown): Promise<MeActionResult> {
  const row = await own(database, discordUserId, characterId);
  if (!row) return { status: "forbidden" };
  try {
    await setMainCharacter(database, row.member.guildId, row.member.id, row.id);
    await createAuditService(database as unknown as PrismaClient).record({ guildId: row.member.guildId, actorId: row.member.id, action: "CHARACTER_MAIN_SET", entityId: row.id, metadata: { source: "app", name: row.name } }).catch(() => undefined);
  } catch (error) {
    console.warn("Phone app: Make main failed:", error instanceof Error ? error.message : String(error));
    return { status: "failed" };
  }
  return { status: "ok" };
}

/** The Discord panel's own unlink (detached with its history, a BLOCKED claim so nothing links it back, the officer-log line). */
export async function unlinkFor(database: CharacterDb, client: Pick<Client, "guilds"> | null, discordUserId: string, characterId: unknown): Promise<MeActionResult> {
  const row = await own(database, discordUserId, characterId);
  if (!row) return { status: "forbidden" };
  // Without a Discord client (not ready, tests) the officer-log post is skipped: unlinkNotMine tolerates a failed guild fetch.
  const discord = client ?? ({ guilds: { fetch: async () => { throw new Error("no client"); } } } as unknown as Pick<Client, "guilds">);
  try {
    const result = await unlinkNotMine(database as unknown as Parameters<typeof unlinkNotMine>[0], discord, discordUserId, row.id, "web");
    if (!result.undoId) return { status: "gone" };
    markMemberChanged({ guildId: row.member.guildId, memberId: row.member.id });
    await createAuditService(database as unknown as PrismaClient).record({ guildId: row.member.guildId, actorId: row.member.id, action: "CHARACTER_UNLINKED_WEB", entityId: row.id, metadata: { source: "app", name: row.name } }).catch(() => undefined);
  } catch (error) {
    console.warn("Phone app: Unlink failed:", error instanceof Error ? error.message : String(error));
    return { status: "failed" };
  }
  return { status: "ok" };
}

export interface MePromotionServer {
  serverName: string; guildDiscordId: string;
  state: PromotionProgress["state"]; rank: string | null; linked: boolean; character: string | null;
  fromRank: string; minDays: number; minLevel: number | null; requireLink: boolean; minVoiceMinutes: number; voiceDays: number;
  days: number | null; level: number | null; voiceMinutes: number; ready: boolean;
}

/** One entry per server the member is in (their own progress only; the numbers the officers' rule uses). */
export async function mePromotionFor(
  database: Pick<PrismaClient, "member" | "guildSettings" | "memberVoiceHour">, discordUserId: string, allows: (guildDiscordId: string) => boolean = () => true, now = new Date()
): Promise<{ servers: MePromotionServer[] }> {
  const memberships = await database.member.findMany({
    where: { discordUserId, status: "ACTIVE", isTest: false },
    select: { guildId: true, guild: { select: { discordId: true, name: true, gameEdition: true } } }, take: 10
  });
  const servers: MePromotionServer[] = [];
  for (const membership of memberships) {
    if (!allows(membership.guild.discordId)) continue;
    const { progress } = await promotionProgressFor(database, membership.guildId, discordUserId, membership.guild.gameEdition ?? "forever", now);
    servers.push({
      serverName: membership.guild.name, guildDiscordId: membership.guild.discordId,
      state: progress.state, rank: progress.rank ?? null, linked: progress.linked, character: progress.character ?? null,
      fromRank: progress.rule.fromRank, minDays: progress.rule.minDays, minLevel: progress.rule.minLevel, requireLink: progress.rule.requireLink,
      minVoiceMinutes: progress.rule.minVoiceMinutes, voiceDays: PROMOTION_VOICE_DAYS,
      days: progress.days, level: progress.level, voiceMinutes: progress.voiceMinutes, ready: progress.ready
    });
  }
  return { servers };
}
