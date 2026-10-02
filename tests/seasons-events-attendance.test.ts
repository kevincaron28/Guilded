import { describe, expect, it, vi } from "vitest";
import { ChannelType, type Client, type Guild } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { createCommunityService } from "../src/services/community.js";
import { cleanupPastRaidPosts, pastRaidPostWhere, stalePlannedBefore } from "../src/services/raid-post-cleanup.js";
import { buildRaidAttendance } from "../src/services/raid-report.js";
import { raidAttendanceEmbed } from "../src/commands/raid-report.js";
import { channelSpec } from "../src/setup-names.js";
import { ALL_CHANNELS, RETIRED_CHANNELS } from "../src/commands/setup.js";
import { configCommand } from "../src/commands/settings.js";
import { syncCoreLogChannels } from "../src/services/core-channels.js";
import { assertRealm, requiredRealm, sameRealm } from "../src/services/realm-check.js";

type Row = Record<string, unknown>;

function seasonStore(seasons: Row[], blockers = { activities: 0, evidence: 0, kudos: 0 }, configs: Row[] = []) {
  const jobs: Row[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    guildSettings: { findUnique: vi.fn(async () => ({ timezone: "America/Toronto", language: "fr" })) },
    communitySeason: {
      findMany: vi.fn(async () => seasons.filter(row => row["status"] === "ACTIVE" && row["monthly"]).map(row => ({ ...row, participation: configs.find(config => config["seasonId"] === row["id"]) ?? null }))),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(seasons.find(row => row["id"] === where["id"])!, data)),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `season-${seasons.length + 1}`, status: "ACTIVE", ...data }; seasons.push(row); return row; })
    },
    communityActivity: { count: vi.fn(async () => blockers.activities) },
    communityEntry: { count: vi.fn(async () => blockers.evidence) },
    communityKudos: { count: vi.fn(async () => blockers.kudos) },
    communityPoint: { findMany: vi.fn(async () => [{ userId: "a", amount: 30, kind: "AWARD" }]) },
    communitySeasonCounter: { upsert: vi.fn(async () => ({ nextNumber: 3 })) },
    communityParticipationConfig: { create: vi.fn(async ({ data }: { data: Row }) => { configs.push(data); return data; }) },
    discordJob: { upsert: vi.fn(async (args: { create: Row }) => { jobs.push(args.create); return args.create; }), updateMany: vi.fn(async () => ({ count: 1 })) }
  };
  const database = { ...tx, $transaction: <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx) };
  return { service: createCommunityService(database as unknown as PrismaClient), tx, seasons, configs, jobs };
}

const october = { id: "october", guildId: "guild", game: "DISCORD", name: "Octobre 2026", number: 1, channelId: "board", announcementChannelId: "hub", audienceRoleId: null, monthly: true, status: "ACTIVE", createdAt: new Date("2026-10-02T15:00:00Z") };

describe("monthly community seasons", () => {
  it("keeps the season during its month, in guild time", async () => {
    const { service, seasons } = seasonStore([{ ...october }]);
    // 31 October 23:30 in Toronto is already 1 November in UTC.
    expect(await service.rotateMonthly("guild", new Date("2026-11-01T03:30:00Z"))).toEqual([]);
    expect(seasons).toHaveLength(1);
  });

  it("archives it when the month is over and starts the next one with the same channels and rules", async () => {
    const rules = { textChannels: ["chat"], allVoice: true };
    const { service, seasons, configs, jobs } = seasonStore([{ ...october }], undefined, [{ seasonId: "october", enabled: true, rules }]);
    const rotated = await service.rotateMonthly("guild", new Date("2026-11-01T04:01:00Z"));
    expect(rotated).toHaveLength(1);
    expect(seasons[0]).toMatchObject({ status: "ENDED", finalStandings: [{ userId: "a", points: 30 }] });
    expect(seasons[1]).toMatchObject({ name: "Novembre 2026", number: 2, game: "DISCORD", channelId: "board", announcementChannelId: "hub", audienceRoleId: null, monthly: true, createdBy: "Guilded" });
    expect(configs[1]).toMatchObject({ seasonId: seasons[1]!["id"], enabled: true, rules });
    expect(JSON.stringify(jobs[0])).toContain("Novembre 2026");
    // The new season belongs to November: the next check changes nothing.
    seasons[1]!["createdAt"] = new Date("2026-11-01T04:01:00Z");
    expect(await service.rotateMonthly("guild", new Date("2026-11-15T12:00:00Z"))).toEqual([]);
  });

  it("waits while something is still open, and leaves a season that is not monthly alone", async () => {
    for (const blockers of [{ activities: 1, evidence: 0, kudos: 0 }, { activities: 0, evidence: 1, kudos: 0 }, { activities: 0, evidence: 0, kudos: 1 }]) {
      const { service, seasons } = seasonStore([{ ...october }], blockers);
      expect(await service.rotateMonthly("guild", new Date("2026-11-02T12:00:00Z"))).toEqual([]);
      expect(seasons[0]!["status"]).toBe("ACTIVE");
    }
    const manual = seasonStore([{ ...october, monthly: false }]);
    expect(await manual.service.rotateMonthly("guild", new Date("2026-12-02T12:00:00Z"))).toEqual([]);
  });
});

describe("past raid signup posts", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("selects raids over for a day, and planned raids nobody started", () => {
    const where = pastRaidPostWhere(now) as { AND: [unknown, { OR: Row[] }] };
    expect(where.AND[1].OR).toEqual([
      { status: "COMPLETED", endedAt: { lte: new Date("2026-10-09T12:00:00Z") } },
      { status: "CANCELLED", updatedAt: { lte: new Date("2026-10-09T12:00:00Z") } },
      { status: "PLANNED", scheduledAt: { lte: new Date("2026-10-09T06:00:00Z") } }
    ]);
    expect(stalePlannedBefore(now)).toEqual(new Date("2026-10-09T06:00:00Z"));
  });

  it("deletes both posts, forgets a post that is already gone and retries one it could not delete", async () => {
    const deleted: string[] = [];
    const channel = (id: string) => ({ isTextBased: () => true, messages: { delete: vi.fn(async (message: string) => {
      if (message === "gone") throw Object.assign(new Error("Unknown Message"), { code: 10008 });
      if (message === "locked") throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
      deleted.push(`${id}:${message}`);
    }) } });
    const guild = { channels: { fetch: vi.fn(async (id: string) => channel(id)) } };
    const client = { guilds: { cache: new Map([["discord", guild]]) } } as unknown as Client;
    const raid = (id: string, signupMessageId: string | null, mirrorSignupMessageId: string | null) => ({ id, guild: { discordId: "discord" }, signupChannelId: "general", signupMessageId, mirrorSignupChannelId: "core", mirrorSignupMessageId });
    const updates: Row[] = [];
    const update = vi.fn(async (args: Row) => { updates.push(args); return {}; });
    const database = { raid: { findMany: vi.fn(async () => [raid("a", "one", "two"), raid("b", "gone", null), raid("c", "locked", null)]), update } } as unknown as PrismaClient;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await cleanupPastRaidPosts(client, database, now)).toBe(2);
    expect(deleted).toEqual(["general:one", "core:two"]);
    expect(updates).toEqual([
      { where: { id: "a" }, data: { signupMessageId: null, mirrorSignupMessageId: null } },
      { where: { id: "b" }, data: { signupMessageId: null } }
    ]);
  });
});

describe("raid reports and loot logs live in each core's category", () => {
  it("no longer creates or offers server-wide ones, but uninstall still finds old ones", () => {
    expect(ALL_CHANNELS).not.toContain("raidLogChannelId");
    expect(ALL_CHANNELS).not.toContain("lootChannelId");
    expect(RETIRED_CHANNELS).toEqual(["raidLogChannelId", "lootChannelId"]);
    expect(ALL_CHANNELS).toContain("attendanceChannelId");
    const choices = JSON.stringify(configCommand.toJSON());
    expect(choices).not.toContain("raid-log-channel");
    expect(choices).not.toContain("loot-channel");
  });

  it("syncs a core's loot and report channels with its category, and leaves moved or synced ones alone", async () => {
    const lock = vi.fn(async () => undefined);
    const text = (parentId: string | null, permissionsLocked: boolean) => ({ type: ChannelType.GuildText, parentId, permissionsLocked, lockPermissions: lock });
    const channels: Record<string, unknown> = { loot: text("category", false), reports: text("category", true), moved: text("elsewhere", false) };
    const guild = { channels: { fetch: vi.fn(async (id: string) => channels[id] ?? null) } } as unknown as Guild;
    expect(await syncCoreLogChannels(guild, { categoryId: "category", lootChannelId: "loot", raidLogChannelId: "reports" })).toBe(1);
    expect(await syncCoreLogChannels(guild, { categoryId: "category", lootChannelId: "moved", raidLogChannelId: null })).toBe(0);
    expect(await syncCoreLogChannels(guild, { categoryId: null, lootChannelId: "loot", raidLogChannelId: "reports" })).toBe(0);
    expect(lock).toHaveBeenCalledTimes(1);
  });
});

describe("one realm per core and per raid", () => {
  it("uses the realm an officer set, else the one the characters already share", () => {
    expect(requiredRealm("Thunderstrike", ["Spineshatter"])).toBe("Thunderstrike");
    expect(requiredRealm(null, ["Thunderstrike", "thunderstrike", null])).toBe("Thunderstrike");
    expect(requiredRealm(null, ["Thunderstrike", "Spineshatter"])).toBeNull();
    expect(requiredRealm(null, [])).toBeNull();
    expect(requiredRealm("  ", [undefined])).toBeNull();
  });

  it("compares realms without caring about case, spaces, accents or apostrophes", () => {
    expect(sameRealm("Mal'Ganis", "malganis")).toBe(true);
    expect(sameRealm("Living Flame", "LivingFlame")).toBe(true);
    expect(sameRealm("Thunderstrike", "Spineshatter")).toBe(false);
  });

  it("refuses a character from another realm with both names, and accepts when nothing is required", () => {
    const character = { name: "Thrall", realm: "Spineshatter" };
    expect(() => assertRealm(character, "Thunderstrike", "Core A")).toThrow(/Thrall .*Spineshatter.*Core A.*Thunderstrike/);
    expect(() => assertRealm(character, "spineshatter", "Core A")).not.toThrow();
    expect(() => assertRealm(character, null, "Core A")).not.toThrow();
  });
});

describe("raid attendance for officers", () => {
  it("is an officers-only setup channel in both languages", () => {
    expect(channelSpec("attendanceChannelId", "en")).toMatchObject({ name: "raid-attendance", access: "officers", category: "officers" });
    expect(channelSpec("attendanceChannelId", "fr").name).toBe("presences-raid");
  });

  it("lists members by status, with signups nobody recorded", async () => {
    const member = (id: string) => ({ memberId: id, member: { discordUserId: `d-${id}` } });
    const database = { raid: { findFirst: vi.fn(async () => ({ title: "Raid — Core A",
      attendance: [{ ...member("a"), status: "PRESENT" }, { ...member("b"), status: "LATE" }, { ...member("c"), status: "ABSENT" }, { ...member("d"), status: "BENCHED" }],
      signups: [member("a"), member("e")] })) } } as unknown as PrismaClient;
    const list = await buildRaidAttendance(database, "guild", "raid");
    expect(list).toEqual({ title: "Raid — Core A", present: ["d-a"], late: ["d-b"], benched: ["d-d"], absent: ["d-c"], unrecorded: ["d-e"] });
    const fields = raidAttendanceEmbed(list, "fr").toJSON().fields!;
    expect(fields.map(field => field.name)).toEqual(["✅ Présents (1)", "⏰ En retard (1)", "🪑 Sur le banc (1)", "❌ Absents (1)", "❓ Inscrits, non notés (1)"]);
    expect(fields[0]!.value).toBe("<@d-a>");
  });

  it("stays inside Discord's field limit for a full raid and says so when nothing was recorded", () => {
    const many = Array.from({ length: 80 }, (_, index) => `${100000000000000000n + BigInt(index)}`);
    const embed = raidAttendanceEmbed({ title: "Raid", present: many, late: [], benched: [], absent: [], unrecorded: [] }, "en").toJSON();
    expect(embed.fields![0]!.value.length).toBeLessThanOrEqual(1024);
    expect(embed.fields![0]!.name).toBe("✅ Present (80)");
    expect(raidAttendanceEmbed({ title: "Raid", present: [], late: [], benched: [], absent: [], unrecorded: [] }, "en").toJSON().description).toContain("No attendance");
  });
});
