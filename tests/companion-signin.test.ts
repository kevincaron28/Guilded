import { afterEach, describe, expect, it, vi } from "vitest";
import { companionSignInRoute, defaultDeviceName, confirmCode, createCompanionSignIn, SAME_BROWSER_COOKIE } from "../src/services/companion-signin.js";
import { createRequire } from "node:module";
import { createWebApp, type WebRequest, type WebResponse } from "../src/services/web-app.js";
import { startSignIn, waitForSignIn } from "../companion/engine.mjs";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const SITE = "https://guilded.kcaron.top";
const NOW = new Date("2026-11-10T20:00:00Z");

const { startSignInLoopback } = createRequire(import.meta.url)("../companion-app/sign-in-loopback.cjs") as { startSignInLoopback: (options?: { onProof?: (proof: string) => void }) => { ready: Promise<number>; proof: () => string | undefined; close: () => void } };

afterEach(() => { vi.unstubAllGlobals(); });

describe("companion sign-in requests", () => {
  it("hands the grant out once, after approval, and expires after 10 minutes", async () => {
    let now = NOW.getTime();
    const signIn = createCompanionSignIn({ now: () => now });
    const started = signIn.start()!;
    expect(started.confirm).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    expect(await signIn.poll(started.requestId)).toBe("pending");
    expect(await signIn.poll("x".repeat(43))).toBe("expired");
    expect(signIn.confirmFor(started.requestId)).toBe(started.confirm);
    const grant = { companionCredential: "c".repeat(43), guildDiscordId: "111" };
    expect(signIn.approve(started.requestId, grant)).toBe(true);
    expect(signIn.approve(started.requestId, { companionCredential: "d".repeat(43), personal: true })).toBe(false);
    expect(signIn.confirmFor(started.requestId)).toBeNull();
    expect(await signIn.poll(started.requestId)).toEqual(grant);
    expect(await signIn.poll(started.requestId)).toBe("expired");
    const late = signIn.start()!;
    now += 10 * 60_000 + 1;
    expect(await signIn.poll(late.requestId)).toBe("expired");
    expect(signIn.approve(late.requestId, grant)).toBe(false);
  });

  it("reads codes without look-alike letters", () => {
    expect(confirmCode(Buffer.from([0, 1, 2, 3, 4, 5]))).toBe("ABC-DEF");
    expect(confirmCode(Buffer.from([31, 31, 31, 31, 31, 31]))).toBe("999-999");
  });
  it("accepts only the displayed code format and expires after five failed attempts", async () => {
    const signIn = createCompanionSignIn();
    const started = signIn.start()!;
    expect(signIn.verifyConfirm(started.requestId, started.confirm.toLowerCase().replace("-", ""))).toBe(true);
    for (const code of ["", null, started.confirm + "!", started.confirm.repeat(1000), "---"]) {
      expect(signIn.verifyConfirm(started.requestId, code)).toBe(false);
    }
    expect(signIn.verifyConfirm(started.requestId, started.confirm)).toBe(false);
    expect(await signIn.poll(started.requestId)).toBe("expired");
  });
});

describe("/me/companion", () => {
  function setup(servers = [{ discordId: "111", name: "Quebec Gold" }], beforeIssue = async () => {}) {
    const signIn = createCompanionSignIn({ now: () => NOW.getTime() });
    const issued: string[] = [];
    const route = companionSignInRoute({
      signIn,
      servers: async () => servers,
      issueGuild: async (account, guildDiscordId) => { await beforeIssue(); issued.push(`${account.discordUserId}@${guildDiscordId}`); return "g".repeat(43); },
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
    expect(await signIn.poll(started.requestId)).toEqual({ companionCredential: "g".repeat(43), guildDiscordId: "111" });
    expect((await request("POST", "/me/companion", form, body("111"))).status).toBe(410);
  });

  it("chooses a member's only server and names the device by itself", async () => {
    const { signIn, request, signedIn, issued } = setup();
    const started = signIn.start()!;
    const target = `/me/companion?request=${started.requestId}`;
    const { cookie } = await signedIn(target);
    const agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    const page = await request("GET", target, { cookie, "user-agent": agent });
    expect(page.body).toContain('<input type="hidden" name="choice" value="111">');
    expect(page.body).not.toContain('type="radio"');
    expect(page.body).toContain('value="Windows PC (Chrome)"');
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1]!;
    // The leaderboards-only box under "Other choices" wins over the preselected server.
    await request("POST", "/me/companion", { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" },
      `csrf=${encodeURIComponent(csrf)}&request=${encodeURIComponent(started.requestId)}&choice=111&personalOnly=personal&code=${started.confirm}`);
    expect(issued[0]).toMatch(/^personal:/);
  });

  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "en", "Mac (Safari)"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0", "fr", "PC Windows (Edge)"],
    [undefined, "en", "My companion"]
  ] as const)("names a device from its browser: %s", (agent, lang, name) => {
    expect(defaultDeviceName(agent, lang)).toBe(name);
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
    expect(await signIn.poll(started.requestId)).toEqual({ companionCredential: "p".repeat(43), personal: true });
  });
  it("issues only one credential when two approval requests overlap", async () => {
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const issuing = new Promise<void>(resolve => { entered = resolve; });
    const beforeIssue = vi.fn(async () => { entered(); await waiting; });
    const { signIn, request, signedIn, issued } = setup(undefined, beforeIssue);
    const started = signIn.start()!;
    const target = `/me/companion?request=${started.requestId}`;
    const { cookie } = await signedIn(target);
    const page = await request("GET", target, { cookie });
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1]!;
    const form = { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" };
    const body = new URLSearchParams({ csrf, request: started.requestId, choice: "111", code: started.confirm }).toString();
    const first = request("POST", "/me/companion", form, body);
    await issuing;
    expect((await request("POST", "/me/companion", form, body)).status).toBe(410);
    release();
    expect((await first).status).toBe(200);
    expect(beforeIssue).toHaveBeenCalledOnce();
    expect(issued).toHaveLength(1);
    expect(await signIn.poll(started.requestId)).toMatchObject({ companionCredential: "g".repeat(43) });
  });
});

describe("/me/companion without a code", () => {
  function setup() {
    const signIn = createCompanionSignIn({ now: () => NOW.getTime() });
    const issued: string[] = [];
    const route = companionSignInRoute({
      signIn,
      servers: async () => [{ discordId: "111", name: "Quebec Gold" }],
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
    async function session(target: string) {
      const login = await request("GET", `/auth/login?return=${encodeURIComponent(target)}`);
      const state = new URL(String(login.headers["location"])).searchParams.get("state");
      const callback = await request("GET", `/auth/callback?code=c&state=${state}`, { cookie: String((login.headers["set-cookie"] as string[])[0]).split(";")[0] });
      return (callback.headers["set-cookie"] as string[]).find((c) => c.startsWith("__Host-guilded_session="))!.split(";")[0]!;
    }
    const form = (cookie: string, fields: Record<string, string>) => request("POST", "/me/companion", { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams(fields).toString());
    const csrfOf = (body: string) => /name="csrf" value="([^"]+)"/.exec(body)![1]!;
    return { signIn, request, session, form, csrfOf, issued };
  }

  it("approves in the online companion's own browser without asking for the code", async () => {
    const { signIn, request, session, form, csrfOf, issued } = setup();
    const started = signIn.start()!;
    const target = `/me/companion?request=${started.requestId}`;
    const cookie = `${await session(target)}; ${SAME_BROWSER_COOKIE}=${started.requestId}`;
    const page = await request("GET", target, { cookie });
    expect(page.body).not.toContain('name="code"');
    const done = await form(cookie, { csrf: csrfOf(page.body), request: started.requestId, choice: "111" });
    expect(done.status).toBe(200);
    expect(issued).toEqual(["222222222222222222@111"]);
    expect(await signIn.poll(started.requestId)).toMatchObject({ companionCredential: "g".repeat(43), guildDiscordId: "111" });
  });

  it("still asks for the code when the link came from someone else's companion", async () => {
    const { signIn, request, session, form, csrfOf, issued } = setup();
    const theirs = signIn.start()!, mine = signIn.start()!;
    const target = `/me/companion?request=${theirs.requestId}`;
    // This browser started a different request: that is no proof for the one in the link.
    const cookie = `${await session(target)}; ${SAME_BROWSER_COOKIE}=${mine.requestId}`;
    const page = await request("GET", target, { cookie });
    expect(page.body).toContain('name="code"');
    expect((await form(cookie, { csrf: csrfOf(page.body), request: theirs.requestId, choice: "111" })).status).toBe(400);
    expect(issued).toEqual([]);
  });

  it("sends the Windows app its proof through 127.0.0.1 and issues nothing until the app brings it", async () => {
    const { signIn, request, session, form, csrfOf, issued } = setup();
    const started = signIn.start({ loopback: 49152 })!;
    const target = `/me/companion?request=${started.requestId}`;
    const cookie = await session(target);
    const page = await request("GET", target, { cookie });
    expect(page.body).not.toContain('name="code"');
    const done = await form(cookie, { csrf: csrfOf(page.body), request: started.requestId, choice: "111" });
    expect(done.status).toBe(200);
    const back = /content="0;url=(http:\/\/127\.0\.0\.1:49152\/guilded-sign-in\?proof=[^"]+)"/.exec(done.body)![1]!.replaceAll("&amp;", "&");
    const proof = new URL(back).searchParams.get("proof")!;
    // Someone who started this request elsewhere polls without the proof: nothing, and nothing issued.
    expect(await signIn.poll(started.requestId)).toBe("pending");
    expect(await signIn.poll(started.requestId, "x".repeat(32))).toBe("pending");
    expect(issued).toEqual([]);
    expect(await signIn.poll(started.requestId, proof)).toMatchObject({ companionCredential: "g".repeat(43), guildDiscordId: "111" });
    expect(issued).toEqual(["222222222222222222@111"]);
    expect(await signIn.poll(started.requestId, proof)).toBe("expired");
  });

  it("ignores a loopback port that is not a plain local port number", () => {
    const signIn = createCompanionSignIn();
    for (const loopback of [80, 70000, "49152", 1.5, null]) expect(signIn.loopbackFor(signIn.start({ loopback })!.requestId)).toBeNull();
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

  it("gives the bot the app's local port and brings back the proof once it arrives", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(200, { requestId: "r".repeat(43), confirm: "ABC-DEF", url: `${SITE}/me/companion?request=x` }));
    vi.stubGlobal("fetch", fetch);
    await startSignIn({ uploadUrl: "" }, { loopback: 49152 });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ loopback: 49152 });
    let proof: string | undefined;
    const polls = vi.fn()
      .mockImplementationOnce(async () => { proof = "p".repeat(32); return reply(202, { status: "pending" }); })
      .mockResolvedValueOnce(reply(200, { companionCredential: "c".repeat(43), guildDiscordId: "111" }));
    vi.stubGlobal("fetch", polls);
    await waitForSignIn({ uploadUrl: "" }, "r".repeat(43), { sleep: async () => {}, proof: () => proof });
    expect(JSON.parse(polls.mock.calls[0]![1].body)).toEqual({ requestId: "r".repeat(43) });
    expect(JSON.parse(polls.mock.calls[1]![1].body)).toEqual({ requestId: "r".repeat(43), proof: "p".repeat(32) });
  });
});

describe("the Windows app's sign-in callback", () => {
  it("listens on 127.0.0.1 only and keeps the first well-formed proof", async () => {
    const onProof = vi.fn();
    const loopback = startSignInLoopback({ onProof });
    const port = await loopback.ready;
    try {
      expect((await globalThis.fetch(`http://127.0.0.1:${port}/guilded-sign-in?proof=short`)).status).toBe(404);
      expect((await globalThis.fetch(`http://127.0.0.1:${port}/other?proof=${"a".repeat(32)}`)).status).toBe(404);
      const ok = await globalThis.fetch(`http://127.0.0.1:${port}/guilded-sign-in?proof=${"a".repeat(32)}`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("Companion connected");
      await globalThis.fetch(`http://127.0.0.1:${port}/guilded-sign-in?proof=${"b".repeat(32)}`);
      expect(loopback.proof()).toBe("a".repeat(32));
      expect(onProof).toHaveBeenCalled();
    } finally { loopback.close(); }
  });
});
