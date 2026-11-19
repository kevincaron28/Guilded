// One-off backfill (19 November 2026): link characters from the guild chat WoW's Discord link already relayed into a channel before the
// bot started reading it live (src/services/game-bridge-link.ts). It reads the last N messages of one channel through the REST API with the
// bot token (no gateway session, no second bot), picks the relayed ones (WoW's application id, flag 65536, lobby_member name) and applies
// the same linking as the live hook, once per Discord user and character.
//   npx tsx scripts/backfill-game-bridge-links.ts --channel <channel id> [--limit 1000]            dry run: lists what would happen
//   npx tsx scripts/backfill-game-bridge-links.ts --channel <channel id> [--limit 1000] --apply    writes the links
// Prints character names and outcomes only, never Discord ids. Apply sends no DM and renames nobody itself: the running bot's member sync
// follows the linked characters on its next pass. Never run it without the owner's yes.
import { REST, Routes } from "discord.js";
import { config } from "../src/config.js";
import { createPrismaClient } from "../src/database.js";
import { allowedBridgeApps, applyBridgeLink, detectBridgeMessage, type BridgeMessage } from "../src/services/game-bridge-link.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const channelId = option("channel");
const limit = Math.max(1, Math.min(50_000, Number(option("limit") ?? 1000) || 1000));
if (!channelId || !/^\d+$/.test(channelId)) { console.error("Usage: tsx scripts/backfill-game-bridge-links.ts --channel <channel id> [--limit 1000] [--apply]"); process.exit(2); }

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
const channel = await rest.get(Routes.channel(channelId)) as { guild_id?: string; name?: string };
if (!channel.guild_id) { console.error("That channel is not in a server."); process.exit(2); }
const apps = allowedBridgeApps(config.GAME_BRIDGE_APP_IDS);

// Newest first, 100 per page.
const found = new Map<string, BridgeMessage>();
let scanned = 0, before: string | undefined;
while (scanned < limit) {
  const query = new URLSearchParams({ limit: String(Math.min(100, limit - scanned)), ...(before ? { before } : {}) });
  const page = await rest.get(Routes.channelMessages(channelId), { query }) as { id: string }[];
  if (!page.length) break;
  for (const message of page) {
    const bridge = detectBridgeMessage(message, apps, channel.guild_id);
    if (bridge) found.set(`${bridge.discordUserId}:${bridge.characterName.toLowerCase()}`, bridge);
  }
  scanned += page.length;
  before = page[page.length - 1]!.id;
  if (page.length < 100) break;
}
console.log(`${apply ? "APPLY" : "DRY RUN"}: read ${scanned} message(s) of #${channel.name ?? "channel"}, ${found.size} distinct player/character pair(s) relayed by the game.`);

const prisma = createPrismaClient();
const totals = new Map<string, number>();
try {
  for (const bridge of found.values()) {
    const result = await applyBridgeLink(prisma, bridge, { apply });
    totals.set(result.outcome, (totals.get(result.outcome) ?? 0) + 1);
    console.log(`${bridge.characterName}: ${apply ? "" : "would be "}${result.outcome}`);
  }
} finally { await prisma.$disconnect(); }
console.log(`Summary: ${[...totals].map(([outcome, count]) => `${outcome} ${count}`).join(", ") || "nothing relayed"}.`);
