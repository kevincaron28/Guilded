import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { prismaBattleNetStore } from "../src/services/battlenet-store.js";
import { discoveredKey, type BattleNetDiscovery } from "../src/services/battlenet.js";
import { issuePersonalCredential, prismaPersonalStore } from "../src/services/personal-pairing.js";
import { prismaDeviceStore } from "../src/services/companion-devices.js";

// Only called by the existing disposable-local-database rehearsal.
export async function verifyBattleNetPostgres(database: PrismaClient) {
  const prefix = "release-test-battlenet-";
  try {
    const a = await database.webAccount.create({ data: { discordUserId: `${prefix}a`, username: "A" } });
    const b = await database.webAccount.create({ data: { discordUserId: `${prefix}b`, username: "B" } });
    const store = prismaBattleNetStore(database);
    const discovery: BattleNetDiscovery = { subject: `${prefix}provider`, battleTag: "Fixture#123", region: "us", gameEdition: "retail", verifiedAt: new Date(), characters: [
      { region: "us", gameEdition: "retail", realmId: 1, characterId: 2147483001, name: "Same", realm: "one" },
      { region: "us", gameEdition: "retail", realmId: 2, characterId: 2147483002, name: "Same", realm: "two" }
    ] };
    const keys = discovery.characters.map(discoveredKey);
    await store.save(a.id, discovery, keys, keys[0]!);
    await store.save(a.id, discovery, keys, keys[1]!);
    assert.equal((await store.get(a.id))!.characters.filter(c => c.isMain).length, 1);
    await assert.rejects(store.save(b.id, discovery, keys, null));
    await assert.rejects(store.save(b.id, { ...discovery, subject: `${prefix}other` }, keys, null));
    assert.equal(await store.get(b.id), null); // Failed transaction did not leave a partial identity.
    const identity = await database.battleNetIdentity.findUniqueOrThrow({ where: { accountId: a.id } });
    await assert.rejects(database.battleNetCharacter.updateMany({ where: { identityId: identity.id }, data: { isMain: true } }));
    // Maximum-size accounts must use bounded round trips, including refresh.
    const large = { ...discovery, characters: [...discovery.characters, ...Array.from({ length: 498 }, (_, i) => ({
      region: "us" as const, gameEdition: "retail" as const, realmId: 3, characterId: 2147400000 + i, name: `Alt${i}`, realm: "three"
    }))] };
    await store.save(a.id, large, large.characters.map(discoveredKey), null);
    const beforeRefresh = await database.battleNetCharacter.findMany({ where: { identityId: identity.id } });
    assert.equal(beforeRefresh.length, 500);
    await store.save(a.id, { ...large, characters: large.characters.map(c => ({ ...c, name: `New${c.name}` })) }, large.characters.map(discoveredKey), null);
    const afterRefresh = await database.battleNetCharacter.findMany({ where: { identityId: identity.id } });
    assert.deepEqual(afterRefresh.map(c => c.id).sort(), beforeRefresh.map(c => c.id).sort());
    assert.equal(afterRefresh.filter(c => c.isMain).length, 1);
    assert.equal(afterRefresh.every(c => c.name.startsWith("New")), true);
    const era: BattleNetDiscovery = { ...discovery, gameEdition: "classic-era", characters: [{ ...discovery.characters[0]!, gameEdition: "classic-era" }] };
    await store.save(a.id, era, era.characters.map(discoveredKey), null);
    assert.equal((await store.get(a.id))!.characters.length, 501);
    await assert.rejects(store.save(b.id, { ...large, subject: `${prefix}bulk-other` }, large.characters.map(discoveredKey), null));
    assert.equal(await store.get(b.id), null);
    assert.equal((await store.get(a.id))!.characters.length, 501);
    await store.save(a.id, large, [keys[1]!], null);
    assert.equal((await store.get(a.id))!.characters.length, 2);
    assert.equal((await store.get(a.id))!.characters.filter(c => c.isMain).length, 1);
    assert.equal(await database.webCharacter.count({ where: { accountId: a.id } }), 0);
    const personal = prismaPersonalStore(database);
    await issuePersonalCredential(personal, a.id, "Home PC");
    await issuePersonalCredential(personal, a.id, "Laptop");
    await issuePersonalCredential(personal, b.id, "Other account");
    const devices = prismaDeviceStore(database);
    const list = await devices.list(a);
    assert.equal(list.length, 2);
    await devices.change(b, "revoke", "personal", list[0]!.id, "");
    assert.equal((await devices.list(a)).length, 2);
    await devices.change(a, "revoke", "personal", list[0]!.id, "");
    assert.equal((await devices.list(a)).length, 1);
    await devices.change(a, "revoke-all", "", "", "");
    assert.equal((await devices.list(a)).length, 0);
    assert.equal((await devices.list(b)).length, 1);
    await store.unlink(a.id);
    assert.equal(await database.battleNetCharacter.count({ where: { identityId: identity.id } }), 0);
    console.log("Battle.net private ownership, main uniqueness, rollback, cascade and independent devices passed.");
  } finally {
    await database.webAccount.deleteMany({ where: { discordUserId: { startsWith: prefix } } });
  }
}
