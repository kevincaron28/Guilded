import { describe, expect, it, vi } from "vitest";
// Turns the Forever-only focus switches on for this file (see tests/helpers/focus-switches.ts).
vi.mock("../companion/active-editions.mjs", async (original) => (await import("./helpers/focus-switches.js")).allEditionsOn(await original()));
vi.mock("../companion/active-games.mjs", async (original) => (await import("./helpers/focus-switches.js")).poeTrackingOn(await original()));
const sync = vi.hoisted(() => vi.fn());
vi.mock("../src/services/achievements.js", async (original) => ({ ...(await original<typeof import("../src/services/achievements.js")>()), syncMemberAchievements: sync }));
import { createAchievementsWeb } from "../src/services/achievements-web.js";
import { ACHIEVEMENTS, ACTIVE_ACHIEVEMENTS, RETIRED_ACHIEVEMENT_IDS } from "../src/services/achievements-catalogue.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";

const kit = {
  page: (status: number, title: string, body: string) => ({ status, headers: {}, body: `${title}${body}` }),
  redirect: (location: string) => ({ status: 302, headers: { location }, body: "" }),
  signInPrompt: () => ({ status: 401, headers: {}, body: "sign in" })
} as unknown as WebKit;
const ctx = (path: string, lang: "en" | "fr" = "en", account: WebContext["account"] = null): WebContext => ({
  request: { method: "GET", path, query: new URLSearchParams(), headers: {} }, lang, t: (en, fr) => lang === "fr" ? fr : en, now: new Date("2026-11-02T12:00:00Z"),
  account, sessionToken: null, csrf: null, form: null, auth: null
});

function fakeDb(profile: { publicProfile: boolean } | null) {
  const stored = [{ key: "wow-level-20", earnedAt: new Date("2026-10-20T00:00:00Z") }, { key: "dungeon-runs-1", earnedAt: new Date("2026-10-22T00:00:00Z") }, { key: "dungeon-runs-1", earnedAt: new Date("2026-10-21T00:00:00Z") }];
  return {
    webAccount: { findUnique: vi.fn(async () => profile ? { discordUserId: "u1", username: "kev", displayName: "Kev <b>", ...profile } : null) },
    guildSettings: { findMany: vi.fn(async () => []) },
    member: { findMany: vi.fn(async () => [{ id: "m1", guildId: "g1", guild: { discordId: "d1" } }, { id: "m2", guildId: "g2", guild: { discordId: "blocked" } }]) },
    memberAchievement: { findMany: vi.fn(async (args: { where: { memberId: { in: string[] } } }) => { expect(args.where.memberId.in).toEqual(["m1"]); return stored; }) }
  };
}
const allows = (id: string) => id === "d1";

describe("achievements on the website", () => {
  it("shows stored achievements on a public player page, earliest date winning, only for allowed guilds", async () => {
    const db = fakeDb({ publicProfile: true });
    const web = createAchievementsWeb(db as never, allows);
    const html = await web.publicSection(ctx("/players/x"), "a".repeat(24));
    // The stored "wow-level-20" is retired: it stays in the database but is neither listed nor counted.
    expect(html).toContain(`1 of ${ACTIVE_ACHIEVEMENTS.length} unlocked`);
    expect(html).not.toContain("Getting Started");
    expect(db.memberAchievement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ key: { notIn: [...RETIRED_ACHIEVEMENT_IDS] } }) }));
    expect(html).toContain("Unlocked 2026-10-21");
    expect(html).toContain("achievements.png");
    expect(html).not.toContain("Locked ·");
  });
  it("renders nothing on a public page with no stored achievements", async () => {
    const db = fakeDb({ publicProfile: true });
    db.memberAchievement.findMany.mockResolvedValue([]);
    expect(await createAchievementsWeb(db as never, allows).publicSection(ctx("/players/x"), "a".repeat(24))).toBe("");
  });
  it("evaluates and always shows the card on the signed-in owner's own page", async () => {
    sync.mockResolvedValue({ results: ACHIEVEMENTS.map(def => ({ def, earned: false, earnedAt: null, value: 3 })) });
    const db = fakeDb({ publicProfile: true });
    db.memberAchievement.findMany.mockResolvedValue([]);
    const owner = { id: "a".repeat(24) } as WebContext["account"];
    const html = await createAchievementsWeb(db as never, allows).publicSection(ctx("/players/x", "en", owner), "a".repeat(24));
    expect(sync).toHaveBeenCalled();
    expect(html).toContain(`0 of ${ACTIVE_ACHIEVEMENTS.length} unlocked`);
    expect(html).toContain("Locked ·");
    expect(await createAchievementsWeb(db as never, allows).publicSection(ctx("/players/x", "en", { id: "b".repeat(24) } as WebContext["account"]), "a".repeat(24))).toBe("");
  });
  it("is bilingual", async () => {
    const html = await createAchievementsWeb(fakeDb({ publicProfile: true }) as never, allows).publicSection(ctx("/players/x", "fr"), "a".repeat(24));
    expect(html).toContain(`1 sur ${ACTIVE_ACHIEVEMENTS.length} débloqués`);
    expect(html).toContain("Première descente");
  });
  it("serves the card image for every known profile (no hide option)", async () => {
    const missing = createAchievementsWeb(fakeDb(null) as never, allows);
    expect((await missing.route(ctx(`/players/${"a".repeat(24)}/achievements.png`), kit))?.status).toBe(404);
    const visible = await createAchievementsWeb(fakeDb({ publicProfile: true }) as never, allows).route(ctx(`/players/${"a".repeat(24)}/achievements.png`), kit);
    expect(visible?.status).toBe(200);
    expect(visible?.headers["content-type"]).toBe("image/png");
    expect(visible?.binaryBody?.subarray(1, 4).toString()).toBe("PNG");
  });
  it("ignores other paths", async () => {
    const web = createAchievementsWeb(fakeDb({ publicProfile: true }) as never, allows);
    expect(await web.route(ctx("/players/"), kit)).toBeNull();
    expect(await web.ownerRoute(ctx("/me/"), kit)).toBeNull();
    expect((await web.ownerRoute(ctx("/me/achievements.png"), kit))?.status).toBe(401);
    expect(await web.meSection(ctx("/me/"))).toBe("");
  });
  it("catalogue is large enough to list by game", () => { expect(ACHIEVEMENTS.length).toBe(105); expect(ACTIVE_ACHIEVEMENTS.length).toBe(105); });
  it("lists WoW Forever and guild achievements only, never a retired or other-edition row", async () => {
    const html = await createAchievementsWeb(fakeDb({ publicProfile: true }) as never, allows).publicSection(ctx("/players/x"), "a".repeat(24));
    const heads = [...html.matchAll(/<h3>([^<]*?) <small>/g)].map(match => match[1]);
    expect(heads).toEqual(["World of Warcraft · WoW Forever", "Guild"]);
    expect(html).toContain("Forever: Level 60 (Max)");
    expect(html).not.toMatch(/Veteran of Azeroth|Retail|TBC|Exile|Cartographer/);
    expect(html).toContain("First Descent");
  });
  it("makes every tile expandable with no script: a checkbox, its label and a details panel with the full information", async () => {
    sync.mockResolvedValue({ results: ACHIEVEMENTS.map(def => ({ def, earned: def.id === "dungeon-runs-1", earnedAt: def.id === "dungeon-runs-1" ? new Date("2026-10-21T00:00:00Z") : null, value: def.id === "wow-forever-level-60" ? 41 : 0 })) });
    const db = fakeDb({ publicProfile: true });
    const owner = { id: "a".repeat(24) } as WebContext["account"];
    const html = await createAchievementsWeb(db as never, allows).publicSection(ctx("/players/x", "en", owner), "a".repeat(24));
    expect(html).not.toMatch(/<script|\son\w+=/i);
    const tiles = html.match(/<div class="ach">/g) ?? [];
    expect(tiles.length).toBe(ACTIVE_ACHIEVEMENTS.length);
    expect(html.match(/<input type="checkbox" class="ach-t"/g)?.length).toBe(tiles.length);
    expect(html.match(/class="ach-more"/g)?.length).toBe(tiles.length);
    // Every checkbox has an accessible name and points at its panel, and each label points at its checkbox.
    expect(html).toContain(`id="ach-wow-forever-level-60" aria-controls="ach-wow-forever-level-60-more" aria-label="Forever: Level 60 (Max): Epic, Locked · 41/60"`);
    expect(html).toContain(`for="ach-wow-forever-level-60"`);
    expect(html).toContain("How to earn:");
    expect(html).toContain("only characters of this edition count");
    expect(html).toContain("Progress: 41/60");
    expect(html).toContain("run /achievements");
    expect(html).toContain("(hover:hover)");
    expect(html).toContain(":focus-visible");
  });
  it("shows no progress or share hint to visitors, and the details panel is bilingual", async () => {
    const html = await createAchievementsWeb(fakeDb({ publicProfile: true }) as never, allows).publicSection(ctx("/players/x", "fr"), "a".repeat(24));
    expect(html).not.toContain("run /achievements");
    expect(html).toContain("Comment l'obtenir");
    expect(html).toContain("Forever : niveau 60 (max)");
    expect(html).toContain("seuls les personnages de cette édition comptent");
  });
});
