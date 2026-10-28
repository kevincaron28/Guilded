import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createPlayerProfiles, decodeCursor, encodeCursor, PAGE_SIZE, prismaProfileStore, readPlayerFilters, type PlayerProfile, type ProfileStore } from "../src/services/player-profiles.js";
import { createWebApp } from "../src/services/web-app.js";
import { csrfToken, hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const profileId = "c111111111111111111111111";
const auth = { clientId: "123", clientSecret: "secret", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) };
function fixture() {
  const profile: PlayerProfile = { id: profileId, name: "<script>Player</script>", public: true,
    characters: [{ name: "Kev", realm: "Forever", source: "guild" }], runs: [] };
  const store: ProfileStore = {
    list: vi.fn(async () => profile.public ? [{ id: profile.id, character: profile.characters[0]!.name, realm: "Forever", className: "Mage", role: null, level: 60, guild: "Quebec Gold", sortKey: "kev" }] : []),
    get: vi.fn(async id => id === profile.id ? profile : null),
    visibility: vi.fn(async (_id, visible) => { profile.public = visible; })
  };
  const memory = memoryWebStore();
  const profiles = createPlayerProfiles(store);
  const app = createWebApp({ auth, store: memory.store, allows: () => true, postApplication: async () => null,
    routes: [profiles.route], meSections: [profiles.meSection] });
  const request = (path: string, method = "GET", body?: string, cookie?: string) => app.respond({
    method, path, query: new URLSearchParams(), headers: { origin: auth.siteUrl, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body } : {})
  });
  return { profile, store, memory, request };
}
describe("player profiles", () => {
  it("shows a Forever full name while keeping the existing character URL", async () => {
    const { profile, request } = fixture();
    profile.characters[0]!.displayName = "Kev Galemorne";
    const page = await request(`/players/${profileId}`);
    expect(page!.body).toContain('Kev-Forever');
    expect(page!.body).toContain('>Kev Galemorne</a>');
    expect(page!.body).not.toContain('character/Kev%20Galemorne');
  });
  it("shows public profiles and character results without requiring sign-in, with escaped names", async () => {
    const { request } = fixture();
    const page = await request(`/players/${profileId}`);
    expect(page!.status).toBe(200);
    expect(page!.headers["cache-control"]).toBe("no-store");
    expect(page!.body).toContain("&lt;script&gt;Player&lt;/script&gt;");
    expect(page!.body).toContain("/leaderboards/character/Kev-Forever");
    expect(page!.body).not.toContain("/me/pair");
    expect(page!.body).not.toContain("My applications");
    const directory = await request("/players/");
    expect(directory!.body).toContain(`/players/${profileId}`);
  });
  it("hides private profiles in both the directory and direct URL", async () => {
    const { profile, request } = fixture();
    profile.public = false;
    expect((await request(`/players/${profileId}`))!.status).toBe(404);
    expect((await request("/players/"))!.body).not.toContain(`/players/${profileId}`);
  });
  it("requires a session and CSRF for visibility changes, and always changes the signed-in account", async () => {
    const { memory, store, request } = fixture();
    expect((await request("/me/profile", "POST", "public=false"))!.status).toBe(401);
    const account = await memory.store.upsertAccount({ id: "discord", username: "me", displayName: null }, new Date());
    const token = "test-token";
    await memory.store.createSession(account.id, hashToken(token), new Date(Date.now() + 60_000));
    const cookie = `${SESSION_COOKIE}=${sign(auth.sessionSecret, token)}`;
    expect((await request("/me/profile", "POST", "public=false&csrf=wrong", cookie))!.status).toBe(403);
    expect(store.visibility).not.toHaveBeenCalled();
    const body = new URLSearchParams({ public: "false", csrf: csrfToken(auth.sessionSecret, token), accountId: profileId }).toString();
    expect((await request("/me/profile", "POST", body, cookie))!.status).toBe(303);
    expect(store.visibility).toHaveBeenCalledWith(account.id, false);
  });
  it("never associates every party member with an account or reads private dungeon records", async () => {
    const run = { id: "r", instanceId: 36, routeKey: "36", difficultyId: 0, dungeonName: "Deadmines", durationSec: 2000,
      endedAt: new Date(), deaths: 0, bracket: "15-24", season: "2026-Q4", confirmations: 1,
      players: [{ character: "Kev", realm: "Forever", className: "Priest", role: "HEALER", level: 20 },
        { character: "PartyMember", realm: "Forever", className: "Warrior", role: "TANK", level: 20 }] };
    const database = {
      webAccount: { findUnique: vi.fn(async () => ({ id: profileId, discordUserId: "discord", username: "me", displayName: null,
        publicProfile: true, characters: [{ name: "Kev", realm: "Forever" }] })) },
      character: { findMany: vi.fn(async () => [{ name: "BlockedCharacter", realm: "Elsewhere", member: { guild: { discordId: "blocked" } } }]) },
      publicRun: { findMany: vi.fn(async () => [run]) }
    };
    const profile = await prismaProfileStore(database as unknown as PrismaClient, id => id !== "blocked").get(profileId);
    expect(profile!.characters).toEqual([{ name: "Kev", realm: "Forever", source: "companion" }]);
    expect(profile!.runs).toHaveLength(1);
    expect(database.publicRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "ACCEPTED",
      OR: [{ gameEdition: "forever", players: { some: { character: { equals: "Kev", mode: "insensitive" }, realm: { equals: "Forever", mode: "insensitive" } } } }] }) }));
    expect(database.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { member: { discordUserId: "discord", status: "ACTIVE" } } }));
  });
});

describe("players directory (/players/)", () => {
  const row = (id: string, character: string) => ({ id, character, realm: "Doomhowl", className: "Mage", role: "DPS", level: 60, guild: "Quebec Gold", sortKey: character.toLowerCase() });
  function directory(rows: ReturnType<typeof row>[]) {
    const list = vi.fn(async () => rows);
    const store: ProfileStore = { list, get: vi.fn(async () => null), visibility: vi.fn(async () => {}) };
    const app = createWebApp({ auth, store: memoryWebStore().store, allows: () => true, postApplication: async () => null, routes: [createPlayerProfiles(store).route] });
    const open = (query: string) => app.respond({ method: "GET", path: "/players/", query: new URLSearchParams(query), headers: {} });
    return { list, open };
  }

  it("shows each player by their character, class, role, level, realm and guild, never a Discord name", async () => {
    const { open } = directory([row(profileId, "Kev Galemorne")]);
    const body = (await open("lang=fr"))!.body;
    expect(body).toContain(`/players/${profileId}?lang=fr">Kev Galemorne</a>`);
    expect(body).toContain("Mage · DPS · niveau 60 · Doomhowl · Quebec Gold");
  });

  it("passes the filters to the store with server-side limits, and ignores unknown values", async () => {
    const { list, open } = directory([]);
    await open(`q=${"k".repeat(80)}&class=Mage&role=HEALER&realm=Doomhowl&guild=quebec&edition=classic-era`);
    expect(list).toHaveBeenCalledWith({ q: "k".repeat(40), edition: "classic-era", realm: "Doomhowl", className: "Mage", role: "HEALER", guild: "quebec" }, null);
    await open("class=Jedi&role=BARD&after=not-a-cursor");
    expect(list).toHaveBeenLastCalledWith({ q: "", edition: "forever", realm: null, className: null, role: null, guild: null }, null);
  });

  it("pages with a cursor that keeps the filters", async () => {
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => row(`c${String(i).padStart(24, "0")}`, `Player${String(i).padStart(2, "0")}`));
    const { list, open } = directory(rows);
    const body = (await open("class=Mage"))!.body;
    expect(body).not.toContain("Player24"); // the extra row only says there is a next page
    const next = /href="([^"]*after=[^"]*)">Next/.exec(body)![1]!.replace(/&amp;/g, "&");
    const query = new URLSearchParams(next.split("?")[1]);
    expect(query.get("class")).toBe("Mage");
    await open(query.toString());
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ className: "Mage" }), { sortKey: "player23", id: rows[23]!.id });
  });

  it("reads cursors only in its own format", () => {
    expect(decodeCursor(encodeCursor({ sortKey: "kev", id: profileId }))).toEqual({ sortKey: "kev", id: profileId });
    expect(decodeCursor(Buffer.from(JSON.stringify({ a: 1 })).toString("base64url"))).toBeNull();
    expect(decodeCursor("x".repeat(300))).toBeNull();
    expect(readPlayerFilters(new URLSearchParams("q=  Kev  "), "forever").q).toBe("Kev");
  });
});
