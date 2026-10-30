import assert from "node:assert/strict";
import { createPrismaClient } from "../src/database.js";
import { linkVerifiedCharacters, verifyCodeFor } from "../src/services/character-verify.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
const value = process.env["TEST_DATABASE_URL"];
if (!value) throw new Error("TEST_DATABASE_URL required");
const url = new URL(value);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local database required");
const db = createPrismaClient(value), other = createPrismaClient(value);
const guild = await db.guild.create({ data: { discordId: `correction-${Date.now()}`, name: "Correction fixture" } });
try {
  const members = await Promise.all(["old", "right", "alternate"].map(name => db.member.create({ data: { guildId: guild.id, discordUserId: name, displayName: name } })));
  const [old, right, alternate] = members;
  assert(old && right && alternate);
  const codes = await Promise.all(members.map(m => verifyCodeFor(db, guild.id, m.id)));
  const entries = (verify: string) => parseAddonSnapshot({ source: "Guilded", exportedAt: new Date().toISOString(), characters: [{ name: "Correction", realm: "Forever", class: "MAGE", level: 60, verify }] }).characters;
  await linkVerifiedCharacters(db, guild.id, { officer: false, memberId: old.id }, entries(codes[0]!));
  const original = await db.character.findFirstOrThrow({ where: { guildId: guild.id } });
  const profession = await db.professionSkill.create({ data: { characterId: original.id, profession: "Alchemy", skillLevel: 300 } });
  // Inject a failure after the ownership write inside a real PostgreSQL transaction.
  const faulty = new Proxy(db, { get(target, property) {
    if (property !== "$transaction") return Reflect.get(target, property);
    return (work: Parameters<typeof db.$transaction>[0], options: unknown) => db.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(inner, key) {
        if (key === "characterVerifyClaim") return { ...inner.characterVerifyClaim, upsert: async () => { throw new Error("injected claim failure"); } };
        return Reflect.get(inner, key);
      } });
      return (work as unknown as (transaction: typeof tx) => Promise<unknown>)(wrapped);
    }, options as never);
  } });
  await assert.rejects(() => linkVerifiedCharacters(faulty, guild.id, { officer: true }, entries(codes[1]!)), /injected claim failure/);
  assert.equal((await db.character.findUniqueOrThrow({ where: { id: original.id } })).memberId, old.id);
  assert.equal((await db.characterVerifyClaim.findFirstOrThrow({ where: { guildId: guild.id, memberId: old.id } })).status, "PROVISIONAL");
  // Two independent connections race to correct the same provisional identity.
  const raced = await Promise.allSettled([
    linkVerifiedCharacters(db, guild.id, { officer: true }, entries(codes[1]!)),
    linkVerifiedCharacters(other, guild.id, { officer: true }, entries(codes[2]!))
  ]);
  assert(raced.some(result => result.status === "fulfilled"));
  const corrected = await db.character.findUniqueOrThrow({ where: { id: original.id } });
  assert([right.id, alternate.id].includes(corrected.memberId));
  assert.equal(await db.character.count({ where: { guildId: guild.id } }), 1);
  assert.equal((await db.professionSkill.findUniqueOrThrow({ where: { id: profession.id } })).characterId, original.id);
  assert.equal(await db.characterVerifyClaim.count({ where: { guildId: guild.id, status: "LINKED" } }), 1);
  assert.equal((await db.characterVerifyClaim.findFirstOrThrow({ where: { guildId: guild.id, memberId: old.id } })).status, "REMOVED");
  console.log("Character correction rollback, concurrent ownership and dependent-record preservation passed.");
} finally { await db.guild.delete({ where: { id: guild.id } }); await Promise.all([db.$disconnect(), other.$disconnect()]); }
