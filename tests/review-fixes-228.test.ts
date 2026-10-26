import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";

// Codex's review of PR #228: replies within Discord's 2,000 characters, voice attendance that never
// overwrites an officer's correction, and acknowledgement before slow work.
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  edition: "classic-era",
  tx: {} as Record<string, unknown>,
  settings: { language: "en", timezone: "UTC", characterSignups: false } as Record<string, unknown>
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.tx }));
vi.mock("../src/services/edition-context.js", () => ({ currentEdition: () => mocks.edition, withEdition: (_e: string, work: () => unknown) => work() }));
vi.mock("../src/services/discord-jobs.js", () => ({ enqueueDiscordJob: vi.fn(async () => ({ id: "job" })), deliverDiscordJob: vi.fn(async () => undefined), dispatchDiscordJob: vi.fn() }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: vi.fn(async () => { mocks.calls.push("db:context"); return { guildId: "g", memberId: "m" }; }),
  guildService: {
    ensureGuild: vi.fn(async () => { mocks.calls.push("db:guild"); return { id: "g" }; }),
    ensureMember: vi.fn(async () => { mocks.calls.push("db:member"); return { id: "m" }; }),
    getSettings: vi.fn(async () => { mocks.calls.push("db:settings"); return mocks.settings; })
  }
}));

import { executeWorldBuff, worldBuffListText } from "../src/commands/world-buffs.js";
import { worldBuffLine } from "../src/services/world-buffs.js";
import { nameList, voiceAttendanceSummary } from "../src/services/voice-attendance.js";
import { createRaidService } from "../src/services/raid.js";
import { handleRaidSignupButton, RAID_SIGNUP_PREFIX } from "../src/commands/raid.js";

beforeEach(() => { mocks.calls.length = 0; mocks.edition = "classic-era"; mocks.settings["characterSignups"] = false; });

describe("bounded replies", () => {
  it("a full world-buff list of maximum-length drops stays under 2,000 characters, whole lines only", () => {
    const drop = { id: "d", buff: "ONYXIA", dropsAt: new Date("2026-11-10T20:00:00Z"), location: "L".repeat(60), note: "N".repeat(120), createdBy: "123456789012345678" };
    const lines = Array.from({ length: 15 }, () => worldBuffLine(drop, "fr"));
    const text = worldBuffListText("Prochains buffs mondiaux (dans votre fuseau horaire)", lines, "none");
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/… \+\d+$/);
    expect(text.split("\n").slice(1, -1).every((line) => line === lines[0])).toBe(true);
  });
  it("a voice summary with long name lists stays under 2,000 characters", () => {
    const names = Array.from({ length: 60 }, (_, i) => `${"X".repeat(29)}${String(i).padStart(3, "0")}`);
    const text = voiceAttendanceSummary({ raid: "R".repeat(200), channel: "C".repeat(100), marked: 40, kept: 3, strangers: names, missing: names });
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain("Kept 3 attendance record(s)");
    expect(nameList(["a", "b", "c"], 100)).toBe("a, b, c");
    expect(nameList(["aaaa", "bbbb", "cccc"], 10)).toBe("aaaa +2");
  });
});

describe("voice attendance never overwrites a correction", () => {
  it("inserts only missing rows, skipping one an officer recorded after the snapshot", async () => {
    const rows = new Map<string, string>();
    const createMany = vi.fn(async ({ data, skipDuplicates }: { data: { memberId: string; status: string }[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const row of data) if (!(skipDuplicates && rows.has(row.memberId))) { rows.set(row.memberId, row.status); count++; }
      return { count };
    });
    const database = { raid: { findFirst: vi.fn(async () => ({ id: "r", guildId: "g", status: "ACTIVE" })) }, raidAttendance: { createMany, upsert: vi.fn(), update: vi.fn() } };
    // The plan was made when nobody was recorded; an officer then marked "late" LATE.
    rows.set("late", "LATE");
    const added = await createRaidService(database as never).recordPresentIfMissing("r", "g", ["early", "late"], "officer", "voice: Raid");
    expect(added).toBe(1);
    expect(rows.get("late")).toBe("LATE");
    expect(rows.get("early")).toBe("PRESENT");
    expect(createMany.mock.calls[0]![0].skipDuplicates).toBe(true);
    expect(database.raidAttendance.upsert).not.toHaveBeenCalled();
    expect(database.raidAttendance.update).not.toHaveBeenCalled();
  });
  it("refuses a raid that is not active or completed", async () => {
    const database = { raid: { findFirst: vi.fn(async () => ({ id: "r", guildId: "g", status: "PLANNED" })) }, raidAttendance: { createMany: vi.fn() } };
    await expect(createRaidService(database as never).recordPresentIfMissing("r", "g", ["m"], "o", "voice")).rejects.toThrow(/active or completed/);
  });
});

function interaction(subcommand: string, options: Record<string, string | boolean | null> = {}) {
  const record = (name: string) => vi.fn(async (...args: unknown[]) => { mocks.calls.push(name); return args; });
  return {
    guildId: "1", guild: { id: "1", name: "S" }, member: { roles: { cache: new Map() }, permissions: { has: () => false } }, user: { id: "u" },
    options: { getSubcommand: () => subcommand, getString: (n: string) => options[n] ?? null, getBoolean: (n: string) => options[n] ?? null },
    deferReply: record("deferReply"), editReply: record("editReply"), reply: record("reply"), deleteReply: record("deleteReply"), followUp: record("followUp")
  };
}

describe("acknowledge before slow work", () => {
  it("world-buff commands defer before any database work, with the right visibility", async () => {
    mocks.tx["worldBuffDrop"] = { findMany: vi.fn(async () => { mocks.calls.push("db:list"); return []; }), deleteMany: vi.fn(), create: vi.fn() };
    const list = interaction("list");
    await executeWorldBuff(list as never);
    expect(mocks.calls[0]).toBe("deferReply");
    expect(list.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    mocks.calls.length = 0;
    const posted = interaction("list", { post: true });
    await executeWorldBuff(posted as never);
    expect(posted.deferReply).toHaveBeenCalledWith({});
  });
  it("a mistaken drop is answered privately, never in the public placeholder", async () => {
    const add = interaction("add", { buff: "ONYXIA", time: "yesterday at noon??" });
    await executeWorldBuff(add as never);
    expect(add.deleteReply).toHaveBeenCalled();
    expect(add.followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect(add.editReply).not.toHaveBeenCalled();
  });
  it("unsupported editions get a private answer without deferring or touching the database", async () => {
    mocks.edition = "retail";
    const list = interaction("list");
    await executeWorldBuff(list as never);
    expect(mocks.calls).toEqual(["reply"]);
  });
  it("the Late button acknowledges before the guild lookup and the raid lock", async () => {
    Object.assign(mocks.tx, {
      $transaction: async (work: (tx: unknown) => unknown) => work(mocks.tx), $executeRaw: async () => 0,
      raid: { findFirst: vi.fn(async () => { mocks.calls.push("db:raid"); return { id: "r", guildId: "g", status: "PLANNED" }; }) },
      raidSignup: { findUnique: vi.fn(async () => ({ id: "s", status: "SIGNED_UP", late: false })), update: vi.fn(async ({ data }) => ({ id: "s", ...data })) }
    });
    const button = { ...interaction("x"), customId: `${RAID_SIGNUP_PREFIX}r:LATE`, deferred: false, replied: false };
    button.deferReply = vi.fn(async () => { mocks.calls.push("deferReply"); button.deferred = true; return []; });
    await handleRaidSignupButton(button as never).catch(() => undefined);
    expect(mocks.calls.indexOf("deferReply")).toBe(0);
    expect(mocks.calls.indexOf("deferReply")).toBeLessThan(mocks.calls.indexOf("db:raid"));
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("late") }));
  });
});
