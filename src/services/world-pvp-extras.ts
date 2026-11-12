import { EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { onHelpCallCleared, onHelpCallStored } from "./guild-map.js";
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
/** Different guildmates who must have reported the enemy: one member's three calls are not enough to publish a name. */
export const MOST_WANTED_MEMBERS = 2;
export const CALL_POST_ZONE_MINUTES = 10;
/** The recap waits this long after the reset so late uploads of the finished week are in. */
export const RECAP_DELAY_HOURS = 6;
const TOP = 5;

export interface PvpExtrasSwitches { callPosts: boolean; recap: boolean; hotZones: boolean; mostWanted: boolean }
export const extrasSwitches = (s: { pvpCallPostsEnabled?: boolean | null; pvpRecapEnabled?: boolean | null; pvpHotZonesEnabled?: boolean | null; pvpMostWantedEnabled?: boolean | null } | null | undefined): PvpExtrasSwitches =>
  ({ callPosts: s?.pvpCallPostsEnabled === true, recap: s?.pvpRecapEnabled === true, hotZones: s?.pvpHotZonesEnabled === true, mostWanted: s?.pvpMostWantedEnabled === true });

export interface WeekCall { memberId?: string; character: string; zone: string; attackers: unknown; calledAt: Date; clearedAt: Date | null }
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
/** Lowercase full names and first names of every character the guild knows (roster, linked, unclaimed): never listed as an enemy. */
export type KnownNames = ReadonlySet<string>;
export const knownNameSet = (names: readonly string[]): Set<string> => {
  const out = new Set<string>();
  for (const name of names) { const full = name.trim().toLowerCase(); if (!full) continue; out.add(full); out.add(full.split(/\s+/)[0]!); }
  return out;
};
/**
 * Pure: enemy names seen in MOST_WANTED_MIN or more different calls from at least MOST_WANTED_MEMBERS different members (one count per
 * call, whatever the case). A name that is a guild character (full name, or the first name an attacker line carries) is never listed.
 * Names only.
 */
export function mostWanted(calls: readonly WeekCall[], known: KnownNames = new Set(), top = TOP): WantedPlayer[] {
  const seen = new Map<string, { name: string; calls: number; members: Set<string> }>();
  for (const call of calls) {
    const inCall = new Map<string, string>();
    for (const a of attackersOf(call.attackers)) if (!inCall.has(a.name.toLowerCase())) inCall.set(a.name.toLowerCase(), a.name);
    for (const [key, name] of inCall) {
      if (known.has(key) || known.has(key.split(/\s+/)[0]!)) continue;
      const entry = seen.get(key) ?? { name, calls: 0, members: new Set<string>() };
      entry.calls += 1;
      entry.members.add(call.memberId ?? call.character.toLowerCase());
      seen.set(key, entry);
    }
  }
  return [...seen.values()].filter((p) => p.calls >= MOST_WANTED_MIN && p.members.size >= MOST_WANTED_MEMBERS).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, top)
    .map((p) => ({ name: p.name, calls: p.calls }));
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
/**
 * Text from the game (zones, enemy names, classes) as Discord text: no link can form (a bare discord.gg/x or a domain has its
 * dots, slashes and colons removed), no mention, no markdown. Every string shown by this module goes through it.
 */
export const clean = (value: string) => escapeMarkdown(value.replace(/[.:/\\@#<>()[\]`|]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 40);

/** Pure: embed fields for the world PvP panel: the defender line, hot zones and most wanted (only the switched-on ones that have something to show). */
export function extrasFields(input: { switches: PvpExtrasSwitches; standings: readonly WorldPvpStanding[]; calls: readonly WeekCall[]; known?: KnownNames }, lang: Lang): { name: string; value: string }[] {
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
    const wanted = mostWanted(input.calls, input.known);
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

type LoadDb = Pick<PrismaClient, "guildHelpCall"> & Partial<Pick<PrismaClient, "character" | "guildRosterEntry" | "unclaimedCharacter">>;
/** The week's calls from guildmates still in the guild (the table keeps seven days). The newest 500 when a week is busier than that. */
export async function loadWeekCalls(db: Pick<PrismaClient, "guildHelpCall">, guildId: string, weekKey: number): Promise<WeekCall[]> {
  const range = weekRange(weekKey);
  return db.guildHelpCall.findMany({ where: { guildId, calledAt: { gte: range.from, lt: range.to }, member: { status: "ACTIVE" } },
    select: { memberId: true, character: true, zone: true, attackers: true, calledAt: true, clearedAt: true }, orderBy: { calledAt: "desc" }, take: 500 });
}

async function loadKnownNames(db: LoadDb, guildId: string): Promise<Set<string>> {
  const [characters, roster, unclaimed] = await Promise.all([
    db.character?.findMany({ where: { guildId }, select: { name: true, displayName: true } }) ?? [],
    db.guildRosterEntry?.findMany({ where: { guildId }, select: { name: true } }) ?? [],
    db.unclaimedCharacter?.findMany({ where: { guildId }, select: { name: true, displayName: true } }) ?? []
  ]);
  return knownNameSet([...characters, ...unclaimed].flatMap((row) => [row.name, row.displayName ?? ""]).concat(roster.map((row) => row.name)));
}

/** The board's extra fields for this guild, or none when every switch is off. Never throws. */
export async function loadExtrasFields(db: LoadDb, guildId: string, settings: Parameters<typeof extrasSwitches>[0], standings: readonly WorldPvpStanding[], lang: Lang, now = new Date()): Promise<{ name: string; value: string }[]> {
  const switches = extrasSwitches(settings);
  if (!switches.recap && !switches.hotZones && !switches.mostWanted) return [];
  try {
    const calls = switches.hotZones || switches.mostWanted ? await loadWeekCalls(db, guildId, weekKeyOf(now)) : [];
    const known = switches.mostWanted ? await loadKnownNames(db, guildId) : undefined;
    return extrasFields({ switches, standings, calls, ...(known ? { known } : {}) }, lang);
  } catch (error) { console.warn("World PvP extras failed", error); return []; }
}

// ---------------------------------------------------------------------------------------------
// Discord posts (queued jobs: retry, pacing, nothing lost on a refused send)
// ---------------------------------------------------------------------------------------------

type PostDb = Pick<PrismaClient, "guild" | "guildSettings" | "guildHelpCall" | "character" | "member" | "worldPvpWeek" | "unclaimedCharacter" | "guildRosterEntry" | "discordJob">;

/** The channel calls and the recap go to: the group finder when the server uses one, else the PvP groups channel, else the ladder channel. */
export function pvpPostChannelId(s: { unifiedGroupFinder?: boolean | null; dungeonSignupChannelId?: string | null; bgGroupsChannelId?: string | null; bgStatsChannelId?: string | null }): string | null {
  return (s.unifiedGroupFinder !== false ? s.dungeonSignupChannelId ?? s.bgGroupsChannelId : s.bgGroupsChannelId ?? s.dungeonSignupChannelId) ?? s.bgStatsChannelId ?? null;
}

async function sendableChannel(discordGuild: DiscordGuild, id: string | null) {
  const channel = id ? await discordGuild.channels.fetch(id).catch(() => null) : null;
  return channel?.isTextBased() && "send" in channel ? channel : null;
}

/** Discord says the channel, the message or the permission is gone: retrying cannot help, so the job ends quietly. */
const isGone = (error: unknown) => { const code = error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0; return [10003, 10008, 50001, 50013].includes(code); };

/** Same place whatever the spelling: the map id when the call has one, else the zone name without case, accents or spacing. */
export const zoneKeyOf = (call: { mapId?: number | null; zone: string }) =>
  call.mapId ? `m:${call.mapId}` : `z:${call.zone.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

export const CALL_POST_LIVE_MINUTES = 5;
/** A queued post is dropped when it is delivered later than this after the call (a long outage never posts old alarms). */
export const CALL_POST_MAX_AGE_MINUTES = 10;
export const CALL_POST_MEMBER_PER_HOUR = 3;
export const CALL_POST_GUILD_PER_10_MIN = 6;
const PENDING = "pending:";
const PENDING_STALE_MS = 2 * 60_000;

type CallRow = { id: string; guildId: string; memberId: string; character: string; zone: string; mapId: number | null; calledAt: Date; clearedAt: Date | null; postChannelId: string | null; postMessageId: string | null };
const callSelect = { id: true, guildId: true, memberId: true, character: true, zone: true, mapId: true, calledAt: true, clearedAt: true, postChannelId: true, postMessageId: true } as const;
const realPost = (call: Pick<CallRow, "postChannelId" | "postMessageId">) => !!call.postChannelId && !!call.postMessageId && !call.postMessageId.startsWith(PENDING);

/** Queues the post work for a call (post when new, edit when cleared). One job per call, so a repeat only refreshes it. Never throws. */
export async function queueCallPost(db: Pick<PrismaClient, "guildSettings" | "discordJob">, call: { id: string; guildId: string }): Promise<boolean> {
  try {
    const settings = await db.guildSettings.findUnique({ where: { guildId: call.guildId }, select: { pvpCallPostsEnabled: true, worldPvpEnabled: true } });
    if (!settings?.pvpCallPostsEnabled || settings.worldPvpEnabled === false) return false;
    await enqueueDiscordJob(db, call.guildId, `pvp-call:${call.id}`, "PVP_CALL", { callId: call.id });
    return true;
  } catch (error) { console.warn("World PvP call post was not queued", error); return false; }
}

/**
 * Job delivery for one call. Reads the call as it is NOW, so a clear that arrived before or during the send is honoured:
 * a call that is already cleared or older than a few minutes is never posted, a post that exists is edited to "cleared",
 * and after a send the call is read again and edited if the all clear landed meanwhile.
 * Limits (at most one live post per zone, per member and per server in a time window) are checked before the post is claimed.
 * Throws only for a failure worth retrying; a missing channel or permission ends the job quietly.
 */
export async function syncCallPost(discordGuild: DiscordGuild, db: PostDb, callId: string, now = new Date()): Promise<boolean> {
  const call: CallRow | null = await db.guildHelpCall.findUnique({ where: { id: callId }, select: callSelect });
  if (!call) return false;
  const settings = await db.guildSettings.findUnique({ where: { guildId: call.guildId } });
  if (!settings?.pvpCallPostsEnabled || settings.worldPvpEnabled === false) return false;
  const lang = asLang(settings.language);
  const book = await loadFullNameBook(db as never, call.guildId);
  const name = displayCharacterName(call.character, book);

  if (realPost(call)) {
    if (!call.clearedAt) return false;
    const channel = await sendableChannel(discordGuild, call.postChannelId);
    return channel ? editPost(channel, call.postMessageId!, callPostText(lang, name, call.zone, true)) : false;
  }
  if (call.clearedAt) return false;
  const ageMs = now.getTime() - call.calledAt.getTime();
  if (ageMs > CALL_POST_MAX_AGE_MINUTES * 60_000) return false;
  if (call.postMessageId?.startsWith(PENDING) && now.getTime() - Number(call.postMessageId.slice(PENDING.length)) < PENDING_STALE_MS) return false;

  const posted = { postMessageId: { not: null } };
  const live = await db.guildHelpCall.findMany({ where: { guildId: call.guildId, id: { not: call.id }, ...posted, clearedAt: null, calledAt: { gte: new Date(now.getTime() - CALL_POST_LIVE_MINUTES * 2 * 60_000) } }, select: { zone: true, mapId: true } });
  if (live.some((other) => zoneKeyOf(other) === zoneKeyOf(call))) return false;
  const [mine, everyone] = await Promise.all([
    db.guildHelpCall.count({ where: { guildId: call.guildId, memberId: call.memberId, id: { not: call.id }, ...posted, calledAt: { gte: new Date(now.getTime() - 3_600_000) } } }),
    db.guildHelpCall.count({ where: { guildId: call.guildId, id: { not: call.id }, ...posted, calledAt: { gte: new Date(now.getTime() - 600_000) } } })
  ]);
  if (mine >= CALL_POST_MEMBER_PER_HOUR || everyone >= CALL_POST_GUILD_PER_10_MIN) return false;

  const channel = await sendableChannel(discordGuild, pvpPostChannelId(settings));
  if (!channel) return false;
  // Claim before sending: a second delivery of the same call finds the claim and stops.
  const claim = `${PENDING}${now.getTime()}`;
  const claimed = await db.guildHelpCall.updateMany({ where: { id: call.id, postMessageId: call.postMessageId }, data: { postMessageId: claim } });
  if (!claimed.count) return false;
  const release = () => db.guildHelpCall.updateMany({ where: { id: call.id, postMessageId: claim }, data: { postMessageId: null } });
  let sent;
  try { sent = await channel.send({ content: callPostText(lang, name, call.zone), allowedMentions: { parse: [] } }); }
  catch (error) { await release(); if (isGone(error)) return false; throw error; }
  await db.guildHelpCall.update({ where: { id: call.id }, data: { postChannelId: channel.id, postMessageId: sent.id } });
  // The all clear may have arrived while the post was on its way.
  const after = await db.guildHelpCall.findUnique({ where: { id: call.id }, select: { clearedAt: true } });
  if (after?.clearedAt) await editPost(channel, sent.id, callPostText(lang, name, call.zone, true));
  return true;
}

async function editPost(channel: NonNullable<Awaited<ReturnType<typeof sendableChannel>>>, messageId: string, content: string): Promise<boolean> {
  try {
    const message = await channel.messages.fetch(messageId);
    if (!message.editable) return false;
    if (message.content === content) return true;
    await message.edit({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) { if (isGone(error)) return false; throw error; }
}

/** Subscribes the call posts to the upload hooks. Call once at startup. Only live, new calls are queued; any all clear of a posted call is queued as an edit. */
export function registerCallPosts(db: PostDb): void {
  onHelpCallStored(async (call) => {
    if (Date.now() - call.calledAt.getTime() > CALL_POST_LIVE_MINUTES * 60_000) return;
    await queueCallPost(db, call);
  });
  onHelpCallCleared(async (call) => { if (call.postMessageId) await queueCallPost(db, call); });
}

/**
 * The Tuesday recap, queued once per finished week, six hours after the reset, for a server that switched it on.
 * A server that has never had a baseline gets one now (no recap for a week that ended before the officer opted in), and the week
 * is claimed before anything is queued, so a missing channel or a second bot instance cannot make it repeat every tick.
 */
export async function scheduleWeeklyRecap(db: PostDb, discordId: string, now = new Date()): Promise<boolean> {
  const record = await db.guild.findUnique({ where: guildWhere(discordId), select: { id: true } });
  if (!record) return false;
  const settings = await db.guildSettings.findUnique({ where: { guildId: record.id }, select: { pvpRecapEnabled: true, worldPvpEnabled: true, pvpRecapLastWeek: true } });
  if (!settings?.pvpRecapEnabled || settings.worldPvpEnabled === false) return false;
  const week = weekKeyOf(now) - 1;
  if (settings.pvpRecapLastWeek === null || settings.pvpRecapLastWeek === undefined) {
    await db.guildSettings.updateMany({ where: { guildId: record.id, pvpRecapLastWeek: null }, data: { pvpRecapLastWeek: week } });
    return false;
  }
  if (settings.pvpRecapLastWeek >= week || now.getTime() < weekRange(week).to.getTime() + RECAP_DELAY_HOURS * 3_600_000) return false;
  const claimed = await db.guildSettings.updateMany({ where: { guildId: record.id, pvpRecapLastWeek: { lt: week } }, data: { pvpRecapLastWeek: week } });
  if (!claimed.count) return false;
  await enqueueDiscordJob(db, record.id, `pvp-recap:${week}`, "PVP_RECAP", { week });
  return true;
}

/** Job delivery of the recap for one finished week. A missing channel or a week with nothing counted ends the job without posting. */
export async function deliverWeeklyRecap(discordGuild: DiscordGuild, db: PostDb, guildId: string, week: number): Promise<boolean> {
  const [settings, record] = await Promise.all([db.guildSettings.findUnique({ where: { guildId } }), db.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true } })]);
  if (!settings?.pvpRecapEnabled || settings.worldPvpEnabled === false) return false;
  const channel = await sendableChannel(discordGuild, pvpPostChannelId(settings));
  if (!channel) return false;
  const data = await loadWorldPvpData(db, guildId, record?.gameEdition ?? "forever", new Date(weekRange(week).from.getTime() + 1_000));
  const recap = weekRecap(data.standings, await loadWeekCalls(db, guildId, week));
  if (!recap.killer && !recap.defender && !recap.helper) return false;
  try { await channel.send({ content: recapText(recap, asLang(settings.language)), allowedMentions: { parse: [] } }); }
  catch (error) { if (isGone(error)) return false; throw error; }
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
