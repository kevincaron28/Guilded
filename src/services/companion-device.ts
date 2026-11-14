import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { characterKey, foreverSameName } from "../../companion/character-identity.mjs";
import { firstNameKey, importDungeonRuns, receiptReason, RETRY_OUTCOME, saveRunReceipts } from "./dungeon-import.js";
import { plausibilityFlags, type Anomaly, type NeighbourRun } from "./run-plausibility.js";
import { challengeSecret, holdsRun, integrityConfig } from "./run-integrity-config.js";
import { contradicts, issueChallenge, verifyBatch } from "./run-challenge.js";
import { anchored, countsDeviceOnlyRuns, decide, fingerprintOf, independent, RUN_TRUST, sameRun, voucherOf, type RunFingerprint, type Statement } from "./run-trust.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { withEdition } from "./edition-context.js";
import { gameEditionOf } from "./game-edition.js";
import { hashCompanionSecret } from "./character-pairing.js";
import { looseKey } from "./loose-key.js";
import { normalizeClassName, normalizeRaceName } from "./character-import.js";
import { prismaPublicRunStore } from "./public-runs.js";
import { GROUP_RELAY_FEATURE, ingestRelayedRuns, splitGroupCarried } from "./relay-public.js";

// Zero-setup companion (owner decision, 9 November 2026; docs/ZERO_SETUP_COMPANION.md).
// The Windows companion makes a device key on first start and syncs without Discord sign-in. The
// bot finds the Discord server from the uploading character's in-game guild (as /setup registered
// it). What such a device sends is only ever "reported": its characters (DeviceCharacter), never a
// member's characters, the EP/GP ledger, loot, ranks, guild roster or public dungeon runs. Since 9.1.1 it also
// sends its finished dungeon runs: stored and scored like any run (dungeon-import.ts), only for the in-game
// guild's server, only when a reported character of the device was in the run, never replacing a stored run. A Discord
// sign-in in the same companion claims the device; from then on it uploads with the member's own
// credential through the normal path, and its reported characters become confirmed there.
//
// A /guilded verify code is NOT proof that a device is the member's: the addon broadcasts the code to
// guildmates (Core.lua digest "|V:"), so any guildmate's saved file can hold it. Verify and officer
// links confirm characters (Character.confirmedAt); only a sign-in claims a device.

/** What this bot's device endpoint can do, sent with every answer: an older bot ignores `runsOnly`, so a companion must not send one to it. */
export const DEVICE_FEATURES = ["runs-only", GROUP_RELAY_FEATURE] as const;

export const DEVICE_LIMITS = {
  /** New device keys per IP address per hour (a household or LAN party shares one). */
  registrationsPerIpPerHour: 5,
  /** Uploads per device per hour: the companion uploads at most every few minutes. */
  uploadsPerDevicePerHour: 30,
  /** Uploads per IP address per hour, every device together. */
  uploadsPerIpPerHour: 120,
  /** Runs-only uploads (a parked guild's runs, 9.3.1) per device per hour: apart from the loaded guild's budget above. */
  runsOnlyPerDevicePerHour: 12,
  /** Characters one device may report: a member's alts on one WoW account. */
  charactersPerDevice: 12,
  /** Characters in one upload. */
  charactersPerUpload: 12,
  /** Dungeon runs in one upload (same cap as a public upload). */
  runsPerUpload: 50,
  /** Dungeon runs one device may send per hour, new or repeated. */
  runsPerDevicePerHour: 300,
  /** Reported characters of unclaimed devices one server keeps (T7): new names beyond it are ignored. */
  charactersPerGuild: 2000,
  /** An unclaimed device that has not uploaded for this long is forgotten with what it reported (T7). */
  idleDays: 90
} as const;

/**
 * The key a registration limit counts by (T7): an IPv4 address as it is, or the /64 of an IPv6 address (a home or one
 * machine holds a whole /64, so a limit per address was no limit there).
 */
export function networkKey(address: string): string {
  const text = address.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mapped) return mapped[1]!;
  if (!text.includes(":")) return text;
  const [head = "", tail = ""] = text.split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = text.includes("::") ? [...left, ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => "0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

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
  /**
   * (9.3.1) Runs only: the dungeon runs of a guild the addon parked (another guild's character logged in since). The guild and the
   * characters named here belong to THAT guild: they are never stored as the device's guild, pick or characters, the member's
   * "choose server" pick is not used for them, and a guild no server registered is never guessed from a roster (no alias).
   */
  runsOnly: z.boolean().optional(),
  deviceName: z.string().max(80).optional(),
  /** Finished dungeon runs from the saved file, in the bot's dungeonRunSchema shape (validated when imported). */
  dungeonRuns: z.array(z.unknown()).max(DEVICE_LIMITS.runsPerUpload).default([])
});
export type DeviceUpload = z.infer<typeof deviceUploadSchema>;

const key = (value: string) => value.normalize("NFC").trim().toLowerCase();

export { looseKey };

export interface DeviceRow {
  id: string; guildId: string | null; chosenGuildId: string | null; claimedMemberId: string | null; revokedAt: Date | null; uploads: number;
}
/** A Guild row (in-game guild scope) that /setup registered for this WoW guild. */
export interface ServerCandidate {
  guildId: string; discordId: string; serverName: string | null; officerLinked: boolean;
  /** The registered realm is the uploading guild's realm (a hint only: connected realms differ). */
  realmMatch?: boolean;
  /** One of the uploading characters is already in this server's roster. */
  rosterMatch?: boolean;
  /** No server registered this guild name: found only because its roster holds one of the uploading characters (T9, a guild renamed in game). */
  viaRoster?: boolean;
}

/** The device a batch of runs came from, and the characters it reported. */
export interface DeviceRunSource { deviceId: string; characterKeys: readonly string[]; /** Signing key derived from the device key sent with this upload. */ sealKey?: string | null }
export interface DeviceRunResult { stored: number; skipped: number; /** Run ref -> why it waits (not a run anywhere yet). */ pending?: Record<string, string>;
  /** (9.3.2) The runs stored by this call (for the other guilds with a member in them). */ shareable?: unknown[] }

export interface DeviceStore {
  create(tokenHash: string, now: Date): Promise<{ id: string }>;
  find(tokenHash: string): Promise<DeviceRow | null>;
  /**
   * Servers that know a WoW Forever guild, across every Discord server: matched by the loosened guild name
   * (looseKey), any realm. Keys are NFC lowercase; characterKeys are the uploading characters (roster tie-break).
   */
  candidates(nameKey: string, realmKey: string, characterKeys?: string[]): Promise<ServerCandidate[]>;
  characterKeys(deviceId: string): Promise<string[]>;
  saveUpload(deviceId: string, data: { guildId: string | null; chosenGuildId: string | null; wowGuild: { key: string; name: string; realm: string } | null; now: Date },
    characters: { nameKey: string; name: string; realm: string; displayName?: string; className?: string; race?: string; level?: number; gameEdition: string }[]): Promise<void>;
  /** Marks the device claimed by this member; false when it is unknown, revoked or claimed by someone else. */
  claim(deviceId: string, memberId: string, now: Date): Promise<boolean>;
  /** Stores runs for this Discord server like any import; refs the server already holds are left untouched. */
  importRuns?(guildId: string, runs: unknown[], now: Date, source: DeviceRunSource): Promise<DeviceRunResult>;
  /**
   * What the server holds for these run refs (9.1.3): receipts and stored runs. The companion writes them to the addon
   * (GuildedDungeonAccepted/Notes) so it marks the runs synced, as the standings do for a signed-in companion.
   */
  receipts?(guildId: string, refs: string[]): Promise<{ runRef: string; reason: string | null }[]>;
  /** Reported characters unclaimed devices hold in this server (T7 cap). */
  guildCharacterCount?(guildId: string): Promise<number>;
  /** Forgets unclaimed devices idle since before `before`, with their characters and waiting runs (T7). */
  expireIdle?(before: Date): Promise<number>;
  /** Remembers an in-game guild name no /setup registered, for the server its roster pointed to (T9). */
  noteAlias?(guildId: string, guild: { name: string; realm: string }, now: Date): Promise<void>;
  /**
   * (9.3.1) Runs of players outside this device's guild that reached its addon through a party or raid: the public boards' own
   * lane (the same checks as any public run). Returns the refs the server now holds.
   */
  publicRuns?(deviceId: string, runs: unknown[], now: Date, deviceKeys: ReadonlySet<string>, onPlaced?: (runs: unknown[]) => void): Promise<string[]>;
}

/**
 * (9.3.1) Splits an upload's runs into those the addon marked viaGroup (they reached it through a party or raid) and the rest.
 * A viaGroup run never enters a guild lane, whoever is in it: it goes to the public lane (relay-public.ts).
 */
export const splitGroupRuns = (raw: unknown[]): { group: unknown[]; rest: unknown[] } => splitGroupCarried(raw);

/** The runs of one unsigned upload the server now holds, in the shape the signed-in standings use. */
export interface DeviceRunReceipts { acceptedRunRefs: string[]; runNotes: Record<string, string>; /** Received but not counted yet, with the reason. Never "synced". */ pendingRunNotes?: Record<string, string> }

/** What an unsigned companion should tell its member. PvP counters (kills, defends, duels, calls) are applied only for a signed-in member. */
export interface DeviceNotice { en: string; fr: string }
export const DEVICE_PVP_NOTICE: DeviceNotice = {
  en: "Sign in with Discord to count your PvP on the boards.",
  fr: "Connectez-vous avec Discord pour que votre JcJ compte dans les classements."
};

export type DeviceUploadAnswer =
  | { status: "synced"; server: { discordId: string; name: string | null }; guild: { name: string; realm: string }; characters: number; claimed: boolean; /** Fresh challenge for the companion to hand to the addon. */ challenge?: string; runs?: { received: number; stored: number; skipped: number; pending?: number }; runReceipts?: DeviceRunReceipts; reported?: string[]; notice: DeviceNotice }
  | { status: "no-guild"; guild: { name: string; realm: string } | null; runReceipts?: DeviceRunReceipts }
  | { status: "choose"; guild: { name: string; realm: string }; servers: { discordId: string; name: string | null }[]; runReceipts?: DeviceRunReceipts }
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
  // Several servers share the name: narrow by the character's roster, then the guild's home realm, then officer sync.
  let narrowed: readonly ServerCandidate[] = candidates;
  for (const test of [(c: ServerCandidate) => c.rosterMatch, (c: ServerCandidate) => c.realmMatch, (c: ServerCandidate) => c.officerLinked]) {
    const next = narrowed.filter((candidate) => test(candidate));
    if (next.length === 1) return { pick: next[0]! };
    if (next.length) narrowed = next;
  }
  return { choose: [...narrowed] };
}

/**
 * One upload from an unsigned companion. Stores only its reported characters, capped per device;
 * a claimed device is told to use its member credential instead.
 */
const deviceRunHits = windowLimiter(DEVICE_LIMITS.runsPerDevicePerHour, 3_600_000);

/** Runs a device may send: a party member is a character this device reported (a device cannot post strangers' runs). */
export function runsOfDevice(raw: unknown[], deviceKeys: ReadonlySet<string>): unknown[] {
  return raw.filter((run) => {
    const players = (run as { players?: unknown } | null)?.players;
    return Array.isArray(players) && players.some((player) => typeof (player as { character?: unknown })?.character === "string"
      && [...deviceKeys].some((own) => foreverSameName(own, (player as { character: string }).character)));
  });
}

export async function handleDeviceUpload(store: DeviceStore, device: DeviceRow, body: unknown, options: { allows?: (discordId: string) => boolean; now?: Date; runLimiter?: (deviceId: string) => boolean; sealKey?: string | null;
  /** (9.3.2) Runs this upload stored (a guild's id) or placed on the public boards (null): other guilds with a member in them get a copy. Called after the runs are saved. */
  afterShare?: (originGuildId: string | null, runs: unknown[]) => void } = {}): Promise<DeviceUploadAnswer> {
  if (device.claimedMemberId) return { status: "claimed" };
  const parsed = deviceUploadSchema.safeParse(body);
  if (!parsed.success) throw new DeviceError("This upload is not valid.", 400);
  const upload = parsed.data;
  const now = options.now ?? new Date();
  const guild = upload.guild ? { name: upload.guild.name, realm: upload.guild.realm } : null;
  const wowGuild = guild ? { key: `${key(guild.name)}|${key(guild.realm)}`, ...guild } : null;
  const characterKeys = upload.characters.map((character) => characterKey(character.name, character.realm, character.gameEdition));
  const runsOnly = upload.runsOnly === true;
  if (runsOnly && !guild) throw new DeviceError("A runs-only upload names the guild its runs belong to.", 400);
  // A runs-only upload finds its server by the guild's registered name only: the roster fallback (a renamed guild) would send a
  // guild nobody set up to the server of a character's earlier guild.
  const candidates = guild ? (await store.candidates(key(guild.name), key(guild.realm), characterKeys)).filter((candidate) => (options.allows?.(candidate.discordId) ?? true) && !(runsOnly && candidate.viaRoster)) : [];
  // The member's earlier pick sticks until they choose again (it is for the loaded guild, never for a parked one).
  const remembered = runsOnly ? undefined : candidates.find((candidate) => candidate.guildId === device.chosenGuildId);
  const chosen = runsOnly ? null : upload.server ?? remembered?.discordId ?? null;
  const decision = pickServer(candidates, chosen);
  const target = "pick" in decision ? decision.pick : null;
  sweepIdleDevices(store, now);
  // T7: a server keeps a bounded number of reported names, whatever the number of keys that send them.
  const guildFull = target && store.guildCharacterCount ? await store.guildCharacterCount(target.guildId) >= DEVICE_LIMITS.charactersPerGuild : false;
  const chosenGuildId = upload.server && target?.discordId === upload.server ? target.guildId : remembered?.guildId ?? null;

  // Characters: only ones this device already reported, plus new ones up to the cap. A runs-only upload stores nothing of the
  // device: its characters only vouch for its runs, and the device's guild and server pick stay as the loaded guild's upload left them.
  // A runs-only upload vouches only with characters this device already reported through its own sync (never new ones: the cap stays).
  const reportedBefore = await store.characterKeys(device.id);
  const known = new Set(runsOnly ? characterKeys.filter((nameKey) => reportedBefore.includes(nameKey)) : reportedBefore);
  const rows: Parameters<DeviceStore["saveUpload"]>[2] = [];
  for (const character of runsOnly ? [] : upload.characters) {
    const nameKey = characterKey(character.name, character.realm, character.gameEdition);
    if (rows.some((row) => row.nameKey === nameKey)) continue;
    if (!known.has(nameKey)) {
      if (known.size >= DEVICE_LIMITS.charactersPerDevice || guildFull) continue;
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
  if (!runsOnly) await store.saveUpload(device.id, { guildId: target?.guildId ?? null, chosenGuildId, wowGuild, now }, rows);
  // (9.3.1) Runs this device carries for players near it go to the public boards, whatever this device's guild is (even none).
  const split = splitGroupRuns(upload.dungeonRuns);
  const carried: string[] = [];
  if (split.group.length && store.publicRuns) {
    // Carried runs have their own caps (per upload here, per day in the relay lane): they never spend the device's shared hourly budget,
    // which is for the guild lane.
    const allowedGroup = split.group.slice(0, RUN_TRUST.relayedPerUpload);
    if (allowedGroup.length) carried.push(...await store.publicRuns(device.id, allowedGroup, now, known, options.afterShare ? (placed) => options.afterShare!(null, placed) : undefined).catch(() => []));
  }
  const carriedReceipts: DeviceRunReceipts | undefined = carried.length ? { acceptedRunRefs: carried, runNotes: {} } : undefined;
  if (!guild || "none" in decision) return { status: "no-guild", guild, ...(carriedReceipts ? { runReceipts: carriedReceipts } : {}) };
  if ("choose" in decision) return { status: "choose", guild, servers: decision.choose.map((candidate) => ({ discordId: candidate.discordId, name: candidate.serverName })), ...(carriedReceipts ? { runReceipts: carriedReceipts } : {}) };
  // T9: the guild was renamed in game. The roster sent this device to the right server; officers get the new name.
  if (!runsOnly && target?.viaRoster && store.noteAlias) await store.noteAlias(target.guildId, guild, now).catch(() => undefined);
  let runs: { received: number; stored: number; skipped: number; pending?: number } | undefined;
  let pending: Record<string, string> = {};
  const guildRuns = split.rest;
  if (guildRuns.length && store.importRuns && target) {
    const limiter = options.runLimiter ?? ((id: string) => deviceRunHits(id, now.getTime()));
    const allowed: unknown[] = [];
    let relayed = 0;
    // Runs this device has standing for: one of its characters played it, or a participant's addon sent it in game.
    for (const run of guildRuns) {
      const standing = voucherOf(run, known);
      if (!standing || (standing.kind === "relay" && ++relayed > RUN_TRUST.relayedPerUpload)) continue;
      if (!limiter(device.id)) break;
      allowed.push(run);
    }
    const result = allowed.length ? await store.importRuns(target.guildId, allowed, now, { deviceId: device.id, characterKeys: [...known], sealKey: options.sealKey ?? null }) : { stored: 0, skipped: 0 };
    pending = result.pending ?? {};
    if (result.shareable?.length) options.afterShare?.(target.guildId, result.shareable);
    runs = { received: guildRuns.length, stored: result.stored, skipped: result.skipped, ...(Object.keys(pending).length ? { pending: Object.keys(pending).length } : {}) };
  }
  // Every ref this upload carried that the server now holds (stored, a guildmate's copy, refused), so the addon stops waiting.
  // A guildmate's run the addon got by peer sync (none of this PC's characters in it) is not stored and gets NO receipt
  // (9.1.4): a receipt marks the run synced in the addon, which then tells its author "my bot has your run" (ACK) and the
  // author stops replaying it, so a run no bot held looked delivered. It stays unconfirmed for a signed-in companion.
  let runReceipts: DeviceRunReceipts | undefined;
  if (guildRuns.length && store.receipts && target) {
    // A run that waits for a second statement is NOT held: a receipt would mark it synced in the addon, which then ACKs it to
    // its author. It is answered apart (pendingRunNotes) so the member sees why it waits.
    const refs = [...new Set(guildRuns.flatMap((run) => { const id = (run as { id?: unknown } | null)?.id; return typeof id === "string" && id.length <= 80 ? [id] : []; }))];
    const held = refs.length ? await store.receipts(target.guildId, refs) : [];
    const acceptedRunRefs = [...held.map((row) => row.runRef), ...carried];
    const runNotes: Record<string, string> = Object.fromEntries(held.flatMap((row) => row.reason ? [[row.runRef, row.reason] as const] : []));
    const waiting = Object.fromEntries(Object.entries(pending).filter(([ref]) => !acceptedRunRefs.includes(ref)));
    if (acceptedRunRefs.length || Object.keys(waiting).length) runReceipts = { acceptedRunRefs, runNotes, ...(Object.keys(waiting).length ? { pendingRunNotes: waiting } : {}) };
  }
  if (!runReceipts && carriedReceipts) runReceipts = carriedReceipts;
  // (9.1.4) The characters THIS upload reported and the server holds for the device, so the addon can say "Reported, not
  // confirmed" for the one being played. Names the device itself sent, nothing else: no Discord name and nothing about
  // anyone else's characters ever goes back to an unsigned device.
  const reported = rows.map((row) => row.name);
  return { status: "synced", server: { discordId: decision.pick.discordId, name: decision.pick.serverName }, guild, characters: known.size, claimed: false, notice: DEVICE_PVP_NOTICE, ...(challengeSecret() ? { challenge: issueChallenge(challengeSecret()!, device.id, now.getTime() / 1000) } : {}), ...(runs ? { runs } : {}), ...(runReceipts ? { runReceipts } : {}), ...(reported.length && !runsOnly ? { reported } : {}) };
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

let lastSweep = 0;
/** T7: at most every six hours, forget unclaimed devices idle for 90 days. Never delays or fails an upload. */
function sweepIdleDevices(store: DeviceStore, now: Date): void {
  if (!store.expireIdle || now.getTime() - lastSweep < 6 * 3_600_000) return;
  lastSweep = now.getTime();
  void store.expireIdle(new Date(now.getTime() - DEVICE_LIMITS.idleDays * 86_400_000)).catch((error: unknown) => console.error("Idle device sweep failed", error));
}

type RunTx = Pick<Prisma.TransactionClient, "officialSeason" | "guild" | "dungeonRun" | "companionDevice" | "character" | "guildSettings" | "dungeonRunWitness" | "guildRosterEntry"> & Parameters<typeof importDungeonRuns>[0] & Parameters<typeof enqueueDiscordJob>[0];
const DEVICE_SOURCE = "companion device";
const COPY_REASON = "Counted with a guildmate's copy of this run";
const epoch = (date: Date | null | undefined) => date ? Math.floor(date.getTime() / 1000) : null;
const near = (endedAt: number) => ({ gte: new Date((endedAt - RUN_TRUST.endToleranceSec) * 1000), lte: new Date((endedAt + RUN_TRUST.endToleranceSec) * 1000) });
interface WitnessRow { id: string; deviceId: string; runRef: string; kind: string; voucher: string; instanceId: number; difficultyId: number; startedAt: Date | null; endedAt: Date | null;
  players: string[]; bosses: number[]; payload: unknown; status: string; reason?: string | null; firstSeenAt: Date }
const statementOfRow = (row: WitnessRow): Statement => ({ deviceId: row.deviceId, voucher: row.voucher, kind: row.kind === "relay" ? "relay" : "first-hand", instanceId: row.instanceId,
  difficultyId: row.difficultyId, startedAt: epoch(row.startedAt), endedAt: epoch(row.endedAt), players: row.players, bosses: row.bosses });

/**
 * Judges a device's runs inside one transaction (docs/plans/RUN_TRUST_2026-11-10.md). A run the server already holds (same id, or the
 * same clear under another id) is never touched: no observer merge, no added player. A new run is imported the normal way (validity,
 * final boss, season window, route, presence) only when a party member is known to the server (officer-synced roster or a linked
 * character) or a second device speaking for another party member agrees; otherwise the statement waits in DungeonRunWitness.
 */
export async function storeDeviceRuns(tx: RunTx, guildId: string, runs: unknown[], now: Date, source: DeviceRunSource): Promise<DeviceRunResult> {
  // (9.3.1) Backstop: a run marked viaGroup never enters a guild lane (the relay lane takes it).
  runs = runs.filter((raw) => (raw as { viaGroup?: unknown } | null)?.viaGroup !== true);
  const refOf = (run: unknown) => { const id = (run as { id?: unknown } | null)?.id; return typeof id === "string" && id.length >= 3 && id.length <= 100 ? id : null; };
  const entries = [...new Map(runs.flatMap((raw) => { const ref = refOf(raw); return ref ? [[ref, raw] as const] : []; })).entries()].map(([ref, raw]) => ({ ref, raw }));
  const result: DeviceRunResult = { stored: 0, skipped: runs.length - entries.length };
  if (!entries.length) return result;
  const refs = entries.map((entry) => entry.ref);
  const standing = await tx.companionDevice.findUnique({ where: { id: source.deviceId }, select: { excludedGuilds: true, createdAt: true } });
  const excludedHere = standing?.excludedGuilds?.includes(guildId) ?? false;
  const deviceKeys = new Set(source.characterKeys);
  const nowSec = Math.floor(now.getTime() / 1000);
  const guild = await tx.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true } });
  const heldRows = await tx.dungeonRun.findMany({ where: { guildId, runRef: { in: refs } }, select: { id: true, runRef: true, trust: true } });
  const mineRows = await tx.dungeonRunWitness.findMany({ where: { guildId, deviceId: source.deviceId, runRef: { in: refs } } }) as WitnessRow[];
  const characters = await tx.character.findMany({ where: { member: { guildId } }, include: { member: true } });
  const roster = await tx.guildRosterEntry.findMany({ where: { guildId, gameEdition: "forever", inGuild: true }, select: { nameKey: true }, take: 5000 });
  const held = new Map(heldRows.map((row) => [row.runRef, row] as const));
  const mine = new Map(mineRows.map((row) => [row.runRef, row] as const));
  const knownNames = [...roster.map((row) => row.nameKey), ...characters.map((character) => character.name.toLowerCase())];
  const linked = characters.map((character) => ({ name: character.name, realm: character.realm, memberId: character.memberId, spec: character.spec, discordId: character.member?.discordUserId ?? null, displayName: character.displayName ?? null }));
  const started = await tx.officialSeason.findMany({ where: { gameEdition: gameEditionOf(guild ?? {}), startsAt: { lte: now } }, select: { number: true } });
  const allowDeviceOnly = countsDeviceOnlyRuns(started.map((season) => season.number));
  let waiting = await tx.dungeonRunWitness.count({ where: { deviceId: source.deviceId, status: "pending" } });
  let storedToday = await tx.dungeonRunWitness.count({ where: { deviceId: source.deviceId, trust: "device", decidedAt: { gte: new Date(now.getTime() - 86_400_000) } } });
  const pending: Record<string, string> = {};
  const config = integrityConfig();
  const batchFlags = verifyBatch(entries.map(({ ref, raw }) => ({ raw, ref, endedAt: fingerprintOf(raw)?.endedAt ?? null, kind: voucherOf(raw, deviceKeys)?.kind ?? "relay" as const, earlier: mine.get(ref)?.reason === "released" })),
    { deviceId: source.deviceId, sealKey: source.sealKey ?? null, secret: challengeSecret(), windowSec: config.challengeWindowSec, clockSlackSec: config.clockSlackSec, deviceSince: epoch(standing?.createdAt), requireSeal: config.requireSeal });
  let strikes = config.strikeWindowSec === null ? 0 : await tx.dungeonRunWitness.count({ where: { deviceId: source.deviceId, status: "held", firstSeenAt: { gte: new Date(now.getTime() - config.strikeWindowSec * 1000) } } });

  const record = async (ref: string, raw: unknown, statement: Statement, data: { status: string; reason?: string | null; trust?: string | null; runId?: string | null; decided?: boolean; keepPayload?: boolean; flags?: Anomaly[] }) => {
    const text = data.keepPayload ? JSON.stringify(raw) : "";
    const row = { kind: statement.kind, voucher: statement.voucher, instanceId: statement.instanceId, difficultyId: statement.difficultyId,
      startedAt: statement.startedAt ? new Date(statement.startedAt * 1000) : null, endedAt: statement.endedAt ? new Date(statement.endedAt * 1000) : null,
      players: statement.players, bosses: statement.bosses, status: data.status, reason: data.reason ?? null, lastSeenAt: now,
      ...(data.flags ? { flags: data.flags as unknown as Prisma.InputJsonValue } : {}),
      ...(data.trust !== undefined ? { trust: data.trust } : {}), ...(data.runId !== undefined ? { runId: data.runId } : {}), ...(data.decided ? { decidedAt: now } : {}),
      // Kept only while it may be needed to store the run; an oversized one is not kept (the other statement's copy is used).
      payload: text && text.length <= 200_000 ? JSON.parse(text) as Prisma.InputJsonValue : Prisma.DbNull };
    await tx.dungeonRunWitness.upsert({ where: { guildId_runRef_deviceId: { guildId, runRef: ref, deviceId: source.deviceId } },
      create: { guildId, deviceId: source.deviceId, runRef: ref, firstSeenAt: now, ...row }, update: row });
  };
  /** Holds the run for review. */
  const holdRun = async (ref: string, raw: unknown, statement: Statement, flags: Anomaly[]) => {
    await record(ref, raw, statement, { status: "held", reason: "held", keepPayload: true, flags });
    await saveRunReceipts(tx, guildId, [{ runRef: ref, outcome: "stored", reason: null, runId: null }], now);
  };
  /** This statement plus every other device's statement that speaks for another party member. */
  const witnessesOf = (statement: Statement, rows: readonly WitnessRow[]): number => new Set([statement.voucher, ...rows.map((row) => row.voucher)]).size;
  // Lookups for the run checks.
  const needsChecks = (ref: string): boolean => { const row = mine.get(ref); return !held.has(ref) && row?.reason !== "released" && !["stored", "held", "expired"].includes(row?.status ?? ""); };
  const newPrints = entries.filter((entry) => needsChecks(entry.ref)).flatMap((entry) => { const print = fingerprintOf(entry.raw); return print ? [print] : []; });
  const reach = config.limits?.reachSec;
  const windows = typeof reach === "number" ? newPrints.flatMap((print) => print.endedAt ? [{ gte: new Date((print.endedAt - reach) * 1000), lte: new Date((print.endedAt + reach) * 1000) }] : []) : [];
  /** One bounded query per run, so a busy stretch around one run cannot hide the neighbours of another. */
  const perWindow = async <T extends { runRef: string }>(query: (endedAt: { gte: Date; lte: Date }) => Promise<T[]>): Promise<T[]> => {
    const found: T[] = [];
    for (let at = 0; at < windows.length; at += 10) found.push(...(await Promise.all(windows.slice(at, at + 10).map(query))).flat());
    return [...new Map(found.map((row) => [row.runRef, row])).values()];
  };
  const instances = [...new Set(newPrints.map((print) => print.instanceId))];
  const fastestRows = newPrints.length && config.limits ? await tx.dungeonRun.groupBy({ by: ["instanceId", "difficultyId"], where: { guildId, instanceId: { in: instances }, valid: true, state: "COMPLETED", durationSec: { not: null } }, _min: { durationSec: true }, _count: { _all: true } }) : [];
  const nearbyRows = await perWindow((endedAt) => tx.dungeonRun.findMany({ where: { guildId, valid: true, endedAt }, orderBy: { endedAt: "desc" }, select: { runRef: true, instanceId: true, startedAt: true, endedAt: true, players: { select: { character: true } } }, take: 100 }));
  const ownRows = await perWindow((endedAt) => tx.dungeonRunWitness.findMany({ where: { guildId, deviceId: source.deviceId, kind: "first-hand", status: "stored", endedAt }, orderBy: { endedAt: "desc" }, take: 60 }) as Promise<WitnessRow[]>);
  const flagsFor = (raw: unknown, ref: string): Anomaly[] => {
    const data = raw as { instanceId?: number; difficultyId?: number; startedAt?: number; endedAt?: number; players?: { character?: unknown; level?: unknown }[]; encounters?: { id?: unknown; at?: unknown; success?: unknown; kind?: unknown }[] };
    const started = typeof data.startedAt === "number" ? data.startedAt : null, ended = typeof data.endedAt === "number" ? data.endedAt : null;
    if (typeof data.instanceId !== "number") return [];
    const within = (row: { endedAt: Date | null }) => ended === null || !row.endedAt || Math.abs(epoch(row.endedAt)! - ended) <= (reach ?? 0);
    const fastest = (fastestRows as { instanceId: number; difficultyId: number; _min: { durationSec: number | null }; _count: { _all: number } }[]).find((row) => row.instanceId === data.instanceId && row.difficultyId === (data.difficultyId ?? 0));
    const neighbour = (row: { runRef: string; instanceId: number; startedAt: Date | null; endedAt: Date | null }, characters: string[]): NeighbourRun => ({ runRef: row.runRef, instanceId: row.instanceId, startedAt: epoch(row.startedAt), endedAt: epoch(row.endedAt), characters });
    return plausibilityFlags({
      instanceId: data.instanceId, startedAt: started, endedAt: ended,
      players: (data.players ?? []).flatMap((player) => typeof player.character === "string" ? [{ character: player.character, level: typeof player.level === "number" ? player.level : null }] : []),
      kills: (data.encounters ?? []).flatMap((boss) => boss.success === true && boss.kind !== "npc" && typeof boss.id === "number" ? [{ id: boss.id, at: typeof boss.at === "number" ? boss.at : null }] : [])
    }, {
      runRef: ref, ...(config.limits ? { limits: config.limits } : {}), fastest: { seconds: fastest?._min.durationSec ?? null, count: fastest?._count._all ?? 0 },
      neighbours: (nearbyRows as { runRef: string; instanceId: number; startedAt: Date | null; endedAt: Date | null; players: { character: string }[] }[]).filter(within).map((row) => neighbour(row, row.players.map((player) => player.character))),
      deviceRuns: ownRows.filter(within).map((row) => neighbour({ runRef: row.runRef, instanceId: row.instanceId, startedAt: row.startedAt, endedAt: row.endedAt }, row.players))
    });
  };
  const othersNear = async (print: RunFingerprint): Promise<WitnessRow[]> => print.endedAt ? await tx.dungeonRunWitness.findMany({ where: { guildId, instanceId: print.instanceId,
    deviceId: { not: source.deviceId }, status: { in: ["pending", "stored"] }, endedAt: near(print.endedAt) }, take: 50 }) as WitnessRow[] : [];
  const storedCopy = async (print: RunFingerprint) => {
    if (!print.endedAt) return null;
    const rows = await tx.dungeonRun.findMany({ where: { guildId, instanceId: print.instanceId, difficultyId: print.difficultyId, endedAt: near(print.endedAt) },
      select: { id: true, runRef: true, trust: true, instanceId: true, difficultyId: true, startedAt: true, endedAt: true, players: { select: { character: true } } }, take: 20 });
    return rows.find((row) => sameRun(print, { instanceId: row.instanceId, difficultyId: row.difficultyId, startedAt: epoch(row.startedAt), endedAt: epoch(row.endedAt),
      players: [...new Set(row.players.map((player) => firstNameKey(player.character)))], bosses: [] })) ?? null;
  };

  for (const { ref, raw } of entries) {
    const standing = voucherOf(raw, deviceKeys);
    const print = fingerprintOf(raw);
    if (!standing || !print) { result.skipped++; continue; }
    const statement: Statement = { ...print, deviceId: source.deviceId, ...standing };
    const earlier = mine.get(ref);
    if (earlier?.status === "held") { await saveRunReceipts(tx, guildId, [{ runRef: ref, outcome: "stored", reason: null, runId: null }], now); continue; }
    if (excludedHere && earlier?.reason !== "released" && earlier?.status !== "stored") { await holdRun(ref, raw, statement, [{ code: "pc-excluded", detail: "PC excluded by an officer" }]); continue; }
    const sameId = held.get(ref);
    const existing = sameId ?? await storedCopy(print);
    if (existing) {
      // Never touched. A run one device vouched for alone becomes witnessed when an independent device agrees.
      if (!sameId) await saveRunReceipts(tx, guildId, [{ runRef: ref, outcome: "copy", state: "COMPLETED", reason: COPY_REASON, runId: existing.id }], now);
      if (earlier?.status !== "stored") {
        const others = await othersNear(print);
        const independents = others.filter((other) => independent(statement, statementOfRow(other)));
        if (independents.length) {
          if (existing.trust === "device") await tx.dungeonRun.updateMany({ where: { id: existing.id, trust: "device" }, data: { trust: "witnessed" } });
          // "Confirmed by N players" is information only: the distinct players whose statements agree.
          await tx.dungeonRun.updateMany({ where: { id: existing.id, witnessCount: { lt: witnessesOf(statement, independents) } }, data: { witnessCount: witnessesOf(statement, independents) } });
        }
      }
      await record(ref, raw, statement, { status: "stored", runId: existing.id });
      result.skipped++;
      continue;
    }
    const others = await othersNear(print);
    const decision = decide(statement, others.map(statementOfRow), { anchored: anchored(raw, knownNames), storedToday, nowSec, allowDeviceOnly });
    if ("expire" in decision) {
      await saveRunReceipts(tx, guildId, [{ runRef: ref, outcome: "refused", reason: decision.expire, runId: null }], now);
      await record(ref, raw, statement, { status: "expired", reason: decision.expire, decided: true });
      result.skipped++;
      continue;
    }
    if ("wait" in decision) {
      if (!earlier && waiting >= RUN_TRUST.pendingPerDevice) { result.skipped++; continue; }
      if (!earlier || earlier.status !== "pending") waiting++;
      await record(ref, raw, statement, { status: "pending", reason: earlier?.reason === "released" ? "released" : decision.wait, keepPayload: true });
      pending[ref] = decision.wait;
      continue;
    }
    // Stored now. When two statements agree, the first-hand one is imported with the time the server first received it
    // (a run that waited must not lose the season's upload window).
    const partner = decision.store === "witnessed" ? others.find((other) => independent(statement, statementOfRow(other))) : undefined;
    const usePartner = partner && statement.kind === "relay" && partner.kind === "first-hand" && partner.payload;
    const flagList: Anomaly[] = [...(batchFlags.get(ref) ?? []), ...flagsFor(usePartner ? partner.payload : raw, ref),
      ...(others.some((other) => contradicts(statement, statementOfRow(other), config.limits)) ? [{ code: "comparison", detail: "comparison" }] : [])];
    if (decision.store !== "witnessed" && earlier?.reason !== "released" && holdsRun(flagList.map((flag) => flag.code), config, strikes)) {
      strikes++;
      await holdRun(ref, raw, statement, flagList);
      continue;
    }
    const summary = await withEdition(gameEditionOf(guild ?? {}), () => importDungeonRuns(tx, guildId, [usePartner ? partner.payload : raw], linked, DEVICE_SOURCE, null, usePartner ? partner.firstSeenAt : earlier?.firstSeenAt ?? now));
    const made = summary.results[0];
    if (!made) {
      await record(ref, raw, statement, { status: "expired", reason: "Refused", decided: true });
      result.skipped++;
      continue;
    }
    if (made.runId) await tx.dungeonRun.updateMany({ where: { id: made.runId, trust: null }, data: { trust: decision.store } });
    if (made.runId) {
      const flags = flagList;
      const confirmed = witnessesOf(statement, others.filter((other) => independent(statement, statementOfRow(other))));
      if (flags.length || confirmed > 1) await tx.dungeonRun.updateMany({ where: { id: made.runId }, data: { ...(flags.length ? { anomalies: flags as unknown as Prisma.InputJsonValue } : {}), ...(confirmed > 1 ? { witnessCount: confirmed } : {}) } });
    }
    result.stored++;
    (result.shareable ??= []).push(usePartner ? partner.payload : raw);
    if (decision.store === "device") storedToday++;
    await record(ref, raw, statement, { status: "stored", trust: decision.store, runId: made.runId ?? null, decided: true });
    const agreeing = others.filter((other) => sameRun(print, statementOfRow(other)));
    if (agreeing.length) await tx.dungeonRunWitness.updateMany({ where: { id: { in: agreeing.map((other) => other.id) } }, data: { status: "stored", runId: made.runId ?? null, payload: Prisma.DbNull, reason: null } });
    const copies = [...new Set([ref, ...agreeing.map((other) => other.runRef)])].filter((other) => other !== made.runRef);
    if (copies.length) await saveRunReceipts(tx, guildId, copies.map((runRef) => ({ runRef, outcome: "copy" as const, state: "COMPLETED", reason: COPY_REASON, runId: made.runId ?? null })), now);
  }
  if (Object.keys(pending).length) result.pending = pending;
  const settings = await tx.guildSettings.findUnique({ where: { guildId }, select: { dungeonLeaderboardChannelId: true } });
  if (result.stored && settings?.dungeonLeaderboardChannelId) await enqueueDiscordJob(tx, guildId, "dungeon-board", "DUNGEON_BOARD");
  return result;
}

export function prismaInstallStore(database: PrismaClient, serverName: (discordId: string) => string | null = () => null): DeviceStore {
  return {
    create: (tokenHash, now) => database.companionDevice.create({ data: { tokenHash, createdAt: now, lastSeenAt: now }, select: { id: true } }),
    find: (tokenHash) => database.companionDevice.findUnique({ where: { tokenHash }, select: { id: true, guildId: true, chosenGuildId: true, claimedMemberId: true, revokedAt: true, uploads: true } }),
    async candidates(nameKey, realmKey, characterKeys = []) {
      // Matched on the loosened guild name, any realm: WoW Forever guilds span connected realms (the character is on
      // "Realm 8", the guild's home is "Realm 2"), and a server is registered under its own spelling ("✤Quebec Gold✤").
      const wanted = looseKey(nameKey), realmWanted = looseKey(realmKey);
      if (!wanted) return [];
      const [spaces, mains] = await Promise.all([
        database.wowGuild.findMany({
          where: { gameEdition: "forever" },
          select: { name: true, realm: true, guildId: true, scopeGuildId: true, guild: { select: { discordId: true, officerSyncAt: true } }, scope: { select: { officerSyncAt: true } } },
          take: 2000
        }),
        // A server set up without extra in-game guilds is one default Guild row named like the Discord server.
        database.guild.findMany({ where: { scopeKey: "default", gameEdition: "forever" }, select: { id: true, discordId: true, name: true, officerSyncAt: true }, take: 2000 })
      ]);
      const found = new Map<string, ServerCandidate>();
      const add = (candidate: ServerCandidate) => {
        const earlier = found.get(candidate.guildId);
        found.set(candidate.guildId, earlier ? { ...earlier, realmMatch: Boolean(earlier.realmMatch || candidate.realmMatch) } : candidate);
      };
      for (const row of spaces) {
        if (looseKey(row.name) !== wanted) continue;
        add({ guildId: row.scopeGuildId ?? row.guildId, discordId: row.guild.discordId, serverName: serverName(row.guild.discordId), officerLinked: Boolean((row.scope ?? row.guild).officerSyncAt), realmMatch: looseKey(row.realm) === realmWanted });
      }
      for (const row of mains) {
        const discordName = serverName(row.discordId);
        if (looseKey(row.name) !== wanted && looseKey(discordName ?? "") !== wanted) continue;
        add({ guildId: row.id, discordId: row.discordId, serverName: discordName, officerLinked: Boolean(row.officerSyncAt) });
      }
      const result = [...found.values()].slice(0, 10);
      if (!result.length && characterKeys.length) {
        // T9: no server registered this guild name (renamed in game, or set up under another spelling). The servers whose
        // officer-synced roster or linked characters already hold one of these characters are offered instead.
        const [rosters, owned] = await Promise.all([
          database.guildRosterEntry.findMany({ where: { gameEdition: "forever", inGuild: true, nameKey: { in: characterKeys } }, select: { guildId: true }, take: 50 }),
          // One equality per key (no `in` with a case mode); every hit is then compared the way the tie-break below does.
          database.character.findMany({ where: { OR: characterKeys.slice(0, 12).map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) }, select: { name: true, realm: true, gameEdition: true, member: { select: { guildId: true } } }, take: 200 })
        ]);
        const mine = new Set(characterKeys);
        const linked = owned.filter((character) => mine.has(characterKey(character.name, character.realm, character.gameEdition ?? "forever")));
        const ids = [...new Set([...rosters.map((row) => row.guildId), ...linked.map((row) => row.member.guildId)])].slice(0, 10);
        const homes = ids.length ? await database.guild.findMany({ where: { id: { in: ids }, gameEdition: "forever" }, select: { id: true, discordId: true, officerSyncAt: true } }) : [];
        return homes.map((row) => ({ guildId: row.id, discordId: row.discordId, serverName: serverName(row.discordId), officerLinked: Boolean(row.officerSyncAt), rosterMatch: true, viaRoster: true }));
      }
      if (result.length > 1 && characterKeys.length) {
        // Only needed to tell servers apart: does a roster already hold one of these characters?
        const members = await database.character.findMany({ where: { member: { guildId: { in: result.map((candidate) => candidate.guildId) } } }, select: { name: true, realm: true, gameEdition: true, member: { select: { guildId: true } } }, take: 5000 });
        const mine = new Set(characterKeys);
        const holders = new Set(members.filter((character) => mine.has(characterKey(character.name, character.realm, character.gameEdition ?? "forever"))).map((character) => character.member.guildId));
        for (const candidate of result) if (holders.has(candidate.guildId)) candidate.rosterMatch = true;
      }
      return result;
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
    async receipts(guildId, refs) {
      const [receipts, stored, waiting] = await Promise.all([
        database.dungeonRunReceipt.findMany({ where: { guildId, runRef: { in: refs }, outcome: { not: RETRY_OUTCOME } }, select: { runRef: true, reason: true } }),
        database.dungeonRun.findMany({ where: { guildId, runRef: { in: refs } }, select: { runRef: true, state: true, invalidReason: true } }),
        database.dungeonRunReceipt.findMany({ where: { guildId, runRef: { in: refs }, outcome: RETRY_OUTCOME }, select: { runRef: true } })
      ]);
      // A stored run the device sent again has no receipt of its own: its reason is the run's (not scored, not completed).
      const byRef = new Map<string, string | null>(stored.map((row) => [row.runRef, receiptReason(row.invalidReason ?? (row.state === "COMPLETED" ? null : "Not completed"))]));
      for (const row of receipts) byRef.set(row.runRef, row.reason ?? byRef.get(row.runRef) ?? null);
      // (9.3) A ref whose receipt says "retry" (a stored unfinished run re-sent as completed, still waiting for a guildmate's own copy)
      // is not held, whatever is stored under it: the addon must keep it and send it again.
      for (const row of waiting) byRef.delete(row.runRef);
      return [...byRef].map(([runRef, reason]) => ({ runRef, reason }));
    },
    importRuns: (guildId, runs, now, source) => database.$transaction((tx) => storeDeviceRuns(tx, guildId, runs, now, source), { timeout: 60_000, maxWait: 15_000 }),
    guildCharacterCount: (guildId) => database.deviceCharacter.count({ where: { device: { guildId, claimedMemberId: null, revokedAt: null } } }),
    // Claimed devices stay (the member sees and revokes them on /me/connections); characters and waiting runs go with the device.
    expireIdle: async (before) => (await database.companionDevice.deleteMany({ where: { claimedMemberId: null, lastSeenAt: { lt: before } } })).count,
    async publicRuns(deviceId, runs, now, deviceKeys, onPlaced) {
      // The relay lane: only a participant's statement counts, the plausibility checks and a daily cap apply, no guild is claimed.
      return (await ingestRelayedRuns(prismaPublicRunStore(database), { carrier: deviceId, carrierKeys: deviceKeys, runs, now, ...(onPlaced ? { onPlaced } : {}) })).receipts;
    },
    async noteAlias(guildId, guild, now) {
      const nameKey = looseKey(guild.name);
      if (!nameKey) return;
      await database.guildNameAlias.upsert({ where: { guildId_nameKey: { guildId, nameKey } },
        create: { guildId, nameKey, name: guild.name, realm: guild.realm, createdAt: now, lastSeenAt: now }, update: { seen: { increment: 1 }, lastSeenAt: now } });
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

/** In-game guild names unsigned companions of this server's roster reported that no /setup registered (T9): the guild was renamed in game. */
export async function reportedGuildNames(database: Pick<PrismaClient, "guildNameAlias">, guildId: string) {
  return database.guildNameAlias.findMany({ where: { guildId }, orderBy: { lastSeenAt: "desc" }, take: 10, select: { name: true, realm: true, seen: true, lastSeenAt: true } });
}

/** The member a companion credential belongs to (guild credentials only; leaderboards-only accounts have no guild). */
export async function memberForCredential(database: Pick<PrismaClient, "companionCredential">, secret: unknown): Promise<string | null> {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) return null;
  const row = await database.companionCredential.findFirst({ where: { tokenHash: hashCompanionSecret(secret), revokedAt: null, member: { status: "ACTIVE" } }, select: { memberId: true } });
  return row?.memberId ?? null;
}
