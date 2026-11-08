// One-off repair (owner request, 7 November 2026): members who joined today pressed World of Warcraft in the
// game-choice panel, got an error and no role. Gives the World of Warcraft role to members of the configured
// server (DISCORD_GUILD_ID) who joined since --since and hold none of the panel's game roles.
// REST only, never starts a bot session. Posts nothing.
//   npx tsx scripts/backfill-wow-role.ts                      dry run: lists who would get the role
//   npx tsx scripts/backfill-wow-role.ts --apply              gives the role
//   npx tsx scripts/backfill-wow-role.ts --since 2026-11-07T05:00:00Z
// Default --since: today 00:00 UTC.
import { REST, Routes, type APIGuildMember, type APIRole, type APIChannel, type APIMessage } from "discord.js";
import { config } from "../src/config.js";

const WOW_ROLE_NAME = /world\s*of\s*warcraft|^@?wow$|wow forever/i;
const REASON = "Guilded: World of Warcraft pick failed on join (backfill)";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");
const since = new Date(arg("--since") ?? new Date().toISOString().slice(0, 10) + "T00:00:00Z");
if (Number.isNaN(since.getTime())) throw new Error("--since is not a date");

const rest = new REST({ version: "10", timeout: 15000 }).setToken(config.DISCORD_TOKEN);
const gid = config.DISCORD_GUILD_ID;
const roles = await rest.get(Routes.guildRoles(gid)) as APIRole[];
const wow = roles.find((role) => WOW_ROLE_NAME.test(role.name));
if (!wow) throw new Error("No World of Warcraft role in this server.");

// The game roles are the ones on the bot's welcome panel buttons; holding any of them means the member did pick.
const gameRoles = new Set<string>([wow.id]);
const channels = await rest.get(Routes.guildChannels(gid)) as APIChannel[];
for (const channel of channels.filter((c) => c.type === 0)) {
  const messages = await rest.get(Routes.channelMessages(channel.id), { query: new URLSearchParams({ limit: "20" }) }).catch(() => []) as APIMessage[];
  for (const message of messages.filter((m) => m.author.id === config.DISCORD_CLIENT_ID)) {
    for (const match of JSON.stringify(message.components ?? []).matchAll(/welcomerole:\d+:(\d+)/g)) gameRoles.add(match[1]!);
  }
  if (gameRoles.size > 1) break;
}

const members: APIGuildMember[] = [];
for (let after = "0"; ;) {
  const page = await rest.get(Routes.guildMembers(gid), { query: new URLSearchParams({ limit: "1000", after }) }) as APIGuildMember[];
  members.push(...page);
  if (page.length < 1000) break;
  after = page.at(-1)!.user.id;
}
const targets = members.filter((m) => !m.user.bot && new Date(m.joined_at!) >= since && !m.roles.some((id) => gameRoles.has(id)));
console.log(`${apply ? "" : "[dry run] "}Server ${gid}: ${members.length} members, ${targets.length} joined since ${since.toISOString()} with no game role (game roles: ${[...gameRoles].map((id) => roles.find((r) => r.id === id)?.name ?? id).join(", ")}).`);
let given = 0, failed = 0;
for (const member of targets) {
  console.log(`  ${member.joined_at!.slice(0, 16)} ${member.user.username}`);
  if (!apply) continue;
  try { await rest.put(Routes.guildMemberRole(gid, member.user.id, wow.id), { reason: REASON }); given++; } catch (error) { failed++; console.error(`  failed for ${member.user.username}:`, error instanceof Error ? error.message : error); }
}
if (apply) console.log(`Gave @${wow.name} to ${given} member(s); ${failed} failed.`);
