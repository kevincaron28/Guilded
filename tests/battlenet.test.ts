import { describe, expect, it, vi } from "vitest";
import { battleNetAuthorize, battleNetConfig, discoverBattleNet, discoveredKey, type BattleNetDiscovery } from "../src/services/battlenet.js";
import { createBattleNetPage } from "../src/services/battlenet-page.js";
import { prismaBattleNetStore, selectDiscovered } from "../src/services/battlenet-store.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { csrfToken, hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const SITE = "https://guilded.kcaron.top";
const config = { clientId: "client", clientSecret: "private-client-secret", siteUrl: SITE };
const secret = "s".repeat(40);
const fixture: BattleNetDiscovery = { subject: "123", battleTag: "Player#123", region: "us", gameEdition: "retail", verifiedAt: new Date("2026-10-29T12:00:00Z"), characters: [
  { region: "us", gameEdition: "retail", characterId: 100, realmId: 1, name: "Same", realm: "realm-one" },
  { region: "us", gameEdition: "retail", characterId: 200, realmId: 2, name: "Same", realm: "realm-two" }
] };
async function setup(enabled = true) {
  let now = new Date("2026-10-29T12:00:00Z");
  const { store } = memoryWebStore();
  const account = await store.upsertAccount({ id: "123456789012345678", username: "user", displayName: null }, now);
  for (const token of ["session-one", "session-two"]) await store.createSession(account.id, hashToken(token), new Date("2027-01-01"));
  const save = vi.fn(async () => {}), unlink = vi.fn(async () => {}), discover = vi.fn(async () => fixture);
  const route = createBattleNetPage({ get: async () => null, save, unlink }, enabled ? config : null, discover);
  const app = createWebApp({ store, auth: { ...config, sessionSecret: secret }, allows: () => true, postApplication: async () => null, now: () => now, routes: [route] });
  const request = async (method: string, target: string, fields: [string, string][] = [], token = "session-one", origin = SITE) => {
    const url = new URL(target, SITE);
    return await app.respond({ method, path: url.pathname, query: url.searchParams, headers: { cookie: `${SESSION_COOKIE}=${sign(secret, token)}`, origin, "content-type": "application/x-www-form-urlencoded" }, ...(method === "POST" ? { body: new URLSearchParams([["csrf", csrfToken(secret, token)], ...fields]).toString() } : {}) }) as WebResponse;
  };
  const start = async () => {
    const response = await request("POST", "/me/battlenet/start", [["region", "us"], ["gameEdition", "retail"]]);
    const href = response.body.match(/href="(https:\/\/oauth\.battle\.net\/authorize[^\"]+)"/)![1]!.replaceAll("&amp;", "&");
    return new URL(href).searchParams.get("state")!;
  };
  const preview = async () => {
    const state = await start();
    const result = await request("GET", `/me/battlenet/callback?code=code&state=${state}`);
    return new URL(String(result.headers["location"]), SITE).searchParams.get("preview")!;
  };
  return { request, start, preview, save, unlink, discover, advance: () => { now = new Date(now.getTime() + 11 * 60_000); } };
}

describe("Battle.net linking and consent", () => {
  it("is optional and does not expose client secrets in the authorization URL", async () => {
    expect(battleNetConfig({})).toBeNull();
    const url = battleNetAuthorize(config, "state");
    expect(url).not.toContain(config.clientSecret);
    expect(new URL(url).searchParams.get("scope")).toBe("openid wow.profile");
    const h = await setup(false);
    expect((await h.request("GET", "/me/battlenet")).body).toContain("not configured");
    expect((await h.request("POST", "/me/battlenet/start", [["region", "us"], ["gameEdition", "retail"]])).status).toBe(503);
  });
  it("requires same-origin CSRF protection before beginning authorization", async () => {
    const h = await setup();
    expect((await h.request("POST", "/me/battlenet/start", [["region", "us"], ["gameEdition", "retail"]], "session-one", "https://evil.test")).status).toBe(403);
    expect((await h.request("POST", "/me/battlenet/start", [["region", "us"], ["gameEdition", "forever"]])).status).toBe(400);
  });
  it("hands off with a link so strict form-action does not block Blizzard navigation", async () => {
    const h = await setup();
    const response = await h.request("POST", "/me/battlenet/start", [["region", "us"], ["gameEdition", "retail"]]);
    expect(response.status).toBe(200);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["content-security-policy"]).toContain("form-action 'self'");
    expect(response.body).toContain('rel="noreferrer" href="https://oauth.battle.net/authorize?');
    expect(response.body).not.toContain(config.clientSecret);
    expect(h.discover).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });
  it("binds OAuth state to the initiating session and consumes it once", async () => {
    const h = await setup(); const state = await h.start();
    expect((await h.request("GET", `/me/battlenet/callback?code=c&state=${state}`, [], "session-two")).status).toBe(400);
    expect(h.discover).not.toHaveBeenCalled();
    expect((await h.request("GET", `/me/battlenet/callback?code=c&state=${state}`)).status).toBe(302);
    expect((await h.request("GET", `/me/battlenet/callback?code=c&state=${state}`)).status).toBe(400);
    expect(h.discover).toHaveBeenCalledOnce(); expect(h.save).not.toHaveBeenCalled();
  });
  it("saves only the explicitly selected character after confirmation", async () => {
    const h = await setup(); const preview = await h.preview();
    const page = await h.request("GET", `/me/battlenet?preview=${preview}`);
    expect(page.body).toContain("realm-one"); expect(page.body).toContain("realm-two");
    expect(h.save).not.toHaveBeenCalled();
    const key = discoveredKey(fixture.characters[1]!);
    const fields: [string, string][] = [["preview", preview], ["characters", key], ["main", key]];
    expect((await h.request("POST", "/me/battlenet/confirm", fields, "session-two")).status).toBe(400);
    expect((await h.request("POST", "/me/battlenet/confirm", fields)).status).toBe(303);
    expect(h.save).toHaveBeenCalledWith(expect.any(String), fixture, [key], key);
    expect((await h.request("POST", "/me/battlenet/confirm", fields)).status).toBe(400);
    expect(h.save).toHaveBeenCalledOnce();
  });
  it("rejects forged selections, expired previews and unselected mains", async () => {
    expect(() => selectDiscovered(fixture, ["forged"], null)).toThrow();
    expect(() => selectDiscovered(fixture, [], discoveredKey(fixture.characters[0]!))).toThrow();
    const h = await setup(); const preview = await h.preview(); h.advance();
    expect((await h.request("POST", "/me/battlenet/confirm", [["preview", preview]])).status).toBe(400);
    expect(h.save).not.toHaveBeenCalled();
  });
  it("disconnecting clears in-flight discoveries so they cannot silently reconnect", async () => {
    const h = await setup(); const state = await h.start();
    expect((await h.request("POST", "/me/battlenet/unlink", [["confirm", "yes"]])).status).toBe(303);
    expect((await h.request("GET", `/me/battlenet/callback?code=c&state=${state}`)).status).toBe(400);
    expect(h.unlink).toHaveBeenCalledOnce();
  });
  it("refuses to transfer a provider identity between Guilded accounts", async () => {
    const upsert = vi.fn();
    const tx = { battleNetIdentity: { findUnique: async ({ where }: { where: { subject?: string } }) => where.subject ? { accountId: "other" } : null, upsert } };
    const store = prismaBattleNetStore({ $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as never);
    await expect(store.save("mine", fixture, [], null)).rejects.toThrow("another Guilded account");
    expect(upsert).not.toHaveBeenCalled();
  });
  it("discards a provider response that arrives after disconnect", async () => {
    const h = await setup(); const state = await h.start();
    let finish!: (value: BattleNetDiscovery) => void;
    h.discover.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const callback = h.request("GET", `/me/battlenet/callback?code=c&state=${state}`);
    await vi.waitFor(() => expect(h.discover).toHaveBeenCalledOnce());
    await h.request("POST", "/me/battlenet/unlink", [["confirm", "yes"]]);
    finish(fixture);
    expect((await callback).status).toBe(400);
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("Blizzard account discovery", () => {
  it("uses region/edition namespaces and keeps same-named characters distinct without following supplied URLs", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "private-access-token", scope: "openid wow.profile" }))
      .mockResolvedValueOnce(Response.json({ sub: "123", battletag: "User#123" }))
      .mockResolvedValueOnce(Response.json({ wow_accounts: [{ characters: fixture.characters.map(c => ({ id: c.characterId, name: c.name, realm: { id: c.realmId, slug: c.realm }, protected_character: { href: "https://evil.test/steal" } })) }] }));
    const result = await discoverBattleNet(config, "code", "eu", "classic-era", fetcher);
    expect(result.characters).toHaveLength(2);
    expect(result.characters.map(discoveredKey)).toEqual(["eu:classic-era:1:100", "eu:classic-era:2:200"]);
    expect(fetcher.mock.calls[2]![0]).toContain("namespace=profile-classic1x-eu");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain("private-access-token");
    expect(JSON.stringify(result)).not.toContain(config.clientSecret);
  });
  it("does not interpret provider failure as an empty roster or delete existing selections", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token" })).mockResolvedValueOnce(Response.json({ id: 123, battletag: "User#123" })).mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(discoverBattleNet(config, "c", "us", "retail", fetcher)).rejects.toThrow("could not provide");
  });
});
