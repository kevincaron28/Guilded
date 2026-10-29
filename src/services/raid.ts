import type {
  Prisma,
  PrismaClient,
  RaidSignupStatus,
  RaidAttendanceStatus,
  RaidBossStatus,
  RaidStatus,
  RaidRole
} from "../generated/prisma/client.js";
import { ownedSignupCharacter } from "./signup-character.js";
import { currentEdition } from "./edition-context.js";
import { assertRealm, requiredRealm } from "./realm-check.js";
import { SIGNUP_CHARACTER_SELECT } from "./character-display.js";
import { raidPreset } from "./raid-presets.js";
import { dpsKind, signupSpec, specsForRole, type DpsKind } from "./dps-kind.js";

const activeSignupStatuses: RaidSignupStatus[] = ["SIGNED_UP"];

// Two raids starting less than this apart can't both be done (a raid night is about 3 hours).
export const CLASH_WINDOW_MS = 4 * 3_600_000;

const roleCapField: Record<RaidRole, "tankLimit" | "healerLimit" | "dpsLimit"> = {
  TANK: "tankLimit",
  HEALER: "healerLimit",
  DPS: "dpsLimit"
};

// The class and spec that decide melee or ranged: the signup's character, else the member's main.
const KIND_SELECT = {
  id: true, memberId: true, role: true, status: true, spec: true, signedUpAt: true, characterId: true,
  character: { select: { className: true, spec: true } },
  member: { select: { characters: { where: { isMain: true }, take: 1, select: { className: true, spec: true } } } }
} as const;
type KindRow = { spec: string | null; character: { className: string; spec: string | null } | null; member: { characters: { className: string; spec: string | null }[] } };
export function signupDpsKind(row: KindRow, edition = currentEdition()): DpsKind | null {
  const character = row.character ?? row.member.characters[0] ?? null;
  return character ? dpsKind(character.className, signupSpec(row, character), edition) : null;
}

export interface CreateRaidInput {
  guildId: string;
  title: string;
  scheduledAt: Date;
  createdBy: string;
  description?: string;
  bosses?: string[];
  tankLimit?: number;
  healerLimit?: number;
  dpsLimit?: number;
  meleeLimit?: number;
  rangedLimit?: number;
  // Create the raid for a raid core: its members get signup priority.
  coreId?: string;
  repeatWeekly?: boolean;
  preset?: string;
  // Close signups this many hours before the start (1-168).
  signupsCloseHours?: number;
}

export type SignupAvailability = "AVAILABLE" | "MAYBE";

// A member tried to sign up or change role after the raid's signup deadline.
export class SignupsClosedError extends Error {
  constructor(readonly closedAt: Date) { super("Signups are closed for this raid."); }
}

// The other damage kind is full: the player keeps their current spec.
export class DpsKindFullError extends Error {
  constructor(readonly kind: DpsKind) { super(`${kind === "MELEE" ? "Melee" : "Ranged"} DPS spots are full for this raid.`); }
}

const HOUR_MS = 3_600_000;
function deadline(scheduledAt: Date, hours: number, now = new Date()): Date {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("The signup deadline must be 1 to 168 hours before the start.");
  const closesAt = new Date(scheduledAt.getTime() - hours * HOUR_MS);
  if (closesAt.getTime() <= now.getTime()) throw new Error("That signup deadline is already past: choose fewer hours, or none.");
  return closesAt;
}

type RaidDb = Pick<PrismaClient, "raid" | "raidSignup" | "raidCoreMember"> & Partial<Pick<PrismaClient, "raidCore">>;

export function createRaidService(database: PrismaClient) {
  async function locked<T>(raidId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return database.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`raid-signup:${raidId}`}, 0))`;
      return work(tx);
    }, { timeout: 15_000, maxWait: 15_000 });
  }
  async function getRaid(raidId: string, guildId: string, tx: RaidDb = database) {
    const raid = await tx.raid.findFirst({ where: { id: raidId, guildId } });
    if (!raid) throw new Error("Raid not found in this guild.");
    return raid;
  }

  // The realm a raid is played on: its core's (set by an officer, else the one the core's
  // characters share); with no core, the one the characters already signed up share.
  async function raidRealm(raid: { id: string; coreId: string | null }, memberId: string, tx: RaidDb = database): Promise<string | null> {
    if (raid.coreId) {
      const core = await tx.raidCore?.findUnique({ where: { id: raid.coreId }, select: { realm: true, members: { where: { memberId: { not: memberId } }, select: { character: { select: { realm: true } } } } } });
      if (currentEdition() === "retail") return core?.realm?.trim() || null;
      return core ? requiredRealm(core.realm, core.members.map(spot => spot.character?.realm)) : null;
    }
    if (currentEdition() === "retail") return null;
    const signups = await tx.raidSignup.findMany({ where: { raidId: raid.id, memberId: { not: memberId }, status: { not: "CANCELLED" }, characterRealm: { not: null } }, select: { characterRealm: true } });
    return requiredRealm(null, signups.map(signup => signup.characterRealm));
  }

  async function coreMemberIds(coreId: string, tx: RaidDb = database, byCharacter = false): Promise<Set<string>> {
    // Main players only: the bench (replacements) gets no signup priority.
    const rows = await tx.raidCoreMember.findMany({ where: { coreId, bench: false }, select: { memberId: true, characterId: true, backups: { select: { characterId: true } } } });
    return new Set(rows.flatMap(row => byCharacter ? [row.characterId, ...(row.backups ?? []).map(backup => backup.characterId)]
      .filter((id): id is string => !!id).map(id => `${row.memberId}:${id}`) : [row.memberId]));
  }

  // Fills open role slots from the waitlist, earliest signup first. Runs
  // after a cancellation or a cap change. Returns who was promoted.
  async function promoteWaitlist(raidId: string, tx: RaidDb = database) {
    const raid = await tx.raid.findUnique({ where: { id: raidId } });
    if (!raid || raid.status !== "PLANNED") return [];
    const byCharacter = (await (tx as Prisma.TransactionClient).guildSettings?.findUnique({ where: { guildId: raid.guildId }, select: { characterSignups: true } }))?.characterSignups ?? false;
    const promoted = [];
    for (const role of ["TANK", "HEALER", "DPS"] as const) {
      const cap = raid[roleCapField[role]];
      const waiting = await tx.raidSignup.findMany({
        where: { raidId, role, status: "WAITLISTED" },
        orderBy: { signedUpAt: "asc" },
        include: { member: true }
      });
      if (waiting.length === 0) continue;
      // Core members move up first (then earliest signup) for a core raid.
      if (raid.coreId) {
        const coreIds = await coreMemberIds(raid.coreId, tx, byCharacter);
        const key = (row: { memberId: string; characterId: string | null }) => byCharacter ? `${row.memberId}:${row.characterId}` : row.memberId;
        waiting.sort((a, b) => Number(coreIds.has(key(b))) - Number(coreIds.has(key(a))) || a.signedUpAt.getTime() - b.signedUpAt.getTime());
      }
      const taken = cap === null ? 0 : await tx.raidSignup.count({ where: { raidId, role, status: "SIGNED_UP" } });
      let open = cap === null ? waiting.length : Math.max(0, cap - taken);
      // DPS with melee/ranged seats: a waiting player moves up only into their own kind's free seats.
      const kindOpen: Record<DpsKind, number | null> | null = role === "DPS" && (raid.meleeLimit != null || raid.rangedLimit != null) ? await dpsKindRoom(raid, tx) : null;
      const kinds: Map<string, DpsKind | null> | null = kindOpen ? new Map((await tx.raidSignup.findMany({ where: { raidId, role, status: "WAITLISTED" }, select: KIND_SELECT }))
        .map(row => [row.id, signupDpsKind(row)])) : null;
      for (const signup of waiting) {
        if (open <= 0) break;
        const kind = kinds?.get(signup.id) ?? null;
        if (kindOpen && kind && kindOpen[kind] !== null && kindOpen[kind]! <= 0) continue;
        await tx.raidSignup.update({ where: { id: signup.id }, data: { status: "SIGNED_UP" } });
        promoted.push(signup);
        open--;
        if (kindOpen && kind && kindOpen[kind] !== null) kindOpen[kind]!--;
      }
    }
    return promoted;
  }

  // Free melee and ranged seats (null where the raid sets no limit). Players whose kind is
  // unknown count against the DPS limit only.
  async function dpsKindRoom(raid: { id: string; meleeLimit: number | null; rangedLimit: number | null }, tx: RaidDb, exceptMemberId?: string): Promise<Record<DpsKind, number | null>> {
    const rows = await tx.raidSignup.findMany({ where: { raidId: raid.id, role: "DPS", status: "SIGNED_UP", ...(exceptMemberId ? { memberId: { not: exceptMemberId } } : {}) }, select: KIND_SELECT });
    const used = { MELEE: 0, RANGED: 0 };
    for (const row of rows) { const kind = signupDpsKind(row); if (kind) used[kind]++; }
    return {
      MELEE: raid.meleeLimit == null ? null : raid.meleeLimit - used.MELEE,
      RANGED: raid.rangedLimit == null ? null : raid.rangedLimit - used.RANGED
    };
  }
  const checkLimits = (limits: (number | null | undefined)[]) => {
    for (const limit of limits) if (limit != null && (!Number.isInteger(limit) || limit < 0)) throw new Error("Role limits must be non-negative integers.");
  };

  return {
    async create(input: CreateRaidInput) {
      const preset = raidPreset(input.preset);
      if (input.title.trim().length < 3) throw new Error("Raid title must be at least 3 characters.");
      if (input.scheduledAt.getTime() <= Date.now()) throw new Error("Raid time must be in the future.");
      for (const [label, limit] of [["Tank", input.tankLimit], ["Healer", input.healerLimit], ["DPS", input.dpsLimit]] as const) {
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          throw new Error(`${label} limit must be a non-negative integer.`);
        }
      }
      checkLimits([input.meleeLimit, input.rangedLimit]);
      const bosses = input.bosses?.map((name) => name.trim()).filter(Boolean) ?? [];
      let coreLimits: { tankLimit?: number | null; healerLimit?: number | null; dpsLimit?: number | null } = {};
      if (input.coreId) {
        const core = await database.raidCore.findFirst({ where: { id: input.coreId, guildId: input.guildId }, select: { id: true, tankLimit: true, healerLimit: true, dpsLimit: true } });
        if (!core) throw new Error("That raid core was not found in this guild.");
        coreLimits = core;
      }
      return database.raid.create({
        data: {
          guildId: input.guildId,
          ...(input.coreId ? { coreId: input.coreId } : {}),
          title: input.title.trim(),
          scheduledAt: input.scheduledAt,
          createdBy: input.createdBy,
          description: input.description?.trim() || null,
          repeatWeekly: input.repeatWeekly ?? false,
          ...(input.signupsCloseHours === undefined ? {} : { signupsCloseAt: deadline(input.scheduledAt, input.signupsCloseHours) }),
          tankLimit: input.tankLimit ?? preset?.tankLimit ?? coreLimits.tankLimit ?? null,
          healerLimit: input.healerLimit ?? preset?.healerLimit ?? coreLimits.healerLimit ?? null,
          dpsLimit: input.dpsLimit ?? preset?.dpsLimit ?? coreLimits.dpsLimit ?? null,
          meleeLimit: input.meleeLimit ?? null,
          rangedLimit: input.rangedLimit ?? null,
          ...(bosses.length > 0 ? {
            bosses: { create: bosses.map((name, sortOrder) => ({ name, sortOrder })) }
          } : {})
        },
        include: { bosses: true }
      });
    },

    // For a weekly raid that just ended: creates the next one, seven days on
    // (or the first such date still in the future). Null if it is not weekly.
    async createNextRepeat(raidId: string, guildId: string, now = new Date()) {
      const raid = await database.raid.findFirst({ where: { id: raidId, guildId }, include: { bosses: { orderBy: { sortOrder: "asc" } } } });
      if (!raid || !raid.repeatWeekly || raid.isTest || raid.weeklyOccurrence) return null;
      const week = 7 * 24 * 3_600_000;
      let next = raid.scheduledAt.getTime() + week;
      while (next <= now.getTime()) next += week;
      // A cancelled or already-created follow-up must not be duplicated.
      const existing = await database.raid.findFirst({ where: { guildId, title: raid.title, scheduledAt: new Date(next), status: { not: "CANCELLED" } }, select: { id: true } });
      if (existing) return null;
      return database.raid.create({
        data: {
          guildId, title: raid.title, scheduledAt: new Date(next), createdBy: raid.createdBy, description: raid.description,
          tankLimit: raid.tankLimit, healerLimit: raid.healerLimit, dpsLimit: raid.dpsLimit, meleeLimit: raid.meleeLimit, rangedLimit: raid.rangedLimit, repeatWeekly: true,
          // The same deadline, the same time before the start.
          ...(raid.signupsCloseAt ? { signupsCloseAt: new Date(next - (raid.scheduledAt.getTime() - raid.signupsCloseAt.getTime())) } : {}),
          ...(raid.coreId ? { coreId: raid.coreId } : {}),
          ...(raid.bosses.length > 0 ? { bosses: { create: raid.bosses.map((boss, sortOrder) => ({ name: boss.name, sortOrder })) } } : {})
        }
      });
    },

    setSignupMessage(raidId: string, guildId: string, channelId: string, messageId: string) {
      return database.raid.updateMany({
        where: { id: raidId, guildId },
        data: { signupChannelId: channelId, signupMessageId: messageId }
      });
    },

    async edit(raidId: string, guildId: string, input: {
      title?: string;
      description?: string | null;
      scheduledAt?: Date;
      tankLimit?: number | null;
      healerLimit?: number | null;
      dpsLimit?: number | null;
      meleeLimit?: number | null;
      rangedLimit?: number | null;
      // Hours before the start; 0 removes the deadline.
      signupsCloseHours?: number;
    }) {
      return locked(raidId, async tx => {
        const raid = await getRaid(raidId, guildId, tx);
        if (raid.status !== "PLANNED") throw new Error("Only planned raids can be edited.");
        if (input.title !== undefined && input.title.trim().length < 3) {
          throw new Error("Raid title must be at least 3 characters.");
        }
        if (input.scheduledAt !== undefined && input.scheduledAt.getTime() <= Date.now()) {
          throw new Error("Raid time must be in the future.");
        }
        checkLimits([input.tankLimit, input.healerLimit, input.dpsLimit, input.meleeLimit, input.rangedLimit]);
        // A new time keeps an existing deadline the same number of hours before it.
        const start = input.scheduledAt ?? raid.scheduledAt;
        const signupsCloseAt = input.signupsCloseHours === 0 ? null
          : input.signupsCloseHours !== undefined ? deadline(start, input.signupsCloseHours)
          : raid.signupsCloseAt && input.scheduledAt ? new Date(start.getTime() - (raid.scheduledAt.getTime() - raid.signupsCloseAt.getTime()))
          : undefined;
        const updated = await tx.raid.update({
          where: { id: raid.id },
          data: {
            ...(signupsCloseAt === undefined ? {} : { signupsCloseAt }),
            ...(input.title === undefined ? {} : { title: input.title.trim() }),
            ...(input.description === undefined ? {} : { description: input.description?.trim() || null }),
            ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
            ...(input.tankLimit === undefined ? {} : { tankLimit: input.tankLimit }),
            ...(input.healerLimit === undefined ? {} : { healerLimit: input.healerLimit }),
            ...(input.dpsLimit === undefined ? {} : { dpsLimit: input.dpsLimit }),
            ...(input.meleeLimit === undefined ? {} : { meleeLimit: input.meleeLimit }),
            ...(input.rangedLimit === undefined ? {} : { rangedLimit: input.rangedLimit })
          }
        });
        // A raised cap opens slots for the waitlist.
        const promoted = await promoteWaitlist(raid.id, tx);
        return Object.assign(updated, { promoted });
      });
    },

    async cancel(raidId: string, guildId: string) {
      const raid = await getRaid(raidId, guildId);
      if (raid.status === "COMPLETED") throw new Error("Completed raids cannot be cancelled.");
      if (raid.status === "CANCELLED") throw new Error("Raid is already cancelled.");
      return database.raid.update({ where: { id: raid.id }, data: { status: "CANCELLED" } });
    },

    // AVAILABLE takes a role slot, or joins the waitlist when that role is
    // full. MAYBE never takes a slot.
    // respectDeadline: a member signing up themselves (buttons, /raid signup). Imports and
    // calendar sync record what already happened in game, so they pass false.
    async signup(raidId: string, guildId: string, memberId: string, role: RaidRole, availability: SignupAvailability = "AVAILABLE", characterValue?: string | null, respectDeadline = false) {
      return locked(raidId, async tx => {
        const raid = await getRaid(raidId, guildId, tx);
        if (raid.status !== "PLANNED") throw new Error("Signups are closed for this raid.");
        if (respectDeadline && raid.signupsCloseAt && raid.signupsCloseAt.getTime() <= Date.now()) throw new SignupsClosedError(raid.signupsCloseAt);
        const byCharacter = (await tx.guildSettings?.findUnique({ where: { guildId }, select: { characterSignups: true } }))?.characterSignups ?? false;
        const character = characterValue || byCharacter ? await ownedSignupCharacter(tx, guildId, memberId, characterValue) : null;
        if (character && await tx.raidSignup.findFirst({ where: { raidId, characterId: character.id, memberId: { not: memberId }, status: { not: "CANCELLED" } } })) {
          throw new Error("Ce personnage est déjà inscrit à ce raid. Une inscription par personnage et une place par personne.");
        }
        if (character) assertRealm(character, await raidRealm(raid, memberId, tx), raid.title);
        const identity = byCharacter ? `${memberId}:${character?.id}` : memberId;
        const previous = await tx.raidSignup.findUnique({ where: { raidId_memberId: { raidId, memberId } } });
        let status: RaidSignupStatus = availability === "MAYBE" ? "MAYBE" : "SIGNED_UP";
        // A spec picked for this raid stays only while the role and character stay the same.
        const spec = previous?.spec && previous.role === role && (!character || previous.characterId === character.id) ? previous.spec : null;
        const cap = raid[roleCapField[role]];
        // Melee/ranged seats: only checked when the raid sets one and this player's kind is known.
        let kind: DpsKind | null = null;
        let kindFull = false;
        if (status === "SIGNED_UP" && role === "DPS" && (raid.meleeLimit != null || raid.rangedLimit != null)) {
          const own = character ?? await tx.character.findFirst({ where: { memberId, isMain: true }, select: { className: true, spec: true } });
          kind = own ? dpsKind(own.className, signupSpec({ spec }, own), currentEdition()) : null;
          const room = kind ? (await dpsKindRoom(raid, tx, memberId))[kind] : null;
          kindFull = room !== null && room <= 0;
        }
        let bumped: Prisma.RaidSignupGetPayload<{ include: { member: true } }> | null = null;
        const roleFull = status === "SIGNED_UP" && cap !== null && await tx.raidSignup.count({
          where: { raidId, role, status: "SIGNED_UP", memberId: { not: memberId } }
        }) >= cap;
        if (roleFull || kindFull) {
          status = "WAITLISTED";
          // Core priority: a core member takes the slot of the most recent
          // non-core signup in that role (and of their own kind when that is what is full),
          // who goes to the front of the waitlist.
          if (raid.coreId && (await coreMemberIds(raid.coreId, tx, byCharacter)).has(identity)) {
            const coreIds = await coreMemberIds(raid.coreId, tx, byCharacter);
            const candidates = await tx.raidSignup.findMany({
              where: { raidId, role, status: "SIGNED_UP", memberId: { not: memberId } },
              include: { member: true },
              orderBy: { signedUpAt: "desc" }
            });
            const sameKind = kindFull ? new Set((await tx.raidSignup.findMany({ where: { raidId, role, status: "SIGNED_UP" }, select: KIND_SELECT }))
              .filter(row => signupDpsKind(row) === kind).map(row => row.id)) : null;
            const victim = candidates.find(signup => (!sameKind || sameKind.has(signup.id)) && !coreIds.has(byCharacter ? `${signup.memberId}:${signup.characterId}` : signup.memberId));
            if (victim) {
              await tx.raidSignup.update({ where: { id: victim.id }, data: { status: "WAITLISTED" } });
              bumped = { ...victim, status: "WAITLISTED" };
              status = "SIGNED_UP";
            }
          }
        }
        const saved = await tx.raidSignup.upsert({
          where: { raidId_memberId: { raidId, memberId } },
          create: { raidId, memberId, role, status, ...(character ? { characterId: character.id, characterName: character.name, characterRealm: character.realm } : {}) },
          update: { status, role, spec, signedUpAt: new Date(), cancelledAt: null, ...(character ? { characterId: character.id, characterName: character.name, characterRealm: character.realm } : {}) }
        });
        // Leaving a taken slot (another role, Maybe or the waitlist) frees it, as a cancellation does.
        const promoted = previous?.status === "SIGNED_UP" && (previous.role !== role || status !== "SIGNED_UP" || (previous.spec ?? null) !== spec)
          ? await promoteWaitlist(raidId, tx) : [];
        return Object.assign(saved, { bumped, promoted });
      });
    },

    // The spec a player brings to this raid ("Playing a different spec?"). It must fit their
    // signup's role and class; moving to a full melee or ranged group is refused, not waitlisted.
    async setSignupSpec(raidId: string, guildId: string, memberId: string, specName: string | null) {
      return locked(raidId, async tx => {
        const raid = await getRaid(raidId, guildId, tx);
        if (raid.status !== "PLANNED") throw new Error("Signups are closed for this raid.");
        const signup = await tx.raidSignup.findUnique({ where: { raidId_memberId: { raidId, memberId } }, select: KIND_SELECT });
        if (!signup || signup.status === "CANCELLED") throw new Error("Sign up for this raid first, then choose your spec.");
        const character = signup.character ?? signup.member.characters[0] ?? null;
        if (!character) throw new Error("Link your character first (/character pair), so Guilded knows your class.");
        const edition = currentEdition();
        const chosen = specName ? specsForRole(character.className, signup.role, edition).find(spec => spec.name === specName) : null;
        if (specName && !chosen) throw new Error("That spec does not fit your class and role for this raid.");
        const before = signupDpsKind(signup, edition);
        const after = signupDpsKind({ ...signup, spec: chosen?.name ?? null }, edition);
        if (signup.status === "SIGNED_UP" && signup.role === "DPS" && after && after !== before) {
          const room = (await dpsKindRoom(raid, tx, memberId))[after];
          if (room !== null && room <= 0) throw new DpsKindFullError(after);
        }
        const saved = await tx.raidSignup.update({ where: { id: signup.id }, data: { spec: chosen?.name ?? null } });
        const promoted = signup.status === "SIGNED_UP" && before !== after ? await promoteWaitlist(raidId, tx) : [];
        return Object.assign(saved, { kind: after, promoted, chosen: chosen ?? null });
      });
    },

    // Other raids the member is also down for (signed up, waitlisted or maybe) that start within
    // CLASH_WINDOW_MS of this one: someone in two cores whose raid nights overlap.
    async clashingSignups(raidId: string, guildId: string, memberId: string) {
      const raid = await getRaid(raidId, guildId);
      const at = raid.scheduledAt.getTime();
      return database.raidSignup.findMany({
        where: {
          memberId, raidId: { not: raidId }, status: { in: ["SIGNED_UP", "WAITLISTED", "MAYBE"] },
          raid: { guildId, status: { in: ["PLANNED", "ACTIVE"] }, scheduledAt: { gt: new Date(at - CLASH_WINDOW_MS), lt: new Date(at + CLASH_WINDOW_MS) } }
        },
        include: { raid: { select: { id: true, title: true, scheduledAt: true } } },
        orderBy: { raid: { scheduledAt: "asc" } }
      });
    },

    // Everyone not cancelled, for the embed: signed up, maybe, waitlist.
    async signups(raidId: string, guildId: string) {
      await getRaid(raidId, guildId);
      return database.raidSignup.findMany({
        where: { raidId, status: { not: "CANCELLED" } },
        // The member's main character tells melee from ranged when a signup names no character.
        include: { member: { include: { characters: { where: { isMain: true }, take: 1, select: { className: true, spec: true } } } }, character: { select: SIGNUP_CHARACTER_SELECT } },
        orderBy: { signedUpAt: "asc" }
      });
    },

    async cancelSignup(raidId: string, guildId: string, memberId: string) {
      return locked(raidId, async tx => {
        const raid = await getRaid(raidId, guildId, tx);
        if (raid.status === "COMPLETED" || raid.status === "CANCELLED") {
          throw new Error("This raid is no longer accepting signup changes.");
        }
        const signup = await tx.raidSignup.findUnique({ where: { raidId_memberId: { raidId, memberId } } });
        if (!signup || signup.status === "CANCELLED") throw new Error("You are not signed up for this raid.");
        const cancelled = await tx.raidSignup.update({
          where: { id: signup.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), characterId: null, late: false }
        });
        const promoted = signup.status === "SIGNED_UP" ? await promoteWaitlist(raidId, tx) : [];
        return { cancelled, promoted };
      });
    },

    // The Late button: flips the member's own "I'll be late" on a planned raid. Null when
    // they have no active signup (they pick a role first). Allowed after the signup deadline.
    async toggleLate(raidId: string, guildId: string, memberId: string) {
      return locked(raidId, async tx => {
        const raid = await getRaid(raidId, guildId, tx);
        if (raid.status !== "PLANNED") throw new Error("Signups are closed for this raid.");
        const signup = await tx.raidSignup.findUnique({ where: { raidId_memberId: { raidId, memberId } } });
        if (!signup || signup.status === "CANCELLED") return null;
        return tx.raidSignup.update({ where: { id: signup.id }, data: { late: !signup.late } });
      });
    },

    getStatus(raidId: string, guildId: string) {
      return database.raid.findFirst({
        where: { id: raidId, guildId },
        include: {
          bosses: { orderBy: { sortOrder: "asc" } },
          notes: { orderBy: { createdAt: "asc" } },
          _count: { select: { signups: true, attendance: true } }
        }
      }).then((raid) => {
        if (!raid) throw new Error("Raid not found in this guild.");
        return raid;
      });
    },

    // Officer notes: general, per boss, or "improve next time".
    async addNote(raidId: string, guildId: string, body: string, createdBy: string, bossName?: string) {
      const text = body.trim();
      if (text.length < 2) throw new Error("Write a note first.");
      const raid = await database.raid.findFirst({ where: { id: raidId, guildId }, select: { id: true } });
      if (!raid) throw new Error("Raid not found in this guild.");
      return database.raidNote.create({
        data: { raidId, body: text.slice(0, 1000), createdBy, bossName: bossName?.trim() || null }
      });
    },

    async roster(raidId: string, guildId: string): Promise<Array<Prisma.RaidSignupGetPayload<{ include: { member: true } }>>> {
      await getRaid(raidId, guildId);
      return database.raidSignup.findMany({
        where: { raidId, status: { in: activeSignupStatuses } },
        include: { member: true },
        orderBy: { signedUpAt: "asc" }
      });
    },

    async start(raidId: string, guildId: string) {
      const raid = await getRaid(raidId, guildId);
      if (raid.status !== "PLANNED") throw new Error("Only planned raids can be started.");
      return database.raid.update({
        where: { id: raid.id },
        data: { status: "ACTIVE", startedAt: new Date() }
      });
    },

    async end(raidId: string, guildId: string) {
      const raid = await getRaid(raidId, guildId);
      if (raid.status !== "ACTIVE") throw new Error("Only active raids can be ended.");
      return database.raid.update({
        where: { id: raid.id },
        data: { status: "COMPLETED", endedAt: new Date() }
      });
    },

    // Voice attendance: adds PRESENT only where nothing is recorded yet, in one insert that skips
    // existing rows, so an officer's correction made meanwhile is never overwritten. Returns how many were added.
    async recordPresentIfMissing(raidId: string, guildId: string, memberIds: string[], recordedBy: string, notes: string) {
      const raid = await getRaid(raidId, guildId);
      if (raid.status !== "ACTIVE" && raid.status !== "COMPLETED") {
        throw new Error("Attendance can only be recorded for an active or completed raid.");
      }
      if (!memberIds.length) return 0;
      const created = await database.raidAttendance.createMany({
        data: memberIds.map((memberId) => ({ raidId, memberId, status: "PRESENT" as const, recordedBy, notes })),
        skipDuplicates: true
      });
      return created.count;
    },

    async recordAttendance(input: {
      raidId: string;
      guildId: string;
      memberId: string;
      status: RaidAttendanceStatus;
      recordedBy: string;
      notes?: string;
    }) {
      const raid = await getRaid(input.raidId, input.guildId);
      if (raid.status !== "ACTIVE" && raid.status !== "COMPLETED") {
        throw new Error("Attendance can only be recorded for an active or completed raid.");
      }
      return database.raidAttendance.upsert({
        where: { raidId_memberId: { raidId: input.raidId, memberId: input.memberId } },
        create: {
          raidId: input.raidId,
          memberId: input.memberId,
          status: input.status,
          recordedBy: input.recordedBy,
          ...(input.notes === undefined ? {} : { notes: input.notes.trim() || null })
        },
        update: {
          status: input.status,
          recordedBy: input.recordedBy,
          ...(input.notes === undefined ? {} : { notes: input.notes.trim() || null })
        }
      });
    },

    async setBossStatus(raidId: string, guildId: string, bossId: string, status: RaidBossStatus) {
      await getRaid(raidId, guildId);
      const boss = await database.raidBoss.findFirst({ where: { id: bossId, raidId } });
      if (!boss) throw new Error("Boss not found for this raid.");
      return database.raidBoss.update({
        where: { id: boss.id },
        data: { status, killedAt: status === "KILLED" ? new Date() : null }
      });
    }
  };
}

export type RaidService = ReturnType<typeof createRaidService>;
export type RaidStatusValue = RaidStatus;
