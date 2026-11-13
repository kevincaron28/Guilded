import { describe, expect, it, vi } from "vitest";
import { professionLabel } from "../src/commands/craft-board.js";
import { crafterStandings } from "../src/services/craft-ladder.js";
import { PROFESSION_IDENTITIES, canonicalProfessionText, professionSlug } from "../src/services/profession-names.js";
import { loadProfessionPosts, professionPostEmbed, professionPostLinks, threadTitle, updateProfessionPosts } from "../src/services/profession-board.js";
import { professionKey } from "../src/services/profession-details.js";
import { professionNavRows } from "../src/services/profession-directory.js";
import { findProfessionHolders, professionCoverage } from "../src/services/profession-search.js";
import { hallEmbed, loadRaceBoardData } from "../src/services/race-board.js";
import { applyDiscoveredCharacters } from "../src/services/roster-discovery.js";

// 13 November 2026 (owner report): "in Discord and the addon we have Cooking and Cuisine as two separate professions, same
// for the other professions". The stored tables only hold English names, but several Discord views grouped or showed the
// name as stored (post grouping, Hall of Fame text, unclaimed-character JSON, the craft ladder, discovery by name): any row
// carrying a localized spelling split a profession. Every view now goes through the canonical English name.

describe("one profession name in every Discord view", () => {
  it("maps every profession in French, German and Spanish client names, none shared between two", () => {
    expect(Object.keys(PROFESSION_IDENTITIES).length).toBeGreaterThanOrEqual(15);
    for (const [canonical, identity] of Object.entries(PROFESSION_IDENTITIES)) {
      for (const language of ["frFR", "deDE", "esES"] as const) {
        expect(identity.names[language].length, `${canonical} ${language}`).toBeGreaterThan(0);
        for (const name of identity.names[language]) expect(professionSlug(name), name).toBe(canonical.toLowerCase());
      }
    }
  });

  it("canonicalProfessionText joins 'Cuisine 300, Cooking 150, Pêche 75' into one Cooking at the highest skill", () => {
    expect(canonicalProfessionText("Cuisine 150, Cooking 300, Pêche 75, Kochkunst")).toBe("Cooking 300, Fishing 75");
    expect(canonicalProfessionText("Secourisme 20, First Aid 40")).toBe("First Aid 40");
    expect(canonicalProfessionText(null)).toBe("");
    expect(canonicalProfessionText("Lockpicking 10")).toBe("Lockpicking 10");
  });

  it("profession posts: Cuisine and Cooking rows are one post, one crafter line at the higher skill, recipes merged", async () => {
    const db = {
      professionSkill: { findMany: async () => [
        { profession: "Cuisine", skillLevel: 150, character: { name: "Amy", lastSeenAt: null } },
        { profession: "Cooking", skillLevel: 300, character: { name: "Amy", lastSeenAt: null } },
        { profession: "Kochkunst", skillLevel: 200, character: { name: "Bob", lastSeenAt: null } }
      ] },
      recipeKnown: { findMany: async () => [
        { character: "Amy", profession: "Cuisine", itemKey: 7, itemName: "Stew", scannedAt: new Date() },
        { character: "Bob", profession: "Cooking", itemKey: 7, itemName: "Stew", scannedAt: new Date() }
      ] }
    };
    const posts = await loadProfessionPosts(db as never, "g1");
    expect(posts.map((post) => post.profession)).toEqual(["Cooking"]);
    expect(posts[0]!.skilled.map((row) => `${row.character}:${row.skillLevel}`).sort()).toEqual(["Amy:300", "Bob:200"]);
    expect(posts[0]!.recipes).toHaveLength(1);
    expect(posts[0]!.recipes[0]!.crafters.map((crafter) => crafter.character).sort()).toEqual(["Amy", "Bob"]);
    // Shown once, in the guild's language.
    expect(professionPostEmbed(posts[0]!, "fr", "g1").toJSON().title).toContain("Cuisine");
    expect(professionPostEmbed(posts[0]!, "en", "g1").toJSON().title).toContain("Cooking");
    expect(professionKey("Cuisine")).toBe(professionKey("Cooking"));
  });

  it("the craft ladder counts a French and an English Cooking craft as one profession", () => {
    const rows = [
      { crafterId: "m1", points: 1, profession: "Cuisine", doneAt: new Date("2026-11-10T00:00:00Z") },
      { crafterId: "m1", points: 1, profession: "Cooking", doneAt: new Date("2026-11-11T00:00:00Z") },
      { crafterId: "m1", points: 1, profession: "Pêche", doneAt: new Date("2026-11-11T00:00:00Z") }
    ];
    const standing = crafterStandings(rows, new Map([["m1", { name: "Amy", className: null }]]), new Date("2026-11-12T00:00:00Z"));
    expect(standing[0]!.topProfession).toBe("Cooking");
  });

  it("the craft board labels a profession in the guild's language whatever spelling it was stored with", () => {
    expect(professionLabel("fr", "Cooking")).toBe("Cuisine");
    expect(professionLabel("fr", "Kochkunst")).toBe("Cuisine");
    expect(professionLabel("en", "Cuisine")).toBe("Cooking");
    expect(professionLabel("fr", "Something hand-typed")).toBe("Something hand-typed");
  });

  it("Hall of Fame text written with a localized spelling shows each profession once, in the guild's language", () => {
    const entry = { order: 1, name: "Aria", className: "Mage", race: "Human", reachedAt: new Date("2026-11-11T00:00:00Z"), firstSeenAt: new Date("2026-11-04T00:00:00Z"),
      professions: "Cuisine 150, Cooking 300, Pêche 75", memberDiscordId: null };
    const en = JSON.stringify(hallEmbed(entry, "en", "g1").toJSON());
    expect(en).toContain("Cooking 300, Fishing 75");
    expect(en).not.toContain("Cuisine");
    const fr = JSON.stringify(hallEmbed(entry, "fr", "g1").toJSON());
    expect(fr).toContain("Cuisine 300, Pêche 75");
    expect(fr).not.toContain("Cooking");
  });

  it("the race board merges an unclaimed character's stored JSON that still has a localized spelling", async () => {
    const db = {
      character: { findMany: async () => [] },
      unclaimedCharacter: { findMany: async () => [{ nameKey: "amy", name: "Amy", displayName: null, className: "Mage", race: "Human", level: 60,
        professions: [{ name: "Cuisine", skillLevel: 150 }, { name: "Cooking", skillLevel: 300 }, { name: "Pêche", skillLevel: 75 }], lastSeenAt: null }] },
      levelRaceEntry: { findMany: async () => [], upsert: async () => ({}), deleteMany: async () => ({}) }
    };
    const data = await loadRaceBoardData(db as never, "g1", "forever", new Date("2026-11-12T00:00:00Z"));
    expect(data.rows[0]!.professions).toEqual(["Cooking 300", "Fishing 75"]);
  });

  it("roster discovery stores and prunes by the canonical name even when the entry carries a localized one", async () => {
    const stored: Record<string, unknown>[] = [];
    const deleted: Record<string, unknown>[] = [];
    const tx = {
      character: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
      professionSkill: { upsert: vi.fn(async () => ({})) },
      recipeKnown: { deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => { deleted.push(where); return {}; }) },
      professionCooldown: { deleteMany: vi.fn(async () => ({})) },
      unclaimedCharacter: { findUnique: vi.fn(async () => null), upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { stored.push(create); return create; }) }
    };
    const entry = { name: "Amy", realm: "Forever", class: "MAGE", race: "Human", level: 40, spec: "",
      professions: [{ name: "Cuisine", skillLevel: 150 }, { name: "Cooking", skillLevel: 300 }], professionsComplete: true, professionsAt: new Date("2026-11-12T00:00:00Z") };
    await applyDiscoveredCharacters(tx as never, "g", [entry] as never, []);
    expect(stored[0]!["professions"]).toEqual([{ name: "Cooking", skillLevel: 300 }]);
    expect(deleted[0]!["profession"]).toEqual({ notIn: ["Cooking"] });
  });

  it("tableau-artisanat on a French server: the profession thread is titled in French, an English-titled one is renamed once, and no second thread appears", async () => {
    expect(threadTitle("Cooking", "fr")).toBe("📚 Cuisine");
    expect(threadTitle("Cuisine", "en")).toBe("📚 Cooking");
    const db = {
      guildSettings: { findUnique: async () => ({ professionPostsEnabled: true }) },
      professionSkill: { findMany: async () => [{ profession: "Cooking", skillLevel: 300, character: { name: "Amy", lastSeenAt: null } }, { profession: "Fishing", skillLevel: 100, character: { name: "Amy", lastSeenAt: null } }] },
      recipeKnown: { findMany: async () => [] },
      character: { findMany: async () => [] }
    };
    const edit = vi.fn();
    const setName = vi.fn(async () => undefined);
    const english = { name: "📚 Cooking", archived: false, fetchStarterMessage: async () => ({ editable: true, edit }), setArchived: vi.fn(), setName };
    const create = vi.fn();
    const forum = { threads: { fetchActive: async () => ({ threads: new Map([["1", english]]) }), fetchArchived: async () => ({ threads: new Map() }), create } };
    await updateProfessionPosts({ id: "d1" } as never, forum as never, db as never, "g1", "fr", new Date("2026-11-13T12:00:00Z"));
    expect(setName).toHaveBeenCalledWith("📚 Cuisine");
    expect(edit).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0]![0] as { name: string }).name).toBe("📚 Pêche");
    // A thread already titled in French is found as the same profession: nothing is created for it and it is not renamed.
    const french = { ...english, name: "📚 Cuisine", setName: vi.fn() };
    const forum2 = { threads: { fetchActive: async () => ({ threads: new Map([["1", french]]) }), fetchArchived: async () => ({ threads: new Map() }), create: vi.fn() } };
    await updateProfessionPosts({ id: "d1" } as never, forum2 as never, db as never, "g1", "fr", new Date("2026-11-13T12:00:00Z"));
    expect(french.setName).not.toHaveBeenCalled();
    expect(forum2.threads.create).toHaveBeenCalledTimes(1);
  });

  it("a French and an English thread of one profession: the French one is kept, the bot's English duplicate is archived, a member's is left alone", async () => {
    const db = {
      guildSettings: { findUnique: async () => ({ professionPostsEnabled: true }) },
      professionSkill: { findMany: async () => [{ profession: "Cooking", skillLevel: 300, character: { name: "Amy", lastSeenAt: null } }] },
      recipeKnown: { findMany: async () => [] },
      character: { findMany: async () => [] }
    };
    const edit = vi.fn();
    const thread = (id: string, name: string, ownerId: string) => ({ id, name, ownerId, archived: false, fetchStarterMessage: async () => ({ editable: true, edit }), setArchived: vi.fn(async () => undefined), setName: vi.fn(async () => undefined), send: vi.fn(async () => undefined) });
    const english = thread("1", "📚 Cooking", "bot");
    const french = thread("2", "📚 Cuisine", "bot");
    const members = thread("3", "📚 Cooking ", "member");
    const forum = { client: { user: { id: "bot" } }, threads: { fetchActive: async () => ({ threads: new Map([["1", english], ["2", french], ["3", members]]) }), fetchArchived: async () => ({ threads: new Map() }), create: vi.fn() } };
    await updateProfessionPosts({ id: "d1" } as never, forum as never, db as never, "g1", "fr", new Date("2026-11-13T12:00:00Z"));
    expect(english.setArchived).toHaveBeenCalledWith(true);
    expect(members.setArchived).not.toHaveBeenCalled();
    expect(french.setArchived).not.toHaveBeenCalledWith(true);
    expect(french.setName).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(forum.threads.create).not.toHaveBeenCalled();
    // The directory links to the kept thread, whatever spelling the others use.
    expect([...(await professionPostLinks(forum as never, "fr"))]).toEqual([["cooking", "2"]]);
  });

  it("a member-made thread never wins over the bot's: the bot's thread is the keeper and nothing is archived in favour of the member's", async () => {
    const db = {
      guildSettings: { findUnique: async () => ({ professionPostsEnabled: true }) },
      professionSkill: { findMany: async () => [{ profession: "Cooking", skillLevel: 300, character: { name: "Amy", lastSeenAt: null } }] },
      recipeKnown: { findMany: async () => [] },
      character: { findMany: async () => [] }
    };
    const edit = vi.fn();
    const thread = (id: string, name: string, ownerId: string, editable = true) => ({ id, name, ownerId, archived: false, fetchStarterMessage: async () => ({ editable, edit }), setArchived: vi.fn(async () => undefined), setName: vi.fn(async () => undefined), send: vi.fn(async () => undefined) });
    const bots = thread("1", "📚 Cooking", "bot");
    const members = thread("2", "📚 Cuisine", "member", false);
    const forum = { client: { user: { id: "bot" } }, threads: { fetchActive: async () => ({ threads: new Map([["1", bots], ["2", members]]) }), fetchArchived: async () => ({ threads: new Map() }), create: vi.fn() } };
    await updateProfessionPosts({ id: "d1" } as never, forum as never, db as never, "g1", "fr", new Date("2026-11-13T12:00:00Z"));
    expect(bots.setArchived).not.toHaveBeenCalledWith(true);
    expect(members.setArchived).not.toHaveBeenCalled();
    expect(bots.setName).toHaveBeenCalledWith("📚 Cuisine");
    expect(edit).toHaveBeenCalledTimes(1);
    expect([...(await professionPostLinks(forum as never, "fr"))]).toEqual([["cooking", "1"]]);
  });

  it("a thread that cannot be renamed does not take the only rename slot; a thread that cannot be archived is reported as such", async () => {
    const db = {
      guildSettings: { findUnique: async () => ({ professionPostsEnabled: true }) },
      professionSkill: { findMany: async () => [
        { profession: "Cooking", skillLevel: 300, character: { name: "Amy", lastSeenAt: null } },
        { profession: "Fishing", skillLevel: 100, character: { name: "Amy", lastSeenAt: null } }] },
      recipeKnown: { findMany: async () => [] },
      character: { findMany: async () => [] }
    };
    const edit = vi.fn();
    const thread = (id: string, name: string) => ({ id, name, ownerId: "bot", archived: false, fetchStarterMessage: async () => ({ editable: true, edit }), setArchived: vi.fn(async () => { throw new Error("Missing Permissions"); }), setName: vi.fn(async () => undefined), send: vi.fn(async () => undefined) });
    const stuck = thread("1", "📚 Cooking");
    stuck.setName = vi.fn(async () => { throw new Error("Missing Permissions"); });
    const fishing = thread("2", "📚 Fishing");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const twin = thread("3", "📚 Cuisine ");
    const forum = { client: { user: { id: "bot" } }, threads: { fetchActive: async () => ({ threads: new Map([["1", stuck], ["2", fishing], ["3", twin]]) }), fetchArchived: async () => ({ threads: new Map() }), create: vi.fn() } };
    await updateProfessionPosts({ id: "d1" } as never, forum as never, db as never, "g1", "fr", new Date("2026-11-13T12:00:00Z"));
    expect(stuck.setName).toHaveBeenCalled();
    expect(fishing.setName).toHaveBeenCalledWith("📚 Pêche");
    expect(twin.send).toHaveBeenCalled();
    expect(log.mock.calls.map((call) => String(call[0])).join(String.fromCharCode(10))).toContain("could not archive");
    log.mockRestore();
  });

  it("the directory finds a profession under any spelling: coverage has one line, a French query finds English rows, and the nav button links to the thread", async () => {
    const rows = [
      { profession: "Cuisine", skillLevel: 150, character: { name: "Amy", isMain: true, lastSeenAt: null, member: { displayName: "A" } } },
      { profession: "Cooking", skillLevel: 300, character: { name: "Bob", isMain: true, lastSeenAt: null, member: { displayName: "B" } } }
    ];
    const db = { professionSkill: { findMany: async () => rows }, recipeKnown: { findMany: async () => [], groupBy: async () => [] } };
    const coverage = await professionCoverage(db as never, "g1");
    expect(coverage).toHaveLength(1);
    expect(coverage[0]).toMatchObject({ profession: "Cooking", characters: 2, topSkill: 300, topCharacter: "Bob" });
    expect((await findProfessionHolders(db as never, "g1", "cuis")).map((holder) => holder.character).sort()).toEqual(["Amy", "Bob"]);
    const buttons = professionNavRows(["Cuisine"], new Map([["cooking", "55"]]), "9", "fr").flatMap((row) => row.toJSON().components) as { url?: string }[];
    expect(buttons[0]!.url).toBe("https://discord.com/channels/9/55");
  });
});
