import { describe, expect, it, vi } from "vitest";
import { createPicturePages, type PictureStore, type StoredPicture } from "../src/services/character-picture.js";
import { createPlayerProfiles, type PlayerProfile, type ProfileStore } from "../src/services/player-profiles.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";

const profileId = "a".repeat(25), publicChar = "p".repeat(25), guildChar = "g".repeat(25);
const owner = { id: profileId, discordUserId: "owner", username: "Kev", displayName: null };
const guildmate = { id: "b".repeat(25), discordUserId: "guildmate", username: "Mel", displayName: null };
const stranger = { id: "c".repeat(25), discordUserId: "stranger", username: "Zed", displayName: null };
type Account = typeof owner;

const kit: WebKit = { page: (status, _title, body) => ({ status, headers: {}, body }), redirect: (location) => ({ status: 303, headers: { location }, body: "" }), signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" }) };
const context = (path: string, account: Account | null, form?: Record<string, string>): WebContext => ({
  account, request: { path, method: form ? "POST" : "GET", query: new URLSearchParams(), headers: {} }, lang: "en", t: en => en, now: new Date("2026-11-07T12:00:00Z"),
  sessionToken: account ? "token" : null, csrf: account ? "csrf-value" : null, form: form ? new URLSearchParams(form) : null, auth: null
});
const isMember = vi.fn(async (discordUserId: string, guildId: string) => guildId === "g1" && ["owner", "guildmate"].includes(discordUserId));

function profileFixture(mainVisibility: "public" | "guild") {
  const profile: PlayerProfile = { id: profileId, name: "Kev", public: true, runs: [], characters: [
    { name: "Kev", displayName: "Kev Caron", realm: "Forever", source: "guild", isMain: true, picture: { characterId: guildChar, guildId: "g1", version: 3, visibility: mainVisibility } },
    { name: "Alt", realm: "Forever", source: "guild", picture: { characterId: publicChar, guildId: "g1", version: 1, visibility: "public" } }
  ] };
  const store: ProfileStore = { list: vi.fn(async () => []), get: vi.fn(async id => id === profileId ? profile : null) };
  return createPlayerProfiles(store, undefined, { isMember });
}

describe("character pictures on player profiles", () => {
  it("shows a guild-only picture to that guild's members and the owner, never to anyone else", async () => {
    const profiles = profileFixture("guild");
    const page = async (account: Account | null) => (await profiles.route(context(`/players/${profileId}`, account), kit))!.body;
    const mainUrl = `/players/pictures/${guildChar}/3.webp`, altThumb = `/players/pictures/${publicChar}/1-thumb.webp`;
    for (const viewer of [null, stranger]) {
      const body = await page(viewer);
      expect(body).not.toContain(guildChar);
      // The public alt picture still shows, as the hero and in the list.
      expect(body).toContain(altThumb);
    }
    const seen = await page(guildmate);
    expect(seen).toContain(mainUrl);
    expect(seen).toContain("Guild only");
    expect(seen).toContain("Report this picture");
    const own = await page(owner);
    expect(own).toContain(mainUrl);
    expect(own).not.toContain("Report this picture");
    expect(await profiles.meSection(context("/me/", owner))).toContain(mainUrl);
  });

  it("offers the report link only to signed-in viewers, and shows no picture block without pictures", async () => {
    const profiles = profileFixture("public");
    expect((await profiles.route(context(`/players/${profileId}`, null), kit))!.body).not.toContain("Report this picture");
    expect((await profiles.route(context(`/players/${profileId}`, stranger), kit))!.body).toContain('name="csrf" value="csrf-value"');
    const bare = createPlayerProfiles({ list: vi.fn(async () => []), get: vi.fn(async () => ({ id: profileId, name: "Kev", public: true, runs: [], characters: [{ name: "Kev", realm: "Forever", source: "guild" as const }] })) });
    expect((await bare.route(context(`/players/${profileId}`, null), kit))!.body).not.toContain("character-picture");
  });
});

describe("reporting a picture", () => {
  const picture = (visibility: "public" | "guild"): StoredPicture => ({ guildId: "g1", version: 1, visibility, status: "ok", enabled: true, large: Buffer.from("x"), thumb: Buffer.from("x") });
  function pages(visibility: "public" | "guild", report = vi.fn(async () => true)) {
    const store: PictureStore = {
      myCharacters: vi.fn(async (discordUserId: string) => discordUserId === "owner" ? [{ id: guildChar, name: "Kev", realm: "Forever", className: "Mage", guildId: "g1", guildName: "Gold", enabled: true, picture: null }] : []),
      save: vi.fn(), setVisibility: vi.fn(), removeOwn: vi.fn(), image: vi.fn(async id => id === guildChar ? picture(visibility) : null)
    };
    const access = { guilds: vi.fn(async () => []), authorize: vi.fn(async (user: string, guildId: string) => guildId === "g1" && user !== "stranger" ? { id: guildId } : null) };
    return { report, route: createPicturePages(store, access, { report }).route };
  }
  const send = (route: ReturnType<typeof pages>["route"], account: Account | null, character = guildChar) => route(context("/players/pictures/report", account, { character }), kit);

  it("tells the guild's officers about a picture the reporter can see", async () => {
    const { route, report } = pages("guild");
    const answer = await send(route, guildmate);
    expect(answer?.status).toBe(200);
    expect(report).toHaveBeenCalledWith({ guildId: "g1", characterId: guildChar, reporter: "Mel" });
  });
  it("refuses signed-out viewers, pictures they cannot see, unknown ids and their own picture", async () => {
    const { route, report } = pages("guild");
    expect((await send(route, null))?.status).toBe(401);
    expect((await send(route, stranger))?.status).toBe(404);
    expect((await send(route, guildmate, "z".repeat(25)))?.status).toBe(404);
    expect((await send(route, guildmate, "../etc"))?.status).toBe(404);
    expect((await send(route, owner))?.status).toBe(303);
    expect(report).not.toHaveBeenCalled();
    // A public picture can be reported by anyone signed in.
    const open = pages("public");
    expect((await send(open.route, stranger))?.status).toBe(200);
  });
  it("caps reports at ten a day per member and says when delivery failed", async () => {
    const { route, report } = pages("public");
    for (let i = 0; i < 10; i++) expect((await send(route, stranger))?.status).toBe(200);
    expect((await send(route, stranger))?.status).toBe(429);
    expect(report).toHaveBeenCalledTimes(10);
    const failing = pages("public", vi.fn(async () => false));
    expect((await send(failing.route, stranger))?.status).toBe(503);
  });
});
