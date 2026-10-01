import type {
  Prisma,
  PrismaClient,
  RaidSignupStatus,
  RaidAttendanceStatus,
  RaidBossStatus,
  RaidStatus,
  RaidRole
} from "@prisma/client";

const activeSignupStatuses: RaidSignupStatus[] = ["SIGNED_UP"];

// Two raids starting less than this apart can't both be done (a raid night is about 3 hours).
export const CLASH_WINDOW_MS = 4 * 3_600_000;

const roleCapField: Record<RaidRole, "tankLimit" | "healerLimit" | "dpsLimit"> = {
  TANK: "tankLimit",
  HEALER: "healerLimit",
  DPS: "dpsLimit"
};

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
  // Create the raid for a raid core: its members get signup priority.
  coreId?: string;
  repeatWeekly?: boolean;
}

export type SignupAvailability = "AVAILABLE" | "MAYBE";

type RaidDb = Pick<PrismaClient, "raid" | "raidSignup" | "raidCoreMember">;

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

  async function coreMemberIds(coreId: string, tx: RaidDb = database): Promise<Set<string>> {
    // Main players only: the bench (replacements) gets no signup priority.
    const rows = await tx.raidCoreMember.findMany({ where: { coreId, bench: false }, select: { memberId: true } });
    return new Set(rows.map((row) => row.memberId));
  }

  // Fills open role slots from the waitlist, earliest signup first. Runs
  // after a cancellation or a cap change. Returns who was promoted.
  async function promoteWaitlist(raidId: string, tx: RaidDb = database) {
    const raid = await tx.raid.findUnique({ where: { id: raidId } });
    if (!raid || raid.status !== "PLANNED") return [];
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
        const coreIds = await coreMemberIds(raid.coreId, tx);
        waiting.sort((a, b) => Number(coreIds.has(b.memberId)) - Number(coreIds.has(a.memberId)) || a.signedUpAt.getTime() - b.signedUpAt.getTime());
      }
      const taken = cap === null ? 0 : await tx.raidSignup.count({ where: { raidId, role, status: "SIGNED_UP" } });
      const open = cap === null ? waiting.length : Math.max(0, cap - taken);
      for (const signup of waiting.slice(0, open)) {
        await tx.raidSignup.update({ where: { id: signup.id }, data: { status: "SIGNED_UP" } });
        promoted.push(signup);
      }
    }
    return promoted;
  }

  return {
    async create(input: CreateRaidInput) {
      if (input.title.trim().length < 3) throw new Error("Raid title must be at least 3 characters.");
      if (input.scheduledAt.getTime() <= Date.now()) throw new Error("Raid time must be in the future.");
      for (const [label, limit] of [["Tank", input.tankLimit], ["Healer", input.healerLimit], ["DPS", input.dpsLimit]] as const) {
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          throw new Error(`${label} limit must be a non-negative integer.`);
        }
      }
      const bosses = input.bosses?.map((name) => name.trim()).filter(Boolean) ?? [];
      if (input.coreId) {
        const core = await database.raidCore.findFirst({ where: { id: input.coreId, guildId: input.guildId }, select: { id: true } });
        if (!core) throw new Error("That raid core was not found in this guild.");
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
          tankLimit: input.tankLimit ?? null,
          healerLimit: input.healerLimit ?? null,
          dpsLimit: input.dpsLimit ?? null,
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
          tankLimit: raid.tankLimit, healerLimit: raid.healerLimit, dpsLimit: raid.dpsLimit, repeatWeekly: true,
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
        for (const limit of [input.tankLimit, input.healerLimit, input.dpsLimit]) {
          if (limit != null && (!Number.isInteger(limit) || limit < 0)) {
            throw new Error("Role limits must be non-negative integers.");
          }
        }
        const updated = await tx.raid.update({
          where: { id: raid.id },
          data: {
            ...(input.title === undefined ? {} : { title: input.title.trim() }),
            ...(input.description === undefined ? {} : { description: input.description?.trim() || null }),
            ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
            ...(input.tankLimit === undefined ? {} : { tankLimit: input.tankLimit }),
            ...(input.healerLimit === undefined ? {} : { healerLimit: input.healerLimit }),
            ...(input.dpsLimit === undefined ? {} : { dpsLimit: input.dpsLimit })
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
    async signup(raidId: string, guildId: string, memberId: string, role: RaidRole, availability: SignupAvailability = "AVAILABLE") {
      return locked(raidId, async tx => {
        const raid = await getRaid(raidId, guildId, tx);
        if (raid.status !== "PLANNED") throw new Error("Signups are closed for this raid.");
        let status: RaidSignupStatus = availability === "MAYBE" ? "MAYBE" : "SIGNED_UP";
        const cap = raid[roleCapField[role]];
        let bumped: Prisma.RaidSignupGetPayload<{ include: { member: true } }> | null = null;
        if (status === "SIGNED_UP" && cap !== null) {
          const count = await tx.raidSignup.count({
            where: { raidId, role, status: "SIGNED_UP", memberId: { not: memberId } }
          });
          if (count >= cap) {
            status = "WAITLISTED";
            // Core priority: a core member takes the slot of the most recent
            // non-core signup in that role, who goes to the front of the waitlist.
            if (raid.coreId && (await coreMemberIds(raid.coreId, tx)).has(memberId)) {
              const coreIds = await coreMemberIds(raid.coreId, tx);
              const candidates = await tx.raidSignup.findMany({
                where: { raidId, role, status: "SIGNED_UP", memberId: { not: memberId } },
                include: { member: true },
                orderBy: { signedUpAt: "desc" }
              });
              const victim = candidates.find((signup) => !coreIds.has(signup.memberId));
              if (victim) {
                await tx.raidSignup.update({ where: { id: victim.id }, data: { status: "WAITLISTED" } });
                bumped = { ...victim, status: "WAITLISTED" };
                status = "SIGNED_UP";
              }
            }
          }
        }
        const saved = await tx.raidSignup.upsert({
          where: { raidId_memberId: { raidId, memberId } },
          create: { raidId, memberId, role, status },
          update: { status, role, signedUpAt: new Date(), cancelledAt: null }
        });
        return Object.assign(saved, { bumped });
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
        include: { member: true },
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
          data: { status: "CANCELLED", cancelledAt: new Date() }
        });
        const promoted = signup.status === "SIGNED_UP" ? await promoteWaitlist(raidId, tx) : [];
        return { cancelled, promoted };
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
