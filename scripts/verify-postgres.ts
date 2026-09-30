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
  } else {
    await database.guild.deleteMany({ where: { discordId: { startsWith: "release-test-" } } });
    const guild = await database.guild.create({ data: { discordId: "release-test-guild", name: "Release fixture" } });
    const member = await database.member.create({ data: { guildId: guild.id, discordUserId: "release-test-member", displayName: "Ann" } });
    const character = await database.character.create({ data: { memberId: member.id, name: "ReleaseAnn", realm: "ReleaseTest", className: "Warrior" } });
    const core = await database.raidCore.create({ data: { guildId: guild.id, name: "Core A", separatePool: true } });
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
