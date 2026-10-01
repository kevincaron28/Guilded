import { createRaidService } from "../src/services/raid.js";
import { createDungeonGroupService } from "../src/services/dungeon-group.js";
import { runBackup } from "../src/services/backup.js";
import { deliverDiscordJob, enqueueDiscordJob } from "../src/services/discord-jobs.js";
import { startSeason } from "../src/services/dungeon-admin.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { relayProfessions } from "../src/services/profession-relay.js";
import { fillCoreWeeklyRaids, saveCoreWeeklySchedule } from "../src/services/core-weekly-raids.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createAddonImportService } from "../src/services/addon-import.js";
const url = new URL(process.env["DATABASE_URL"] ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local test database required.");
const database = new PrismaClient();
try {
  if (process.argv.includes("--restored")) {
    const sum = await database.epgpTransaction.aggregate({ where: { createdBy: "release-test" }, _sum: { epAmount: true } });
    assert.equal(sum._sum.epAmount, 20);
    const character = await database.character.findFirstOrThrow({ where: { name: "ReleaseAnn" } });
    assert.equal(character.professionsUpdatedAt?.toISOString(), "2026-09-30T10:00:00.000Z");
    assert.equal(await database.professionSkill.count({ where: { characterId: character.id, profession: "Mining" } }), 1);
    const raid = await database.raid.findFirstOrThrow({ where: { title: "Release mirrored raid" } });
    assert.equal(raid.mirrorSignupMessageId, "core-message");
    assert.equal((await database.raidCore.findUniqueOrThrow({ where: { id: raid.coreId! } })).lootChannelId, "core-loot");
    const weekly = await database.raidCore.findFirstOrThrow({ where: { name: "Weekly release fixture" } });
    assert.equal(weekly.weeklySchedule, null); // paused schedule survives restore
    assert.equal(await database.raid.count({ where: { coreId: weekly.id, weeklyOccurrence: { not: null } } }), 4);
    assert.equal((await database.discordJob.findFirstOrThrow({ where: { key: "release-test-board" } })).status, "DONE");
    const final = await database.dungeonSeason.findFirstOrThrow({ where: { name: "Release season" } });
    assert.equal((final.finalStandings as { points: number }[])[0]?.points, 100);
  } else {
    await database.guild.deleteMany({ where: { discordId: { startsWith: "release-test-" } } });
    const guild = await database.guild.create({ data: { discordId: "release-test-guild", name: "Release fixture" } });
    const member = await database.member.create({ data: { guildId: guild.id, discordUserId: "release-test-member", displayName: "Ann" } });
    const contender = await database.member.create({ data: { guildId: guild.id, discordUserId: "release-test-contender", displayName: "Bob" } });
    const job = await enqueueDiscordJob(database, guild.id, "release-test-board", "DUNGEON_BOARD");
    let sends = 0;
    await Promise.all([1, 2].map(() => deliverDiscordJob(database, job.id, async () => { sends++; })));
    assert.equal(sends, 1);
    await enqueueDiscordJob(database, guild.id, "release-test-board", "DUNGEON_BOARD");
    await deliverDiscordJob(database, job.id, async () => { await enqueueDiscordJob(database, guild.id, "release-test-board", "DUNGEON_BOARD"); });
    assert.equal((await database.discordJob.findUniqueOrThrow({ where: { id: job.id } })).status, "PENDING");
    await database.discordJob.update({ where: { id: job.id }, data: { lockedUntil: new Date(0), leaseToken: "expired-process" } });
    await deliverDiscordJob(database, job.id, async () => {});
    assert.equal((await database.discordJob.findUniqueOrThrow({ where: { id: job.id } })).status, "DONE");
    const season = await database.dungeonSeason.create({ data: { guildId: guild.id, name: "Release season" } });
    await database.dungeonPointTransaction.createMany({ data: [member, contender].map(player => ({ guildId: guild.id, memberId: player.id, seasonId: season.id, amount: 100, reason: "Release fixture", source: "release-test", createdBy: "release-test" })) });
    await startSeason(database, guild.id, "Next release season");
    const closed = await database.dungeonSeason.findUniqueOrThrow({ where: { id: season.id } });
    assert.equal((closed.finalStandings as unknown[]).length, 2);
    assert.ok(closed.rulesSnapshot);
    assert.equal(await database.dungeonAchievement.count({ where: { seasonId: season.id } }), 2);
    const groups = createDungeonGroupService(database);
    const group = await groups.create({ guildId: guild.id, title: "Concurrent dungeon", leaderId: member.id, channelId: null });
    const contenders = await Promise.all([groups.join(group.id, guild.id, member.id, "TANK"), groups.join(group.id, guild.id, contender.id, "TANK")]);
    assert.equal(contenders.filter(result => result.signup.status === "SIGNED_UP").length, 1);
    assert.equal(contenders.filter(result => result.signup.status === "WAITLISTED").length, 1);
    const backupDirectory = await mkdtemp(join(tmpdir(), "guilded-release-backup-"));
    try {
      const copy = await runBackup(database, new Date(), backupDirectory);
      const backup = JSON.parse(gunzipSync(await readFile(join(backupDirectory, copy!.file))).toString("utf8"));
      assert.ok(backup.tables.Guild.some((row: { id: string }) => row.id === guild.id));
      assert.equal(backup.tables.DungeonGroupSignup.filter((row: { groupId: string }) => row.groupId === group.id).length, 2);
    } finally { await rm(backupDirectory, { recursive: true, force: true }); }
    const raids = createRaidService(database);
    const capped = await raids.create({ guildId: guild.id, title: "Concurrent raid", scheduledAt: new Date(Date.now() + 86400000), createdBy: "release-test", tankLimit: 1 });
    const raidContenders = await Promise.all([raids.signup(capped.id, guild.id, member.id, "TANK"), raids.signup(capped.id, guild.id, contender.id, "TANK")]);
    assert.equal(raidContenders.filter(result => result.status === "SIGNED_UP").length, 1);
    assert.equal(raidContenders.filter(result => result.status === "WAITLISTED").length, 1);
    const character = await database.character.create({ data: { memberId: member.id, name: "ReleaseAnn", realm: "ReleaseTest", className: "Warrior" } });
    const core = await database.raidCore.create({ data: { guildId: guild.id, name: "Core A", separatePool: true, lootChannelId: "core-loot", raidLogChannelId: "core-reports" } });
    const weekly = await database.raidCore.create({ data: { guildId: guild.id, name: "Weekly release fixture", schedule: "Tue/Thu 8-11pm EST" } });
    const weeklyNow = new Date("2026-10-01T12:00:00Z");
    assert.deepEqual(await fillCoreWeeklyRaids(database, guild.id, weekly.id, weeklyNow), []); // legacy display text stays inactive
    await saveCoreWeeklySchedule(database, guild.id, weekly.id, "mardi 20h; jeudi 20h", "release-test");
    const createdWeekly = (await Promise.all([1, 2, 3].map(() => fillCoreWeeklyRaids(database, guild.id, weekly.id, weeklyNow)))).flat();
    assert.equal(createdWeekly.length, 2); // real PostgreSQL lock/unique index, concurrent ticks
    assert.equal(await database.discordJob.count({ where: { guildId: guild.id, key: { in: createdWeekly.map(id => `raid:${id}`) } } }), 2);
    const weeklyRaids = await database.raid.findMany({ where: { coreId: weekly.id }, orderBy: { scheduledAt: "asc" } });
    await database.raid.update({ where: { id: weeklyRaids[0]!.id }, data: { status: "CANCELLED" } });
    await database.raid.update({ where: { id: weeklyRaids[1]!.id }, data: { scheduledAt: new Date("2026-10-08T00:00:00Z") } });
    assert.deepEqual(await fillCoreWeeklyRaids(database, guild.id, weekly.id, weeklyNow), []); // cancelled/moved never respawn
    await assert.rejects(database.raid.create({ data: { guildId: guild.id, coreId: weekly.id, title: "Duplicate occurrence", createdBy: "release-test", scheduledAt: weeklyNow, weeklyOccurrence: weeklyRaids[0]!.weeklyOccurrence } }));
    assert.equal((await fillCoreWeeklyRaids(database, guild.id, weekly.id, new Date("2026-10-09T12:00:00Z"))).length, 2); // missed days never backfilled
    await saveCoreWeeklySchedule(database, guild.id, weekly.id, "off", "release-test");
    assert.deepEqual(await fillCoreWeeklyRaids(database, guild.id, weekly.id, new Date("2026-10-16T12:00:00Z")), []);
    assert.equal(await database.raid.count({ where: { coreId: weekly.id } }), 4); // pausing preserves signups/history
    await assert.rejects(saveCoreWeeklySchedule(database, "wrong-guild", weekly.id, "mardi 20h", "release-test"), /this guild/);
    // Manual raids are adopted, preserving existing signups and skipped nights.
    const manualCore = await database.raidCore.create({ data: { guildId: guild.id, name: "Manual weekly fixture" } });
    const manual = await database.raid.create({ data: { guildId: guild.id, coreId: manualCore.id, title: "Manual night", createdBy: "release-test", scheduledAt: new Date("2026-10-02T00:00:00Z"), repeatWeekly: true } });
    await database.raidSignup.create({ data: { raidId: manual.id, memberId: member.id } });
    await saveCoreWeeklySchedule(database, guild.id, manualCore.id, "jeudi 20h", "release-test");
    assert.deepEqual(await fillCoreWeeklyRaids(database, guild.id, manualCore.id, weeklyNow), []);
    assert.equal((await database.raid.findUniqueOrThrow({ where: { id: manual.id } })).repeatWeekly, false);
    assert.equal(await database.raidSignup.count({ where: { raidId: manual.id } }), 1);
    // A different core gets its own occurrence even at the same clock time.
    const otherCore = await database.raidCore.create({ data: { guildId: guild.id, name: "Independent weekly fixture" } });
    await saveCoreWeeklySchedule(database, guild.id, otherCore.id, "jeudi 20h", "release-test");
    assert.equal((await fillCoreWeeklyRaids(database, guild.id, otherCore.id, weeklyNow)).length, 1);
    // Force a delivery-job failure inside a real transaction: its raid must roll back too.
    const brokenCore = await database.raidCore.create({ data: { guildId: guild.id, name: "Rollback weekly fixture" } });
    await saveCoreWeeklySchedule(database, guild.id, brokenCore.id, "jeudi 20h", "release-test");
    const brokenDatabase = { $transaction: (work: (tx: unknown) => Promise<unknown>) => database.$transaction(tx => work(new Proxy(tx, {
      get(target, key) { return key === "discordJob" ? { upsert: async () => { throw new Error("Forced job failure"); } } : Reflect.get(target, key); }
    }))) };
    await assert.rejects(fillCoreWeeklyRaids(brokenDatabase as never, guild.id, brokenCore.id, weeklyNow), /Forced job failure/);
    assert.equal(await database.raid.count({ where: { coreId: brokenCore.id } }), 0);
    await database.raid.create({ data: { guildId: guild.id, coreId: core.id, title: "Release mirrored raid", scheduledAt: new Date(), createdBy: "release-test", signupChannelId: "general", signupMessageId: "general-message", mirrorSignupChannelId: "core", mirrorSignupMessageId: "core-message" } });
    // Full setup reset replaces only the selected guild and cascades its credentials/data.
    const resetGuild = await database.guild.create({ data: { discordId: "release-test-reset", name: "Reset fixture", settings: { create: {} } } });
    const resetMember = await database.member.create({ data: { guildId: resetGuild.id, discordUserId: "reset-member", displayName: "Reset" } });
    const resetJob = await enqueueDiscordJob(database, resetGuild.id, "reset-job", "PROFESSIONS");
    await database.companionCredential.create({ data: { memberId: resetMember.id, tokenHash: "disposable-reset-credential" } });
    const resetCharacter = await database.character.create({ data: { memberId: resetMember.id, name: "ResetChar", realm: "ReleaseTest", className: "Warrior", professions: { create: { profession: "Mining", skillLevel: 300 } } } });
    const resetAt = new Date();
    await database.$transaction(async tx => {
      await tx.guild.delete({ where: { id: resetGuild.id } });
      await tx.guild.create({ data: { discordId: "release-test-reset", name: "Reset fixture", settings: { create: { dataResetAt: resetAt } } } });
    });
    assert.equal(await database.companionCredential.count({ where: { memberId: resetMember.id } }), 0);
    assert.equal(await database.character.count({ where: { id: resetCharacter.id } }), 0);
    assert.equal(await database.professionSkill.count({ where: { characterId: resetCharacter.id } }), 0);
    assert.equal(await database.member.count({ where: { guildId: resetGuild.id } }), 0);
    assert.equal(await database.discordJob.count({ where: { id: resetJob.id } }), 0);
    assert.ok(await database.guild.findUnique({ where: { id: guild.id } }));
    const fresh = await database.guild.findUniqueOrThrow({ where: { discordId: "release-test-reset" } });
    const freshMember = await database.member.create({ data: { guildId: fresh.id, discordUserId: "reset-member", displayName: "Reset" } });
    await database.character.create({ data: { memberId: freshMember.id, name: "ResetChar", realm: "ReleaseTest", className: "Warrior" } });
    const resetImporter = createAddonImportService(database);
    const entry = { character: "ResetChar", realm: "ReleaseTest", epAmount: 10, gpAmount: 0, type: "EP_AWARD", reason: "Reset import" };
    const resetPreview = await resetImporter.preview(fresh.id, { source: "Guilded", exportedAt: new Date(), epgpTransactions: [
      { ...entry, sourceRef: "pre-reset", createdAt: new Date(resetAt.getTime() - 86400000) },
      { ...entry, sourceRef: "unknown-date" },
      { ...entry, sourceRef: "post-reset", createdAt: new Date(resetAt.getTime() + 1000) }
    ] }, "reset-test");
    const resetImport = await resetImporter.record(fresh.id, resetPreview.snapshot, "reset-fixture", "reset-test");
    await resetImporter.apply(fresh.id, resetImport.id, "reset-test");
    assert.equal(await database.epgpTransaction.count({ where: { guildId: fresh.id } }), 1);
    const service = createAddonImportService(database);
    const payload = { source: "Guilded", exportedAt: new Date(), epgpTransactions: [{ character: "ReleaseAnn", realm: "ReleaseTest", epAmount: 10, gpAmount: 5, type: "EP_AWARD", reason: "release test", sourceRef: "release-test-event", coreId: core.id }] };
    const preview = await service.preview(guild.id, payload, "release-test");
    const a = await service.record(guild.id, preview.snapshot, "a", "release-test");
    const b = await service.record(guild.id, preview.snapshot, "b", "release-test");
    await Promise.all([service.apply(guild.id, a.id, "release-test"), service.apply(guild.id, b.id, "release-test")]);
    assert.equal(await database.epgpTransaction.count({ where: { guildId: guild.id } }), 1);
    assert.equal((await database.epgpTransaction.findFirstOrThrow({ where: { guildId: guild.id } })).coreId, core.id);
    // Two callers applying the exact same import: one commits, one is rejected.
    const next = await service.preview(guild.id, { ...payload, epgpTransactions: [{ ...payload.epgpTransactions[0], sourceRef: "release-test-second" }] }, "release-test");
    const c = await service.record(guild.id, next.snapshot, "c", "release-test");
    const results = await Promise.allSettled([service.apply(guild.id, c.id, "release-test"), service.apply(guild.id, c.id, "release-test")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    // The unique constraint also protects writes outside the import service.
    const existing = await database.epgpTransaction.findFirstOrThrow({ where: { guildId: guild.id } });
    await assert.rejects(database.epgpTransaction.create({ data: { guildId: guild.id, memberId: member.id, type: "EP_AWARD", epAmount: 10, reason: "duplicate", createdBy: "release-test", sourceRef: existing.sourceRef } }));
    const invalid = await service.preview(guild.id, { ...payload, epgpTransactions: [{ ...payload.epgpTransactions[0], sourceRef: "bad-pool", coreId: "other-guild-pool" }] }, "release-test");
    const bad = await service.record(guild.id, invalid.snapshot, "bad", "release-test");
    await assert.rejects(service.apply(guild.id, bad.id, "release-test"), /core point pool/);
    assert.equal(await database.epgpTransaction.count({ where: { guildId: guild.id } }), 2);

    // Profession-only relays must remove dropped data without applying included points.
    await database.professionSkill.createMany({ data: ["Alchemy", "Mining"].map((profession) => ({ characterId: character.id, profession, skillLevel: 300 })) });
    await database.recipeKnown.create({ data: { guildId: guild.id, character: character.name, realm: character.realm, profession: "Alchemy", itemKey: 1001, itemName: "Test elixir", scannedAt: new Date("2026-09-29T10:00:00Z") } });
    await database.professionCooldown.create({ data: { guildId: guild.id, character: character.name, realm: character.realm, profession: "Alchemy", name: "Transmute", readyAt: new Date("2026-10-01T10:00:00Z"), scannedAt: new Date("2026-09-29T10:00:00Z") } });
    const professionReport = parseAddonSnapshot({ ...payload, character: { name: character.name, realm: character.realm, class: "WARRIOR", professionsComplete: true, professionsAt: "2026-09-30T10:00:00Z", professions: [{ name: "Mining", skillLevel: 300 }] }, epgpTransactions: [{ ...payload.epgpTransactions[0], sourceRef: "relay-must-not-apply" }] });
    await relayProfessions(database, guild.id, professionReport);
    assert.deepEqual((await database.professionSkill.findMany({ where: { characterId: character.id } })).map((row) => row.profession), ["Mining"]);
    assert.equal(await database.recipeKnown.count({ where: { guildId: guild.id } }), 0);
    assert.equal(await database.professionCooldown.count({ where: { guildId: guild.id } }), 0);
    assert.equal(await database.epgpTransaction.count({ where: { guildId: guild.id } }), 2);
    const stale = parseAddonSnapshot({ ...professionReport, character: { ...professionReport.character, professionsAt: "2026-09-29T10:00:00Z", professions: [{ name: "Alchemy", skillLevel: 300 }] }, recipes: [{ character: character.name, realm: character.realm, profession: "Alchemy", at: "2026-09-29T10:00:00Z", keys: [1001] }] });
    await relayProfessions(database, guild.id, stale);
    assert.equal(await database.professionSkill.count({ where: { characterId: character.id, profession: "Alchemy" } }), 0);
    assert.equal(await database.recipeKnown.count({ where: { guildId: guild.id } }), 0);

  }
} finally { await database.$disconnect(); }
