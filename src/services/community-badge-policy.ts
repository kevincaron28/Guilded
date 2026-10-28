// Owner-requested policy for this Discord only. Other servers retain opt-in sharing.
export const MEMBER_BADGE_SHELF_GUILD = "1323321076478119967";
export const memberBadgeShelves = (discordId: string | undefined) => discordId === MEMBER_BADGE_SHELF_GUILD;

export function badgeCommandsForGuild(discordId: string, body: unknown[]): unknown[] {
  if (!memberBadgeShelves(discordId)) return body;
  // Clone before removing the guild-specific option: command builders are shared.
  const commands = structuredClone(body) as { name?: string; options?: { name?: string; options?: { name?: string }[] }[] }[];
  for (const command of commands) if (command.name === "community") {
    for (const sub of command.options ?? []) if (sub.name === "badges") {
      if (sub.options) sub.options = sub.options.filter(option => option.name !== "share");
    }
  }
  return commands;
}
