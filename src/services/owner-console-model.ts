import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, escapeMarkdown } from "discord.js";

// The pure half of the owner console (docs/OWNER_CONSOLE.md): what a fleet row holds, how it is
// drawn, how pages and buttons are numbered. No Discord or database calls live here.

export const CONSOLE_PREFIX = "oc:";
/** Rows per board page: well under Discord's 25 select options and 4096 embed characters. */
export const PAGE_SIZE = 8;
/** Confirmation buttons stop working after this long (ms). */
export const CONFIRM_TTL_MS = 2 * 60_000;
/** A server with this many saved errors in 24 hours is an error spike in the digest. */
export const ERROR_SPIKE = 10;

export type Tier = "approved" | "lite" | "blocked";

export interface FleetRow {
  discordId: string;
  name: string;
  memberCount: number;
  tier: Tier;
  editions: string[];
  language: string;
  lastActivity: Date | null;
  setupDone: number;
  setupTotal: number;
  achievements: boolean;
  announcements: boolean;
  publicSharing: boolean;
  weeklyReport: boolean;
  /** Weekly honors; null when the server never set community honors up. */
  honors: boolean | null;
  errors24h: number;
  lastSync: Date | null;
  version: string | null;
  characters: number;
  cores: number;
  upcomingRaids: number;
  hasAdminChannel: boolean;
  /** The bot has no database record for this server yet (nobody ran a command there). */
  untracked: boolean;
}

export type ActionId = "messages" | "channels" | "check" | "tier" | "achievements" | "announcements" | "sharing" | "weekly" | "send" | "leave";

export interface ActionInfo { id: ActionId; label: string; style: ButtonStyle; help: string; confirm: string }

export const ACTIONS: readonly ActionInfo[] = [
  { id: "messages", label: "Update bot messages", style: ButtonStyle.Success, help: "Puts back or refreshes the bot guide, group finder menu, welcome panel, craft guide, leaderboard and core rosters (same as the Update bot messages button in /setup).", confirm: "Re-post or edit that server's pinned bot messages." },
  { id: "channels", label: "Create missing channels", style: ButtonStyle.Primary, help: "Creates the core channels (notifications, raid signups, officer log, guide, answers) that the server has not set. Never touches ones already set.", confirm: "Create the missing core channels in that server." },
  { id: "check", label: "Run setup check", style: ButtonStyle.Secondary, help: "Runs the real /setup checklist against live Discord data and shows it to you only. Changes nothing.", confirm: "Read that server's roles, channels and messages (read-only)." },
  { id: "tier", label: "Toggle approval tier", style: ButtonStyle.Secondary, help: "Moves the server between full approval and Guilded Lite. Approving writes HOSTED_GUILD_IDS and registers the full commands; demoting needs a free Lite slot.", confirm: "Change that server's access tier." },
  { id: "achievements", label: "Toggle achievements", style: ButtonStyle.Secondary, help: "Turns the server's achievements on or off (what members can see and earn).", confirm: "Switch achievements for that server." },
  { id: "announcements", label: "Toggle announcements", style: ButtonStyle.Secondary, help: "Turns achievement celebration posts on or off. Turning them on records everything already earned as announced (no backfill).", confirm: "Switch achievement announcement posts for that server." },
  { id: "sharing", label: "Toggle public sharing", style: ButtonStyle.Secondary, help: "Turns the server's public dungeon run sharing on or off (the public leaderboard).", confirm: "Switch public dungeon sharing for that server." },
  { id: "weekly", label: "Toggle weekly report", style: ButtonStyle.Secondary, help: "Turns the weekly guild report post on or off.", confirm: "Switch the weekly report for that server." },
  { id: "send", label: "Message admin channel", style: ButtonStyle.Primary, help: "Posts text you type to the server's private admin channel, signed as from the bot owner. Never sent automatically.", confirm: "Post your text to that server's admin channel." },
  { id: "leave", label: "Leave server", style: ButtonStyle.Danger, help: "Makes the bot leave the server. You must type LEAVE to confirm. Not available for the home server.", confirm: "Remove the bot from that server." }
];
export const actionInfo = (id: string): ActionInfo | undefined => ACTIONS.find(action => action.id === id);

const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const unix = (date: Date): number => Math.floor(date.getTime() / 1000);
const ago = (date: Date | null): string => date ? `<t:${unix(date)}:R>` : "never";
const safeName = (name: string): string => escapeMarkdown(clip(name.replace(/[\r\n]+/g, " "), 40));

export function pageCount(total: number): number { return Math.max(1, Math.ceil(total / PAGE_SIZE)); }
export function clampPage(page: number, total: number): number { return Math.min(Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0), pageCount(total) - 1); }
export function pageSlice<T>(items: readonly T[], page: number): T[] {
  const index = clampPage(page, items.length);
  return items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
}

/** Setup completeness without Discord calls: how many of the key channels the server has set. */
export const SETUP_FIELDS = ["notifyChannelId", "raidSignupChannelId", "logChannelId", "guideChannelId", "welcomeChannelId", "adminChannelId", "dungeonSignupChannelId", "dungeonLeaderboardChannelId"] as const;
export function setupProgress(settings: Partial<Record<(typeof SETUP_FIELDS)[number], string | null>> | null | undefined): { done: number; total: number } {
  return { done: SETUP_FIELDS.filter(field => settings?.[field]).length, total: SETUP_FIELDS.length };
}

const TIER_BADGE: Record<Tier, string> = { approved: "✅ Approved", lite: "🔹 Lite", blocked: "⛔ Blocked" };
const toggle = (on: boolean): string => on ? "✅" : "❌";
/** Setup progress as a small bar: ▰▰▰▱▱▱▱▱ 3/8. */
export const setupBar = (done: number, total: number): string => `${"▰".repeat(Math.max(0, Math.min(done, total)))}${"▱".repeat(Math.max(0, total - done))} ${done}/${total}`;
/** 🟢 none, 🟡 some, 🔴 a spike (the digest's threshold). */
export const errorMarker = (count: number): string => count >= ERROR_SPIKE ? "🔴" : count > 0 ? "🟡" : "🟢";
const errorText = (count: number): string => `${errorMarker(count)} ${count} error${count === 1 ? "" : "s"}/24h`;

/** One server as an embed field: a title line, then status, activity, data and the id. */
export function fleetField(row: FleetRow, rank: number): { name: string; value: string; inline: false } {
  const name = `${rank}. ${safeName(row.name)} · ${TIER_BADGE[row.tier]} · ${row.language.toUpperCase()} · 👥 ${row.memberCount}`;
  const value = [
    `${setupBar(row.setupDone, row.setupTotal)} setup · ${errorText(row.errors24h)}`,
    `🏆 Achievements ${toggle(row.achievements)} · 📣 Announce ${toggle(row.announcements)} · 🌐 Public ${toggle(row.publicSharing)} · 📰 Weekly ${toggle(row.weeklyReport)}`,
    `🕒 Active ${ago(row.lastActivity)} · 🔄 Sync ${ago(row.lastSync)} · 🎮 ${row.editions.join("/") || "no data"}`,
    `👤 ${row.characters} chars · 🛡️ ${row.cores} cores · 📅 ${row.upcomingRaids} raids · 🏷️ ${row.version ? `v${row.version}` : "no version seen"}`,
    `\`${row.discordId}\`${row.untracked ? " · ⚠️ not set up" : ""}`
  ].join("\n");
  return { name: clip(name, 256), value: clip(value, 1024), inline: false };
}

export function fleetFields(rows: readonly FleetRow[], firstIndex = 0): { name: string; value: string; inline: false }[] {
  return rows.map((row, i) => fleetField(row, firstIndex + i + 1));
}

/** Plain-text version of the page (kept for logs and tests): the field titles and values joined. */
export function fleetLines(rows: readonly FleetRow[], firstIndex = 0): string {
  if (rows.length === 0) return "No servers yet.";
  return fleetFields(rows, firstIndex).map(field => `**${field.name}**\n${field.value}`).join("\n");
}

export interface FleetSummary { servers: number; members: number }

/** Header line(s) for the board: fleet totals, plus problem counts for the servers shown. */
export function fleetSummary(rows: readonly FleetRow[], summary: FleetSummary, paged: boolean): string {
  const withErrors = rows.filter(row => row.errors24h > 0).length, unsynced = rows.filter(row => !row.lastSync).length;
  const scope = paged ? " on this page" : "";
  return `🖥️ **${summary.servers}** server${summary.servers === 1 ? "" : "s"} · 👥 **${summary.members}** members · ${errorMarker(withErrors ? Math.max(...rows.map(row => row.errors24h)) : 0)} **${withErrors}** with errors${scope} · 🔄 **${unsynced}** not synced${scope}`;
}

export function healthColor(rows: readonly FleetRow[]): number {
  if (rows.some(row => row.errors24h >= ERROR_SPIKE)) return 0xef4444;
  if (rows.some(row => row.errors24h > 0)) return 0xf59e0b;
  return 0x22c55e;
}

export function boardEmbed(rows: readonly FleetRow[], total: number, page: number, version: string, now: Date, summary?: FleetSummary): EmbedBuilder {
  const index = clampPage(page, total);
  const embed = new EmbedBuilder().setColor(healthColor(rows)).setTitle(`Guilded fleet · ${total} server${total === 1 ? "" : "s"}`)
    .setDescription(rows.length ? fleetSummary(rows, summary ?? { servers: total, members: rows.reduce((sum, row) => sum + row.memberCount, 0) }, pageCount(total) > 1) : "No servers yet.")
    .setFooter({ text: `Page ${index + 1}/${pageCount(total)} · bot v${version}` })
    .setTimestamp(now);
  if (rows.length) embed.addFields(fleetFields(rows, index * PAGE_SIZE));
  return embed;
}

export function boardComponents(rows: readonly FleetRow[], total: number, page: number, digestEnabled: boolean): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const index = clampPage(page, total), last = pageCount(total) - 1;
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}page:${Math.max(0, index - 1)}:prev`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}page:${Math.min(last, index + 1)}:next`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(index >= last),
    new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}refresh:${index}`).setLabel("Refresh").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}digest:${index}`).setLabel(`Daily digest: ${digestEnabled ? "on" : "off"}`).setStyle(digestEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}help`).setLabel("Help").setStyle(ButtonStyle.Secondary));
  const rowsOut: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [buttons];
  if (rows.length) {
    rowsOut.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`${CONSOLE_PREFIX}pick`).setPlaceholder("Open a server…")
      .addOptions(rows.slice(0, 25).map(row => ({ label: clip(row.name.replace(/[\r\n]+/g, " ") || row.discordId, 100), description: clip(`${row.discordId} · ${row.tier} · ${row.memberCount} members`, 100), value: row.discordId })))));
  }
  return rowsOut;
}

export function helpText(): string {
  return ["**Owner console help**", "Only you (the bot's Discord application owner) can use these buttons, and only in this channel. Every action asks you to confirm and is written to the audit log.", "",
    ...ACTIONS.map(action => `• **${action.label}** — ${action.help}`), "",
    "Board: Prev/Next page through servers, Refresh redraws now, the menu opens a server. The board edits one message in place every 5 minutes. **Daily digest** (off by default) posts new/removed servers and error spikes once a day.",
    "The console never shows tokens, database settings, member DMs or message content."].join("\n");
}

export function detailEmbed(row: FleetRow, now: Date): EmbedBuilder {
  return new EmbedBuilder().setColor(row.errors24h >= ERROR_SPIKE ? 0xef4444 : row.errors24h > 0 || row.tier !== "approved" ? 0xf59e0b : 0x22c55e).setTitle(safeName(row.name))
    .setDescription(`${TIER_BADGE[row.tier]} · ${row.language.toUpperCase()} · 👥 ${row.memberCount} members
\`${row.discordId}\`${row.untracked ? " · ⚠️ not set up" : ""}`)
    .addFields(
      { name: "🧭 Setup", value: `${setupBar(row.setupDone, row.setupTotal)} key channels set${row.hasAdminChannel ? "" : "\n⚠️ no admin channel: messaging unavailable"}`, inline: true },
      { name: "🎮 Edition", value: row.editions.join(", ") || "no data", inline: true },
      { name: "🏷️ Bot version seen", value: row.version ? `v${row.version}` : "none", inline: true },
      { name: "⚙️ Settings", value: [`🏆 Achievements ${toggle(row.achievements)}`, `📣 Announcements ${toggle(row.announcements)}`, `🌐 Public sharing ${toggle(row.publicSharing)}`, `📰 Weekly report ${toggle(row.weeklyReport)}`, `🏅 Weekly honors ${row.honors === null ? "n/a" : toggle(row.honors)}`].join("\n"), inline: true },
      { name: "🩺 Health", value: `${errorText(row.errors24h)}
🕒 Active ${ago(row.lastActivity)}
🔄 Last sync ${ago(row.lastSync)}`, inline: true },
      { name: "📊 Data", value: `👤 ${row.characters} linked characters
🛡️ ${row.cores} cores
📅 ${row.upcomingRaids} upcoming raids`, inline: true })
    .setTimestamp(now);
}

export function detailComponents(row: FleetRow, home: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const button = (action: ActionInfo) => new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}act:${action.id}:${row.discordId}`).setLabel(action.label).setStyle(action.style)
    .setDisabled((home && (action.id === "leave" || action.id === "tier")) || (action.id === "send" && !row.hasAdminChannel) || (row.untracked && !["tier", "leave"].includes(action.id)));
  const groups: ActionId[][] = [["messages", "channels", "check", "tier"], ["achievements", "announcements", "sharing", "weekly"], ["send", "leave"]];
  return groups.map(ids => new ActionRowBuilder<ButtonBuilder>().addComponents(ids.map(id => button(actionInfo(id)!))));
}

/** `oc:<kind>:<arg>:<arg>…` → its parts, or null when it is not an owner console id. */
export function parseConsoleId(customId: string): { kind: string; args: string[] } | null {
  if (!customId.startsWith(CONSOLE_PREFIX)) return null;
  const [kind, ...args] = customId.slice(CONSOLE_PREFIX.length).split(":");
  return kind ? { kind, args } : null;
}

export const confirmToken = (now: number): string => now.toString(36);
export function confirmFresh(token: string | undefined, now: number): boolean {
  const issued = token ? parseInt(token, 36) : NaN;
  return Number.isFinite(issued) && now - issued >= 0 && now - issued <= CONFIRM_TTL_MS;
}

export function confirmComponents(action: ActionId, guildId: string, now: number, extra = ""): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}ok:${action}:${guildId}:${confirmToken(now)}${extra ? `:${extra}` : ""}`).setLabel("Confirm").setStyle(action === "leave" ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${CONSOLE_PREFIX}no`).setLabel("Cancel").setStyle(ButtonStyle.Secondary));
}

export interface DigestInput {
  known: Record<string, string> | null;
  current: { id: string; name: string; errors24h: number }[];
}
export interface Digest { added: string[]; removed: string[]; spikes: string[]; quiet: boolean }

export function buildDigest({ known, current }: DigestInput): Digest {
  const now = new Map(current.map(guild => [guild.id, guild]));
  const added = known ? current.filter(guild => !(guild.id in known)).map(guild => guild.name) : [];
  const removed = known ? Object.entries(known).filter(([id]) => !now.has(id)).map(([, name]) => name) : [];
  const spikes = current.filter(guild => guild.errors24h >= ERROR_SPIKE).map(guild => `${guild.name} (${guild.errors24h})`);
  return { added, removed, spikes, quiet: !added.length && !removed.length && !spikes.length };
}

export function digestText(digest: Digest): string {
  const list = (title: string, names: string[]) => names.length ? `**${title}:** ${clip(names.map(name => escapeMarkdown(clip(name, 40))).join(", "), 600)}` : null;
  if (digest.quiet) return "**Daily digest** — no new or removed servers and no error spikes.";
  return clip(["**Daily digest**", list("New servers", digest.added), list("Removed servers", digest.removed), list(`Error spikes (≥${ERROR_SPIKE} in 24h)`, digest.spikes)].filter(Boolean).join("\n"), 1900);
}
