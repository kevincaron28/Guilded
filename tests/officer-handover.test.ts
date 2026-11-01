import { expect, it, vi } from "vitest";
import { createOfficerHandover, officerHandoverStore } from "../src/services/officer-handover.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";
const now = new Date("2026-10-30T18:00:00Z");
const guild = { id: "g", name: "Guild", edition: "retail" as const };

it("checks current officer access before any guild data and selects no audit payloads", async () => {
  const access = { authorize: vi.fn().mockResolvedValue(null), guilds: vi.fn() };
  const db = { auditLog: { findMany: vi.fn(async () => []) }, addonImport: { count: vi.fn(async () => 0) },
    application: { count: vi.fn(async () => 0) }, raid: { findMany: vi.fn(async () => []) }, discordJob: { findMany: vi.fn(async () => []) } };
  const store = officerHandoverStore(db as never, access as never);
  expect(await store.load("user", "g", now)).toBeNull(); expect(db.auditLog.findMany).not.toHaveBeenCalled();
  access.authorize.mockResolvedValue(guild);
  await store.load("user", "g", now);
  expect(access.authorize).toHaveBeenLastCalledWith("user", "g");
  expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g", createdAt: { gte: new Date("2026-10-23T18:00:00Z") } }, select: { action: true, createdAt: true } }));
  expect(db.addonImport.count).toHaveBeenCalledWith({ where: { guildId: "g", status: "PREVIEWED" } });
  expect(db.discordJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g", status: "PENDING" } }));
});

it("distinguishes future scheduled delivery from retry and makes no backup-success claim", async () => {
  const snapshot = { guild, since: now, changes: [], pendingImports: 0, applications: 0, raids: [], limited: false,
    jobs: [{ kind: "MESSAGE", attempts: 0, nextAttemptAt: new Date(now.getTime() + 86400000), lockedUntil: null },
      { kind: "MESSAGE", attempts: 1, nextAttemptAt: now, lockedUntil: null }] };
  const store = { guilds: vi.fn(), load: vi.fn(async () => snapshot) };
  const ctx: WebContext = { account: { id: "a", discordUserId: "user", username: "Name", displayName: null }, request: { path: "/me/handover", method: "GET", query: new URLSearchParams("guild=g"), headers: {} },
    lang: "en", t: en => en, now, sessionToken: null, csrf: null, form: null, auth: null };
  const kit: WebKit = { page: (status, _title, body) => ({ status, headers: {}, body }), redirect: () => ({ status: 303, headers: {}, body: "" }), signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" }) };
  const page = createOfficerHandover(store as never);
  expect((await page.route({ ...ctx, account: null }, kit))?.status).toBe(401); expect(store.load).not.toHaveBeenCalled();
  const result = await page.route(ctx, kit);
  expect(result?.body).toContain("Scheduled; not attempted yet"); expect(result?.body).toContain("Retry scheduled");
  expect(result?.body).toContain("does not inspect or restore host backups");
  store.load.mockClear();
  expect((await page.route({ ...ctx, request: { ...ctx.request, method: "POST" } }, kit))?.status).toBe(405);
  expect(store.load).not.toHaveBeenCalled();
});
