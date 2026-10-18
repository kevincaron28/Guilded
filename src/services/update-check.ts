import type { Client } from "discord.js";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import { asLang } from "../i18n.js";
import { HOSTED_APPLICATION_ID } from "./companion-links.js";
import { CURRENT_VERSION } from "./version-announce.js";

// Self-hosted bots never hear about new releases on their own: once a day this asks GitHub for
// the latest stable release and, when it is newer than the running bot, tells each server's
// officers once per version. The official hosted bot skips it (its maintainer deploys it), and
// UPDATE_CHECK=false turns it off.
const RELEASES_API = "https://api.github.com/repos/kevincaron28/Guilded/releases/latest";
const RELEASES_PAGE = "https://github.com/kevincaron28/Guilded/releases/latest";

function parseVersion(text: unknown): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch): Promise<{ version: string; url: string } | null> {
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Guilded-Bot" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    const body = await response.json() as { tag_name?: unknown; html_url?: unknown };
    const version = parseVersion(body.tag_name);
    if (!version) return null;
    const url = typeof body.html_url === "string" && body.html_url.startsWith("https://github.com/") ? body.html_url : RELEASES_PAGE;
    return { version: version.join("."), url };
  } catch {
    return null;
  }
}

const NOTICE = {
  en: (latest: string, current: string, url: string) =>
    `🔔 **Guilded ${latest} is available.** This bot runs ${current}. Whoever hosts this bot: back up, then update it. Release notes, the addon and the companion installer: ${url}`,
  fr: (latest: string, current: string, url: string) =>
    `🔔 **Guilded ${latest} est disponible.** Ce bot utilise la version ${current}. La personne qui héberge ce bot : faites une sauvegarde, puis mettez-le à jour. Notes de version, addon et installateur du compagnon : ${url}`
};

type Options = { current?: string; fetchImpl?: typeof fetch; clientId?: string | undefined; enabled?: boolean };

// Returns how many notices were posted.
export async function announceAvailableUpdate(client: Client, options: Options = {}): Promise<number> {
  const { current = CURRENT_VERSION, fetchImpl = fetch, clientId = config.DISCORD_CLIENT_ID, enabled = config.UPDATE_CHECK } = options;
  if (!enabled || clientId === HOSTED_APPLICATION_ID) return 0;
  const latest = await fetchLatestRelease(fetchImpl);
  if (!latest || !isNewerVersion(latest.version, current)) return 0;
  const pending = await prisma.guildSettings.findMany({
    where: { ...pilotGuildScope, logChannelId: { not: null }, OR: [{ lastUpdateNoticeVersion: null }, { lastUpdateNoticeVersion: { not: latest.version } }] },
    include: { guild: true }
  });
  let posted = 0;
  for (const settings of pending) {
    // Marked first, as in version-announce.ts, so a failed post never repeats daily.
    await prisma.guildSettings.update({ where: { id: settings.id }, data: { lastUpdateNoticeVersion: latest.version } });
    try {
      const discordGuild = await client.guilds.fetch(settings.guild.discordId);
      const channel = await discordGuild.channels.fetch(settings.logChannelId ?? "");
      if (!channel?.isTextBased()) continue;
      await channel.send({ content: NOTICE[asLang(settings.language)](latest.version, current, latest.url), allowedMentions: { parse: [] } });
      posted += 1;
    } catch (error) {
      console.error(`Update notice failed for guild ${settings.guild.discordId}`, error);
    }
  }
  if (posted) console.info(`Guilded ${latest.version} is available (running ${current}); told ${posted} server(s).`);
  return posted;
}
