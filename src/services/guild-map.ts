import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";

// Track M (ROADMAP "Final phase 2" items 3 and 4): the phone's guildmate map, last-seen heat map and
// call-for-help pins.
//
// Where it comes from: the addon (Modules/GuildMap.lua, Modules/CallForHelp.lua) saves the player's
// own last outdoor position, a short trail and their own calls for help; their companion uploads
// them (companion/lua-export-content.mjs exportGuildMap) with the usual addon import. Only the
// uploader's own rows are kept (their pairing), so a member never reports another member's position.
//
// Privacy (owner decision, 6 November 2026): on by default; only signed-in members of the same guild
// see it (GET /api/v1/companion/guild-map, credential bound to the guild); never public. A member who
// turns sharing off has every stored position deleted and their calls lose their coordinates; uploads
// then keep none. Officers can turn the whole map off (/officer roster map). Positions are "last
// seen" (uploads happen at reload or logout), kept 28 days; calls 7 days.

export const SIGHTING_DAYS = 28;
export const CALL_DAYS = 7;
/** Calls this recent are shown as pins; the addon itself expires a call after 5 minutes. */
export const CALL_PIN_HOURS = 6;
export const CALL_ACTIVE_MINUTES = 5;
export const HEAT_COLS = 24;
export const HEAT_ROWS = 16;
const MAX_SIGHTINGS_PER_UPLOAD = 60;
const MAX_CALLS_PER_UPLOAD = 10;

const unit = z.number().finite().min(0).max(1);
const label = (max: number) => z.string().trim().min(1).max(200).transform((v) => v.replace(/[|\p{Cc}]/gu, " ").slice(0, max));
const epochSeconds = z.number().int().min(1_600_000_000).max(4_000_000_000);

const sightingSchema = z.object({
  character: label(80),
  mapId: z.number().int().positive().max(100_000),
  zone: label(60),
  x: unit, y: unit,
  continentId: z.number().int().positive().max(100_000).optional(),
  continent: label(60).optional(),
  cx: unit.optional(), cy: unit.optional(),
  at: epochSeconds
});
export type MapSightingUpload = z.infer<typeof sightingSchema>;

const attackerSchema = z.object({ name: label(40), class: z.string().max(20).optional(), level: z.number().int().min(0).max(100).optional() });
const helpCallSchema = z.object({
  ref: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
  character: label(80),
  zone: z.string().max(200).transform((v) => v.replace(/[|\p{Cc}]/gu, " ").trim().slice(0, 60)),
  subzone: z.string().max(200).transform((v) => v.replace(/[|\p{Cc}]/gu, " ").trim().slice(0, 60)).optional(),
  mapId: z.number().int().positive().max(100_000).optional(),
  x: unit.optional(), y: unit.optional(),
  continentId: z.number().int().positive().max(100_000).optional(),
  continent: label(60).optional(),
  cx: unit.optional(), cy: unit.optional(),
  attackers: z.array(attackerSchema).max(3).default([]),
  at: epochSeconds,
  clearedAt: epochSeconds.optional()
});
export type HelpCallUpload = z.infer<typeof helpCallSchema>;

/** Row by row: a malformed row is left out, never the upload. Future timestamps (bad clocks) are dropped. */
export function parseGuildMapUpload(sightings: unknown, calls: unknown, now = new Date()): { sightings: MapSightingUpload[]; calls: HelpCallUpload[] } {
  const limit = Math.floor(now.getTime() / 1000) + 600;
  const rows = <T extends { at: number }>(value: unknown, schema: z.ZodType<T>, max: number): T[] =>
    (Array.isArray(value) ? value : []).flatMap((raw) => {
      const parsed = schema.safeParse(raw);
      return parsed.success && parsed.data.at <= limit ? [parsed.data] : [];
    }).slice(-max);
  return { sightings: rows(sightings, sightingSchema, MAX_SIGHTINGS_PER_UPLOAD), calls: rows(calls, helpCallSchema, MAX_CALLS_PER_UPLOAD) };
}

// ---------------------------------------------------------------------------------------------
// Push hook: the Defender push notification (needs PR #345 and Firebase) subscribes here later.
// ---------------------------------------------------------------------------------------------

export interface StoredHelpCall { guildId: string; memberId: string; character: string; zone: string; calledAt: Date; attackers: HelpCallUpload["attackers"] }
type HelpCallListener = (call: StoredHelpCall) => void | Promise<void>;
const helpCallListeners: HelpCallListener[] = [];
/** Called once for each newly stored call. Returns an unsubscribe function. Listeners never fail an upload. */
export function onHelpCallStored(listener: HelpCallListener): () => void {
  helpCallListeners.push(listener);
  return () => { const i = helpCallListeners.indexOf(listener); if (i >= 0) helpCallListeners.splice(i, 1); };
}

type MapDb = Pick<PrismaClient, "guildSettings" | "member" | "guildMapSighting" | "guildHelpCall">;

const coords = (row: { mapId?: number | undefined; x?: number | undefined; y?: number | undefined; continentId?: number | undefined; continent?: string | undefined; cx?: number | undefined; cy?: number | undefined }, share: boolean) => share && row.mapId && row.x !== undefined && row.y !== undefined
  ? { mapId: row.mapId, x: row.x, y: row.y, continentId: row.continentId ?? null, continent: row.continent ?? null,
    cx: row.cx ?? null, cy: row.cy ?? null }
  : { mapId: null, x: null, y: null, continentId: null, continent: null, cx: null, cy: null };

/** Stores the uploader's own rows. Never throws for an odd row; the caller still guards the whole call. */
export async function applyGuildMapUpload(db: MapDb, guildId: string, memberId: string, upload: { sightings: MapSightingUpload[]; calls: HelpCallUpload[] }, now = new Date()): Promise<{ sightings: number; calls: number }> {
  if (!upload.sightings.length && !upload.calls.length) return { sightings: 0, calls: 0 };
  const [settings, member] = await Promise.all([
    db.guildSettings.findUnique({ where: { guildId }, select: { guildMapEnabled: true } }),
    db.member.findUnique({ where: { id: memberId }, select: { guildId: true, mapShareOff: true } })
  ]);
  if (!member || member.guildId !== guildId) return { sightings: 0, calls: 0 };
  // With the map off for the server nothing about where anyone was is kept, but calls for help are still stored (without
  // coordinates): the world PvP board checks defends and calls answered against the guild's real calls.
  const mapOn = settings?.guildMapEnabled !== false;
  const share = mapOn && !member.mapShareOff;
  const sightingCutoff = new Date(now.getTime() - SIGHTING_DAYS * 86_400_000);
  const callCutoff = new Date(now.getTime() - CALL_DAYS * 86_400_000);
  let sightings = 0;
  if (share) {
    const data = upload.sightings.map((row) => ({
      guildId, memberId, character: row.character, mapId: row.mapId, zone: row.zone, x: row.x, y: row.y,
      continentId: row.continentId ?? null, continent: row.continent ?? null, cx: row.cx ?? null, cy: row.cy ?? null,
      seenAt: new Date(row.at * 1000)
    })).filter((row) => row.seenAt >= sightingCutoff);
    if (data.length) sightings = (await db.guildMapSighting.createMany({ data, skipDuplicates: true })).count;
  }
  let calls = 0;
  for (const call of upload.calls) {
    const calledAt = new Date(call.at * 1000);
    if (calledAt < callCutoff) continue;
    const clearedAt = call.clearedAt ? new Date(call.clearedAt * 1000) : null;
    const existing = await db.guildHelpCall.findUnique({ where: { memberId_ref: { memberId, ref: call.ref } }, select: { id: true, clearedAt: true } });
    if (existing) {
      if (clearedAt && !existing.clearedAt) await db.guildHelpCall.update({ where: { id: existing.id }, data: { clearedAt } });
      continue;
    }
    await db.guildHelpCall.create({ data: {
      guildId, memberId, ref: call.ref, character: call.character, zone: call.zone || "?", subzone: call.subzone || null,
      ...coords(call, share), attackers: call.attackers, calledAt, clearedAt
    } });
    calls += 1;
    for (const listener of [...helpCallListeners]) {
      try { await listener({ guildId, memberId, character: call.character, zone: call.zone, calledAt, attackers: call.attackers }); }
      catch (error) { console.warn("Help call listener failed", error); }
    }
  }
  // Pruned here rather than by a scheduled job: every upload trims its own guild.
  await db.guildMapSighting.deleteMany({ where: { guildId, seenAt: { lt: sightingCutoff } } });
  await db.guildHelpCall.deleteMany({ where: { guildId, calledAt: { lt: callCutoff } } });
  return { sightings, calls };
}

/** The member's switch. Off deletes every stored position and strips coordinates from their calls. */
export async function setMapSharing(db: MapDb, memberId: string, share: boolean): Promise<{ share: boolean; deleted: number }> {
  await db.member.update({ where: { id: memberId }, data: { mapShareOff: !share } });
  if (share) return { share, deleted: 0 };
  const removed = await db.guildMapSighting.deleteMany({ where: { memberId } });
  await db.guildHelpCall.updateMany({ where: { memberId }, data: { mapId: null, x: null, y: null, continentId: null, continent: null, cx: null, cy: null } });
  return { share, deleted: removed.count };
}

// ---------------------------------------------------------------------------------------------
// The phone view
// ---------------------------------------------------------------------------------------------

export interface SightingRow { memberId: string; character: string; mapId: number; zone: string; x: number; y: number; continentId: number | null; continent: string | null; cx: number | null; cy: number | null; seenAt: Date }
export interface CharacterInfo { name: string; displayName: string | null; className: string; level: number | null }
export interface MapMate {
  character: string; name: string; className: string | null; level: number | null; mine: boolean;
  zone: string; mapId: number; x: number; y: number; continentId: number | null; cx: number | null; cy: number | null; seenAt: string;
}
export interface MapContinent { id: number; name: string; cells: [number, number, number][]; max: number; zones: { zone: string; cx: number; cy: number; count: number }[] }
export interface MapHelpPin {
  character: string; name: string; mine: boolean; zone: string; subzone: string | null; continentId: number | null; cx: number | null; cy: number | null;
  mapId: number | null; x: number | null; y: number | null; attackers: { name: string; class: string | null; level: number | null }[];
  calledAt: string; active: boolean; cleared: boolean;
}
export interface GuildMapView {
  enabled: boolean; sharing: boolean; days: number;
  mates: MapMate[]; continents: MapContinent[]; calls: MapHelpPin[];
}

const nameKey = (value: string) => value.trim().toLowerCase();

/** Latest sighting per character, newest first. */
export function latestPerCharacter(rows: SightingRow[]): SightingRow[] {
  const by = new Map<string, SightingRow>();
  for (const row of rows) {
    const key = `${row.memberId}|${nameKey(row.character)}`;
    const seen = by.get(key);
    if (!seen || seen.seenAt < row.seenAt) by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime());
}

/**
 * The heat map: every sighting of the window binned on its continent (HEAT_COLS x HEAT_ROWS), plus a
 * label spot for each zone (the middle of the guild's sightings there). Counts only, never names.
 */
export function heatByContinent(rows: SightingRow[]): MapContinent[] {
  const continents = new Map<number, { name: string; cells: Map<number, number>; zones: Map<string, { sx: number; sy: number; count: number }> }>();
  for (const row of rows) {
    if (row.continentId === null || row.cx === null || row.cy === null) continue;
    let entry = continents.get(row.continentId);
    if (!entry) { entry = { name: row.continent ?? `Map ${row.continentId}`, cells: new Map(), zones: new Map() }; continents.set(row.continentId, entry); }
    const col = Math.min(HEAT_COLS - 1, Math.floor(row.cx * HEAT_COLS)), line = Math.min(HEAT_ROWS - 1, Math.floor(row.cy * HEAT_ROWS));
    const cell = line * HEAT_COLS + col;
    entry.cells.set(cell, (entry.cells.get(cell) ?? 0) + 1);
    const zone = entry.zones.get(row.zone) ?? { sx: 0, sy: 0, count: 0 };
    zone.sx += row.cx; zone.sy += row.cy; zone.count += 1;
    entry.zones.set(row.zone, zone);
  }
  return [...continents.entries()].map(([id, entry]) => {
    const cells = [...entry.cells.entries()].map(([cell, count]): [number, number, number] => [cell % HEAT_COLS, Math.floor(cell / HEAT_COLS), count]);
    const zones = [...entry.zones.entries()].map(([zone, z]) => ({ zone, cx: round(z.sx / z.count), cy: round(z.sy / z.count), count: z.count }))
      .sort((a, b) => b.count - a.count);
    return { id, name: entry.name, cells, max: Math.max(0, ...cells.map((c) => c[2])), zones };
  }).sort((a, b) => b.cells.reduce((n, c) => n + c[2], 0) - a.cells.reduce((n, c) => n + c[2], 0));
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function buildGuildMapView(input: {
  enabled: boolean; sharing: boolean; viewerMemberId: string; now: Date;
  sightings: SightingRow[]; characters: Map<string, CharacterInfo>;
  calls: { memberId: string; character: string; zone: string; subzone: string | null; mapId: number | null; x: number | null; y: number | null; continentId: number | null; cx: number | null; cy: number | null; attackers: unknown; calledAt: Date; clearedAt: Date | null }[];
}): GuildMapView {
  const info = (character: string) => input.characters.get(nameKey(character));
  const shown = (character: string) => info(character)?.displayName || character;
  const mates = latestPerCharacter(input.sightings).map((row): MapMate => ({
    character: row.character, name: shown(row.character), className: info(row.character)?.className || null, level: info(row.character)?.level ?? null,
    mine: row.memberId === input.viewerMemberId, zone: row.zone, mapId: row.mapId, x: round(row.x), y: round(row.y),
    continentId: row.continentId, cx: row.cx === null ? null : round(row.cx), cy: row.cy === null ? null : round(row.cy), seenAt: row.seenAt.toISOString()
  }));
  const calls = input.calls.map((call): MapHelpPin => {
    const attackers = Array.isArray(call.attackers) ? call.attackers.flatMap((raw) => {
      const a = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
      const name = a?.["name"], cls = a?.["class"], level = a?.["level"];
      return typeof name === "string" ? [{ name, class: typeof cls === "string" ? cls : null, level: typeof level === "number" ? level : null }] : [];
    }) : [];
    return {
      character: call.character, name: shown(call.character), mine: call.memberId === input.viewerMemberId, zone: call.zone, subzone: call.subzone,
      continentId: call.continentId, cx: call.cx, cy: call.cy, mapId: call.mapId, x: call.x, y: call.y, attackers,
      calledAt: call.calledAt.toISOString(), cleared: call.clearedAt !== null,
      active: call.clearedAt === null && input.now.getTime() - call.calledAt.getTime() <= CALL_ACTIVE_MINUTES * 60_000
    };
  }).sort((a, b) => b.calledAt.localeCompare(a.calledAt));
  return { enabled: input.enabled, sharing: input.sharing, days: SIGHTING_DAYS, mates, continents: heatByContinent(input.sightings), calls };
}

type ViewDb = MapDb & Pick<PrismaClient, "character">;

/** What a signed-in member of this guild sees. Members who turned sharing off have no rows left to show. */
export async function guildMapFor(db: ViewDb, guildId: string, viewerMemberId: string, now = new Date()): Promise<GuildMapView> {
  const [settings, viewer] = await Promise.all([
    db.guildSettings.findUnique({ where: { guildId }, select: { guildMapEnabled: true } }),
    db.member.findUnique({ where: { id: viewerMemberId }, select: { mapShareOff: true } })
  ]);
  const enabled = settings?.guildMapEnabled !== false;
  const sharing = !viewer?.mapShareOff;
  if (!enabled) return { enabled, sharing, days: SIGHTING_DAYS, mates: [], continents: [], calls: [] };
  const active = { member: { status: "ACTIVE" as const, mapShareOff: false } };
  const [sightings, calls, characters] = await Promise.all([
    db.guildMapSighting.findMany({
      where: { guildId, seenAt: { gte: new Date(now.getTime() - SIGHTING_DAYS * 86_400_000) }, ...active },
      select: { memberId: true, character: true, mapId: true, zone: true, x: true, y: true, continentId: true, continent: true, cx: true, cy: true, seenAt: true },
      orderBy: { seenAt: "desc" }, take: 5000
    }),
    db.guildHelpCall.findMany({
      where: { guildId, calledAt: { gte: new Date(now.getTime() - CALL_PIN_HOURS * 3_600_000) }, member: { status: "ACTIVE" } },
      select: { memberId: true, character: true, zone: true, subzone: true, mapId: true, x: true, y: true, continentId: true, cx: true, cy: true, attackers: true, calledAt: true, clearedAt: true },
      orderBy: { calledAt: "desc" }, take: 50
    }),
    db.character.findMany({ where: { guildId, member: { status: "ACTIVE" } }, select: { name: true, displayName: true, className: true, level: true } })
  ]);
  const byName = new Map<string, CharacterInfo>();
  for (const character of characters) {
    byName.set(nameKey(character.name), character);
    if (character.displayName) byName.set(nameKey(character.displayName), character);
  }
  return buildGuildMapView({ enabled, sharing, viewerMemberId, now, sightings, characters: byName, calls });
}
