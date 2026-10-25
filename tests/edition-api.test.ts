import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { Collection } from "discord.js";
import { startCompanionApi, resetFailures } from "../src/companion-api.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";
import { currentGuildScope } from "../src/services/guild-scope.js";

const db = vi.hoisted(() => ({
  guild: { findFirst: vi.fn(), findUnique: vi.fn() },
  companionCredential: { findFirst: vi.fn() },
  addonImport: { findFirst: vi.fn(), create: vi.fn() },
  character: { create: vi.fn() }
}));
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));
vi.mock("../src/services/companion-manage.js", async original => ({
  ...await original<typeof import("../src/services/companion-manage.js")>(),
  createCompanionManage: () => ({ view: async (guildId: string, access: { officer: boolean }) => {
    await Promise.resolve();
    return { guildId, contextId: currentGuildScope()?.guild.id, officer: access.officer };
  } })
}));

const scopes = ["forever", "retail"].map(gameEdition => ({
  id: gameEdition, discordId: "server", name: gameEdition, gameEdition,
  scopeKey: gameEdition === "forever" ? "default" : "retail",
  wowSpace: { permissionRoles: { officer: "retail-officers" }, memberRoleId: "retail-members" }
}));
const secret = (edition: string) => edition.padEnd(43, "x");
let memberRoles = ["retail-officers", "retail-members"];
const fetchMember = vi.fn(async () => ({ id: "user", permissions: { has: () => false },
  roles: { cache: new Collection(memberRoles.map(id => [id, {id, name: id}])) } }));
const client = { isReady: () => true, guilds: { fetch: async () => ({ members: { fetch: fetchMember } }) } };
let server: ReturnType<typeof startCompanionApi>, address: string;
beforeAll(async () => {
  server = startCompanionApi(client as never);
  await once(server, "listening");
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("Missing test address");
  address = `http://127.0.0.1:${bound.port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.clearAllMocks(); resetFailures(); memberRoles = ["retail-officers", "retail-members"];
  db.guild.findFirst.mockImplementation(async ({where}) => scopes.find(g => g.id === where.id && g.discordId === where.discordId));
  db.guild.findUnique.mockImplementation(async ({where}) => scopes.find(g => g.id === where.id));
  db.companionCredential.findFirst.mockImplementation(async ({where}) => {
    const guild = scopes.find(g => hashCompanionSecret(secret(g.id)) === where.tokenHash
      && (where.member.guildId ? where.member.guildId === g.id : where.member.guild.discordId === g.discordId));
    return guild ? { memberId: `${guild.id}-member`, member: {guild, discordUserId:"user"} } : null;
  });
});
const headers = (edition: string) => ({"x-companion-credential":secret(edition), "content-type":"application/json"});

describe("multiple in-game guilds over the companion HTTP API", () => {
  it("binds concurrent requests and permissions to credentials, ignoring requested scope overrides", async () => {
    const results = await Promise.all(scopes.map(async guild => {
      const response = await fetch(`${address}/api/v1/manage?guild=server&wowGuildId=other`, {headers:headers(guild.id)});
      expect(response.status).toBe(200);
      return response.json();
    }));
    expect(results).toEqual([
      expect.objectContaining({guildId:"forever",contextId:"forever",officer:false}),
      expect.objectContaining({guildId:"retail",contextId:"retail",officer:true})
    ]);
    expect(fetchMember).toHaveBeenCalledWith({user:"user",force:true});
  });
  it("refuses wrong-edition files before character or import writes", async () => {
    const response = await fetch(`${address}/api/v1/addon-imports`, {method:"POST",headers:headers("retail"),body:JSON.stringify({
      guildDiscordId:"server",export:{source:"Guilded",exportedAt:new Date().toISOString(),gameEdition:"forever",character:{name:"Amy",realm:"Forever",class:"PRIEST"}}
    })});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error:expect.stringContaining("This guild uses retail")});
    expect(db.addonImport.findFirst).not.toHaveBeenCalled();
    expect(db.addonImport.create).not.toHaveBeenCalled();
    expect(db.character.create).not.toHaveBeenCalled();
  });
  it("revokes access immediately when the in-game guild membership role is removed", async () => {
    memberRoles = ["retail-officers"];
    const response = await fetch(`${address}/api/v1/manage?guild=server`, {headers:headers("retail")});
    expect(response.status).toBe(401);
  });
  it("does not accept a credential from another Discord server", async () => {
    const response = await fetch(`${address}/api/v1/manage?guild=other`, {headers:headers("retail")});
    expect(response.status).toBe(401);
    expect(fetchMember).not.toHaveBeenCalled();
  });
});
