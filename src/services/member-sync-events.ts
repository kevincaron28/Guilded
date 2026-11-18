// One small event hook so services that change a member (a character linked, unlinked, moved, a new main, a guild rank
// read from a roster upload) can ask for that ONE member's Discord nickname and rank role to be refreshed, without
// importing discord.js. The bot wires a listener to the scheduler in member-sync.ts (src/main.ts); with no listener
// (tests, scripts) a mark does nothing. The hourly full pass stays as the safety net.

export type MemberSyncWhat = "nickname" | "rank" | "both";

/** Who changed: our own member row (memberId, with its in-game guild row `guildId`), or a Discord user in a Discord server. */
export type MemberChange =
  | { guildId: string; memberId: string; what?: MemberSyncWhat }
  | { discordGuildId: string; discordUserId: string; what?: MemberSyncWhat };

type Listener = (change: MemberChange) => void;
const listeners = new Set<Listener>();

export function onMemberChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Never throws and never waits: a hook inside a service or transaction must not be able to break it. */
export function markMemberChanged(change: MemberChange): void {
  for (const listener of listeners) {
    try { listener(change); } catch { /* a refresh is best effort: the hourly pass catches it */ }
  }
}
