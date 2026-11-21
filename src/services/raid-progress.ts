import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { escapeHtml, link } from "./web-layout.js";
import { factionTag, guildFactions } from "./guild-faction.js";
import { registerLeaderboardCache } from "./leaderboard-cache-hooks.js";
import type { WebContext, WebKit, WebRoute } from "./web-app.js";

// Raid progress (9 December 2026, WoW Forever's first raids). Members' addons record boss kills inside raid instances
// (addon Modules/RaidProgress.lua); companions upload them; this file stores them and ranks guilds on a public board:
// most bosses killed first, then the earlier last kill. World firsts are the earliest kill of each boss among the guilds on the board.
//
// Trust follows the dungeon runs (docs/plans/RUN_TRUST_2026-11-10.md and docs/PUBLIC_SCORE_INTEGRITY*.md): a signed-in member's upload
// counts; an unsigned companion's counts only when its own reported character is one of the kill's guild members; a kill needs a real
// guild raid group (at least 40 % of the raid, three or more, are guild members), a believable time, and is capped per guild and day.
// One report is enough (no two-witness rule); more reporters only raise the "confirmed by N" count. Only guilds that publish their
// dungeon runs (/mod leaderboard) appear on the public board.

/** The first raids open on this day (UTC). Before it the board shows its "raids open" empty state. */
export const RAIDS_OPEN_AT = new Date(Date.UTC(2026, 11, 9, 0, 0, 0));

/**
 * Raid and boss names the bot knows by id, filled in when the game's ids are confirmed (the owner's saved kills show them).
 * Until then every kill inside a raid instance is accepted and shown with the names the game sent.
 */
export const RAID_CATALOG: Record<number, { name: { en: string; fr: string }; bosses: Record<number, { en: string; fr: string }> }> = {};

const MIN_GUILD_SHARE = 0.4;
const MIN_GUILD_MEMBERS = 3;
const MAX_FUTURE_MS = 10 * 60_000;
const MAX_AGE_MS = 45 * 86_400_000;
const SAME_KILL_MS = 15 * 60_000;
export const KILLS_PER_GUILD_PER_DAY = 200;
const clean = (max: number) => z.string().trim().min(1).max(max).refine((value) => !value.includes("|") && Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));

const killSchema = z.object({
  ref: clean(80),
  instanceId: z.number().int().min(1).max(1_000_000),
  instance: clean(60),
  encounterId: z.number().int().min(1).max(10_000_000),
  boss: z.string().trim().max(60).optional().default(""),
  difficultyId: z.number().int().min(0).max(1000).optional().default(0),
  difficulty: z.string().trim().max(30).optional(),
  groupSize: z.number().int().min(1).max(40),
  guildCount: z.number().int().min(0).max(40),
  guildNames: z.array(z.string().trim().min(1).max(40)).max(40).optional().default([]),
  at: z.number().int().min(1_600_000_000).max(4_000_000_000),
  durationSec: z.number().int().min(1).max(21_600).optional(),
  reporter: z.string().trim().max(40).optional()
});
export type RaidKillUpload = z.infer<typeof killSchema>;

/** Rows that pass the shape check; the rest are dropped one by one (a bad row never rejects an upload). */
export function parseRaidKills(raw: unknown[]): RaidKillUpload[] {
  const out: RaidKillUpload[] = [];
  for (const row of raw.slice(0, 60)) {
    const parsed = killSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

const key = (value: string) => value.normalize("NFC").trim().toLowerCase();

export type RaidKillVerdict = { ok: true } | { ok: false; reason: "future" | "old" | "not-guild-raid" | "reporter-not-in-kill" };

/** The plausibility and trust rules for one kill. `reporterKeys` are the lowercase names the uploader may speak for (an unsigned device's own characters). */
export function checkRaidKill(kill: RaidKillUpload, now: Date, trust: "member" | "device", reporterKeys: ReadonlySet<string> = new Set()): RaidKillVerdict {
  const killedAt = kill.at * 1000;
  if (killedAt > now.getTime() + MAX_FUTURE_MS) return { ok: false, reason: "future" };
  if (killedAt < now.getTime() - MAX_AGE_MS) return { ok: false, reason: "old" };
  if (kill.guildCount < Math.max(MIN_GUILD_MEMBERS, Math.ceil(kill.groupSize * MIN_GUILD_SHARE)) || kill.guildCount > kill.groupSize) return { ok: false, reason: "not-guild-raid" };
  if (trust === "device") {
    const names = new Set(kill.guildNames.map(key));
    if (![...reporterKeys].some((own) => names.has(own))) return { ok: false, reason: "reporter-not-in-kill" };
  }
  return { ok: true };
}

export interface ApplyRaidKills { stored: number; confirmed: number; refused: number }

/** Stores the kills of one upload for a guild. Idempotent: a resent upload changes nothing. */
export async function applyRaidKills(db: PrismaClient, input: { guildId: string; trust: "member" | "device"; reporterKeys?: ReadonlySet<string>; kills: RaidKillUpload[]; now?: Date }): Promise<ApplyRaidKills> {
  const now = input.now ?? new Date();
  const result: ApplyRaidKills = { stored: 0, confirmed: 0, refused: 0 };
  if (!input.kills.length) return result;
  const dayStart = new Date(now.getTime() - 86_400_000);
  let room = Math.max(0, KILLS_PER_GUILD_PER_DAY - await db.raidKill.count({ where: { guildId: input.guildId, createdAt: { gte: dayStart } } }));
  for (const kill of input.kills) {
    if (!checkRaidKill(kill, now, input.trust, input.reporterKeys).ok) { result.refused += 1; continue; }
    const killedAt = new Date(kill.at * 1000);
    const near = await db.raidKill.findFirst({ where: { guildId: input.guildId, instanceId: kill.instanceId, encounterId: kill.encounterId, difficultyId: kill.difficultyId,
      killedAt: { gte: new Date(killedAt.getTime() - SAME_KILL_MS), lte: new Date(killedAt.getTime() + SAME_KILL_MS) } }, select: { id: true, killedAt: true } });
    if (near) {
      // The same kill told by another member: only the exact same timestamp is the same report, anything else is a new witness.
      if (near.killedAt.getTime() !== killedAt.getTime()) { await db.raidKill.update({ where: { id: near.id }, data: { reporters: { increment: 1 } } }); result.confirmed += 1; }
      continue;
    }
    if (room <= 0) { result.refused += 1; continue; }
    room -= 1;
    await db.raidKill.create({ data: {
      guildId: input.guildId, instanceId: kill.instanceId, instanceName: kill.instance, encounterId: kill.encounterId, bossName: kill.boss || String(kill.encounterId),
      difficultyId: kill.difficultyId, difficultyName: kill.difficulty ?? null, killedAt, durationSec: kill.durationSec ?? null, groupSize: kill.groupSize,
      guildCount: kill.guildCount, members: kill.guildNames.map(key).slice(0, 40), trust: input.trust
    } }).then(() => { result.stored += 1; }, (error: { code?: string }) => { if (error?.code !== "P2002") throw error; });
  }
  if (result.stored || result.confirmed) clearRaidBoardCache();
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The board

export interface BoardKill { guildId: string; instanceId: number; instanceName: string; encounterId: number; bossName: string; difficultyId: number; difficultyName: string | null; killedAt: Date; reporters: number }
export interface BoardGuild { id: string; name: string; slug: string | null; /** ALLIANCE or HORDE when known (guild-faction.ts). */ faction?: string | null }
export interface RaidBoardRow { guild: BoardGuild; bosses: number; lastKillAt: Date; firstKillAt: Date; worldFirsts: number }
export interface RaidFirst { instanceId: number; instanceName: string; encounterId: number; bossName: string; difficultyId: number; difficultyName: string | null; guild: BoardGuild; killedAt: Date; reporters: number }
export interface RaidBoard { rows: RaidBoardRow[]; firsts: RaidFirst[]; totalKills: number }

/** Guilds ranked by distinct bosses killed (a boss on another difficulty counts once per difficulty), then the earlier last kill. */
export function buildRaidBoard(kills: BoardKill[], guilds: ReadonlyMap<string, BoardGuild>): RaidBoard {
  const bossKey = (kill: BoardKill) => `${kill.instanceId}:${kill.encounterId}:${kill.difficultyId}`;
  const earliest = new Map<string, BoardKill>();
  const perGuild = new Map<string, Map<string, BoardKill>>();
  let totalKills = 0;
  for (const kill of kills) {
    if (!guilds.has(kill.guildId)) continue;
    totalKills += 1;
    const mine = perGuild.get(kill.guildId) ?? new Map<string, BoardKill>();
    perGuild.set(kill.guildId, mine);
    const own = mine.get(bossKey(kill));
    if (!own || kill.killedAt < own.killedAt) mine.set(bossKey(kill), kill);
  }
  for (const mine of perGuild.values()) for (const [id, kill] of mine) {
    const best = earliest.get(id);
    // Ties (the same second) go to the guild with more reporters, then to the older id: stable, never random.
    if (!best || kill.killedAt < best.killedAt || (kill.killedAt.getTime() === best.killedAt.getTime() && kill.guildId < best.guildId)) earliest.set(id, kill);
  }
  const firsts = [...earliest.values()].map((kill): RaidFirst => ({ instanceId: kill.instanceId, instanceName: kill.instanceName, encounterId: kill.encounterId, bossName: kill.bossName,
    difficultyId: kill.difficultyId, difficultyName: kill.difficultyName, guild: guilds.get(kill.guildId)!, killedAt: kill.killedAt, reporters: kill.reporters }))
    .sort((a, b) => a.killedAt.getTime() - b.killedAt.getTime());
  const firstsByGuild = new Map<string, number>();
  for (const kill of earliest.values()) firstsByGuild.set(kill.guildId, (firstsByGuild.get(kill.guildId) ?? 0) + 1);
  const rows = [...perGuild.entries()].map(([guildId, mine]): RaidBoardRow => {
    const times = [...mine.values()].map((kill) => kill.killedAt.getTime());
    return { guild: guilds.get(guildId)!, bosses: mine.size, lastKillAt: new Date(Math.max(...times)), firstKillAt: new Date(Math.min(...times)), worldFirsts: firstsByGuild.get(guildId) ?? 0 };
  }).sort((a, b) => b.bosses - a.bosses || a.lastKillAt.getTime() - b.lastKillAt.getTime() || a.guild.name.localeCompare(b.guild.name));
  return { rows, firsts, totalKills };
}

const MAX_BOARD_KILLS = 20_000;
let boardCache: { at: number; board: RaidBoard } | null = null;
const CACHE_MS = 60_000;
export function clearRaidBoardCache(): void { boardCache = null; }
registerLeaderboardCache(clearRaidBoardCache);

/** The public board: only guilds on the Forever edition that publish their dungeon runs and are not test servers. */
export async function loadRaidBoard(db: PrismaClient, now = new Date()): Promise<RaidBoard> {
  if (boardCache && now.getTime() - boardCache.at < CACHE_MS) return boardCache.board;
  const kills = await db.raidKill.findMany({ where: { valid: true, guild: { gameEdition: "forever", isTestServer: false, settings: { publicDungeonRuns: true } } },
    orderBy: { killedAt: "asc" }, take: MAX_BOARD_KILLS,
    select: { guildId: true, instanceId: true, instanceName: true, encounterId: true, bossName: true, difficultyId: true, difficultyName: true, killedAt: true, reporters: true,
      guild: { select: { id: true, name: true, settings: { select: { publicSlug: true } } } } } });
  const guilds = new Map<string, BoardGuild>();
  for (const kill of kills) guilds.set(kill.guildId, { id: kill.guild.id, name: kill.guild.name, slug: kill.guild.settings?.publicSlug ?? null });
  const factions = await guildFactions(db, [...guilds.keys()]);
  for (const [id, guild] of guilds) guild.faction = factions.get(id) ?? null;
  const board = buildRaidBoard(kills, guilds);
  boardCache = { at: now.getTime(), board };
  return board;
}

// ---------------------------------------------------------------------------------------------------------------------------
// JSON and page

const names = (instanceId: number, encounterId: number, lang: "en" | "fr", fallback: { instance: string; boss: string }) => {
  const known = RAID_CATALOG[instanceId];
  return { instance: known?.name[lang] ?? fallback.instance, boss: known?.bosses[encounterId]?.[lang] ?? fallback.boss };
};

export function raidBoardJson(board: RaidBoard, now: Date): Record<string, unknown> {
  const open = now >= RAIDS_OPEN_AT;
  return {
    opensAt: RAIDS_OPEN_AT.toISOString(), open, totalKills: board.totalKills,
    guilds: board.rows.map((row, index) => ({ rank: index + 1, name: row.guild.name, slug: row.guild.slug, faction: row.guild.faction ?? null, bosses: row.bosses, worldFirsts: row.worldFirsts, lastKillAt: row.lastKillAt.toISOString() })),
    firsts: board.firsts.map((first) => ({ instanceId: first.instanceId, instance: names(first.instanceId, first.encounterId, "en", { instance: first.instanceName, boss: first.bossName }).instance,
      encounterId: first.encounterId, boss: names(first.instanceId, first.encounterId, "en", { instance: first.instanceName, boss: first.bossName }).boss, difficultyId: first.difficultyId,
      difficulty: first.difficultyName, guild: first.guild.name, slug: first.guild.slug, faction: first.guild.faction ?? null, killedAt: first.killedAt.toISOString(), confirmedBy: first.reporters }))
  };
}

const guildHref = (guild: BoardGuild, lang: "en" | "fr") => link(`/leaderboards/guild/${encodeURIComponent(guild.slug ?? guild.id)}`, lang);

export function raidBoardBody(board: RaidBoard, ctx: Pick<WebContext, "t" | "lang" | "now">): string {
  const { t, lang } = ctx;
  const date = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const opens = RAIDS_OPEN_AT.toISOString().slice(0, 10);
  let body = `<p class="eyebrow">Guilded</p><h1>${t("Raid progress", "Progression en raid")}</h1>`
    + `<p class="muted">${t("Guilds ranked by raid bosses killed, then by who finished first. Kills are recorded by the guild's own members through the Guilded addon; a kill counts when most of the raid is from the guild.", "Les guildes classées par boss de raid tués, puis par qui a fini en premier. Les victoires sont enregistrées par les membres de la guilde avec l'addon Guilded ; une victoire compte quand la majorité du raid vient de la guilde.")}</p>`;
  if (!board.rows.length) {
    body += ctx.now < RAIDS_OPEN_AT
      ? `<div class="notice"><strong>${t("Raids open 9 December", "Les raids ouvrent le 9 décembre")}</strong><br>${t(`WoW Forever's first raids open on ${opens}. Install Guilded and its companion now: your guild's first kills will appear here by themselves.`, `Les premiers raids de WoW Forever ouvrent le ${opens}. Installez Guilded et son compagnon dès maintenant : les premières victoires de votre guilde apparaîtront ici toutes seules.`)}</div>`
      : `<div class="notice">${t("No raid kill has been recorded yet. Guilds that share their runs publicly appear here after their first boss.", "Aucune victoire en raid n'a encore été enregistrée. Les guildes qui partagent leurs parcours publiquement apparaissent ici après leur premier boss.")}</div>`;
    return body + `<p><a href="${link("/leaderboards/", lang)}">${t("All leaderboards →", "Tous les classements →")}</a></p>`;
  }
  body += `<h2>${t("Guilds", "Guildes")}</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>${t("Guild", "Guilde")}</th><th>${t("Bosses", "Boss")}</th><th>${t("World firsts", "Premières mondiales")}</th><th>${t("Last kill", "Dernière victoire")}</th></tr></thead><tbody>`
    + board.rows.slice(0, 100).map((row, index) => `<tr><td>${index + 1}</td><td><a href="${escapeHtml(guildHref(row.guild, lang))}">${escapeHtml(row.guild.name)}</a>${row.guild.faction ? ` ${factionTag(row.guild.faction, lang)}` : ""}</td><td>${row.bosses}</td><td>${row.worldFirsts}</td><td>${date(row.lastKillAt)}</td></tr>`).join("")
    + `</tbody></table></div>`;
  body += `<h2>${t("World firsts", "Premières mondiales")}</h2><div class="table-wrap"><table><thead><tr><th>${t("Raid", "Raid")}</th><th>${t("Boss", "Boss")}</th><th>${t("First guild", "Première guilde")}</th><th>${t("When", "Quand")}</th></tr></thead><tbody>`
    + board.firsts.slice(0, 200).map((first) => {
      const label = names(first.instanceId, first.encounterId, lang, { instance: first.instanceName, boss: first.bossName });
      return `<tr><td>${escapeHtml(label.instance)}${first.difficultyName ? ` <span class="muted">${escapeHtml(first.difficultyName)}</span>` : ""}</td><td>${escapeHtml(label.boss)}</td><td><a href="${escapeHtml(guildHref(first.guild, lang))}">${escapeHtml(first.guild.name)}</a>${first.guild.faction ? ` ${factionTag(first.guild.faction, lang)}` : ""}</td><td>${date(first.killedAt)}</td></tr>`;
    }).join("")
    + `</tbody></table></div>`;
  return body + `<p class="muted">${t("Only guilds that share their dungeon runs publicly are listed. WoW Forever has no regions, so firsts are worldwide.", "Seules les guildes qui partagent publiquement leurs parcours de donjon sont listées. WoW Forever n'a pas de régions : les premières sont mondiales.")} <a href="${link("/leaderboards/raids.json", lang)}">JSON</a></p>`
    + `<p><a href="${link("/leaderboards/", lang)}">${t("All leaderboards →", "Tous les classements →")}</a></p>`;
}

/** /leaderboards/raids/ and /leaderboards/raids.json (also served inside the Forever section: the website strips the prefix). */
export function createRaidProgressWeb(db: PrismaClient): { route: WebRoute } {
  const route: WebRoute = async (ctx: WebContext, kit: WebKit) => {
    const path = ctx.request.path;
    const isJson = path === "/leaderboards/raids.json";
    if (!isJson && path !== "/leaderboards/raids/" && path !== "/leaderboards/raids") return null;
    if (!["GET", "HEAD"].includes(ctx.request.method)) return null;
    if (path === "/leaderboards/raids") return kit.redirect(`/leaderboards/raids/${ctx.request.query.size ? `?${ctx.request.query.toString()}` : ""}`);
    const board = await loadRaidBoard(db, ctx.now);
    if (isJson) {
      const text = JSON.stringify(raidBoardJson(board, ctx.now));
      return { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" }, body: ctx.request.method === "HEAD" ? "" : text };
    }
    return kit.page(200, ctx.t("Raid progress", "Progression en raid"), raidBoardBody(board, ctx), {
      description: ctx.t("WoW Forever raid progress: guilds ranked by bosses killed, and the world first on every boss.", "Progression en raid de WoW Forever : les guildes classées par boss tués, et la première mondiale sur chaque boss.") });
  };
  return { route };
}
