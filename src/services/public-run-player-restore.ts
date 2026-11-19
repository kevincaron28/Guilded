// Repair for public runs whose merged player rows lost the guild, faction, display name or death count (19 November 2026): a later
// report without them replaced the recorder's own. Every upload keeps its own summary in PublicRunUpload.evidence, so the values
// are still there. Pure: the caller reads the rows and writes the returned patches. Only null fields are ever filled.
export interface StoredPlayer { id: string; character: string; realm: string; guild: string | null; faction: string | null; displayName: string | null; deaths: number | null }
type Evidence = { players?: { character?: unknown; realm?: unknown; guild?: unknown; faction?: unknown; displayName?: unknown; deaths?: unknown }[] } | null | undefined;
export interface PlayerPatch { id: string; guild?: string; faction?: string; displayName?: string; deaths?: number }

const keyOf = (character: string, realm: string) => `${character.normalize("NFC").toLowerCase()}|${realm.trim().toLowerCase()}`;

export function restorePlayerPatches(players: readonly StoredPlayer[], evidences: readonly Evidence[]): PlayerPatch[] {
  const seen = new Map<string, { guild?: string; faction?: string; displayName?: string; deaths?: number }>();
  for (const evidence of evidences) for (const p of evidence?.players ?? []) {
    if (typeof p?.character !== "string") continue;
    const key = keyOf(p.character, typeof p.realm === "string" && p.realm !== "-" ? p.realm : "");
    const entry = seen.get(key) ?? {};
    if (!entry.guild && typeof p.guild === "string" && p.guild.trim()) entry.guild = p.guild.trim().slice(0, 80);
    if (!entry.faction && (p.faction === "ALLIANCE" || p.faction === "HORDE")) entry.faction = p.faction;
    if (!entry.displayName && typeof p.displayName === "string" && p.displayName.trim()) entry.displayName = p.displayName.trim().slice(0, 80);
    if (typeof p.deaths === "number" && Number.isInteger(p.deaths) && p.deaths >= 0) entry.deaths = Math.max(entry.deaths ?? 0, p.deaths);
    seen.set(key, entry);
  }
  return players.flatMap((player) => {
    const found = seen.get(keyOf(player.character, player.realm));
    if (!found) return [];
    const patch: PlayerPatch = { id: player.id };
    if (!player.guild && found.guild) patch.guild = found.guild;
    if (!player.faction && found.faction) patch.faction = found.faction;
    if (!player.displayName && found.displayName) patch.displayName = found.displayName;
    if (player.deaths === null && found.deaths !== undefined) patch.deaths = found.deaths;
    return Object.keys(patch).length > 1 ? [patch] : [];
  });
}
