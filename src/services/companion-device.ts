import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { hashCompanionSecret } from "./character-pairing.js";
import { normalizeClassName, normalizeRaceName } from "./character-import.js";

// Zero-setup companion (owner decision, 9 November 2026; docs/ZERO_SETUP_COMPANION.md).
// The Windows companion makes a device key on first start and syncs without Discord sign-in. The
// bot finds the Discord server from the uploading character's in-game guild (as /setup registered
// it). What such a device sends is only ever "reported": its characters (DeviceCharacter), never a
// member's characters, the EP/GP ledger, loot, ranks, guild roster or public dungeon runs. A Discord
// sign-in in the same companion claims the device; from then on it uploads with the member's own
// credential through the normal path, and its reported characters become confirmed there.
//
// A /guilded verify code is NOT proof that a device is the member's: the addon broadcasts the code to
// guildmates (Core.lua digest "|V:"), so any guildmate's saved file can hold it. Verify and officer
// links confirm characters (Character.confirmedAt); only a sign-in claims a device.

export const DEVICE_LIMITS = {
  /** New device keys per IP address per hour (a household or LAN party shares one). */
  registrationsPerIpPerHour: 5,
  /** Uploads per device per hour: the companion uploads at most every few minutes. */
  uploadsPerDevicePerHour: 30,
  /** Uploads per IP address per hour, every device together. */
  uploadsPerIpPerHour: 120,
  /** Characters one device may report: a member's alts on one WoW account. */
  charactersPerDevice: 12,
  /** Characters in one upload. */
  charactersPerUpload: 12
} as const;

/** Sliding-window counter kept in memory (a restart forgets it, like the other API limits). */
export function windowLimiter(limit: number, windowMs: number, maxKeys = 5_000) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    hits.set(key, [...recent, now]);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
    return true;
  };
}

const text = (max: number) => z.string().trim().min(1).max(max).refine((value) => !value.includes("|") && Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
const deviceCharacterSchema = z.object({
  name: text(40),
  realm: z.string().trim().max(100).optional().default(""),
  displayName: text(80).optional(),
  class: z.string().trim().max(30).optional(),
  race: z.string().trim().max(30).optional(),
  level: z.number().int().min(1).max(100).optional(),
  gameEdition: z.literal("forever").optional().default("forever")
});
export const deviceUploadSchema = z.object({
  /** The in-game guild the saved data belongs to (GuildedDB.guildKey, split by the companion). */
  guild: z.object({ name: text(80), realm: text(80) }).nullable().optional(),
  characters: z.array(deviceCharacterSchema).max(DEVICE_LIMITS.charactersPerUpload).default([]),
  /** "Advanced: choose server": a Discord server ID among the candidates the bot listed. */
  server: z.string().regex(/^\d{5,25}$/).optional(),
  deviceName: z.string().max(80).optional()
});
export type DeviceUpload = z.infer<typeof deviceUploadSchema>;

const key = (value: string) => value.normalize("NFC").trim().toLowerCase();

export interface DeviceRow {
  id: string; guildId: string | null; chosenGuildId: string | null; claimedMemberId: string | null; revokedAt: Date | null; uploads: number;
}
/** A Guild row (in-game guild scope) that /setup registered for this WoW guild. */
export interface ServerCandidate { guildId: string; discordId: string; serverName: string | null; officerLinked: boolean }

export interface DeviceStore {
  create(tokenHash: string, now: Date): Promise<{ id: string }>;
  find(tokenHash: string): Promise<DeviceRow | null>;
  /** Guild rows for a WoW Forever guild (keys are NFC lowercase), across every Discord server. */
  candidates(nameKey: string, realmKey: string): Promise<ServerCandidate[]>;
  characterKeys(deviceId: string): Promise<string[]>;
  saveUpload(deviceId: string, data: { guildId: string | null; chosenGuildId: string | null; wowGuild: { key: string; name: string; realm: string } | null; now: Date },
    characters: { nameKey: string; name: string; realm: string; displayName?: string; className?: string; race?: string; level?: number; gameEdition: string }[]): Promise<void>;
  /** Marks the device claimed by this member; false when it is unknown, revoked or claimed by someone else. */
  claim(deviceId: string, memberId: string, now: Date): Promise<boolean>;
}

export type DeviceUploadAnswer =
  | { status: "synced"; server: { discordId: string; name: string | null }; guild: { name: string; realm: string }; characters: number; claimed: boolean }
  | { status: "no-guild"; guild: { name: string; realm: string } | null }
  | { status: "choose"; guild: { name: string; realm: string }; servers: { discordId: string; name: string | null }[] }
  | { status: "claimed" };

export class DeviceError extends Error { constructor(message: string, readonly status: number) { super(message); } }

/** A new device key. Only its hash is stored; the key goes back to the companion once. */
export async function registerDevice(store: DeviceStore, now = new Date()): Promise<{ deviceSecret: string; deviceId: string }> {
  const deviceSecret = randomBytes(32).toString("base64url");
  const { id } = await store.create(hashCompanionSecret(deviceSecret), now);
  return { deviceSecret, deviceId: id };
}

export async function deviceFor(store: DeviceStore, secret: unknown): Promise<DeviceRow | null> {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) return null;
  const device = await store.find(hashCompanionSecret(secret));
  return device && !device.revokedAt ? device : null;
}

/**
 * Pure: which server an unsigned upload goes to. One Guild row registered the WoW guild: that one.
 * Several (two Discord servers set up the same in-game guild): the ones an officer's companion
 * syncs (Guild.officerSyncAt); then the member's own pick among them; otherwise the member chooses.
 */
export function pickServer(candidates: readonly ServerCandidate[], chosenDiscordId?: string | null): { pick: ServerCandidate } | { choose: ServerCandidate[] } | { none: true } {
  if (!candidates.length) return { none: true };
  const chosen = chosenDiscordId ? candidates.find((candidate) => candidate.discordId === chosenDiscordId || candidate.guildId === chosenDiscordId) : undefined;
  if (chosen) return { pick: chosen };
  if (candidates.length === 1) return { pick: candidates[0]! };
  const linked = candidates.filter((candidate) => candidate.officerLinked);
  if (linked.length === 1) return { pick: linked[0]! };
  return { choose: linked.length ? linked : [...candidates] };
}

/**
 * One upload from an unsigned companion. Stores only its reported characters, capped per device;
 * a claimed device is told to use its member credential instead.
 */
export async function handleDeviceUpload(store: DeviceStore, device: DeviceRow, body: unknown, options: { allows?: (discordId: string) => boolean; now?: Date } = {}): Promise<DeviceUploadAnswer> {
  if (device.claimedMemberId) return { status: "claimed" };
  const parsed = deviceUploadSchema.safeParse(body);
  if (!parsed.success) throw new DeviceError("This upload is not valid.", 400);
  const upload = parsed.data;
  const now = options.now ?? new Date();
  const guild = upload.guild ? { name: upload.guild.name, realm: upload.guild.realm } : null;
  const wowGuild = guild ? { key: `${key(guild.name)}|${key(guild.realm)}`, ...guild } : null;
  const candidates = guild ? (await store.candidates(key(guild.name), key(guild.realm))).filter((candidate) => options.allows?.(candidate.discordId) ?? true) : [];
  // The member's earlier pick sticks until they choose again.
  const remembered = candidates.find((candidate) => candidate.guildId === device.chosenGuildId);
  const chosen = upload.server ?? remembered?.discordId ?? null;
  const decision = pickServer(candidates, chosen);
  const target = "pick" in decision ? decision.pick : null;
  const chosenGuildId = upload.server && target?.discordId === upload.server ? target.guildId : remembered?.guildId ?? null;

  // Characters: only ones this device already reported, plus new ones up to the cap.
  const known = new Set(await store.characterKeys(device.id));
  const rows: Parameters<DeviceStore["saveUpload"]>[2] = [];
  for (const character of upload.characters) {
    const nameKey = characterKey(character.name, character.realm, character.gameEdition);
    if (rows.some((row) => row.nameKey === nameKey)) continue;
    if (!known.has(nameKey)) {
      if (known.size >= DEVICE_LIMITS.charactersPerDevice) continue;
      known.add(nameKey);
    }
    rows.push({
      nameKey, name: character.name, realm: character.realm, gameEdition: character.gameEdition,
      ...(character.displayName ? { displayName: character.displayName } : {}),
      ...(character.class ? { className: normalizeClassName(character.class) } : {}),
      ...(character.race ? { race: normalizeRaceName(character.race) } : {}),
      ...(character.level ? { level: character.level } : {})
    });
  }
  await store.saveUpload(device.id, { guildId: target?.guildId ?? null, chosenGuildId, wowGuild, now }, rows);
  if (!guild || "none" in decision) return { status: "no-guild", guild };
  if ("choose" in decision) return { status: "choose", guild, servers: decision.choose.map((candidate) => ({ discordId: candidate.discordId, name: candidate.serverName })) };
  return { status: "synced", server: { discordId: decision.pick.discordId, name: decision.pick.serverName }, guild, characters: known.size, claimed: false };
}

/**
 * A Discord sign-in in the same companion: the member's credential plus the device key. The device
 * is the member's from now on (its next uploads use the credential, which confirms its characters).
 * Refused for a device another member already claimed.
 */
export async function claimDevice(store: DeviceStore, device: DeviceRow, memberId: string, now = new Date()): Promise<boolean> {
  if (device.claimedMemberId && device.claimedMemberId !== memberId) return false;
  if (device.claimedMemberId === memberId) return true;
  return store.claim(device.id, memberId, now);
}

export function prismaInstallStore(database: PrismaClient, serverName: (discordId: string) => string | null = () => null): DeviceStore {
  return {
    create: (tokenHash, now) => database.companionDevice.create({ data: { tokenHash, createdAt: now, lastSeenAt: now }, select: { id: true } }),
    find: (tokenHash) => database.companionDevice.findUnique({ where: { tokenHash }, select: { id: true, guildId: true, chosenGuildId: true, claimedMemberId: true, revokedAt: true, uploads: true } }),
    async candidates(nameKey, realmKey) {
      const rows = await database.wowGuild.findMany({
        where: { gameEdition: "forever", nameKey, realmKey },
        select: { guildId: true, scopeGuildId: true, guild: { select: { discordId: true, officerSyncAt: true } }, scope: { select: { officerSyncAt: true } } },
        take: 10
      });
      const seen = new Set<string>();
      return rows.flatMap((row) => {
        const guildId = row.scopeGuildId ?? row.guildId;
        if (seen.has(guildId)) return [];
        seen.add(guildId);
        return [{ guildId, discordId: row.guild.discordId, serverName: serverName(row.guild.discordId), officerLinked: Boolean((row.scope ?? row.guild).officerSyncAt) }];
      });
    },
    characterKeys: async (deviceId) => (await database.deviceCharacter.findMany({ where: { deviceId }, select: { nameKey: true } })).map((row) => row.nameKey),
    async saveUpload(deviceId, data, characters) {
      await database.$transaction(async (tx) => {
        await tx.companionDevice.update({ where: { id: deviceId }, data: {
          guildId: data.guildId, chosenGuildId: data.chosenGuildId, lastSeenAt: data.now, uploads: { increment: 1 },
          ...(data.wowGuild ? { wowGuildKey: data.wowGuild.key, wowGuildName: data.wowGuild.name, wowGuildRealm: data.wowGuild.realm } : {})
        } });
        for (const { nameKey, ...character } of characters) {
          await tx.deviceCharacter.upsert({
            where: { deviceId_nameKey: { deviceId, nameKey } },
            create: { deviceId, nameKey, ...character, firstSeenAt: data.now, lastSeenAt: data.now },
            update: { ...character, lastSeenAt: data.now }
          });
        }
      });
    },
    async claim(deviceId, memberId, now) {
      const done = await database.companionDevice.updateMany({ where: { id: deviceId, revokedAt: null, OR: [{ claimedMemberId: null }, { claimedMemberId: memberId }] }, data: { claimedMemberId: memberId, claimedAt: now } });
      return done.count === 1;
    }
  };
}

/** Characters unsigned companions reported in this guild that no member has linked, for officers. */
export async function reportedDeviceCharacters(database: Pick<PrismaClient, "deviceCharacter" | "character">, guildId: string, limit = 50) {
  const rows = await database.deviceCharacter.findMany({
    where: { device: { guildId, claimedMemberId: null, revokedAt: null } },
    orderBy: { lastSeenAt: "desc" }, take: limit * 2,
    select: { nameKey: true, name: true, displayName: true, className: true, level: true, lastSeenAt: true }
  });
  const linked = new Set((await database.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, gameEdition: true } }))
    .map((character) => characterKey(character.name, character.realm, character.gameEdition ?? "forever")));
  const seen = new Set<string>();
  return rows.filter((row) => !linked.has(row.nameKey) && !seen.has(row.nameKey) && seen.add(row.nameKey)).slice(0, limit);
}

/** The member a companion credential belongs to (guild credentials only; leaderboards-only accounts have no guild). */
export async function memberForCredential(database: Pick<PrismaClient, "companionCredential">, secret: unknown): Promise<string | null> {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) return null;
  const row = await database.companionCredential.findFirst({ where: { tokenHash: hashCompanionSecret(secret), revokedAt: null, member: { status: "ACTIVE" } }, select: { memberId: true } });
  return row?.memberId ?? null;
}
