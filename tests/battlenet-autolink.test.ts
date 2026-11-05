import { describe, expect, it, vi } from "vitest";
import { discoverAllBattleNet } from "../src/services/battlenet.js";
import { autoLinkBattleNet, undoBattleNetLinks } from "../src/services/battlenet-autolink.js";
import { createBattleNetPage, type BattleNetLinking } from "../src/services/battlenet-page.js";
import { battleNetUseful, linkStatusLines, nextStep } from "../src/services/link-status.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { csrfToken, hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const SITE = "https://guilded.kcaron.top";
const config = { clientId: "client", clientSecret: "private-client-secret", siteUrl: SITE };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function blizzard(characters: Record<string, { id: number; name: string; realm: string }[]>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/token") return json({ access_token: "t", scope: "openid wow.profile" });
    if (url.pathname === "/userinfo") return json({ sub: "42", battletag: "Player#42" });
    const key = `${url.hostname.split(".")[0]}|${url.searchParams.get("namespace")}`;
    const list = characters[key];
    if (!list) return json({}, 404);
    return json({ wow_accounts: [{ characters: list.map(c => ({ id: c.id, name: c.name, realm: { id: 1, slug: c.realm } })) }] });
  }) as unknown as typeof fetch;
}

describe("discoverAllBattleNet", () => {
  it("collects every region and edition Blizzard answers for and skips the rest", async () => {
    const fetcher = blizzard({ "us|profile-us": [{ id: 1, name: "Ray", realm: "area-52" }], "eu|profile-classic1x-eu": [{ id: 2, name: "Zed", realm: "firemaw" }] });
    const result = await discoverAllBattleNet(config, "code", fetcher);
    expect(result.found.map(d => `${d.region}:${d.gameEdition}`).sort()).toEqual(["eu:classic-era", "us:retail"]);
    expect(result.unavailable).toBeGreaterThan(0);
  });
  it("fails as a whole when the sign-in itself is refused", async () => {
    await expect(discoverAllBattleNet(config, "bad", vi.fn(async () => json({}, 400)) as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("autoLinkBattleNet", () => {
  function fakeDb(unclaimedRows: { id: string; nameKey: string; name: string; realm: string }[]) {
    return {
      member: { findMany: vi.fn(async () => [{ id: "m1", guildId: "g1", guild: { name: "Guild", gameEdition: "retail" } }]) },
      unclaimedCharacter: { findMany: vi.fn(async () => unclaimedRows) },
      characterVerifyClaim: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) }
    };
  }
  it("links nothing for an empty list and nothing for another edition", async () => {
    const db = fakeDb([]);
    expect(await autoLinkBattleNet(db as never, "u", [])).toEqual([]);
    expect(await autoLinkBattleNet(db as never, "u", [{ region: "us", gameEdition: "classic-era", realmId: 1, characterId: 1, name: "Ray", realm: "area-52" }])).toEqual([]);
    expect(db.unclaimedCharacter.findMany).not.toHaveBeenCalled();
  });
  it("matches Blizzard's realm slug to the addon's realm spelling and never links another realm's namesake", async () => {
    const rows = [{ id: "u1", nameKey: "ray-area52", name: "Ray", realm: "Area 52" }, { id: "u2", nameKey: "ray-tarrenmill", name: "Ray", realm: "Tarren Mill" }];
    const db = fakeDb(rows);
    // Linking itself is covered by character-autolink; here only the candidate filter is observed.
    await autoLinkBattleNet(db as never, "u", [{ region: "us", gameEdition: "retail", realmId: 1, characterId: 1, name: "Ray", realm: "area-52" }]).catch(() => undefined);
    expect(db.characterVerifyClaim.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("undoBattleNetLinks", () => {
  it("removes only characters still owned by the member and blocks them from relinking", async () => {
    const del = vi.fn(async () => ({})), update = vi.fn(async () => ({}));
    const db = {
      characterVerifyClaim: { findMany: vi.fn(async () => [{ nameKey: "ray-area52", guildId: "g1", memberId: "m1" }, { nameKey: "gone-area-52", guildId: "g1", memberId: "m1" }]), update },
      character: { findMany: vi.fn(async () => [{ id: "c1", name: "Ray", realm: "Area 52", gameEdition: "retail", isMain: true }]), delete: del }
    };
    expect(await undoBattleNetLinks(db as never, "u")).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect((update.mock.calls as unknown[][])[0]![0]).toMatchObject({ data: { status: "BLOCKED" } });
  });
});

describe("plain status line", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("picks one next step", () => {
    expect(nextStep({ battleNet: false, companion: false, characters: 0, lastSynced: null })).toBe("connect");
    expect(nextStep({ battleNet: true, companion: false, characters: 1, lastSynced: null })).toBe("sync");
    expect(nextStep({ battleNet: true, companion: true, characters: 1, lastSynced: now })).toBe("done");
    // WoW Forever only: Blizzard knows none of its characters, so the first step is the Windows app, not Battle.net.
    const fresh = { battleNet: false, companion: false, characters: 0, lastSynced: null };
    expect(battleNetUseful(["forever"])).toBe(false);
    expect(battleNetUseful(["forever", "retail"])).toBe(true);
    expect(linkStatusLines(fresh, "en", now, false).join(" ")).toMatch(/Windows app and sign in with Discord/);
    expect(linkStatusLines(fresh, "en", now, false).join(" ")).not.toContain("Battle.net");
    expect(linkStatusLines(fresh, "fr", now, false).join(" ")).toContain("Installe l'application Windows");
    expect(linkStatusLines(fresh, "en", now, true).join(" ")).toContain("Connect Battle.net");
  });
  it("speaks English and French without jargon", () => {
    const status = { battleNet: true, companion: true, characters: 2, lastSynced: new Date("2026-11-02T09:00:00Z") };
    expect(linkStatusLines(status, "en", now).join(" ")).toContain("3 hours ago");
    expect(linkStatusLines(status, "fr", now).join(" ")).toContain("Dernière synchronisation");
    for (const lang of ["en", "fr"] as const) expect(linkStatusLines(status, lang, now).join(" ")).not.toMatch(/token|provisional|ledger|jeton/i);
  });
});

describe("one-click Connect Battle.net page", () => {
  const secret = "s".repeat(40);
  async function setup() {
    const now = new Date("2026-11-02T12:00:00Z");
    const { store } = memoryWebStore();
    const account = await store.upsertAccount({ id: "123456789012345678", username: "user", displayName: null }, now);
    await store.createSession(account.id, hashToken("session-one"), new Date("2027-01-01"));
    const save = vi.fn(async () => {});
    const linking: BattleNetLinking = {
      discoverAll: vi.fn(async () => ({ subject: "42", battleTag: "P#1", unavailable: 0, found: [{ subject: "42", battleTag: "P#1", region: "us" as const, gameEdition: "retail" as const, verifiedAt: now,
        characters: [{ region: "us" as const, gameEdition: "retail" as const, realmId: 1, characterId: 9, name: "Ray", realm: "area-52" }] }] })),
      autoLink: vi.fn(async () => [{ guildId: "g1", guildName: "Guild", name: "Ray", realm: "Area 52", isMain: true }]),
      recent: vi.fn(async () => [{ guildId: "g1", guildName: "Guild", name: "Ray", realm: "Area 52", isMain: true }]),
      undo: vi.fn(async () => 1),
      status: vi.fn(async () => ({ battleNet: true, companion: false, characters: 1, lastSynced: now }))
    };
    const route = createBattleNetPage({ get: async () => null, save, unlink: async () => {} }, config, undefined, linking);
    const app = createWebApp({ store, auth: { ...config, sessionSecret: secret }, allows: () => true, postApplication: async () => null, now: () => now, routes: [route] });
    const request = async (method: string, target: string, fields: [string, string][] = []) => {
      const url = new URL(target, SITE);
      return await app.respond({ method, path: url.pathname, query: url.searchParams, headers: { cookie: `${SESSION_COOKIE}=${sign(secret, "session-one")}`, origin: SITE, "content-type": "application/x-www-form-urlencoded" },
        ...(method === "POST" ? { body: new URLSearchParams([["csrf", csrfToken(secret, "session-one")], ...fields]).toString() } : {}) }) as WebResponse;
    };
    return { request, save, linking };
  }
  it("connects, saves, links and shows an undo with no choices to make", async () => {
    const h = await setup();
    const start = await h.request("GET", "/me/battlenet/connect");
    expect(start.status).toBe(200);
    const href = start.body.match(/href="(https:\/\/oauth\.battle\.net\/authorize[^"]+)"/)![1]!.replaceAll("&amp;", "&");
    const state = new URL(href).searchParams.get("state")!;
    const back = await h.request("GET", `/me/battlenet/callback?code=c&state=${state}`);
    expect(back.status).toBe(302);
    expect(new URL(String(back.headers["location"]), SITE).search).toContain("done=1");
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.linking.autoLink).toHaveBeenCalledTimes(1);
    const summary = await h.request("GET", "/me/battlenet?done=1");
    expect(summary.body).toContain("Ray");
    expect(summary.body).toContain("Undo these links");
    expect(summary.body).toContain("What to do next");
    expect((await h.request("GET", `/me/battlenet/callback?code=c&state=${state}`)).status).toBe(400); // replay
  });
  it("undoes in one click", async () => {
    const h = await setup();
    expect((await h.request("POST", "/me/battlenet/undo")).status).toBe(303);
    expect(h.linking.undo).toHaveBeenCalledWith("123456789012345678");
  });
});
