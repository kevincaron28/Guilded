import type { PrismaClient } from "@prisma/client";
import type { AddonSnapshot } from "../integrations/addon.js";
import { applyDiscoveredCharacters } from "./roster-discovery.js";
import { findCharacter } from "./character-match.js";
import { syncProfessionSnapshot } from "./profession-snapshot.js";
import { applyRecipeData } from "./recipes.js";

// Officer uploads may relay guild professions even while ledger imports await review.
// Keep this explicit allowlist separate from apply(): no points, loot, runs or attendance.
export async function relayProfessions(database: PrismaClient, guildId: string, snapshot: AddonSnapshot) {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    const characters = await tx.character.findMany({ where: { member: { guildId } }, select: { id: true, name: true, realm: true } });
    const discovery = await applyDiscoveredCharacters(tx, guildId,
      [...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts, ...snapshot.characters], characters);
    for (const entry of snapshot.readiness) {
      const character = findCharacter(characters, entry.character, entry.realm);
      if (character) await syncProfessionSnapshot(tx, guildId, character, entry.professions,
        entry.professionsComplete === true, entry.professionsAt ?? entry.inspectedAt ?? snapshot.exportedAt);
    }
    const crafting = await applyRecipeData(tx, guildId, { recipes: snapshot.recipes, recipeNames: snapshot.recipeNames, cooldowns: snapshot.cooldowns });
    return { ...discovery, recipeSets: crafting.recipeSets };
  }, { timeout: 60_000, maxWait: 15_000 });
}
