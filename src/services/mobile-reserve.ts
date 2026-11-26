import type { PrismaClient } from "../generated/prisma/client.js";
import { placeReserve, removeReserve, type ReserveOutcome } from "./reserve-requests.js";

// The phone app's soft reserve: the same request as /loot reserve, for the member who holds the
// companion credential. The caller (companion-api.ts) has already turned the credential into a
// Discord user id. The server and the character are re-read: someone else's answers "gone".

const GUILD_ID = /^\d{5,30}$/;

export type ReserveResult =
  | { status: "ok"; outcome: ReserveOutcome }
  | { status: "invalid" }
  | { status: "gone" }
  | { status: "refused"; message: string };

type Db = Pick<PrismaClient, "member" | "character" | "reserveList" | "itemReserve" | "reserveRequest" | "recipeKnown">;

export async function reserveFor(
  database: Db, discordUserId: string, input: { guildDiscordId?: unknown; characterId?: unknown; item?: unknown; remove?: unknown },
  allows: (id: string) => boolean = () => true, now = new Date()
): Promise<ReserveResult> {
  const { guildDiscordId, characterId, item } = input;
  if (typeof item !== "string" || !item.trim() || item.length > 300) return { status: "invalid" };
  if (typeof characterId !== "string" || !characterId || characterId.length > 60) return { status: "invalid" };
  if (typeof guildDiscordId !== "string" || !GUILD_ID.test(guildDiscordId) || !allows(guildDiscordId)) return { status: "gone" };
  const member = await database.member.findFirst({ where: { discordUserId, status: "ACTIVE", isTest: false, guild: { discordId: guildDiscordId } }, select: { id: true, guildId: true } });
  if (!member) return { status: "gone" };
  const character = await database.character.findFirst({ where: { id: characterId, memberId: member.id }, select: { name: true, realm: true } });
  if (!character) return { status: "gone" };
  const request = { guildId: member.guildId, memberId: member.id, character: character.name, realm: character.realm, item };
  try {
    return { status: "ok", outcome: await (input.remove === true ? removeReserve(database, request, now) : placeReserve(database, request, now)) };
  } catch (error) {
    // Only a plain, short Error is an answer for the member (services/error-report.ts); anything else is a failure.
    if (error instanceof Error && error.constructor === Error && error.message.length < 200) return { status: "refused", message: error.message };
    throw error;
  }
}
