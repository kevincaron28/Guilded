import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index.mjs";
import { ADS_TXT, adPage, adsCsp, withAds } from "../worker/ads.mjs";
import { CONSENT_SCRIPT } from "../worker/consent-script.mjs";

afterEach(() => vi.unstubAllGlobals());
const STRICT = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const page = (csp = STRICT) => new Response("<html><body><main>hi</main><footer></footer></body></html>", { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": csp } });
const envWith = (extra: Record<string, string> = {}) => ({ ASSETS: { fetch: vi.fn(async () => page()) }, ...extra });
const get = (host: string, path: string) => new Request(`https://${host}${path}`);

describe("ads.txt", () => {
  it("is exactly the AdSense line on every host, with ads off, and is never redirected", async () => {
    expect(ADS_TXT).toBe("google.com, pub-6948243189424271, DIRECT, f08c47fec0942fa0\n");
    for (const host of ["guildedwow.com", "guilded.kcaron.top", "kcaron.top", "www.kcaron.top"]) {
      const response = await worker.fetch(get(host, "/ads.txt"), { ...envWith(), GUILDED_CANONICAL_HOST: "guildedwow.com" });
      expect(response.status, host).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(await response.text()).toBe(ADS_TXT);
    }
  });
});

describe("the switch is off by default", () => {
  it("adds no banner script and keeps the strict policy on an ad-eligible page", async () => {
    const response = await worker.fetch(get("guildedwow.com", "/guide/dungeons/"), envWith());
    const html = await response.text();
    expect(html).not.toContain("consent.js");
    expect(response.headers.get("content-security-policy")).toBe(STRICT);
    const script = await worker.fetch(get("guildedwow.com", "/consent.js"), envWith());
    expect(await script.text()).not.toContain("guilded_ad_consent");
  });
  it("also stays off for any value but on", async () => {
    const out = await withAds(get("guildedwow.com", "/"), { GUILDED_ADS: "false" }, page());
    expect(await out.text()).not.toContain("consent.js");
  });
});

describe("page allow-list", () => {
  const url = (host: string, path: string) => new URL(`https://${host}${path}`);
  it("allows the public pages", () => {
    for (const path of ["/", "/fr/", "/guide/dungeons/", "/guide/epgp/", "/fr/guide/dungeons/", "/leaderboards/", "/leaderboards/?lang=fr", "/forever/leaderboards/", "/leaderboards/character/Kevin-Forever", "/players/x", "/g/quebec-gold/"]) expect(adPage(url("guildedwow.com", path)), path).toBe(true);
    for (const path of ["/", "/creator/"]) expect(adPage(url("kcaron.top", path)), path).toBe(true);
  });
  it("refuses downloads, install, companion, sign-in, accounts, officers and program fetches", () => {
    for (const path of ["/download/", "/companion/", "/start/", "/guide/install/", "/guide/companion/", "/guide/start/", "/guide/officers/", "/guide/self-host/", "/me/", "/me/settings", "/auth/login", "/owner/", "/officers/", "/recruitment/", "/docs/PRIVACY", "/forever/", "/api/v1/hub", "/downloads/Guilded.Companion.Setup.exe", "/releases.json", "/leaderboards/summary.json", "/leaderboards/run/r1/card.png", "/health", "/g/quebec-gold/extra", "/community/"]) expect(adPage(url("guildedwow.com", path)), path).toBe(false);
    expect(adPage(url("kcaron.top", "/support"))).toBe(false);
    expect(adPage(url("kcaron.top", "/ads.txt"))).toBe(false);
  });
});

describe("switch on", () => {
  const on = { GUILDED_ADS: "on" };
  it("injects the banner script and widens the policy only on allowed HTML pages", async () => {
    const out = await withAds(get("guildedwow.com", "/guide/dungeons/"), on, page());
    const html = await out.text();
    expect(html).toContain('<script src="/consent.js" defer></script></body>');
    const csp = out.headers.get("content-security-policy")!;
    expect(csp).toContain("script-src 'self' https://pagead2.googlesyndication.com");
    expect(csp).toContain("frame-src https://googleads.g.doubleclick.net");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    const refused = await withAds(get("guildedwow.com", "/download/"), on, page());
    expect(await refused.text()).not.toContain("consent.js");
    expect(refused.headers.get("content-security-policy")).toBe(STRICT);
  });
  it("leaves POSTs, errors and non-HTML alone", async () => {
    const post = await withAds(new Request("https://guildedwow.com/leaderboards/", { method: "POST" }), on, page());
    expect(await post.text()).not.toContain("consent.js");
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(await (await withAds(get("guildedwow.com", "/leaderboards/"), on, json)).text()).toBe("{}");
    const missing = new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
    expect((await withAds(get("guildedwow.com", "/leaderboards/"), on, missing)).status).toBe(404);
  });
  it("widens a bot page's default-src 'none' policy only for Google's hosts", () => {
    const bot = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
    const csp = adsCsp(bot);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self' https://pagead2.googlesyndication.com");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).not.toMatch(/script-src[^;]*\*(?:[ ;]|$)/);
  });
  it("serves the script and answers through the Worker on an allowed page and the creator page", async () => {
    const env = envWith(on);
    expect((await (await worker.fetch(get("guildedwow.com", "/consent.js"), env)).text())).toContain("guilded_ad_consent");
    const creator = await worker.fetch(get("kcaron.top", "/"), env);
    expect(await creator.text()).toContain("consent.js");
  });
});

interface Fake { tag: string; className?: string; textContent?: string; src?: string; async?: boolean; crossOrigin?: string; children: Fake[]; listeners: Record<string, () => void>; style: object; parentNode: null; setAttribute(): void; appendChild(child: Fake): Fake; addEventListener(type: string, fn: () => void): void }
describe("consent script", () => {
  function run(lang: string, stored: string | null, storageThrows = false) {
    const make = (tag: string): Fake => ({ tag, children: [], listeners: {}, style: {}, parentNode: null, setAttribute() {}, appendChild(child: Fake) { this.children.push(child); return child; }, addEventListener(type: string, fn: () => void) { this.listeners[type] = fn; } });
    const head = make("head"); const body = make("body"); const footer = make("footer");
    const store = new Map<string, string>(stored ? [["guilded_ad_consent", stored]] : []);
    const document = { documentElement: { lang }, readyState: "complete", head, body, getElementById: () => null, createElement: make, querySelector: () => footer, addEventListener: () => undefined };
    const win: Record<string, unknown> = {};
    const localStorage = storageThrows ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    vm.runInNewContext(CONSENT_SCRIPT, { window: Object.assign(win, { localStorage, location: { reload: vi.fn() }, document }), document });
    const scripts = () => head.children.filter((c) => c.tag === "script");
    const banner = () => body.children.find((c) => c.className === "gc-banner");
    const buttons = () => banner()?.children[1]?.children ?? [];
    const click = (index: number) => buttons()[index]?.listeners["click"]?.();
    return { footer, store, scripts, banner, buttons, click, win };
  }
  it("loads nothing before a choice, and shows both buttons", () => {
    const { scripts, buttons, footer } = run("en", null);
    expect(scripts()).toHaveLength(0);
    expect(buttons().map((b) => b.textContent)).toEqual(["Accept", "Decline"]);
    expect(buttons()[0]?.className).toBe(buttons()[1]?.className);
    expect(footer.children.length).toBe(1);
  });
  it("is French on a French page", () => {
    expect(run("fr-CA", null).buttons().map((b) => b.textContent)).toEqual(["Accepter", "Refuser"]);
  });
  it("Accept loads AdSense personalised; Decline loads it non-personalised; the choice is remembered", () => {
    const a = run("en", null);
    a.click(0);
    const s = a.scripts()[0];
    expect(s?.src).toBe("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6948243189424271");
    expect(s?.async).toBe(true);
    expect(s?.crossOrigin).toBe("anonymous");
    expect(a.store.get("guilded_ad_consent")).toBe("accept");
    expect((a.win["adsbygoogle"] as { requestNonPersonalizedAds?: number }).requestNonPersonalizedAds).toBeUndefined();
    const d = run("en", null);
    d.click(1);
    expect(d.scripts()).toHaveLength(1);
    expect((d.win["adsbygoogle"] as { requestNonPersonalizedAds?: number }).requestNonPersonalizedAds).toBe(1);
    expect(d.store.get("guilded_ad_consent")).toBe("decline");
    expect(run("en", "decline").scripts()).toHaveLength(1);
    expect(run("en", "decline").banner()).toBeUndefined();
    expect(run("en", "accept").scripts()).toHaveLength(1);
  });
  it("survives blocked storage", () => {
    const r = run("en", null, true);
    expect(r.scripts()).toHaveLength(0);
    r.click(0);
    expect(r.scripts()).toHaveLength(1);
  });
});

describe("configuration in wrangler.jsonc", () => {
  it("sets the canonical host and the ads switch, and keeps the other variables and all five domains", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(config.vars.GUILDED_CANONICAL_HOST).toBe("guildedwow.com");
    expect(config.vars.GUILDED_ADS).toBe("on");
    expect(config.vars.GUILDED_ORIGIN_URL).toBe("https://bot.kcaron.top");
    expect(config.keep_vars).toBe(true);
    expect(config.routes.map((route: { pattern: string }) => route.pattern).sort()).toEqual(["guilded.kcaron.top", "guildedwow.com", "kcaron.top", "www.guildedwow.com", "www.kcaron.top"]);
  });
});
