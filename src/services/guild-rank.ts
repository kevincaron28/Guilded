import type { AddonCharacter } from "../integrations/addon.js";

// A character's rank in its own WoW guild (from the addon's guild roster). Index 0 is the guild
// master; higher numbers are lower ranks. Kept on the linked Character record only.

export interface GuildRank {
  name: string;
  index: number;
}

type RankFields = { guildRankName?: string | null | undefined; guildRankIndex?: number | null | undefined };

// Prisma update data for an upload entry: empty when the entry carries no rank, so an older
// addon or companion never erases a rank an earlier upload recorded.
export function guildRankUpdate(entry: Pick<AddonCharacter, "guildRankName" | "guildRankIndex">, at: Date = new Date()) {
  return entry.guildRankName !== undefined && entry.guildRankIndex !== undefined
    ? { guildRankName: entry.guildRankName, guildRankIndex: entry.guildRankIndex, guildRankAt: at }
    : {};
}

// The rank of a stored character, or null when none was ever reported.
export function guildRankOf(character: RankFields | null | undefined): GuildRank | null {
  const name = character?.guildRankName?.trim();
  const index = character?.guildRankIndex;
  return name && typeof index === "number" && Number.isInteger(index) && index >= 0 ? { name, index } : null;
}

// One short line for a card under the player name ("Officer · rank 2"), or null without a rank.
export function guildRankLine(character: RankFields | null | undefined, maxLength = 28): string | null {
  const rank = guildRankOf(character);
  if (!rank) return null;
  return rank.name.length > maxLength ? `${rank.name.slice(0, maxLength - 1)}…` : rank.name;
}
