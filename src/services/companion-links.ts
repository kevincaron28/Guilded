import { config } from "../config.js";
import { t, type Lang } from "../i18n.js";

const HOSTED_APPLICATION_ID = "1552633893587394590";
const HOSTED_COMPANION_URL = "https://guilded-wow.kcaron.workers.dev/companion/";

type LinkSettings = { COMPANION_WEB_URL?: string | undefined; DISCORD_CLIENT_ID?: string | undefined };

// Never send an independently hosted bot's members to a different bot's pairing endpoint.
// The browser already reads ?guild= for first-time setup; existing connections stay intact.
export function companionWebUrl(discordGuildId?: string, settings: LinkSettings = config): string | null {
  const address = settings.COMPANION_WEB_URL
    || (settings.DISCORD_CLIENT_ID === HOSTED_APPLICATION_ID ? HOSTED_COMPANION_URL : null);
  if (!address) return null;
  const url = new URL(address);
  if (discordGuildId) url.searchParams.set("guild", discordGuildId);
  return url.href;
}

export function companionLinkText(lang: Lang, discordGuildId?: string): string {
  const url = companionWebUrl(discordGuildId);
  return url ? `[${t(lang, "pair.online")}](${url})` : t(lang, "pair.askLink");
}
