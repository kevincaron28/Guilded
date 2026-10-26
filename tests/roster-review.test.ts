import { describe, expect, it, vi } from "vitest";
import { createRosterReview, parseMainPlan, reviewMainPlan } from "../src/services/roster-review.js";
import type { RosterSnapshot } from "../src/services/roster-dashboard-store.js";
import { createWebApp, type WebContext, type WebKit } from "../src/services/web-app.js";
import { csrfToken, hashToken, sign, SESSION_COOKIE } from "../src/services/web-auth.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const snapshot: RosterSnapshot = { guild: { id: "g1", name: "Guild", edition: "forever" }, truncated: false, characters: [
  { key: "arden", name: "Arden River", realm: "Forever", className: "Warrior", race: null, level: 60, memberId: "member1", isMain: true, professions: [], refreshedAt: null },
  { key: "mira", name: "Mira Stone", realm: "Forever", className: "Priest", race: null, level: 60, memberId: "member1", isMain: false, professions: [], refreshedAt: null },
  { key: "nora", name: "Nora Ash", realm: "Forever", className: "Mage", race: null, level: 60, memberId: null, isMain: null, professions: [], refreshedAt: null }
] };
const header = "character,realm,main\n";
describe("main/alt review plan", () => {
  it("detects supported GRM delimiters from exact headers without accepting private columns", () => {
    for (const separator of [",", ";", "~", "::", "||", "\\t", "\t"]) {
      const text = [["Name", "Main/Alt", "Realm Name"], ["Arden River", "Main", "Forever"]].map(row => row.join(separator)).join("\n");
      expect(parseMainPlan(text)).toEqual([{ character: "Arden River", realm: "Forever", main: true }]);
      expect(() => parseMainPlan(text.replace("Realm Name", `Realm Name${separator}Officer Note`))).toThrow();
    }
    expect(parseMainPlan('Name;Main/Alt;Realm Name\n"Name; included";Alt;Realm')[0]?.character).toBe("Name; included");
    expect(() => parseMainPlan("Name;Main/Alt;Realm Name\nArden,Main,Realm")).toThrow();
  });
  it("reads BOM, CRLF, quoted commas and escaped quotes without executing content", () => {
    expect(parseMainPlan('\uFEFFcharacter,realm,main\r\n"Name, with ""quote""",Realm,true\r\n')).toEqual([{ character: 'Name, with "quote"', realm: "Realm", main: true }]);
  });
  it("reads the narrow GRM export contract and keeps unset designations unknown", () => {
    expect(parseMainPlan("Name,Main/Alt,Realm Name\nArden River,Main,Forever\nMira Stone,Alt,Forever\nNora Ash,,Forever").map(row => row.main)).toEqual([true, false, null]);
    expect(reviewMainPlan(snapshot, "Name,Main/Alt,Realm Name\nArden River,,Forever")[0]?.status).toBe("unspecified");
    expect(() => parseMainPlan("Name,Main/Alt,Realm Name,Officer Note\nArden River,Main,Forever,private")).toThrow("header");
    expect(() => parseMainPlan("Name,Main/Alt,Realm Name\nArden River,Principal,Forever")).toThrow("row");
    expect(() => parseMainPlan("GRM_GuildMemberHistory_Save = {};")).toThrow("header");
  });
  it("rejects malformed fields, unsafe control text, wrong headers and bounded input", () => {
    for (const text of ["name,realm,main\nArden,,true", header, header + '"Arden,,true', header + "Arden,,yes", header + 'Ar"den,,true', header + "Arden,,true,extra", header + "Arden|h,,true", header + "a".repeat(8_001), header + "Arden,,true\n".repeat(51)]) expect(() => parseMainPlan(text)).toThrow();
  });
  it("shows a complete same-member main switch without mutating the snapshot", () => {
    const before = JSON.stringify(snapshot);
    expect(reviewMainPlan(snapshot, header + "Arden River,,false\nMira Stone,,true").map(row => row.status)).toEqual(["change", "change"]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("blocks duplicate identities, multiple or missing mains, unknown characters and unclaimed ownership", () => {
    expect(reviewMainPlan(snapshot, header + "Mira Stone,,true")[0]?.status).toBe("conflict");
    expect(reviewMainPlan(snapshot, header + "Arden River,,false")[0]?.status).toBe("conflict");
    expect(reviewMainPlan(snapshot, header + "Arden River,,true\nArden River,Forever,false").map(row => row.status)).toEqual(["duplicate", "duplicate"]);
    expect(reviewMainPlan(snapshot, header + "Arden Wrongname,,true\nNora Ash,,true").map(row => row.status)).toEqual(["unknown", "unclaimed"]);
  });
  it("requires a realm for Blizzard editions and refuses partial snapshots", () => {
    expect(reviewMainPlan({ ...snapshot, guild: { ...snapshot.guild, edition: "retail" } }, header + "Arden River,,true")[0]?.status).toBe("realm");
    expect(() => reviewMainPlan({ ...snapshot, truncated: true }, header + "Arden River,,true")).toThrow("partial");
  });
});

describe("private review page", () => {
  const auth = { clientId: "fixture", clientSecret: "fixture", sessionSecret: "local-test-only", siteUrl: "https://guilded.test" };
  const kit: WebKit = { page: (status, _title, body) => ({ status, body, headers: {} }), redirect: location => ({ status: 302, headers: { location }, body: "" }), signInPrompt: () => ({ status: 401, headers: {}, body: "" }) };
  const context = (method = "GET"): WebContext => ({ request: { method, path: "/me/roster/review", query: new URLSearchParams("guild=g1"), headers: { origin: auth.siteUrl } }, account: { id: "account", discordUserId: "officer", username: "Officer", displayName: null }, lang: "en", t: en => en, now: new Date(), auth, sessionToken: "session", csrf: csrfToken(auth.sessionSecret, "session"), form: null });
  it("downloads a revalidated before/after receipt with conflicts visible and no execution authority", async () => {
    const store = { guilds: vi.fn(async () => []), load: vi.fn(async (): Promise<RosterSnapshot | null> => snapshot) };
    const route = createRosterReview(store); const ctx = context("POST");
    ctx.form = new URLSearchParams({ csrf: ctx.csrf!, plan: header + "Mira Stone,,true", intent: "receipt" });
    const result = await route(ctx, kit);
    expect(result?.headers["content-disposition"]).toContain("attachment");
    expect(JSON.parse(result!.body)).toMatchObject({ previewOnly: true, applied: false, blockedRows: 1, rows: [{ character: "Mira Stone", current: false, main: true, status: "conflict" }] });
    store.load.mockResolvedValue(null);
    expect((await route(ctx, kit))?.status).toBe(403);
    expect(store.load).toHaveBeenCalledTimes(2);
    ctx.form.set("csrf", "invalid");
    expect((await route(ctx, kit))?.status).toBe(403);
    expect(store.load).toHaveBeenCalledTimes(2);
  });
  it("accepts URL-encoded international names through the real web app while retaining the decoded CSV limit", async () => {
    const memory = memoryWebStore();
    const account = await memory.store.upsertAccount({ id: "officer", username: "Officer", displayName: null }, new Date());
    await memory.store.createSession(account.id, hashToken("session"), new Date(Date.now() + 3_600_000));
    const store = { guilds: async () => [], load: async () => snapshot };
    const app = createWebApp({ store: memory.store, auth, allows: () => true, postApplication: async () => null, routes: [createRosterReview(store)] });
    const csv = header + Array.from({ length: 45 }, (_, i) => `${"É".repeat(70)}${i},Forever,true`).join("\n");
    const request = { method: "POST", path: "/me/roster/review", query: new URLSearchParams("guild=g1"), headers: { origin: auth.siteUrl, cookie: `${SESSION_COOKIE}=${sign(auth.sessionSecret, "session")}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf: csrfToken(auth.sessionSecret, "session"), plan: csv }).toString() };
    expect(request.body.length).toBeGreaterThan(16_000);
    expect((await app.respond(request))?.status).toBe(200);
    request.body = new URLSearchParams({ csrf: csrfToken(auth.sessionSecret, "session"), plan: "a".repeat(8_001) }).toString();
    expect((await app.respond(request))?.status).toBe(400);
  });
  it("rechecks current access and CSRF before previewing and exposes no execution control", async () => {
    const store = { guilds: vi.fn(async () => []), load: vi.fn(async () => snapshot) };
    const route = createRosterReview(store);
    const ctx = context("POST");
    expect((await route(ctx, kit))?.status).toBe(403);
    expect(store.load).not.toHaveBeenCalled();
    ctx.form = new URLSearchParams({ csrf: ctx.csrf!, plan: header + "Arden River,,false\nMira Stone,,true" });
    const result = await route(ctx, kit);
    expect(result?.status).toBe(200);
    expect(store.load).toHaveBeenCalledWith("officer", "g1");
    expect(result?.body).toContain("nothing saved");
    expect(result?.body).not.toContain("Apply changes");
    ctx.request.headers.origin = "https://other.test";
    expect((await route(ctx, kit))?.status).toBe(403);
    expect(store.load).toHaveBeenCalledTimes(1);
  });
  it("escapes input, blocks unsigned reads, partial data and unexpected methods", async () => {
    const store = { guilds: vi.fn(async () => []), load: vi.fn(async () => snapshot) };
    const route = createRosterReview(store); const ctx = context("POST");
    ctx.form = new URLSearchParams({ csrf: ctx.csrf!, plan: header + "<script>,,true" });
    const result = await route(ctx, kit);
    expect(result?.body).not.toContain("<script>"); expect(result?.body).toContain("&lt;script&gt;");
    ctx.account = null; expect((await route(ctx, kit))?.status).toBe(401);
    expect((await route(context("DELETE"), kit))?.status).toBe(405);
    store.load.mockResolvedValue({ ...snapshot, truncated: true });
    expect((await route(context(), kit))?.status).toBe(409);
  });
});
