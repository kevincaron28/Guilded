import type { PrismaClient } from "../generated/prisma/client.js";
import { CLASSES } from "../wow-data.js";
import { enqueueDiscordJob } from "./discord-jobs.js";

// Cross-guild PUG board (opt-in). A request belongs to one raid of one guild; every guild that
// joined the board and plays the same WoW edition shows it as one message, edited in place.
// Nothing here posts to Discord directly: delivery runs through the Discord job queue
// (PUG_POST / PUG_NOTICE, see pug-discord.ts), which paces and retries the sends.

export const PUG_ROLES = ["TANK", "HEALER", "DPS"] as const;
export type PugRole = typeof PUG_ROLES[number];
export const PUG_LIMITS = { dailyRequests: 3, cooldownMinutes: 10, maxHours: 48, maxPerRole: 25, maxSignups: 60, retainDays: 30 } as const;
export type PugCloseReason = "raid-started" | "filled" | "officer" | "expired" | "raid-gone" | "left";

export class PugError extends Error {}
type Allows = (discordGuildId: string) => boolean;
type Db = PrismaClient;

const isUniqueViolation = (error: unknown) => Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

export interface PugCounts { TANK: number; HEALER: number; DPS: number }
export const wantedOf = (request: { wantTank: number; wantHealer: number; wantDps: number }): PugCounts => ({ TANK: request.wantTank, HEALER: request.wantHealer, DPS: request.wantDps });

/** Spots still open per role: what was asked for minus the PUGs an officer accepted. */
export function openCounts(request: { wantTank: number; wantHealer: number; wantDps: number }, signups: { role: string; status: string }[]): PugCounts {
  const wanted = wantedOf(request);
  const open = { ...wanted };
  for (const signup of signups) if (signup.status === "ACCEPTED" && signup.role in open) open[signup.role as PugRole] = Math.max(0, open[signup.role as PugRole] - 1);
  return open;
}
export const isFilled = (open: PugCounts) => PUG_ROLES.every(role => open[role] === 0);

export const pugKey = (requestId: string) => `pug:${requestId}`;
export const pugNoticeKey = (requestId: string) => `pugnotice:${requestId}`;

// --- Joining, leaving, blocking -------------------------------------------------------------

export async function joinPugBoard(db: Db, guildId: string, channelId: string, userId: string): Promise<void> {
  await db.pugBoardGuild.upsert({ where: { guildId }, create: { guildId, channelId, joinedBy: userId }, update: { channelId } });
}

/** Leaving retires this guild's own requests and removes every post from its channel. */
export async function leavePugBoard(db: Db, guildId: string, allows: Allows, now = new Date()): Promise<{ channelId: string | null }> {
  const board = await db.pugBoardGuild.findUnique({ where: { guildId } });
  if (!board) return { channelId: null };
  const own = await db.pugRequest.findMany({ where: { guildId, status: "OPEN" }, select: { id: true } });
  for (const request of own) await closePugRequest(db, request.id, "left", allows, now);
  const posts = await db.pugPost.findMany({ where: { guildId, removedAt: null }, select: { requestId: true } });
  // Each post row keeps its own channel id, so removal works after the membership is gone.
  await db.pugBoardGuild.delete({ where: { guildId } });
  for (const post of posts) await enqueueDiscordJob(db, guildId, pugKey(post.requestId), "PUG_POST", { requestId: post.requestId });
  return { channelId: board.channelId };
}

export async function blockPugGuild(db: Db, guildId: string, blockedGuildId: string, allows: Allows): Promise<void> {
  if (guildId === blockedGuildId) throw new PugError("A guild cannot block itself.");
  await db.pugBlock.upsert({ where: { guildId_blockedGuildId: { guildId, blockedGuildId } }, create: { guildId, blockedGuildId }, update: {} });
  // Posts between the two guilds disappear at once, in both directions.
  const requests = await db.pugRequest.findMany({ where: { status: "OPEN", guildId: { in: [guildId, blockedGuildId] } }, select: { id: true } });
  for (const request of requests) await fanOutPugRequest(db, request.id, allows);
}

export async function unblockPugGuild(db: Db, guildId: string, blockedGuildId: string, allows: Allows): Promise<boolean> {
  const { count } = await db.pugBlock.deleteMany({ where: { guildId, blockedGuildId } });
  if (count) {
    const requests = await db.pugRequest.findMany({ where: { status: "OPEN", guildId: { in: [guildId, blockedGuildId] } }, select: { id: true } });
    for (const request of requests) await fanOutPugRequest(db, request.id, allows);
  }
  return count > 0;
}

// --- Fan-out ----------------------------------------------------------------------------------

export interface PugTarget { guildId: string; discordId: string; channelId: string }

/** Guilds that joined, play the request's edition and are not blocked either way. The requester is never a target. */
export async function pugTargets(db: Db, request: { guildId: string; edition: string }, allows: Allows): Promise<PugTarget[]> {
  const [boards, blocks] = await Promise.all([
    db.pugBoardGuild.findMany({ where: { guildId: { not: request.guildId }, guild: { gameEdition: request.edition } }, include: { guild: { select: { discordId: true } } } }),
    db.pugBlock.findMany({ where: { OR: [{ guildId: request.guildId }, { blockedGuildId: request.guildId }] } })
  ]);
  const hidden = new Set(blocks.map(block => block.guildId === request.guildId ? block.blockedGuildId : block.guildId));
  return boards.filter(board => !hidden.has(board.guildId) && allows(board.guild.discordId))
    .map(board => ({ guildId: board.guildId, discordId: board.guild.discordId, channelId: board.channelId }));
}

/** True when this guild's board may still show the request (used again at delivery time). */
export async function mayShowPug(db: Db, request: { id: string; guildId: string; edition: string }, viewerGuildId: string, allows: Allows): Promise<boolean> {
  return (await pugTargets(db, request, allows)).some(target => target.guildId === viewerGuildId);
}

/**
 * Idempotent: makes sure each eligible guild has exactly one post row and queues one refresh job per
 * post (the job key is the request id, so a repeat only bumps its revision). Posts of guilds that stopped
 * being eligible, and of closed requests, get a job too: delivery removes them.
 */
export async function fanOutPugRequest(db: Db, requestId: string, allows: Allows, now = new Date()): Promise<number> {
  const request = await db.pugRequest.findUnique({ where: { id: requestId } });
  if (!request) return 0;
  if (request.status === "OPEN") {
    for (const target of await pugTargets(db, request, allows)) {
      await db.pugPost.upsert({ where: { requestId_guildId: { requestId, guildId: target.guildId } }, create: { requestId, guildId: target.guildId, channelId: target.channelId }, update: {} });
    }
  }
  const posts = await db.pugPost.findMany({ where: { requestId, removedAt: null }, orderBy: { createdAt: "asc" } });
  let delay = 0;
  for (const post of posts) {
    const job = await enqueueDiscordJob(db, post.guildId, pugKey(requestId), "PUG_POST", { requestId });
    // One post every two seconds per fan-out: the queue paces the rest.
    await db.discordJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { nextAttemptAt: new Date(now.getTime() + delay) } });
    delay += 2_000;
  }
  return posts.length;
}

async function queueNotice(db: Db, requestId: string, guildId: string, now: Date, delayMs: number): Promise<void> {
  const job = await enqueueDiscordJob(db, guildId, pugNoticeKey(requestId), "PUG_NOTICE", { requestId });
  // Sign-ups arriving within the window share one edit of the single notice message.
  await db.discordJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { nextAttemptAt: new Date(now.getTime() + delayMs) } });
}

// --- Requests ---------------------------------------------------------------------------------

export interface CreatePugRequestInput {
  guildId: string; raidId: string; createdBy: string; want: PugCounts; hours: number; note?: string | null;
}

export async function createPugRequest(db: Db, input: CreatePugRequestInput, allows: Allows, now = new Date()) {
  const board = await db.pugBoardGuild.findUnique({ where: { guildId: input.guildId } });
  if (!board) throw new PugError("Join the PUG board first: /raid pugs join.");
  const want = Object.fromEntries(PUG_ROLES.map(role => [role, Math.trunc(Number(input.want[role]) || 0)])) as unknown as PugCounts;
  if (PUG_ROLES.some(role => want[role] < 0 || want[role] > PUG_LIMITS.maxPerRole)) throw new PugError(`Ask for 0 to ${PUG_LIMITS.maxPerRole} spots per role.`);
  if (PUG_ROLES.every(role => want[role] === 0)) throw new PugError("Ask for at least one tank, healer or DPS spot.");
  const raid = await db.raid.findFirst({ where: { id: input.raidId, guildId: input.guildId }, include: { guild: { select: { gameEdition: true } } } });
  if (!raid) throw new PugError("Raid not found in this guild.");
  if (raid.isTest || raid.status !== "PLANNED" || raid.scheduledAt <= now) throw new PugError("Only upcoming, planned, non-test raids can ask for PUGs.");
  if (await db.pugRequest.findFirst({ where: { raidId: raid.id, status: "OPEN" }, select: { id: true } })) throw new PugError("This raid already has an active PUG request. Close it first.");
  const last = await db.pugRequest.findFirst({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && now.getTime() - last.createdAt.getTime() < PUG_LIMITS.cooldownMinutes * 60_000) throw new PugError(`Wait ${PUG_LIMITS.cooldownMinutes} minutes between PUG requests.`);
  if (await db.pugRequest.count({ where: { guildId: input.guildId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }) >= PUG_LIMITS.dailyRequests) {
    throw new PugError(`This guild can make ${PUG_LIMITS.dailyRequests} PUG requests per day.`);
  }
  const hours = Math.min(PUG_LIMITS.maxHours, Math.max(1, Math.trunc(Number(input.hours) || PUG_LIMITS.maxHours)));
  const expiresAt = new Date(Math.min(now.getTime() + hours * 3_600_000, raid.scheduledAt.getTime()));
  let request;
  try {
    request = await db.pugRequest.create({ data: {
      raidId: raid.id, guildId: input.guildId, edition: raid.guild.gameEdition, raidTitle: clean(raid.title, 100) || "Raid", scheduledAt: raid.scheduledAt,
      wantTank: want.TANK, wantHealer: want.HEALER, wantDps: want.DPS, note: clean(input.note, 200) || null, createdBy: input.createdBy, expiresAt
    } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PugError("This raid already has an active PUG request. Close it first.");
    throw error;
  }
  const posts = await fanOutPugRequest(db, request.id, allows, now);
  return { request, posts };
}

/** Closes once (a repeat is a no-op) and queues the removal of every post. */
export async function closePugRequest(db: Db, requestId: string, reason: PugCloseReason, allows: Allows, now = new Date()): Promise<boolean> {
  const { count } = await db.pugRequest.updateMany({ where: { id: requestId, status: "OPEN" }, data: { status: "CLOSED", closeReason: reason, closedAt: now } });
  if (!count) return false;
  await fanOutPugRequest(db, requestId, allows, now);
  const request = await db.pugRequest.findUnique({ where: { id: requestId }, select: { guildId: true, noticeMessageId: true } });
  if (request?.noticeMessageId) await queueNotice(db, requestId, request.guildId, now, 0);
  return true;
}

// --- Sign-ups ---------------------------------------------------------------------------------

export interface PugSignupInput {
  requestId: string; discordUserId: string; displayName: string; role: string;
  characterName: string; characterClass?: string | null; note?: string | null; sourceGuild?: string | null;
}

export function normalizeClass(value: string | null | undefined): string | null {
  const text = clean(value, 20).toLowerCase();
  return CLASSES.find(name => name.toLowerCase() === text) ?? null;
}

/** Members of the requesting guild use its normal signup; members of a guild it blocked cannot sign up either. */
async function signupRefused(db: Db, request: { guildId: string }, discordUserId: string): Promise<boolean> {
  const blocked = await db.pugBlock.findMany({ where: { guildId: request.guildId }, select: { blockedGuildId: true } });
  const memberships = await db.member.findMany({ where: { discordUserId, status: "ACTIVE", guildId: { in: [request.guildId, ...blocked.map(row => row.blockedGuildId)] } }, select: { guildId: true }, take: 1 });
  return memberships.length > 0;
}

export async function signUpForPug(db: Db, input: PugSignupInput, allows: Allows, now = new Date()) {
  const role = input.role.toUpperCase();
  if (!PUG_ROLES.includes(role as PugRole)) throw new PugError("Choose tank, healer or DPS.");
  const characterName = clean(input.characterName, 24);
  if (characterName.length < 2) throw new PugError("Enter your character's name.");
  const request = await db.pugRequest.findUnique({ where: { id: input.requestId }, include: { signups: { select: { role: true, status: true } }, guild: { select: { discordId: true } } } });
  if (!request || request.status !== "OPEN" || request.expiresAt <= now || request.scheduledAt <= now || !allows(request.guild.discordId)) throw new PugError("This PUG request is closed.");
  if (openCounts(request, request.signups)[role as PugRole] <= 0) throw new PugError("That role is full.");
  if (request.signups.length >= PUG_LIMITS.maxSignups) throw new PugError("This request has enough sign-ups.");
  if (await signupRefused(db, request, input.discordUserId)) throw new PugError("This guild is not taking your sign-up. Members use their own guild's signup.");
  let signup;
  try {
    signup = await db.pugSignup.create({ data: {
      requestId: request.id, discordUserId: input.discordUserId, displayName: clean(input.displayName, 40) || "Player",
      sourceGuild: clean(input.sourceGuild, 60) || null, characterName, characterClass: normalizeClass(input.characterClass), role, note: clean(input.note, 120) || null
    } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PugError("You already signed up for this request.");
    throw error;
  }
  await queueNotice(db, request.id, request.guildId, now, 20_000);
  return signup;
}

/** Officer decision. `guildId` is the deciding guild: nobody can decide another guild's sign-ups. */
export async function decidePugSignup(db: Db, signupId: string, guildId: string, accept: boolean, allows: Allows, now = new Date()): Promise<"accepted" | "declined" | "already-decided"> {
  const signup = await db.pugSignup.findUnique({ where: { id: signupId }, include: { request: { include: { signups: { select: { role: true, status: true } } } } } });
  if (!signup || signup.request.guildId !== guildId) throw new PugError("Sign-up not found.");
  if (signup.status !== "PENDING") return "already-decided";
  if (accept) {
    if (signup.request.status !== "OPEN") throw new PugError("This request is closed.");
    if (openCounts(signup.request, signup.request.signups)[signup.role as PugRole] <= 0) throw new PugError("That role is already full.");
  }
  const { count } = await db.pugSignup.updateMany({ where: { id: signupId, status: "PENDING" }, data: { status: accept ? "ACCEPTED" : "DECLINED", decidedAt: now } });
  if (!count) return "already-decided";
  if (accept) {
    const signups = await db.pugSignup.findMany({ where: { requestId: signup.requestId }, select: { role: true, status: true } });
    if (isFilled(openCounts(signup.request, signups))) await closePugRequest(db, signup.requestId, "filled", allows, now);
    else await fanOutPugRequest(db, signup.requestId, allows, now);
  }
  await queueNotice(db, signup.requestId, guildId, now, 0);
  return accept ? "accepted" : "declined";
}

// --- Expiry sweep -----------------------------------------------------------------------------

export interface SweepResult { closed: number; resynced: number; orphans: number; deleted: number }

/** Run every minute: closes finished requests, retires orphaned posts and prunes old rows. Errors never loop. */
export async function sweepPugRequests(db: Db, allows: Allows, now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { closed: 0, resynced: 0, orphans: 0, deleted: 0 };
  const open = await db.pugRequest.findMany({ where: { status: "OPEN" }, take: 200, orderBy: { createdAt: "asc" } });
  for (const request of open) {
    const raid = await db.raid.findUnique({ where: { id: request.raidId }, select: { status: true, scheduledAt: true, title: true } });
    const hardLimit = request.createdAt.getTime() + PUG_LIMITS.maxHours * 3_600_000;
    const reason: PugCloseReason | null = !raid || raid.status !== "PLANNED" ? "raid-gone"
      : raid.scheduledAt <= now ? "raid-started"
      : request.expiresAt <= now || hardLimit <= now.getTime() ? "expired" : null;
    if (reason) {
      if (await closePugRequest(db, request.id, reason, allows, now)) result.closed++;
    } else if (raid && (raid.scheduledAt.getTime() !== request.scheduledAt.getTime() || clean(raid.title, 100) !== request.raidTitle)) {
      // The officers moved or renamed the raid: keep the posts truthful.
      await db.pugRequest.update({ where: { id: request.id }, data: { scheduledAt: raid.scheduledAt, raidTitle: clean(raid.title, 100) || "Raid", expiresAt: new Date(Math.min(request.expiresAt.getTime(), raid.scheduledAt.getTime())) } });
      await fanOutPugRequest(db, request.id, allows, now);
      result.resynced++;
    }
  }
  const settled = new Date(now.getTime() - 5 * 60_000);
  const stale = await db.pugPost.findMany({ where: { removedAt: null, request: { status: { not: "OPEN" }, closedAt: { lt: settled } } }, take: 100 });
  const boards = new Set((await db.pugBoardGuild.findMany({ select: { guildId: true } })).map(row => row.guildId));
  const live = await db.pugPost.findMany({ where: { removedAt: null, createdAt: { lt: settled }, request: { status: "OPEN" } }, take: 500 });
  const stranded = live.filter(post => !boards.has(post.guildId));
  for (const post of [...stale, ...stranded]) {
    await enqueueDiscordJob(db, post.guildId, pugKey(post.requestId), "PUG_POST", { requestId: post.requestId });
    result.orphans++;
  }
  const { count } = await db.pugRequest.deleteMany({ where: { status: "CLOSED", closedAt: { lt: new Date(now.getTime() - PUG_LIMITS.retainDays * 86_400_000) }, posts: { none: { removedAt: null } } } });
  result.deleted = count;
  return result;
}

// --- Website view -----------------------------------------------------------------------------

export interface PublicPugRequest {
  id: string; guildName: string; raidTitle: string; scheduledAt: string; expiresAt: string; edition: string; note: string | null; open: PugCounts;
}

/** Open requests for one edition. Internal ids (guild, creator, raid) and sign-up details never leave. */
export async function publicPugRequests(db: Db, edition: string, allows: Allows, now = new Date()): Promise<PublicPugRequest[]> {
  const rows = await db.pugRequest.findMany({
    where: { status: "OPEN", edition, expiresAt: { gt: now }, scheduledAt: { gt: now }, guild: { pugBoard: { isNot: null } } },
    include: { guild: { select: { name: true, discordId: true } }, signups: { select: { role: true, status: true } } },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: 100
  });
  return rows.filter(row => allows(row.guild.discordId)).flatMap(row => {
    const open = openCounts(row, row.signups);
    return isFilled(open) ? [] : [{ id: row.id, guildName: row.guild.name, raidTitle: row.raidTitle, scheduledAt: row.scheduledAt.toISOString(), expiresAt: row.expiresAt.toISOString(), edition: row.edition, note: row.note, open }];
  });
}
