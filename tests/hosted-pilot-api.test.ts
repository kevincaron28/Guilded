import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { startCompanionApi, resetFailures } from "../src/companion-api.js";
import { createGuildService } from "../src/services/guild.js";
import { companionAccess } from "../src/services/companion-access.js";
import { handleOnboardingInteraction } from "../src/services/onboarding.js";
import { handleWelcomeRoleButton } from "../src/services/housekeeping.js";
import { runAutoDecay } from "../src/services/auto-decay.js";

const db = vi.hoisted(() => ({ guild: { findUnique: vi.fn(), upsert: vi.fn() }, companionCredential: { findFirst: vi.fn() } }));
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/config.js", () => ({ config: {
  COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1", HOSTED_PILOT: true,
  DISCORD_GUILD_ID: "111111111111111111", HOSTED_GUILD_IDS: "222222222222222222", HOSTED_GUILD_LIMIT: 5
} }));
const owner = "111111111111111111", guest = "222222222222222222", unapproved = "333333333333333333";
const client = { guilds: { fetch: vi.fn() } };
let server: ReturnType<typeof startCompanionApi>, address: string;
beforeAll(async () => {
  server = startCompanionApi(client as never);
  await once(server, "listening");
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("Test address unavailable");
  address = `http://127.0.0.1:${bound.port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); resetFailures(); });

describe("hosted pilot runtime admission", () => {
  it("excludes unapproved guilds before scheduled ledger work is selected", async () => {
    const findMany = vi.fn(async () => []);
    await runAutoDecay({ guildSettings: { findMany } } as never);
    expect(findMany).toHaveBeenCalledWith({ where: { autoDecay: true, guild: { discordId: { in: [owner, guest] } } } });
  });
  it("blocks pairing, reads and uploads before touching an unapproved guild's data", async () => {
    const requests = [
      fetch(`${address}/api/v1/standings?guild=${unapproved}`),
      fetch(`${address}/api/v1/manage?guild=${unapproved}`),
      ...["/api/v1/addon-pairings", "/api/v1/addon-imports", "/api/v1/poe/visits"].map(path => fetch(`${address}${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guildDiscordId: unapproved, code: "abc" })
      }))
    ];
    for (const response of await Promise.all(requests)) expect(response.status).toBe(403);
    expect(db.guild.findUnique).not.toHaveBeenCalled();
    expect(db.companionCredential.findFirst).not.toHaveBeenCalled();
  });
  it("approved servers still need their own personal credential", async () => {
    db.guild.findUnique.mockImplementation(async ({ where }) => ({ id: where.discordId, discordId: where.discordId }));
    db.companionCredential.findFirst.mockResolvedValue(null);
    for (const id of [owner, guest]) {
      const response = await fetch(`${address}/api/v1/standings?guild=${id}`, { headers: { "x-companion-credential": "x".repeat(43) } });
      expect(response.status).toBe(401);
      expect(db.companionCredential.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ member: { guildId: id, status: "ACTIVE" } }) }));
    }
    expect(client.guilds.fetch).not.toHaveBeenCalled();
  });
  it("also blocks direct service calls before guild creation or credential reads", async () => {
    expect(() => createGuildService(db as never).ensureGuild(unapproved, "Unapproved")).toThrow("approval");
    expect(db.guild.upsert).not.toHaveBeenCalled();
    expect(await companionAccess(db as never, client as never, "g", unapproved, "x".repeat(43))).toBeNull();
    expect(db.companionCredential.findFirst).not.toHaveBeenCalled();
  });
  it("rejects old onboarding and welcome-role DM buttons for unapproved servers", async () => {
    const { ONBOARD_PREFIX } = await import("../src/services/onboarding.js");
    const { WELCOME_ROLE_PREFIX } = await import("../src/services/housekeeping.js");
    for (const [handler, customId] of [
      [handleOnboardingInteraction, `${ONBOARD_PREFIX}steps:${unapproved}`],
      [handleWelcomeRoleButton, `${WELCOME_ROLE_PREFIX}${unapproved}:role`]
    ] as const) {
      const reply = vi.fn();
      await handler({ customId, client, guild: null, reply } as never);
      expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, content: expect.stringContaining("approval") }));
    }
    expect(client.guilds.fetch).not.toHaveBeenCalled();
  });
});
