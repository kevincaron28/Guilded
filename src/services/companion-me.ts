// GET /api/v1/companion/me (8.5 Track L, effortless linking). What the companion's first-run screens
// need, for the credential this PC holds:
// - who is signed in ("Connected as <name>", with the Discord avatar, and "Not you? Switch");
// - the Discord servers that use Guilded where this account is a member right now;
// - for the in-game guild the addon saved (GuildedDB.guildKey), that guild's Discord server and the
//   invite its officers published (/guild-page invite), so a member who is not in it yet gets a
//   Join button, and whether they have joined since.
// Nothing here grants anything: joining still needs the normal sign-in and its Connect click.

export interface CompanionMeAccount { discordUserId: string; username: string; displayName: string | null; personal: boolean }
export interface CompanionMeServer { discordId: string; name: string }
export interface CompanionMeDeps {
  /** The account behind a companion credential (guild or leaderboards-only), or null. */
  accountFor(tokenHash: string): Promise<CompanionMeAccount | null>;
  /** Servers with the Guilded bot where this Discord user is a member now. */
  servers(discordUserId: string): Promise<CompanionMeServer[]>;
  /** The Discord avatar URL, or null. */
  avatar(discordUserId: string): Promise<string | null>;
  /** The Guilded server of a WoW Forever guild (keys are NFC lowercase), with its published invite. */
  joinTarget(nameKey: string, realmKey: string): Promise<{ discordId: string; name: string; inviteUrl: string | null } | null>;
}
export interface CompanionMe {
  account: { username: string; displayName: string | null; avatarUrl: string | null };
  personal: boolean;
  servers: string[];
  join: { serverName: string; inviteUrl: string | null; joined: boolean } | null;
}

const key = (value: string) => value.normalize("NFC").trim().toLowerCase();
const label = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 80 && !value.includes("|") && Array.from(value).every((char) => char.charCodeAt(0) >= 32) ? value.trim() : null;

/** Discord invite links only (discord.gg/… or discord.com/invite/…); anything else is dropped. */
export function safeInvite(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname === "discord.gg" && /^\/[\w-]{2,40}$/.test(url.pathname)) return url.href;
    if ((url.hostname === "discord.com" || url.hostname === "www.discord.com") && /^\/invite\/[\w-]{2,40}$/.test(url.pathname)) return url.href;
  } catch { /* not a URL */ }
  return null;
}

export async function companionMe(deps: CompanionMeDeps, input: { tokenHash: string; guild?: unknown; realm?: unknown }): Promise<CompanionMe | null> {
  const account = await deps.accountFor(input.tokenHash);
  if (!account) return null;
  const [servers, avatarUrl] = await Promise.all([
    deps.servers(account.discordUserId).catch(() => []),
    deps.avatar(account.discordUserId).catch(() => null)
  ]);
  let join: CompanionMe["join"] = null;
  const guild = label(input.guild), realm = label(input.realm);
  if (guild && realm) {
    const target = await deps.joinTarget(key(guild), key(realm)).catch(() => null);
    if (target) join = { serverName: target.name, inviteUrl: safeInvite(target.inviteUrl), joined: servers.some((server) => server.discordId === target.discordId) };
  }
  return { account: { username: account.username, displayName: account.displayName, avatarUrl }, personal: account.personal, servers: servers.map((server) => server.name), join };
}
