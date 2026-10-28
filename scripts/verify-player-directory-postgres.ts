import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createEpgpService } from "../src/services/epgp.js";
import { decodeCursor, encodeCursor, PAGE_SIZE, prismaProfileStore, type PlayerFilters } from "../src/services/player-profiles.js";

// Called only by the disposable PostgreSQL rehearsal. No Discord or production access.
// The /players/ query (raw SQL) and the EPGP floors on a real database (27 October 2026).
export async function verifyPlayerDirectoryPostgres(database: PrismaClient): Promise<void> {
  const prefix = "release-test-players-";
  const ids: string[] = [];
  try {
    const guild = await database.guild.create({ data: { discordId: `${prefix}guild`, name: "Directory Gold" } });
    const blocked = await database.guild.create({ data: { discordId: `${prefix}blocked`, name: "Blocked Guild" } });
    const core = await database.raidCore.create({ data: { guildId: guild.id, name: "Directory core" } });
    const person = async (n: number, publicProfile = true) => {
      const discordUserId = `${prefix}user-${n}`;
      const account = await database.webAccount.create({ data: { discordUserId, username: `discord-name-${n}`, publicProfile } });
      ids.push(account.id);
      const member = await database.member.create({ data: { guildId: guild.id, discordUserId, displayName: `discord-name-${n}` } });
      return { account, member };
    };
    // Thirty players with a main, so the list needs two pages; one also has an alt.
    const people = [];
    for (let n = 0; n < 30; n++) {
      const { account, member } = await person(n);
      const main = await database.character.create({ data: { guildId: guild.id, memberId: member.id, name: `Dirchar${String(n).padStart(2, "0")}`, realm: "Doomhowl", className: n % 2 ? "Mage" : "Priest", level: 60, isMain: true } });
      people.push({ account, member, main });
    }
    await database.character.create({ data: { guildId: guild.id, memberId: people[0]!.member.id, name: "Diralt", realm: "Doomhowl", className: "Warrior", level: 60, isMain: false } });
    await database.raidCoreMember.create({ data: { coreId: core.id, memberId: people[1]!.member.id, role: "HEALER", characterId: people[1]!.main.id } });
    // A hidden profile, a member of a blocked server and a companion-only player.
    const hidden = await person(90, false);
    await database.character.create({ data: { guildId: guild.id, memberId: hidden.member.id, name: "Dirhidden", realm: "Doomhowl", className: "Rogue" } });
    const outsider = await database.webAccount.create({ data: { discordUserId: `${prefix}user-91`, username: "outsider", characters: { create: { name: "Dircompanion", realm: "Doomhowl" } } } });
    ids.push(outsider.id);
    const blockedMember = await database.member.create({ data: { guildId: blocked.id, discordUserId: `${prefix}user-91`, displayName: "outsider" } });
    await database.character.create({ data: { guildId: blocked.id, memberId: blockedMember.id, name: "Dirblocked", realm: "Doomhowl", className: "Druid" } });

    const store = prismaProfileStore(database, (id) => id !== `${prefix}blocked`);
    const filters = (over: Partial<PlayerFilters> = {}): PlayerFilters => ({ q: "dir", edition: "forever", realm: null, className: null, role: null, guild: null, ...over });
    const first = await store.list(filters(), null);
    assert.equal(first.length, PAGE_SIZE + 1);
    assert.equal(first[0]!.character, "Dirchar00"); // the main, not the alt (Diralt would sort first)
    assert.ok(!first.some((row) => ["Dirhidden", "Dirblocked", "Diralt"].includes(row.character)));
    const cursor = decodeCursor(encodeCursor(first[PAGE_SIZE - 1]!))!;
    const second = await store.list(filters(), cursor);
    assert.equal(second.length, 31 - PAGE_SIZE);
    assert.equal(second.at(-1)!.character, "Dircompanion"); // companion characters count too, sorted by name
    assert.equal(new Set([...first.slice(0, PAGE_SIZE), ...second].map((row) => row.id)).size, 31);
    assert.deepEqual((await store.list(filters({ className: "Warrior" }), null)).map((row) => row.character), ["Diralt"]);
    assert.deepEqual((await store.list(filters({ role: "HEALER" }), null)).map((row) => row.character), ["Dirchar01"]);
    assert.equal((await store.list(filters({ guild: "directory", className: "Mage" }), null)).length, 15);
    assert.equal((await store.list(filters({ q: "dirchar0_" }), null)).length, 0); // "_" is a letter here, not a wildcard
    assert.equal((await store.list(filters({ edition: "retail" }), null)).length, 0);

    // EPGP floors: a reversal after a decay takes back only what is left.
    const epgp = createEpgpService(database);
    const memberId = people[2]!.member.id;
    const item = await epgp.awardItem({ guildId: guild.id, memberId, gp: 100, reason: "Loot: helm", createdBy: "release-test-players" });
    await epgp.applyDecay(guild.id, 0.1, "release-test-players");
    await epgp.reverseTransaction(item.id, "release-test-players", "Reversal: release test", guild.id);
    assert.equal((await epgp.getStanding(memberId)).gp, 0);
  } finally {
    await database.webAccount.deleteMany({ where: { id: { in: ids } } });
    await database.guild.deleteMany({ where: { discordId: { startsWith: prefix } } });
  }
}
