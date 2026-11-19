import type { PrismaClient } from "../generated/prisma/client.js";
import { markMemberChanged } from "./member-sync-events.js";

/**
 * Makes one of a member's characters their main: one transaction, so the member always has exactly one main (the others are
 * cleared first), then nickname and rank role follow (markMemberChanged). Shared by the Discord /character panel and the
 * website's My Guilded table. The caller has already checked the character belongs to the member.
 */
export async function setMainCharacter(
  database: Pick<PrismaClient, "$transaction" | "character">, guildId: string, memberId: string, characterId: string
): Promise<void> {
  await database.$transaction([
    database.character.updateMany({ where: { memberId, isMain: true }, data: { isMain: false } }),
    database.character.update({ where: { id: characterId }, data: { isMain: true } })
  ]);
  markMemberChanged({ guildId, memberId });
}
