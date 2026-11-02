import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PermissionFlagsBits } from "discord.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleOfficerButton, handleOfficerModal, officerAccess, resolveRole, type OfficerDeps } from "../src/commands/officer-tools.js";
import { applicationChannelOverwrites, coreApplicationChannelName } from "../src/services/core-channels.js";
import { applicationChannelFor } from "../src/services/notify.js";
import { officerId, parseOfficerId, parseOfficerModalId, officerModalId } from "../src/services/officer-buttons.js";

const future = new Date(Date.now() + 86_400_000);
const raid = { id: "r1", guildId: "g1", title: "Karazhan", status: "PLANNED", scheduledAt: future, signupsCloseAt: null as Date | null, description: null, tankLimit: null, healerLimit: null, dpsLimit: null, signupChannelId: null };
const core = { id: "c1", guildId: "g1", name: "Tuesday", schedule: null, lootRulesNote: null, officerRoleId: null, archivedAt: null as Date | null, applicationChannelId: null as string | null };

function click(customId: string, officer: boolean) {
  return {
    customId, replied: false, deferred: false, guild: { id: "d1", name: "Q", roles: { cache: new Map() } },
    member: { permissions: { has: () => officer }, roles: { cache: { some: () => false } } },
    user: { id: "u1" }, client: {},
    reply: vi.fn(async () => undefined), update: vi.fn(async () => undefined), deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined), showModal: vi.fn(async () => undefined)
  };
}

function setup(rows: { raid?: unknown; core?: unknown } = {}) {
  const db = {
    raid: { findFirst: vi.fn(async () => rows.raid ?? null), update: vi.fn(async () => ({ ...raid })) },
    raidCore: { findFirst: vi.fn(async () => rows.core ?? null), update: vi.fn(async () => ({})) },
    raidSignup: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({})) }
  };
  const deps: OfficerDeps = {
    db: db as never, guildIdFor: async () => "g1", languageFor: async () => "en",
    refreshRaid: vi.fn(async () => undefined), refreshCore: vi.fn(async () => undefined)
  };
  return { db, deps };
}

describe("officer button ids", () => {
  it("round-trips", () => {
    expect(parseOfficerId(officerId("raid", "r1", "cancel-ok"))).toEqual({ kind: "raid", entityId: "r1", action: "cancel-ok" });
    expect(parseOfficerModalId(officerModalId("core", "c1"))).toEqual({ kind: "core", entityId: "c1" });
    expect(parseOfficerId("raidsignup:r1:DPS")).toBeNull();
  });
});

describe("officer permissions", () => {
  it("rejects a member click before touching the database, for every action", async () => {
    for (const action of ["menu", "edit", "cancel", "cancel-ok", "cancel-ping", "reopen", "lock", "unlock"] as const) {
      const { db, deps } = setup({ raid });
      const interaction = click(officerId("raid", "r1", action), false);
      await handleOfficerButton(interaction as never, deps);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
      expect(db.raid.findFirst).not.toHaveBeenCalled();
      expect(db.raid.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    }
    for (const action of ["menu", "edit", "archive-ok", "unarchive", "appchan"] as const) {
      const { db, deps } = setup({ core });
      await handleOfficerButton(click(officerId("core", "c1", action), false) as never, deps);
      expect(db.raidCore.findFirst).not.toHaveBeenCalled();
      expect(db.raidCore.update).not.toHaveBeenCalled();
    }
  });

  it("rejects a member's modal submission", async () => {
    const { db, deps } = setup({ raid });
    const interaction = { ...click(officerModalId("raid", "r1"), false), fields: { getTextInputValue: () => "x" } };
    await handleOfficerModal(interaction as never, deps);
    expect(db.raid.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it("treats a member without the Officer role as not an officer", () => {
    expect(officerAccess(click("x", false) as never)).toBe(false);
    expect(officerAccess(click("x", true) as never)).toBe(true);
    expect(officerAccess({ ...click("x", true), member: null } as never)).toBe(false);
  });

  it("looks the raid or core up inside the clicker's own server only", async () => {
    const { db, deps } = setup({});
    await handleOfficerButton(click(officerId("core", "c-other", "archive-ok"), true) as never, deps);
    expect(db.raidCore.findFirst).toHaveBeenCalledWith({ where: { id: "c-other", guildId: "g1" } });
    expect(db.raidCore.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
    const other = setup({});
    await handleOfficerButton(click(officerId("raid", "r-other", "lock"), true) as never, other.deps);
    expect(other.db.raid.findFirst).toHaveBeenCalledWith({ where: { id: "r-other", guildId: "g1" } });
    expect(other.db.raid.update).not.toHaveBeenCalled();
  });
});

describe("officer raid changes", () => {
  it("locks and unlocks signups with an audit entry", async () => {
    const { db, deps } = setup({ raid });
    await handleOfficerButton(click(officerId("raid", "r1", "lock"), true) as never, deps);
    expect(db.raid.update).toHaveBeenLastCalledWith({ where: { id: "r1" }, data: { signupsCloseAt: expect.any(Date) } });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ guildId: "g1", actorId: "u1", action: "RAID_OFFICER", entityId: "r1" }) });
    await handleOfficerButton(click(officerId("raid", "r1", "unlock"), true) as never, deps);
    expect(db.raid.update).toHaveBeenLastCalledWith({ where: { id: "r1" }, data: { signupsCloseAt: null } });
    expect(deps.refreshRaid).toHaveBeenCalledTimes(2);
  });

  it("asks for confirmation before cancelling and never pings on a plain cancel", async () => {
    const { db, deps } = setup({ raid });
    const ask = click(officerId("raid", "r1", "cancel"), true);
    await handleOfficerButton(ask as never, deps);
    expect(db.raid.update).not.toHaveBeenCalled();
    const rows = (ask.update.mock.calls[0] as unknown as [{ components: { toJSON(): { components: { custom_id: string }[] } }[] }])[0].components;
    expect(rows[0]!.toJSON().components.map(button => button.custom_id)).toEqual(["offt:raid:r1:cancel-ok", "offt:raid:r1:cancel-ping", "offt:raid:r1:menu"]);
    await handleOfficerButton(click(officerId("raid", "r1", "cancel-ok"), true) as never, deps);
    expect(db.raid.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "CANCELLED" } });
    expect(db.raidSignup.findMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "RAID_OFFICER", metadata: expect.objectContaining({ change: "cancel", ping: false }) }) });
  });

  it("only the ping confirmation looks up signed-up members", async () => {
    const { db, deps } = setup({ raid });
    await handleOfficerButton(click(officerId("raid", "r1", "cancel-ping"), true) as never, deps);
    expect(db.raidSignup.findMany).toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ ping: true }) }) });
  });

  it("reopens a cancelled raid only while its start is in the future", async () => {
    const reopen = setup({ raid: { ...raid, status: "CANCELLED" } });
    await handleOfficerButton(click(officerId("raid", "r1", "reopen"), true) as never, reopen.deps);
    expect(reopen.db.raid.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "PLANNED" } });
    const past = setup({ raid: { ...raid, status: "CANCELLED", scheduledAt: new Date(Date.now() - 1000) } });
    await handleOfficerButton(click(officerId("raid", "r1", "reopen"), true) as never, past.deps);
    expect(past.db.raid.update).not.toHaveBeenCalled();
  });
});

describe("officer core changes", () => {
  it("archives only after confirmation and audits it", async () => {
    const { db, deps } = setup({ core });
    await handleOfficerButton(click(officerId("core", "c1", "archive"), true) as never, deps);
    expect(db.raidCore.update).not.toHaveBeenCalled();
    await handleOfficerButton(click(officerId("core", "c1", "archive-ok"), true) as never, deps);
    expect(db.raidCore.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { archivedAt: expect.any(Date) } });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CORE_OFFICER", entityId: "c1" }) });
  });

  it("resolves the core officer role by name, mention or id", () => {
    const roles = { cache: { values: () => [{ id: "111111111111111111", name: "Tuesday Officers" }] } };
    expect(resolveRole("tuesday officers", roles)).toEqual({ id: "111111111111111111" });
    expect(resolveRole("<@&111111111111111111>", roles)).toEqual({ id: "111111111111111111" });
    expect(resolveRole("none", roles)).toEqual({ id: null });
    expect(resolveRole("Nobody", roles)).toBeNull();
  });
});

describe("per-core applications channel", () => {
  it("routes to the core's channel and falls back to the common channel, then the officer log", () => {
    const settings = { applicationChannelId: "common", logChannelId: "log" };
    expect(applicationChannelFor("core-channel", settings)).toBe("core-channel");
    expect(applicationChannelFor(null, settings)).toBe("common");
    expect(applicationChannelFor(undefined, { applicationChannelId: null, logChannelId: "log" })).toBe("log");
    expect(applicationChannelFor(null, null)).toBeNull();
  });

  it("makes an officers-only channel: hidden from everyone, open to officers, the core officer role and the bot", () => {
    const role = (id: string, name: string) => ({ id, name });
    const roles = [role("everyone", "@everyone"), role("gm", "Guild Master"), role("off", "Officer"), role("rl", "Raid Leader"), role("coreoff", "Tuesday Officers")];
    const guild = { roles: { everyone: roles[0], cache: { filter: (fn: (r: { id: string; name: string }) => boolean) => ({ values: () => roles.filter(fn) }), has: (id: string) => roles.some(r => r.id === id) } }, members: { me: { id: "bot" } } };
    const list = applicationChannelOverwrites(guild as never, "coreoff") as { id: string; allow?: bigint[]; deny?: bigint[] }[];
    const byId = new Map(list.map(entry => [entry.id, entry]));
    expect(byId.get("everyone")?.deny).toContain(PermissionFlagsBits.ViewChannel);
    for (const id of ["gm", "off", "coreoff", "bot"]) expect(byId.get(id)?.allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(byId.has("rl")).toBe(false);
  });

  it("names the channel after the core, in the guild's language", () => {
    expect(coreApplicationChannelName("Tuesday MC", "en")).toBe("tuesday-mc-applications");
    expect(coreApplicationChannelName("Tuesday MC", "fr")).toBe("tuesday-mc-candidatures");
  });
});

describe("officer core tools migration", () => {
  const database = new PGlite();
  beforeAll(async () => {
    await database.exec(`CREATE TYPE "AuditAction" AS ENUM ('CONFIG_UPDATED');
      CREATE TABLE "RaidCore" (id TEXT PRIMARY KEY, name TEXT NOT NULL, "attendanceChannelId" TEXT);
      INSERT INTO "RaidCore" VALUES ('old', 'Tuesday', 'att');`);
    await database.exec(readFileSync(new URL("../prisma/migrations/20261211000000_officer_core_tools/migration.sql", import.meta.url), "utf8"));
  });
  afterAll(() => database.close());
  it("keeps existing cores on the common channel and adds the audit actions", async () => {
    expect((await database.query('SELECT * FROM "RaidCore"')).rows).toEqual([
      { id: "old", name: "Tuesday", attendanceChannelId: "att", applicationChannelId: null, officerRoleId: null, lootRulesNote: null, archivedAt: null }]);
    expect((await database.query('SELECT unnest(enum_range(NULL::"AuditAction"))::text AS v')).rows.map(row => (row as { v: string }).v)).toEqual(["CONFIG_UPDATED", "RAID_OFFICER", "CORE_OFFICER"]);
  });
});
