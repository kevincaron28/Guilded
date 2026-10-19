import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { createGuildService } from "../src/services/guild.js";
import { publishGuildRuns, type PublicRunStore } from "../src/services/public-runs.js";

// Called only by the disposable PostgreSQL rehearsal. No Discord or production access.
export async function verifyPublicSharingPostgres(database: PrismaClient): Promise<void> {
  const service = createGuildService(database);
  const prefix = "release-test-sharing-";
  try {
    const fresh = await service.ensureGuild(`${prefix}new`, "New sharing fixture");
    const enabled = await database.guildSettings.findUniqueOrThrow({ where: { guildId: fresh.id } });
    assert.equal(enabled.publicDungeonRuns, true);
    assert.ok(enabled.publicDungeonRunsSince);
    const cutoff = enabled.publicDungeonRunsSince;
    const legacy = await database.guild.create({ data: { discordId: `${prefix}public`, name: "Existing public", settings: { create: { publicDungeonRuns: true } } } });
    const privateGuild = await database.guild.create({ data: { discordId: `${prefix}private`, name: "Existing private", settings: { create: {} } } });
    const missing = await database.guild.create({ data: { discordId: `${prefix}missing`, name: "Missing legacy settings" } });
    for (const row of [fresh, legacy, privateGuild, missing]) await service.ensureGuild(row.discordId, "Renamed");
    assert.equal((await service.getSettings(fresh.id))?.publicDungeonRunsSince?.getTime(), cutoff.getTime());
    assert.equal((await service.getSettings(legacy.id))?.publicDungeonRuns, true);
    assert.equal((await service.getSettings(legacy.id))?.publicDungeonRunsSince, null);
    assert.equal((await service.getSettings(privateGuild.id))?.publicDungeonRuns, false);
    assert.equal(await service.getSettings(missing.id), null);

    const addRun = (guildId: string, runRef: string, startOffsetMs: number) => database.dungeonRun.create({ data: {
      guildId, runRef, instanceId: 389, dungeonName: "Ragefire Chasm", state: "COMPLETED", protocolVersion: 2,
      startedAt: new Date(cutoff.getTime() + startOffsetMs), endedAt: new Date(cutoff.getTime() + startOffsetMs + 1500_000),
      recorder: "SharingAnn", competitionData: { encounters: [], players: [{ name: "SharingAnn", level: 16 }] },
      players: { create: ["SharingAnn", "SharingBob", "SharingCam"].map(character => ({ character, inGuild: false, presentSec: 1500 })) }
    } });
    await addRun(fresh.id, "sharing-before-setup", -3600_000);
    await addRun(fresh.id, "sharing-spans-setup", -600_000);
    await addRun(fresh.id, "sharing-at-cutoff", 0);
    await addRun(fresh.id, "sharing-after-setup", 1800_000);
    await addRun(legacy.id, "sharing-legacy-history", -3600_000);
    await addRun(privateGuild.id, "sharing-private-history", 1800_000);
    await addRun(missing.id, "sharing-missing-settings", 1800_000);
    const refs = new Map<string, string[]>();
    const store: PublicRunStore = {
      async findRun() { return null; },
      async createRun(summary, uploaderKey) { refs.set(uploaderKey, [...(refs.get(uploaderKey) ?? []), summary.runRef]); },
      async addUpload() { throw new Error("Unexpected duplicate in sharing rehearsal"); },
      async uploadsSince() { return 0; },
      async storedRefs(uploaderKey) { return refs.get(uploaderKey) ?? []; }
    };
    const now = new Date(cutoff.getTime() + 7200_000);
    await publishGuildRuns(database, store, now);
    assert.deepEqual((refs.get(`guild:${fresh.id}`) ?? []).sort(), ["sharing-after-setup", "sharing-at-cutoff"]);
    assert.deepEqual(refs.get(`guild:${legacy.id}`), ["sharing-legacy-history"]);
    assert.equal(refs.has(`guild:${privateGuild.id}`), false);
    assert.equal(refs.has(`guild:${missing.id}`), false);

    await service.updateSettings(fresh.id, { publicDungeonRuns: false });
    await addRun(fresh.id, "sharing-after-opt-out", 3600_000);
    await publishGuildRuns(database, store, now);
    assert.deepEqual((refs.get(`guild:${fresh.id}`) ?? []).sort(), ["sharing-after-setup", "sharing-at-cutoff"]);
    assert.equal((await service.getSettings(fresh.id))?.publicDungeonRunsSince?.getTime(), cutoff.getTime());
  } finally {
    await database.guild.deleteMany({ where: { discordId: { startsWith: prefix } } });
  }
}
