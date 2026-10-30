// Multi-guild Discord servers bind each credential/import to a WoW space.
// Older default guilds have no configured identity and retain their existing flow.
export function assertAddonGuildScope(snapshot: { wowGuild?: string | undefined }, guild: { wowSpace?: { name: string; realm: string } | null } | null) {
  if (!guild?.wowSpace) return;
  const key = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const expected = `${guild.wowSpace.name}-${guild.wowSpace.realm}`;
  if (!snapshot.wowGuild || key(snapshot.wowGuild) !== key(expected)) {
    throw new Error("This saved data does not identify the selected WoW guild and realm. Choose the matching connection and save fresh data in game.");
  }
}
