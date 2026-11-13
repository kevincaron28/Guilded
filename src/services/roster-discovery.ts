import type { Prisma } from "../generated/prisma/client.js";
import { mergeProfessionSkills } from "./profession-names.js";
import type { AddonCharacter } from "../integrations/addon.js";
import { syncProfessionSnapshot } from "./profession-snapshot.js";
import { findCharacter } from "./character-match.js";
import { normalizeClassName, normalizeRaceName } from "./character-import.js";
import { gameEditionOf } from "./game-edition.js";
import { guildRankUpdate } from "./guild-rank.js";
import { characterKey } from "../../companion/character-identity.mjs";

// Characters that addons reveal through the guild digest (name, class, race,
// level, spec, professions). A character already linked to a Discord member is
// refreshed; any other is remembered as "unclaimed" until it is linked
// (automatically by Discord name, or with /character claim).

export const nameKey = (name: string) => name.trim().toLowerCase();

type Tx = Prisma.TransactionClient;
type Linked = {
  id: string; name: string; realm: string; gameEdition?: string;
  // What the caller already read (the guild's characters): lets an unchanged character skip its write.
  className?: string | null; race?: string | null; level?: number | null; spec?: string | null; displayName?: string | null;
  guildRankName?: string | null; guildRankIndex?: number | null; lastSeenAt?: Date | null; professionsUpdatedAt?: Date | null;
};

// Last seen only moves forward when the move means something (an hour): every character in every officer upload used to be
// one UPDATE plus its profession statements, thousands per upload.
const SEEN_REFRESH_MS = 60 * 60_000;
const sameStored = (existing: Linked, data: Record<string, unknown>): boolean => {
  if (!(existing.lastSeenAt instanceof Date) || Date.now() - existing.lastSeenAt.getTime() >= SEEN_REFRESH_MS) return false;
  for (const [key, value] of Object.entries(data)) {
    if (key === "lastSeenAt" || key === "guildRankAt") continue;
    if (!(key in existing) || (existing as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
};

export interface DiscoveryResult {
  refreshed: number;
  discovered: number;
}

export async function applyDiscoveredCharacters(tx: Tx, guildId: string, entries: readonly AddonCharacter[], linked: readonly Linked[]): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { refreshed: 0, discovered: 0 };
  const seen = new Set<string>();
  const touched: string[] = [];
  // The unclaimed rows of everyone not linked, in one read (it was one per entry). Test doubles without findMany read one by one.
  const unlinkedKeys = entries.filter((entry) => !findCharacter(linked, entry.name, entry.realm, gameEditionOf(entry))).map((entry) => characterKey(entry.name, entry.realm, gameEditionOf(entry))).filter(Boolean);
  const preloaded = unlinkedKeys.length && typeof tx.unclaimedCharacter.findMany === "function"
    ? new Map((await tx.unclaimedCharacter.findMany({ where: { guildId, nameKey: { in: unlinkedKeys } }, select: { id: true, nameKey: true, professionsUpdatedAt: true, lastSeenAt: true, className: true, race: true, level: true, spec: true, displayName: true, guildRankName: true } })).map((row) => [row.nameKey, row]))
    : null;
  for (const entry of entries) {
    const gameEdition = gameEditionOf(entry);
    const key = characterKey(entry.name, entry.realm, gameEdition);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const professions = mergeProfessionSkills(entry.professions);
    const className = entry.class ? normalizeClassName(entry.class) : "";
    const race = entry.race ? normalizeRaceName(entry.race) : null;
    const level = entry.level >= 1 ? entry.level : null;
    const spec = entry.spec || null;
    const existing = findCharacter(linked, entry.name, entry.realm, gameEdition);
    if (existing) {
      const data = { ...(entry.displayName ? { displayName: entry.displayName } : {}), ...(className ? { className } : {}), ...(race ? { race } : {}), ...(level ? { level } : {}), ...(spec ? { spec } : {}), ...guildRankUpdate(entry), lastSeenAt: new Date() };
      if (!sameStored(existing, data)) await tx.character.update({ where: { id: existing.id }, data });
      await syncProfessionSnapshot(tx, guildId, existing, professions, entry.professionsComplete === true, entry.professionsAt ?? new Date(),
        "professionsUpdatedAt" in existing ? { professionsUpdatedAt: existing.professionsUpdatedAt ?? null } : undefined);
      result.refreshed++;
      continue;
    }
    if (!className) continue;
    const before = preloaded ? preloaded.get(key) ?? null : await tx.unclaimedCharacter.findUnique({ where: { guildId_nameKey: { guildId, nameKey: key } }, select: { id: true, professionsUpdatedAt: true } });
    const at = entry.professionsAt ?? new Date();
    const acceptProfessions = !before?.professionsUpdatedAt || (entry.professionsComplete === true && at > before.professionsUpdatedAt);
    // Nothing new about someone already remembered, seen within the hour: no field write. Their last seen is still refreshed for the
    // whole upload below (one updateMany): the sole-newcomer auto-link counts the characters an upload brought by last seen.
    const stored = before as { lastSeenAt?: Date | null; className?: string; race?: string | null; level?: number | null; spec?: string | null; displayName?: string | null; guildRankName?: string | null } | null;
    if (preloaded && stored && !acceptProfessions && stored.lastSeenAt instanceof Date && Date.now() - stored.lastSeenAt.getTime() < SEEN_REFRESH_MS
      && stored.className === className && (stored.race ?? null) === race && (stored.level ?? null) === level && (stored.spec ?? null) === spec
      && (!entry.displayName || stored.displayName === entry.displayName) && (entry.guildRankName === undefined || stored.guildRankName === entry.guildRankName)) { touched.push((before as { id: string }).id); continue; }
    const data = {
      name: entry.name, realm: entry.realm, className, race, level, spec,
      gameEdition,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      ...(acceptProfessions ? { professions: professions as unknown as Prisma.InputJsonValue, ...(entry.professionsComplete === true ? { professionsUpdatedAt: at } : {}) } : {}), lastSeenAt: new Date(),
      // 8.5 C5: the rank the officer's upload reported (omitted by older uploads, which keep the last one).
      ...(entry.guildRankName !== undefined ? { guildRankName: entry.guildRankName, guildRankAt: new Date() } : {})
    };
    await tx.unclaimedCharacter.upsert({
      where: { guildId_nameKey: { guildId, nameKey: key } },
      create: { guildId, nameKey: key, professions: professions as unknown as Prisma.InputJsonValue, ...data },
      update: data
    });
    if (acceptProfessions && entry.professionsComplete === true) {
      const where = { guildId, character: entry.name, realm: entry.realm, profession: { notIn: professions.map((profession) => profession.name) } };
      await tx.recipeKnown.deleteMany({ where });
      await tx.professionCooldown.deleteMany({ where });
    }
    if (!before) result.discovered++;
  }
  for (let from = 0; from < touched.length; from += 1_000) {
    await tx.unclaimedCharacter.updateMany({ where: { id: { in: touched.slice(from, from + 1_000) } }, data: { lastSeenAt: new Date() } });
  }
  return result;
}
