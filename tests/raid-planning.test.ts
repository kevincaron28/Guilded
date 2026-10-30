import { expect, it, vi } from "vitest";
import { parsePlan, raidPlanningStore } from "../src/services/raid-planning.js";
import { createRaidPlanning, planningApproval, verifyPlanningApproval } from "../src/services/raid-planning-page.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";
const now = new Date("2026-10-30T12:00:00Z");
const payload = parsePlan("SUPPLIES", { summary: "Prepare together", items: "Food | 2 | 5", resources: "Guide | https://example.com/raid | 2026-10-29" }, now);

it("validates voluntary quantities, duplicate items and source dates without fetching sources", () => {
  expect(payload.items).toEqual([{ name: "Food", perPerson: 2, fixed: 5 }]);
  for (const items of ["Food | -1 | 1", "Food | 1.5 | 0", "Food | 0 | 0", "Food | 1 | 0\nfood | 2 | 0"]) expect(() => parsePlan("SUPPLIES", { summary: "x", items }, now)).toThrow();
  for (const url of ["javascript:alert(1)", "https://user:password@example.com/", "https://127.0.0.1/", "https://example.com/?token=secret"]) expect(() => parsePlan("RECAP", { summary: "x", resources: `Source | ${url} | 2026-10-29` }, now)).toThrow();
  for (const date of ["2026-02-30", "2026-11-01", "yesterday"]) expect(() => parsePlan("RECAP", { summary: "x", resources: `Guide | https://example.com/ | ${date}` }, now)).toThrow();
});

it("binds approval to the exact preview, session, user, raid, kind, revision, audience state and expiry", () => {
  const args = ["secret", "session", "user", "raid", "SUPPLIES", 2, payload, true, now] as const;
  const token = planningApproval(...args);
  expect(verifyPlanningApproval(token, ...args)).toBe(true);
  expect(verifyPlanningApproval(token, "secret", "session", "user", "raid", "SUPPLIES", 3, payload, true, now)).toBe(false);
  expect(verifyPlanningApproval(token, "secret", "session", "other", "raid", "SUPPLIES", 2, payload, true, now)).toBe(false);
  expect(verifyPlanningApproval(token, "secret", "session", "user", "raid", "SUPPLIES", 2, { ...payload, summary: "changed" }, true, now)).toBe(false);
  expect(verifyPlanningApproval(token, "secret", "session", "user", "raid", "SUPPLIES", 2, payload, false, now)).toBe(false);
  expect(verifyPlanningApproval(token, "secret", "session", "user", "raid", "SUPPLIES", 2, payload, true, new Date(now.getTime() + 600001))).toBe(false);
});

it("does not read plans or perform writes when membership or channel visibility fails", async () => {
  const db = { raid: { findFirst: vi.fn(async () => ({ id: "r", signupChannelId: "private", guild: { discordId: "d" } })) }, raidPlanRevision: { findFirst: vi.fn() }, $transaction: vi.fn() };
  const access = { authorize: vi.fn().mockResolvedValue(null) };
  const client = { isReady: () => true, guilds: { fetch: vi.fn(async () => ({ members: { fetch: async () => ({}) }, channels: { fetch: async () => ({ permissionsFor: () => ({ has: () => false }) }) } })) } };
  const store = raidPlanningStore(db as never, access as never, access as never, client as never);
  expect(await store.load("u", "g", "r", "RECAP")).toBeNull(); expect(db.raid.findFirst).not.toHaveBeenCalled();
  access.authorize.mockResolvedValue({ id: "g" });
  expect(await store.load("u", "g", "r", "RECAP")).toBeNull(); expect(db.raidPlanRevision.findFirst).not.toHaveBeenCalled();
  await expect(store.publish("u", "g", "r", "SUPPLIES", 0, payload, true)).rejects.toThrow("access");
  expect(db.$transaction).not.toHaveBeenCalled();
});

it("requires same-origin CSRF for every write and renders approved content as escaped text", async () => {
  const store = { load: vi.fn(async () => ({ guild: { id: "g", name: "Guild", edition: "retail" }, raid: { title: "Raid", scheduledAt: now, status: "PLANNED" },
    officer: false, current: { id: "v", revision: 1, active: true, approvedAt: now, payload: { ...payload, summary: "<script>bad()</script>" } }, confirmed: 5, totals: [], pledges: [], history: [] })), publish: vi.fn(), pledge: vi.fn() };
  const ctx: WebContext = { account: { id: "a", discordUserId: "u", username: "User", displayName: null }, request: { path: "/me/raid-plans", method: "POST", query: new URLSearchParams("guild=g&raid=r&kind=RECAP"), headers: {} }, lang: "en", t: en => en, now, sessionToken: null, csrf: null, form: new URLSearchParams(), auth: null };
  const kit: WebKit = { page: (status, _title, body) => ({ status, headers: {}, body }), redirect: () => ({ status: 303, headers: {}, body: "" }), signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" }) };
  const page = createRaidPlanning(store as never);
  expect((await page.route(ctx, kit))?.status).toBe(403); expect(store.load).not.toHaveBeenCalled();
  const result = await page.route({ ...ctx, request: { ...ctx.request, method: "GET" } }, kit);
  expect(result?.body).toContain("&lt;script&gt;"); expect(result?.body).not.toContain("<script>");
  expect(result?.body).not.toContain("Officer editor"); expect(store.publish).not.toHaveBeenCalled();
});
