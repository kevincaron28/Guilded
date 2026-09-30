import { relayProfessions } from "../src/services/profession-relay.js";
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
  } else {
    await database.guild.deleteMany({ where: { discordId: { startsWith: "release-test-" } } });
    const guild = await database.guild.create({ data: { discordId: "release-test-guild", name: "Release fixture" } });
    const member = await database.member.create({ data: { guildId: guild.id, discordUserId: "release-test-member", displayName: "Ann" } });
    const character = await database.character.create({ data: { memberId: member.id, name: "ReleaseAnn", realm: "ReleaseTest", className: "Warrior" } });
    const core = await database.raidCore.create({ data: { guildId: guild.id, name: "Core A", separatePool: true, lootChannelId: "core-loot", raidLogChannelId: "core-reports" } });
    await database.raid.create({ data: { guildId: guild.id, coreId: core.id, title: "Release mirrored raid", scheduledAt: new Date(), createdBy: "release-test", signupChannelId: "general", signupMessageId: "general-message", mirrorSignupChannelId: "core", mirrorSignupMessageId: "core-message" } });
    // Full setup reset replaces only the selected guild and cascades its credentials/data.
    const resetGuild = await database.guild.create({ data: { discordId: "release-test-reset", name: "Reset fixture", settings: { create: {} } } });
    const resetMember = await database.member.create({ data: { guildId: resetGuild.id, discordUserId: "reset-member", displayName: "Reset" } });
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
