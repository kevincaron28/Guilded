import { afterEach, describe, expect, it, vi } from "vitest";
import { companionSignInRoute, confirmCode, createCompanionSignIn } from "../src/services/companion-signin.js";
import { createWebApp, type WebRequest, type WebResponse } from "../src/services/web-app.js";
import { startSignIn, waitForSignIn } from "../companion/engine.mjs";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const SITE = "https://guilded.kcaron.top";
const NOW = new Date("2026-11-10T20:00:00Z");

afterEach(() => { vi.unstubAllGlobals(); });

describe("companion sign-in requests", () => {
  it("hands the grant out once, after approval, and expires after 10 minutes", () => {
    let now = NOW.getTime();
    const signIn = createCompanionSignIn({ now: () => now });
    const started = signIn.start()!;
    expect(started.confirm).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    expect(signIn.poll(started.requestId)).toBe("pending");
    expect(signIn.poll("x".repeat(43))).toBe("expired");
    expect(signIn.confirmFor(started.requestId)).toBe(started.confirm);
    const grant = { companionCredential: "c".repeat(43), guildDiscordId: "111" };
    expect(signIn.approve(started.requestId, grant)).toBe(true);
    expect(signIn.approve(started.requestId, { companionCredential: "d".repeat(43), personal: true })).toBe(false);
    expect(signIn.confirmFor(started.requestId)).toBeNull();
    expect(signIn.poll(started.requestId)).toEqual(grant);
    expect(signIn.poll(started.requestId)).toBe("expired");
    const late = signIn.start()!;
    now += 10 * 60_000 + 1;
    expect(signIn.poll(late.requestId)).toBe("expired");
    expect(signIn.approve(late.requestId, grant)).toBe(false);
  });

  it("reads codes without look-alike letters", () => {
    expect(confirmCode(Buffer.from([0, 1, 2, 3, 4, 5]))).toBe("ABC-DEF");
    expect(confirmCode(Buffer.from([31, 31, 31, 31, 31, 31]))).toBe("999-999");
  });
});

describe("/me/companion", () => {
  function setup(servers = [{ discordId: "111", name: "Quebec Gold" }]) {
    const signIn = createCompanionSignIn({ now: () => NOW.getTime() });
    const issued: string[] = [];
    const route = companionSignInRoute({
      signIn,
      servers: async () => servers,
      issueGuild: async (account, guildDiscordId) => { issued.push(`${account.discordUserId}@${guildDiscordId}`); return "g".repeat(43); },
      issuePersonal: async (accountId) => { issued.push(`personal:${accountId}`); return "p".repeat(43); }
    });
    const app = createWebApp({
      store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: SITE, sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null,
      routes: [route], now: () => NOW,
      fetch: (async (url: string) => String(url).endsWith("/token") ? Response.json({ access_token: "t" }) : Response.json({ id: "222222222222222222", username: "kev" })) as unknown as typeof fetch
    });
    const request = (method: string, target: string, headers: WebRequest["headers"] = {}, body?: string) => {
      const url = new URL(target, SITE);
      return app.respond({ method, path: url.pathname, query: url.searchParams, headers, ...(body !== undefined ? { body } : {}) }) as Promise<WebResponse>;
    };
    async function signedIn(returnPath: string) {
      const login = await request("GET", `/auth/login?return=${encodeURIComponent(returnPath)}`);
      const state = new URL(String(login.headers["location"])).searchParams.get("state");
      const callback = await request("GET", `/auth/callback?code=c&state=${state}`, { cookie: String((login.headers["set-cookie"] as string[])[0]).split(";")[0] });
      const cookie = (callback.headers["set-cookie"] as string[]).find((c) => c.startsWith("__Host-guilded_session="))!.split(";")[0]!;
      return { cookie, location: String(callback.headers["location"]) };
    }
    return { signIn, request, signedIn, issued };
  }

  it("asks for Discord sign-in, then returns to the same request", async () => {
    const { signIn, request, signedIn } = setup();
    const started = signIn.start()!;
    const page = await request("GET", `/me/companion?request=${started.requestId}`);
    expect(page.status).toBe(401);
    const login = /href="(\/auth\/login\?[^"]+)"/.exec(page.body)![1]!.replaceAll("&amp;", "&");
    const back = new URL(login, SITE).searchParams.get("return")!;
    const { location } = await signedIn(back);
    expect(location).toBe(back);
    expect((await request("GET", "/me/companion?request=nope")).status).toBe(410);
  });

  it("links the chosen server after the member checks the code, once", async () => {
    const { signIn, request, signedIn, issued } = setup();
    const started = signIn.start()!;
    const target = `/me/companion?request=${started.requestId}`;
    const { cookie } = await signedIn(target);
    const page = await request("GET", target, { cookie });
    expect(page.status).toBe(200);
    expect(page.body).not.toContain(started.confirm);
    expect(page.body).toContain("Quebec Gold");
    expect(page.body).toContain('value="personal"');
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1]!;
    const form = { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" };
    const body = (choice: string) => `csrf=${encodeURIComponent(csrf)}&request=${encodeURIComponent(started.requestId)}&choice=${choice}&code=${started.confirm.toLowerCase().replace("-", "")}`;
    const noCode = `csrf=${encodeURIComponent(csrf)}&request=${encodeURIComponent(started.requestId)}&choice=111`;
    expect((await request("POST", "/me/companion", form, noCode)).status).toBe(400);
    expect((await request("POST", "/me/companion", form, `${noCode}&code=ZZZ-ZZZ`)).status).toBe(400);
    expect(issued).toEqual([]);
    expect((await request("POST", "/me/companion", { ...form, origin: "https://evil.example" }, body("111"))).status).toBe(403);
    expect((await request("POST", "/me/companion", form, body("999"))).status).toBe(400);
    const done = await request("POST", "/me/companion", form, body("111"));
    expect(done.status).toBe(200);
    expect(done.body).toContain("Companion connected");
    expect(issued).toEqual(["222222222222222222@111"]);
    expect(signIn.poll(started.requestId)).toEqual({ companionCredential: "g".repeat(43), guildDiscordId: "111" });
    expect((await request("POST", "/me/companion", form, body("111"))).status).toBe(410);
  });

  it("offers the public leaderboards when the member is in no Guilded server", async () => {
    const { signIn, request, signedIn, issued } = setup([]);
    const started = signIn.start()!;
    const target = `/me/companion?request=${started.requestId}&lang=fr`;
    const { cookie } = await signedIn(target);
    const page = await request("GET", target, { cookie });
    expect(page.body).toContain("Classements publics des donjons seulement");
    expect(page.body).toContain('value="personal" checked');
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1]!;
    await request("POST", "/me/companion", { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, `csrf=${encodeURIComponent(csrf)}&request=${encodeURIComponent(started.requestId)}&choice=personal&lang=fr&code=${started.confirm}`);
    expect(issued[0]).toMatch(/^personal:/);
    expect(signIn.poll(started.requestId)).toEqual({ companionCredential: "p".repeat(43), personal: true });
  });
});

describe("companion engine sign-in", () => {
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

  it("starts at the hosted bot when no address is set and checks the page address", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(200, { requestId: "r".repeat(43), confirm: "ABC-DEF", url: `${SITE}/me/companion?request=x` }));
    vi.stubGlobal("fetch", fetch);
    const started = await startSignIn({ uploadUrl: "" });
    expect(started).toMatchObject({ ok: true, confirm: "ABC-DEF", uploadUrl: `${SITE}/api/v1/addon-imports` });
    expect(String(fetch.mock.calls[0]![0])).toBe(`${SITE}/api/v1/companion/sign-in`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(404, { error: "Not found" })));
    expect((await startSignIn({ uploadUrl: "" })).message).toContain("pairing code");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { requestId: "r".repeat(43), confirm: "ABC-DEF", url: "http://evil.example/" })));
    expect((await startSignIn({ uploadUrl: "" })).ok).toBe(false);
  });

  it("waits while pending and returns the same result as a pairing code", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(202, { status: "pending" }))
      .mockResolvedValueOnce(reply(200, { companionCredential: "c".repeat(43), guildDiscordId: "111" }));
    vi.stubGlobal("fetch", fetch);
    const result = await waitForSignIn({ uploadUrl: "" }, "r".repeat(43), { sleep: async () => {} });
    expect(result).toMatchObject({ ok: true, personal: false, companionCredential: "c".repeat(43), guildDiscordId: "111", uploadUrl: `${SITE}/api/v1/addon-imports` });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(410, { error: "This sign-in expired." })));
    expect((await waitForSignIn({ uploadUrl: "" }, "r".repeat(43), { sleep: async () => {} })).message).toContain("expired");
  });
});
