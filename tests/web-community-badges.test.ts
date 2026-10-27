import { beforeEach, expect, it, vi } from "vitest";
import type { WebContext, WebKit } from "../src/services/web-app.js";
const state = vi.hoisted(() => ({ allowed: true, shared: false, visible: true, initialized: vi.fn() }));
vi.mock("../src/services/guild-dashboard-access.js", () => ({ guildDashboardAccess: () => ({ authorize: async () => state.allowed, guilds: async () => [{ id: "guild", name: "Guild" }] }) }));
vi.mock("../src/services/guild-scope.js", () => ({ withGuildScope: async (_db: unknown, _id: string, work: () => unknown) => work() }));
vi.mock("../src/services/community-access.js", () => ({ communityAccess: async () => {}, accessibleCommunitySeasons: async () => state.visible ? [{ id: "season", name: "<private season>", game: "DISCORD", status: "ENDED" }] : [] }));
vi.mock("../src/services/community-badges.js", () => ({ initializeCommunityBadgeHistory: state.initialized, communityBadgeShelf: async (_db: unknown, _season: string, viewer: string, owner: string) => viewer === owner || state.shared ? [{ code: "community-100", earnedAt: null, evidenceRef: "PRIVATE-PROOF", source: "BASELINE" }] : null }));
import { createWebCommunityBadges } from "../src/services/web-community-badges.js";

const kit = { page: (status: number, _title: string, body: string) => ({ status, body, headers: {} }), signInPrompt: () => ({ status: 401, body: "Sign in", headers: {} }) } as WebKit;
const db = { guild: { findUniqueOrThrow: async () => ({ discordId: "discord" }) } };
const client = { guilds: { fetch: async () => ({}) } };
const page = createWebCommunityBadges(db as never, client as never, () => true);
const ctx = (query = "guild=guild&season=season", method = "GET") => ({ request: { path: "/me/badges", method, query: new URLSearchParams(query), headers: {} }, now: new Date(), sessionToken: null, csrf: null, form: null, auth: null, account: { id: "account", discordUserId: "owner", username: "owner", displayName: null }, lang: "en", t: (en: string) => en }) as WebContext;
beforeEach(() => { state.allowed = true; state.shared = false; state.visible = true; state.initialized.mockClear(); });
it("requires login and current guild membership, and refuses mutation", async () => {
  expect((await page.route({ ...ctx(), account: null }, kit))?.status).toBe(401);
  expect((await page.route(ctx(undefined, "POST"), kit))?.status).toBe(405);
  state.allowed = false;
  expect((await page.route(ctx(), kit))?.status).toBe(403);
  expect(state.initialized).not.toHaveBeenCalled();
});
it("checks private-season access before materialization or disclosure", async () => {
  state.visible = false;
  expect((await page.route(ctx(), kit))?.status).toBe(403);
  expect(state.initialized).not.toHaveBeenCalled();
});
it("shows an escaped archive shelf without evidence links or fabricated dates", async () => {
  const result = await page.route(ctx(), kit);
  expect(result?.status).toBe(200);
  expect(result?.body).toContain("&lt;private season&gt;");
  expect(result?.body).toContain("earning date unknown");
  expect(result?.body).not.toContain("PRIVATE-PROOF");
});
it("honors opt-in sharing and immediate withdrawal for other viewers", async () => {
  const other = { ...ctx("guild=guild&season=season&player=owner"), account: { id: "viewer-account", discordUserId: "viewer", username: "viewer", displayName: null } } as WebContext;
  expect((await page.route(other, kit))?.status).toBe(403);
  state.shared = true;
  expect((await page.route(other, kit))?.status).toBe(200);
  state.shared = false;
  expect((await page.route(other, kit))?.status).toBe(403);
});
