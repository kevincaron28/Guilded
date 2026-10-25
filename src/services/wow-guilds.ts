import { z } from "zod";
import { GAME_EDITIONS } from "../../companion/game-edition.mjs";
import type { PrismaClient } from "../generated/prisma/client.js";

const label = z.string().trim().min(1).max(80).refine(value => !value.includes("|") && Array.from(value).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
export const wowGuildInput = z.object({ gameEdition: z.enum(GAME_EDITIONS), name: label, realm: label });
type Db = Pick<PrismaClient, "wowGuild">;
const key = (value: string) => value.normalize("NFC").toLowerCase();

/** Idempotent registration within the authenticated Discord server. */
export async function registerWowGuild(database: Db, guildId: string, input: unknown) {
  const data = wowGuildInput.parse(input);
  const identity = { guildId, gameEdition: data.gameEdition, nameKey: key(data.name), realmKey: key(data.realm) };
  return database.wowGuild.upsert({
    where: { guildId_gameEdition_realmKey_nameKey: identity },
    create: { ...identity, ...data },
    update: { name: data.name, realm: data.realm }
  });
}

/** Never select the first guild: ambiguous choices require a concrete guild ID. */
export async function resolveWowGuild(database: Db, guildId: string, selectedId?: string) {
  if (selectedId) {
    const selected = await database.wowGuild.findFirst({ where: { id: selectedId, guildId } });
    if (!selected) throw new Error("That in-game guild is not configured in this Discord server.");
    return selected;
  }
  const choices = await database.wowGuild.findMany({ where: { guildId }, take: 2, orderBy: { id: "asc" } });
  if (choices.length !== 1) throw new Error(choices.length ? "Choose the in-game guild for this action." : "Configure an in-game guild first.");
  return choices[0]!;
}
