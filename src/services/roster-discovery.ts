import type { Prisma } from "@prisma/client";
import type { AddonCharacter } from "../integrations/addon.js";
import { syncProfessionSnapshot } from "./profession-snapshot.js";
import { findCharacter } from "./character-match.js";
import { normalizeClassName, normalizeRaceName } from "./character-import.js";

// Characters that addons reveal through the guild digest (name, class, race,
// level, spec, professions). A character already linked to a Discord member is
// refreshed; any other is remembered as "unclaimed" until it is linked
// (automatically by Discord name, or with /character claim).

export const nameKey = (name: string) => name.trim().toLowerCase();

type Tx = Prisma.TransactionClient;
type Linked = { id: string; name: string; realm: string };

export interface DiscoveryResult {
  refreshed: number;
  discovered: number;
}

export async function applyDiscoveredCharacters(tx: Tx, guildId: string, entries: readonly AddonCharacter[], linked: readonly Linked[]): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { refreshed: 0, discovered: 0 };
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = nameKey(entry.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const className = entry.class ? normalizeClassName(entry.class) : "";
    const race = entry.race ? normalizeRaceName(entry.race) : null;
    const level = entry.level >= 1 ? entry.level : null;
    const spec = entry.spec || null;
    const existing = findCharacter(linked, entry.name, entry.realm);
    if (existing) {
      await tx.character.update({
        where: { id: existing.id },
        data: { ...(className ? { className } : {}), ...(race ? { race } : {}), ...(level ? { level } : {}), ...(spec ? { spec } : {}), lastSeenAt: new Date() }
      });
      await syncProfessionSnapshot(tx, guildId, existing, entry.professions, entry.professionsComplete === true, entry.professionsAt ?? new Date());
      result.refreshed++;
      continue;
    }
    if (!className) continue;
    const before = await tx.unclaimedCharacter.findUnique({ where: { guildId_nameKey: { guildId, nameKey: key } }, select: { id: true, professionsUpdatedAt: true } });
    const at = entry.professionsAt ?? new Date();
    const acceptProfessions = !before?.professionsUpdatedAt || (entry.professionsComplete === true && at > before.professionsUpdatedAt);
    const data = {
      name: entry.name, realm: entry.realm, className, race, level, spec,
      ...(acceptProfessions ? { professions: entry.professions as unknown as Prisma.InputJsonValue, ...(entry.professionsComplete === true ? { professionsUpdatedAt: at } : {}) } : {}), lastSeenAt: new Date()
    };
    await tx.unclaimedCharacter.upsert({
      where: { guildId_nameKey: { guildId, nameKey: key } },
      create: { guildId, nameKey: key, professions: entry.professions as unknown as Prisma.InputJsonValue, ...data },
      update: data
    });
    if (acceptProfessions && entry.professionsComplete === true) {
      const where = { guildId, character: entry.name, realm: entry.realm, profession: { notIn: entry.professions.map((profession) => profession.name) } };
      await tx.recipeKnown.deleteMany({ where });
      await tx.professionCooldown.deleteMany({ where });
    }
    if (!before) result.discovered++;
  }
  return result;
}
