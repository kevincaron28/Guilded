import { describe, expect, it, vi } from "vitest";
import { createMemberData, memberDataStore } from "../src/services/member-data.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";

const account = { id: "account", discordUserId: "member", username: "Name", displayName: null };
const context = (query = ""): WebContext => ({ account, request: { path: "/me/data", method: "GET", query: new URLSearchParams(query), headers: {} },
  lang: "en", t: en => en, now: new Date("2026-10-30T12:00:00Z"), sessionToken: null, csrf: null, form: null, auth: null });
const kit: WebKit = { page: (status, _title, body) => ({ status, headers: {}, body }), redirect: () => ({ status: 303, headers: {}, body: "" }), signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" }) };
const snapshot = { publicProfile: false, guilds: [], devices: [], characters: [], recentSignups: [], recapSchedules: [], battlegroundConsents: [], battlegroundReports: [], limited: false };

describe("private member data centre", () => {
  it("uses the signed-in account, never a requested account ID, and requires sign-in", async () => {
    const load = vi.fn(async () => snapshot), page = createMemberData(load);
    expect((await page.route({ ...context(), account: null }, kit))?.status).toBe(401);
    expect(load).not.toHaveBeenCalled();
    expect((await page.route(context("account=someone-else&download=json"), kit))?.headers["cache-control"]).toBe("private, no-store");
    expect(load).toHaveBeenCalledWith(account);
  });
  it("renders empty and failed states without claiming a complete data archive", async () => {
    const load = vi.fn(async () => snapshot), page = createMemberData(load);
    const result = await page.route(context(), kit);
    expect(result?.body).toContain("No visible linked characters");
    expect(result?.body).toContain("not a complete archive");
    expect(result?.body).toContain("/me/connections");
    load.mockRejectedValueOnce(new Error("secret database error"));
    const failed = await page.route(context(), kit);
    expect(failed?.status).toBe(503); expect(failed?.body).not.toContain("secret");
  });
  it("bounds guild records to verified memberships and exports device metadata without secrets", async () => {
    const characters = vi.fn(async () => []), signups = vi.fn(async () => []);
    const db = { webAccount: { findUnique: vi.fn(async () => ({ publicProfile: false })) },
      companionCredential: { findMany: vi.fn(async () => [{ id: "device", deviceName: "PC", tokenHash: "secret", createdAt: new Date(), member: { guild: { name: "Guild", gameEdition: "retail" } } }]) },
      webCompanionCredential: { findMany: vi.fn(async () => []) }, character: { findMany: characters }, raidSignup: { findMany: signups }, recurringRecap: { findMany: vi.fn(async () => []) },
      battlegroundConsent: { findMany: vi.fn(async () => []) }, battlegroundReport: { findMany: vi.fn(async () => []) } };
    const access = { guilds: vi.fn(async () => [{ id: "allowed", name: "Guild", edition: "retail" }]) };
    const result = await memberDataStore(db as never, access as never)(account);
    expect(characters).toHaveBeenCalledWith(expect.objectContaining({ where: { member: { discordUserId: "member", guildId: { in: ["allowed"] } } } }));
    expect(signups).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ member: { discordUserId: "member", guildId: { in: ["allowed"] } } }) }));
    expect(db.recurringRecap.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: { in: ["allowed"] }, member: { discordUserId: "member" } } }));
    expect(db.battlegroundReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: { in: ["allowed"] }, member: { discordUserId: "member" } } }));
    expect(JSON.stringify(result)).not.toContain("secret"); expect(JSON.stringify(result)).not.toContain("tokenHash");
  });
});
