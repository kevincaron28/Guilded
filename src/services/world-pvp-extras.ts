import { EmbedBuilder, escapeMarkdown, type Client, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { onHelpCallCleared, onHelpCallStored, CALL_ACTIVE_MINUTES } from "./guild-map.js";
import { guildWhere } from "./guild-scope.js";
import { loadWorldPvpData, weekKeyOf, weekRange, type WorldPvpStanding } from "./world-pvp.js";

// World PvP extras (docs/plans/WPVP_REVIEW_2026-11-10.md, recommendations 3, 6, 7, 8). Four officer switches, every one OFF until an
// officer turns it on with /bg world-pvp: call posts, the weekly recap with the defender line, hot zones and most wanted.
//   - Call posts: one Discord post per call for help (rate limited per zone), edited to "cleared" on the all clear.
//   - Recap: "Defender of the week" on the board and one Tuesday post (top killer, top defender, most calls answered, quickest all clear).
//   - Hot zones: where the guild was attacked this week, from GuildHelpCall (zone counts, attackers' classes).
//   - Most wanted: enemy names seen in MOST_WANTED_MIN or more different calls this week. Enemy names belong to other people: only the
//     character name is shown (never class, level or guild), and it is off until an officer opts in.

export const MOST_WANTED_MIN = 3;
export const CALL_POST_ZONE_MINUTES = 10;
/** The recap waits this long after the reset so late uploads of the finished week are in. */
export const RECAP_DELAY_HOURS = 6;
const TOP = 5;

export interface PvpExtrasSwitches { callPosts: boolean; recap: boolean; hotZones: boolean; mostWanted: boolean }
export const extrasSwitches = (s: { pvpCallPostsEnabled?: boolean | null; pvpRecapEnabled?: boolean | null; pvpHotZonesEnabled?: boolean | null; pvpMostWantedEnabled?: boolean | null } | null | undefined): PvpExtrasSwitches =>
  ({ callPosts: s?.pvpCallPostsEnabled === true, recap: s?.pvpRecapEnabled === true, hotZones: s?.pvpHotZonesEnabled === true, mostWanted: s?.pvpMostWantedEnabled === true });

export interface WeekCall { character: string; zone: string; attackers: unknown; calledAt: Date; clearedAt: Date | null }
interface Attacker { name: string; className: string | null }

const attackersOf = (value: unknown): Attacker[] => Array.isArray(value) ? value.flatMap((raw) => {
  const a = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const name = a?.["name"], cls = a?.["class"];
  return typeof name === "string" && name.trim() ? [{ name: name.trim(), className: typeof cls === "string" && cls ? cls : null }] : [];
}) : [];

export interface HotZone { zone: string; calls: number; classes: { className: string; count: number }[] }
/** Pure: zones by number of calls (then name), with the attackers' classes seen there. */
export function hotZones(calls: readonly WeekCall[], top = TOP): HotZone[] {
  const zones = new Map<string, { zone: string; calls: number; classes: Map<string, number> }>();
  for (const call of calls) {
    const key = call.zone.trim().toLowerCase();
    if (!key || key === "?") continue;
    const entry = zones.get(key) ?? { zone: call.zone.trim(), calls: 0, classes: new Map() };
    entry.calls += 1;
    for (const a of attackersOf(call.attackers)) if (a.className) entry.classes.set(a.className, (entry.classes.get(a.className) ?? 0) + 1);
    zones.set(key, entry);
  }
  return [...zones.values()].sort((a, b) => b.calls - a.calls || a.zone.localeCompare(b.zone)).slice(0, top)
    .map((z) => ({ zone: z.zone, calls: z.calls, classes: [...z.classes].map(([className, count]) => ({ className, count })).sort((a, b) => b.count - a.count || a.className.localeCompare(b.className)).slice(0, 3) }));
}

export interface WantedPlayer { name: string; calls: number }
/** Pure: enemy names that appear in MOST_WANTED_MIN or more different calls (one count per call, whatever the case). Names only. */
export function mostWanted(calls: readonly WeekCall[], top = TOP): WantedPlayer[] {
  const seen = new Map<string, { name: string; calls: number }>();
  for (const call of calls) {
    const inCall = new Map<string, string>();
    for (const a of attackersOf(call.attackers)) if (!inCall.has(a.name.toLowerCase())) inCall.set(a.name.toLowerCase(), a.name);
    for (const [key, name] of inCall) {
      const entry = seen.get(key) ?? { name, calls: 0 };
      entry.calls += 1;
      seen.set(key, entry);
    }
  }
  return [...seen.values()].filter((p) => p.calls >= MOST_WANTED_MIN).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, top);
}

export interface WeekRecap {
  killer: WorldPvpStanding | null; defender: WorldPvpStanding | null; helper: WorldPvpStanding | null;
  /** The call that was cleared fastest (all clear pressed), with the caller's character. */
  quickest: { character: string; zone: string; seconds: number } | null; calls: number;
}
/** Pure: the recap lines' winners. A category with nothing counted has no winner. */
export function weekRecap(standings: readonly WorldPvpStanding[], calls: readonly WeekCall[]): WeekRecap {
  const best = (pick: (s: WorldPvpStanding) => number) => [...standings].filter((s) => pick(s) > 0).sort((a, b) => pick(b) - pick(a) || b.kills - a.kills || a.name.localeCompare(b.name))[0] ?? null;
  let quickest: WeekRecap["quickest"] = null;
  for (const call of calls) {
    if (!call.clearedAt) continue;
    const seconds = Math.round((call.clearedAt.getTime() - call.calledAt.getTime()) / 1000);
    if (seconds <= 0 || seconds > 3_600) continue;
    if (!quickest || seconds < quickest.seconds) quickest = { character: call.character, zone: call.zone, seconds };
  }
  return { killer: best((s) => s.kills), defender: best((s) => s.defends), helper: best((s) => s.helped), quickest, calls: calls.length };
}

const duration = (seconds: number) => seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
const clean = (value: string) => escapeMarkdown(value).slice(0, 40);

/** Pure: embed fields for the world PvP panel: the defender line, hot zones and most wanted (only the switched-on ones that have something to show). */
export function extrasFields(input: { switches: PvpExtrasSwitches; standings: readonly WorldPvpStanding[]; calls: readonly WeekCall[] }, lang: Lang): { name: string; value: string }[] {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const fields: { name: string; value: string }[] = [];
  if (input.switches.recap) {
    const { defender } = weekRecap(input.standings, []);
    if (defender) fields.push({ name: t("🛡️ Defender of the week", "🛡️ Défenseur de la semaine"), value: `${clean(defender.name)} — ${defender.defends} ${t("defends", "défenses")}` });
  }
  if (input.switches.hotZones) {
    const zones = hotZones(input.calls);
    if (zones.length) fields.push({ name: t("🔥 Hot zones this week", "🔥 Zones chaudes cette semaine"), value: zones.map((z) =>
      `**${clean(z.zone)}** — ${z.calls} ${t(z.calls === 1 ? "call" : "calls", z.calls === 1 ? "appel" : "appels")}${z.classes.length ? ` (${z.classes.map((c) => `${clean(c.className)} ×${c.count}`).join(", ")})` : ""}`).join("\n").slice(0, 1024) });
  }
  if (input.switches.mostWanted) {
    const wanted = mostWanted(input.calls);
    if (wanted.length) fields.push({ name: t("🎯 Most wanted", "🎯 Les plus recherchés"), value: wanted.map((p) => `${clean(p.name)} — ${t(`seen in ${p.calls} calls`, `vu dans ${p.calls} appels`)}`).join("\n").slice(0, 1024) });
  }
  return fields;
}

/** Pure: the Tuesday recap text. */
export function recapText(recap: WeekRecap, lang: Lang): string {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const lines = [t("⚔️ **World PvP — last week**", "⚔️ **JcJ en monde ouvert — semaine dernière**")];
  if (recap.killer) lines.push(`🗡️ ${t("Top killer", "Meilleur tueur")}: **${clean(recap.killer.name)}** (${recap.killer.kills})`);
  if (recap.defender) lines.push(`🛡️ ${t("Defender of the week", "Défenseur de la semaine")}: **${clean(recap.defender.name)}** (${recap.defender.defends} ${t("defends", "défenses")})`);
  if (recap.helper) lines.push(`📣 ${t("Most calls answered", "Le plus d'appels répondus")}: **${clean(recap.helper.name)}** (${recap.helper.helped})`);
  if (recap.quickest) lines.push(`⏱️ ${t("Quickest all clear", "Alerte levée la plus rapide")}: **${clean(recap.quickest.character)}** — ${clean(recap.quickest.zone)}, ${duration(recap.quickest.seconds)}`);
  lines.push(`-# ${t("Counted by members' Guilded addon, capped each week · no points or awards", "Comptés par l'addon Guilded des membres, plafonnés chaque semaine · aucun point ni récompense")}`);
  return lines.join("\n");
}

/** Pure: the post for a call for help, and its "cleared" edit. */
export function callPostText(lang: Lang, name: string, zone: string, cleared = false): string {
  const fr = lang === "fr";
  const base = fr ? `**${clean(name)}** a appelé à l'aide à **${clean(zone)}**` : `**${clean(name)}** called for help in **${clean(zone)}**`;
  return cleared ? `✅ ${fr ? "Alerte levée" : "Cleared"} — ~~${base}~~` : `⚔️ ${base}`;
}

type LoadDb = Pick<PrismaClient, "guildHelpCall">;
/** The week's calls from guildmates still in the guild (the table keeps seven days). */
export async function loadWeekCalls(db: LoadDb, guildId: string, weekKey: number): Promise<WeekCall[]> {
  const range = weekRange(weekKey);
  return db.guildHelpCall.findMany({ where: { guildId, calledAt: { gte: range.from, lt: range.to }, member: { status: "ACTIVE" } },
    select: { character: true, zone: true, attackers: true, calledAt: true, clearedAt: true }, orderBy: { calledAt: "asc" }, take: 500 });
}

/** The board's extra fields for this guild, or none when every switch is off. Never throws. */
export async function loadExtrasFields(db: LoadDb, guildId: string, settings: Parameters<typeof extrasSwitches>[0], standings: readonly WorldPvpStanding[], lang: Lang, now = new Date()): Promise<{ name: string; value: string }[]> {
  const switches = extrasSwitches(settings);
  if (!switches.recap && !switches.hotZones && !switches.mostWanted) return [];
  try {
    const calls = switches.hotZones || switches.mostWanted ? await loadWeekCalls(db, guildId, weekKeyOf(now)) : [];
    return extrasFields({ switches, standings, calls }, lang);
  } catch (error) { console.warn("World PvP extras failed", error); return []; }
}

// ---------------------------------------------------------------------------------------------
// Discord posts
// ---------------------------------------------------------------------------------------------

type PostDb = Pick<PrismaClient, "guild" | "guildSettings" | "guildHelpCall" | "character" | "member" | "worldPvpWeek" | "unclaimedCharacter" | "guildRosterEntry">;

/** The channel calls and the recap go to: the group finder when the server uses one, else the PvP groups channel, else the ladder channel. */
export function pvpPostChannelId(s: { unifiedGroupFinder?: boolean | null; dungeonSignupChannelId?: string | null; bgGroupsChannelId?: string | null; bgStatsChannelId?: string | null }): string | null {
  return (s.unifiedGroupFinder !== false ? s.dungeonSignupChannelId ?? s.bgGroupsChannelId : s.bgGroupsChannelId ?? s.dungeonSignupChannelId) ?? s.bgStatsChannelId ?? null;
}

async function sendableChannel(discordGuild: DiscordGuild, id: string | null) {
  const channel = id ? await discordGuild.channels.fetch(id).catch(() => null) : null;
  return channel?.isTextBased() && "send" in channel ? channel : null;
}

/** One post for a fresh call, when the server opted in, the call is live, and the zone has not been posted in the last ten minutes. */
export async function postHelpCall(client: Client, db: PostDb, call: { id: string; guildId: string; character: string; zone: string; calledAt: Date }, now = new Date()): Promise<boolean> {
  if (now.getTime() - call.calledAt.getTime() > CALL_ACTIVE_MINUTES * 60_000) return false;
  const settings = await db.guildSettings.findUnique({ where: { guildId: call.guildId } });
  if (!settings?.pvpCallPostsEnabled || settings.worldPvpEnabled === false) return false;
  const channelId = pvpPostChannelId(settings);
  const recent = await db.guildHelpCall.findFirst({ where: { guildId: call.guildId, zone: call.zone, id: { not: call.id }, postMessageId: { not: null }, calledAt: { gte: new Date(now.getTime() - CALL_POST_ZONE_MINUTES * 60_000) } }, select: { id: true } });
  if (recent) return false;
  const record = await db.guild.findUnique({ where: { id: call.guildId }, select: { discordId: true } });
  const discordGuild = record ? await client.guilds.fetch(record.discordId).catch(() => null) : null;
  const channel = discordGuild ? await sendableChannel(discordGuild, channelId) : null;
  if (!discordGuild || !channel) return false;
  const name = displayCharacterName(call.character, await loadFullNameBook(db as never, call.guildId));
  const sent = await channel.send({ content: callPostText(asLang(settings.language), name, call.zone), allowedMentions: { parse: [] } });
  await db.guildHelpCall.update({ where: { id: call.id }, data: { postChannelId: channel.id, postMessageId: sent.id } });
  return true;
}

/** Edits the call's post to "cleared". Nothing to do when the call was never posted. */
export async function clearHelpCallPost(client: Client, db: PostDb, call: { guildId: string; character: string; zone: string; postChannelId: string | null; postMessageId: string | null }): Promise<boolean> {
  if (!call.postChannelId || !call.postMessageId) return false;
  const [settings, record] = await Promise.all([db.guildSettings.findUnique({ where: { guildId: call.guildId }, select: { language: true } }), db.guild.findUnique({ where: { id: call.guildId }, select: { discordId: true } })]);
  const discordGuild = record ? await client.guilds.fetch(record.discordId).catch(() => null) : null;
  const channel = discordGuild ? await sendableChannel(discordGuild, call.postChannelId) : null;
  const message = channel ? await channel.messages.fetch(call.postMessageId).catch(() => null) : null;
  if (!message?.editable) return false;
  const name = displayCharacterName(call.character, await loadFullNameBook(db as never, call.guildId));
  await message.edit({ content: callPostText(asLang(settings?.language), name, call.zone, true), allowedMentions: { parse: [] } });
  return true;
}

/** Subscribes the call posts to the upload hooks. Call once at startup. */
export function registerCallPosts(client: Client, db: PostDb): void {
  onHelpCallStored(async (call) => { await postHelpCall(client, db, { ...call }); });
  onHelpCallCleared(async (call) => { await clearHelpCallPost(client, db, call); });
}

/**
 * The Tuesday recap: once per finished week, six hours after the reset, for a server that switched it on and has the week's numbers.
 * The week is marked before anything is sent, so a crash or a second bot instance cannot post it twice.
 */
export async function postWeeklyRecap(discordGuild: DiscordGuild, db: PostDb, now = new Date()): Promise<boolean> {
  const record = await db.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true, gameEdition: true } });
  if (!record) return false;
  const settings = await db.guildSettings.findUnique({ where: { guildId: record.id } });
  if (!settings?.pvpRecapEnabled || settings.worldPvpEnabled === false) return false;
  const week = weekKeyOf(now) - 1;
  if (settings.pvpRecapLastWeek !== null && settings.pvpRecapLastWeek !== undefined && settings.pvpRecapLastWeek >= week) return false;
  if (now.getTime() < weekRange(week).to.getTime() + RECAP_DELAY_HOURS * 3_600_000) return false;
  const channel = await sendableChannel(discordGuild, pvpPostChannelId(settings));
  if (!channel) return false;
  const data = await loadWorldPvpData(db, record.id, record.gameEdition ?? "forever", new Date(weekRange(week).from.getTime() + 1_000));
  const calls = await loadWeekCalls(db, record.id, week);
  const recap = weekRecap(data.standings, calls);
  const claimed = await db.guildSettings.updateMany({ where: { guildId: record.id, OR: [{ pvpRecapLastWeek: null }, { pvpRecapLastWeek: { lt: week } }] }, data: { pvpRecapLastWeek: week } });
  if (!claimed.count) return false;
  if (!recap.killer && !recap.defender && !recap.helper) return false;
  await channel.send({ content: recapText(recap, asLang(settings.language)), allowedMentions: { parse: [] } });
  return true;
}

/** /bg world: the same extras as the ladder panel, for the switches that are on. Empty when none is on or nothing happened this week. */
export async function loadWorldPvpExtras(db: Pick<PrismaClient, "guild" | "guildSettings" | "guildHelpCall" | "worldPvpWeek" | "member">, guildId: string, now = new Date()): Promise<EmbedBuilder[]> {
  const [settings, guild] = await Promise.all([db.guildSettings.findUnique({ where: { guildId } }), db.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true } })]);
  const lang = asLang(settings?.language);
  const data = await loadWorldPvpData(db, guildId, guild?.gameEdition ?? "forever", now);
  const fields = await loadExtrasFields(db, guildId, settings, data.standings, lang, now);
  if (!fields.length) return [];
  return [new EmbedBuilder().setColor(0xb91c1c).setTitle(lang === "fr" ? "⚔️ JcJ en monde ouvert cette semaine" : "⚔️ World PvP this week").addFields(fields)
    .setFooter({ text: lang === "fr" ? "Compteurs des joueurs, plafonnés · aucun point ni récompense" : "Player counters, capped · no points or awards" })];
}
