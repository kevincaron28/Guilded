// One-off repair (20 November 2026): undoes the links the first game-bridge backfill made for WoW's provisional Discord accounts.
// WoW posts the guild chat of a player who never linked Discord as a provisional account (user flag 1 << 23, random username, not a
// member of the server). The backfill of 20 Nov 00:06-00:16 UTC created a Member row for each such author and linked a character to it.
// This script reads the channel's relayed messages over REST with the bot token (no gateway session, no second bot), collects the
// provisional authors, and for each of their members created on or after --since (default 2026-11-20T00:00:00Z) puts every bridge-linked
// character back into the discovered (unclaimed) list and deletes the member when nothing else names it
// (src/services/bridge-provisional-revert.ts). Dry run by default; --apply writes, one transaction per character. Prints names only.
//   cd /opt/guilded && sudo -u guilded bash -c 'set -a; . ./.env.local; set +a; npx tsx scripts/revert-bridge-provisional-links.ts --channel <id> [--apply]'
import { REST, Routes } from "discord.js";
import { config } from "../src/config.js";
import { createPrismaClient } from "../src/database.js";
import { revertProvisionalBridgeLinks } from "../src/services/bridge-provisional-revert.js";
import { allowedBridgeApps, BRIDGE_MESSAGE_FLAG, isProvisionalAccount } from "../src/services/game-bridge-link.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const channelId = option("channel");
const limit = Math.max(1, Math.min(50_000, Number(option("limit") ?? 5000) || 5000));
const since = new Date(option("since") ?? "2026-11-20T00:00:00Z");
if (!channelId || !/^\d+$/.test(channelId) || Number.isNaN(since.getTime())) {
  console.error("Usage: tsx scripts/revert-bridge-provisional-links.ts --channel <channel id> [--since 2026-11-20T00:00:00Z] [--limit 5000] [--apply]");
  process.exit(2);
}

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
const channel = await rest.get(Routes.channel(channelId)) as { guild_id?: string; name?: string };
if (!channel.guild_id) { console.error("That channel is not in a server."); process.exit(2); }
const apps = allowedBridgeApps(config.GAME_BRIDGE_APP_IDS);

// Newest first, 100 per page: the authors of the game's relayed messages whose account is provisional.
const provisional = new Set<string>();
let scanned = 0, before: string | undefined;
while (scanned < limit) {
  const query = new URLSearchParams({ limit: String(Math.min(100, limit - scanned)), ...(before ? { before } : {}) });
  const page = await rest.get(Routes.channelMessages(channelId), { query }) as { id: string; application_id?: string; flags?: number; author?: { id?: string } }[];
  if (!page.length) break;
  for (const message of page) {
    const relayed = typeof message.application_id === "string" && apps.includes(message.application_id) && (Number(message.flags ?? 0) & BRIDGE_MESSAGE_FLAG);
    if (relayed && message.author?.id && isProvisionalAccount(message.author)) provisional.add(message.author.id);
  }
  scanned += page.length;
  before = page[page.length - 1]!.id;
  if (page.length < 100) break;
}
console.log(`${apply ? "APPLY" : "DRY RUN"}: read ${scanned} message(s) of #${channel.name ?? "channel"}, ${provisional.size} provisional account(s) among the relay authors; members created since ${since.toISOString()}.`);

const prisma = createPrismaClient();
try {
  const report = await revertProvisionalBridgeLinks(prisma, { guildDiscordId: channel.guild_id, provisionalIds: provisional, since, apply, log: (line) => console.log(line) });
  const verb = apply ? "" : "would be ";
  console.log(`Summary: ${report.members} junk member(s); ${report.restored.length} character(s) ${verb}unlinked back to the discovered list; ${report.kept.length} character(s) kept; ` +
    `${report.deletedMembers.length} member(s) ${verb}deleted; ${report.keptMembers.length} member(s) kept; ${report.runsUnlinked} dungeon-run row(s) ${verb}unlinked.`);
} finally { await prisma.$disconnect(); }
