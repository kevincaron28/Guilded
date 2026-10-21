import type { PrismaClient } from "../src/generated/prisma/client.js";
import { describe, expect, it, vi } from "vitest";
import {
  checkInviteUrl, createGuildPageServer, editGuildPage, isPageSlug, loadGuildPageView, parseSections, renderGuildPage, slugFromName,
  type GuildPageView
} from "../src/services/guild-page.js";

const view = (over: Partial<GuildPageView> = {}): GuildPageView => ({
  slug: "quebec-gold", name: "Quebec Gold", language: "en", indexable: true, intro: "Francophone guild.",
  sections: ["cores", "loot", "rosters", "rankings", "recruitment"],
  cores: [{
    name: "Les Pulliticiens", description: null, realm: "Doomhowl", schedule: "Wed 8-11pm", timezone: "America/Toronto",
    lootMode: "EPGP", decayPercent: 0.1, minEp: 0,
    roster: [{ name: "Kev", className: "Warrior", role: "TANK", bench: false, trial: false }],
    ranking: [{ name: "Kev", ep: 120, gp: 60, pr: 2 }]
  }],
  recruitment: { text: "We raid twice a week.", inviteUrl: "https://discord.gg/abc123" },
  ...over
});

describe("guild page addresses and inputs", () => {
  it("makes a clean address from a guild name", () => {
    expect(slugFromName("⚜Quebec Gold⚜")).toBe("quebec-gold");
    expect(slugFromName("Les Aggros Anonymé")).toBe("les-aggros-anonyme");
    expect(slugFromName("⚜⚜")).toBe("guild");
    expect(isPageSlug("a".repeat(41))).toBe(false);
    expect(isPageSlug("-x")).toBe(false);
  });

  it("accepts only known sections and Discord invites", () => {
    expect(parseSections(" Cores, loot,cores ")).toEqual(["cores", "loot"]);
    expect(() => parseSections("cores,members")).toThrow("Unknown section: members");
    expect(checkInviteUrl("https://discord.gg/PCs8BeE8bg")).toBe("https://discord.gg/PCs8BeE8bg");
    expect(() => checkInviteUrl("https://evil.example/discord.gg/x")).toThrow();
    expect(() => checkInviteUrl("javascript:alert(1)")).toThrow();
  });
});

describe("guild page rendering", () => {
  it("escapes guild text and shows only turned-on sections", () => {
    const html = renderGuildPage(view({ name: "<script>x</script>", sections: ["cores"], recruitment: null }));
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Raid cores and times");
    expect(html).not.toContain("EPGP ranking");
    expect(html).not.toContain("<table");
  });

  it("writes French labels and asks search engines not to index when turned off", () => {
    const html = renderGuildPage(view({ language: "fr", indexable: false }));
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("Classement EPGP");
    expect(html).toContain("Royaume : Doomhowl");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(renderGuildPage(view())).not.toContain("noindex");
  });

  it("carries the site menu, a way back to the guild list and the guild's dungeon scores", () => {
    const html = renderGuildPage(view({ language: "fr", dungeonPage: "/leaderboards/guild/g1" }));
    expect(html).toContain('<nav aria-label="Navigation principale">');
    expect(html).toContain(">Classements</a>");
    expect(html).toContain('href="/leaderboards/guilds/?lang=fr">Guildes</a>');
    expect(html).toContain('href="/leaderboards/guild/g1?lang=fr">Scores de donjon</a>');
    expect(renderGuildPage(view())).not.toContain("Dungeon scores");
  });
});

describe("guild page server", () => {
  it("redirects to the canonical address, refuses writes and unknown paths", async () => {
    const pages = createGuildPageServer(async () => view());
    expect(await pages.respond("GET", "/companion/")).toBeNull();
    expect((await pages.respond("GET", "/g/quebec-gold"))!.headers["location"]).toBe("/g/quebec-gold/");
    expect((await pages.respond("POST", "/g/quebec-gold/"))!.status).toBe(405);
    expect((await pages.respond("GET", "/g/Quebec_Gold/"))!.status).toBe(404);
    expect((await pages.respond("GET", "/g/quebec-gold/admin"))!.status).toBe(404);
  });

  it("keeps a rendered copy so repeat visits do not reach the database", async () => {
    let now = 0;
    const load = vi.fn(async (slug: string) => (slug === "quebec-gold" ? view() : null));
    const pages = createGuildPageServer(load, { ttlMs: 1_000, now: () => now });
    const first = await pages.respond("GET", "/g/quebec-gold/");
    expect(first!.status).toBe(200);
    expect(first!.headers["content-security-policy"]).toContain("default-src 'none'");
    await pages.respond("HEAD", "/g/quebec-gold/");
    expect(load).toHaveBeenCalledTimes(1);
    now = 1_000;
    await pages.respond("GET", "/g/quebec-gold/");
    expect(load).toHaveBeenCalledTimes(2);
    expect((await pages.respond("GET", "/g/unknown/"))!.status).toBe(404);
  });
});

// Just enough of Prisma for the page queries.
function fakeDatabase(page: Record<string, unknown> | null, cores: unknown[] = [], sums: unknown[] = []) {
  return {
    guildPage: { findUnique: vi.fn(async () => page) },
    raidCore: { findMany: vi.fn(async () => cores) },
    epgpTransaction: { groupBy: vi.fn(async () => sums) }
  } as unknown as PrismaClient;
}
const guild = { id: "g1", name: "Quebec Gold", discordId: "111111111111111111", settings: { language: "fr", timezone: "America/Toronto", lootMode: "EPGP", baseGp: 10, epgpDecayPercent: 0.1 } };
const core = {
  id: "c1", name: "Core A", description: null, realm: null, schedule: "Wed 8pm", weeklyTimezone: null, lootMode: null, decayPercent: null, minEp: null, baseGp: null, separatePool: false,
  members: [
    { memberId: "m1", role: "HEALER", bench: false, trial: false, character: { name: "Healy", className: "Priest" }, member: { characters: [] } },
    { memberId: "m2", role: "TANK", bench: true, trial: false, character: null, member: { characters: [{ name: "Tanky", className: "Warrior" }] } },
    { memberId: "m3", role: "DPS", bench: false, trial: false, character: null, member: { characters: [] } }
  ]
};

describe("guild page data", () => {
  it("returns nothing for drafts and servers that are not allowed", async () => {
    const draft = { slug: "quebec-gold", published: false, sections: [], guild };
    expect(await loadGuildPageView(fakeDatabase(draft), "quebec-gold", () => true)).toBeNull();
    const published = { ...draft, published: true };
    expect(await loadGuildPageView(fakeDatabase(published), "quebec-gold", () => false)).toBeNull();
  });

  it("shows character names in role order, skips members without a character and ranks the core's pool", async () => {
    const page = { slug: "quebec-gold", published: true, sections: ["rosters", "rankings", "bogus"], intro: null, recruitment: "Hi", inviteUrl: null, indexable: true, guild };
    const database = fakeDatabase(page, [core], [{ memberId: "m1", _sum: { epAmount: 100, gpAmount: 40 } }, { memberId: "m2", _sum: { epAmount: 0, gpAmount: 0 } }]);
    const result = await loadGuildPageView(database, "quebec-gold", () => true);
    expect(result!.language).toBe("fr");
    expect(result!.sections).toEqual(["rosters", "rankings"]);
    expect(result!.recruitment).toBeNull();
    expect(result!.cores[0]!.roster!.map((row) => row.name)).toEqual(["Tanky", "Healy"]);
    expect(result!.cores[0]!.ranking).toEqual([{ name: "Healy", ep: 100, gp: 40, pr: 2 }]);
    const query = (database.epgpTransaction.groupBy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { where: { coreId: string | null } };
    expect(query.where.coreId).toBeNull();
  });
});

describe("owner page editing", () => {
  const serverId = "111111111111111111";
  function editable(existing: Record<string, unknown> | null, taken = false) {
    const page = { id: "p1", slug: "quebec-gold", published: false, publishedAt: null, sections: [], intro: null, recruitment: null, inviteUrl: null, indexable: true, ...existing };
    return {
      guild: { findUnique: vi.fn(async () => ({ id: "g1", name: "⚜Quebec Gold⚜", page: existing ? page : null })) },
      guildPage: {
        findUnique: vi.fn(async () => (taken ? page : null)),
        create: vi.fn(async ({ data }: { data: { slug: string } }) => ({ ...page, slug: data.slug })),
        update: vi.fn(async ({ data }: { data: object }) => ({ ...page, ...data }))
      }
    } as unknown as PrismaClient;
  }

  it("creates a draft from the guild name and refuses a taken address", async () => {
    expect(await editGuildPage(editable(null), "create", serverId)).toContain("/g/quebec-gold/ is a draft");
    await expect(editGuildPage(editable(null, true), "create", serverId)).rejects.toThrow("already taken");
    await expect(editGuildPage(editable(null), "create", "not-an-id")).rejects.toThrow("Use: npm run guild-page");
  });

  it("publishes, validates the invite and refuses unknown actions", async () => {
    const database = editable({});
    expect(await editGuildPage(database, "publish", serverId)).toContain("is published");
    const update = (database.guildPage.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { publishedAt: Date } };
    expect(update.data.publishedAt).toBeInstanceOf(Date);
    await expect(editGuildPage(database, "invite", serverId, "https://example.com")).rejects.toThrow("Discord invite");
    await expect(editGuildPage(database, "delete", serverId)).rejects.toThrow("Use: npm run guild-page");
    await expect(editGuildPage(editable(null), "publish", serverId)).rejects.toThrow("Create the page first");
  });
});
