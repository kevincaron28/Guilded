import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/hosted-pilot.js", () => ({ pilotGuildScope: {} }));
// The real rating validators need full frozen rule sets; the podium only needs "is this season rated" and the rows, so they are stubbed.
vi.mock("../src/services/dungeon-rating.js", () => ({ hasDungeonRating: (rules: { rated?: boolean } | null) => rules?.rated === true, frozenRating: (value: unknown) => Array.isArray(value) ? value : null }));

import { queueSeasonEndCards, queueSeasonStartCard, seasonCardChannel, seasonEndCard, seasonPodium, seasonStartCard } from "../src/services/season-cards.js";
import { sendWithPictureFallback } from "../src/services/discord-jobs.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";

const info = { name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: new Date("2026-12-02T23:00:00Z") };
const standings = [{ memberId: "a", name: "Aldric", points: 300 }, { memberId: "b", name: "Brenna", points: 250 }, { memberId: "c", name: "Cedric", points: 90 }, { memberId: "d", name: "Dara", points: 10 }];
const classes = new Map([["aldric", "Warrior"]]);
const rated = { rated: true };
const ratingRow = (memberId: string, name: string, points: number, bracket?: string) => ({ memberId, name, points, dungeons: points / 100, ...(bracket ? { bracket } : {}) });

describe("season podium data", () => {
  it("uses the final standings of an unrated season, with competition ranking and every champion named", () => {
    const tied = [{ memberId: "a", name: "Aldric", points: 300 }, { memberId: "b", name: "Brenna", points: 300 }, { memberId: "c", name: "Cedric", points: 250 }, { memberId: "d", name: "Dara", points: 250 }, { memberId: "e", name: "Eli", points: 100 }, { memberId: "f", name: "Fay", points: 50 }];
    const podium = seasonPodium({ finalStandings: tied })!;
    expect(podium.entries.map(e => `${e.rank} ${e.name}`)).toEqual(["1 Aldric", "1 Brenna", "3 Cedric", "3 Dara"]);
    expect(podium.ranked).toBe(6);
  });

  it("uses the frozen rating of a rated season (the board's source), skipping unlinked rows", () => {
    const podium = seasonPodium({ ratingRules: rated, finalRating: [ratingRow("char:x", "Ghost", 900), ratingRow("a", "Aldric", 700)], finalStandings: standings });
    expect(podium?.entries.map(e => e.name)).toEqual(["Aldric"]);
    expect(podium?.ranked).toBe(1);
    // An invalid rated snapshot is not a podium at all (and never falls back to older points).
    expect(seasonPodium({ ratingRules: rated, finalRating: "nope", finalStandings: standings })).toBeNull();
  });

  it("shows each bracket's champion on one card when the season has brackets", () => {
    const rows = [ratingRow("a", "Aldric", 700, "20-29"), ratingRow("b", "Brenna", 500, "20-29"), ratingRow("c", "Cedric", 600, "30-39"), ratingRow("d", "Dara", 600, "30-39")];
    const podium = seasonPodium({ ratingRules: rated, finalRating: rows });
    {
      expect(podium!.entries.map(e => `${e.label}:${e.name}`)).toEqual(["20-29:Aldric", "30-39:Cedric", "30-39:Dara"]);
      expect(seasonEndCard(info, podium, "en", classes).rows?.[0]?.sub).toContain("20-29");
    }
  });
});

describe("season cards", () => {
  it("draws the podium and says so in words when nobody was ranked", async () => {
    const card = seasonEndCard(info, seasonPodium({ finalStandings: standings }), "en", classes);
    expect(card.title).toBe("Season 1 is over");
    expect(card.backdrop).toEqual({ kind: "board", key: "season-podium", fallbackKey: "dungeon-season" });
    expect(card.rows?.[0]).toMatchObject({ name: "Aldric", color: "#c79c6e", right: "300 pts" });
    expect(cardAltText(card)).toContain("Season 1 is over");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
    const empty = seasonEndCard(info, seasonPodium({ finalStandings: [] }), "fr", new Map());
    expect(empty.rows?.[0]?.name).toBe("Aucun joueur classé cette saison");
    expect((await scoreCardPng(seasonStartCard({ ...info, endsAt: null }, "fr")))?.subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);

  function fakeDb(seasons: unknown[], existing = false, switchOn = true) {
    const created: { key: string }[] = [];
    const database = {
      guildSettings: { findUnique: vi.fn().mockResolvedValue({ seasonCardsEnabled: switchOn, dungeonLeaderboardChannelId: "c1" }) },
      dungeonSeason: { findMany: vi.fn().mockResolvedValue(seasons), findFirst: vi.fn().mockResolvedValue({ id: "s2", name: "Season 2", startsAt: new Date(), endsAt: null }) },
      discordJob: { findUnique: vi.fn().mockResolvedValue(existing ? { id: "x" } : null), create: vi.fn(async ({ data }: { data: { key: string } }) => { created.push(data); }) }
    } as never;
    return { database, created };
  }

  it("posts no end card while a season is CLOSING (no results), then one once it is finalized", async () => {
    // CLOSING seasons are never returned by the ENDED query; a season marked ENDED without any results is skipped too.
    const closing = fakeDb([{ id: "s1", ...info, status: "ENDED", finalStandings: null, finalRating: null }]);
    expect(await queueSeasonEndCards(closing.database, "g", "en", classes, ["s1"])).toBe(0);
    expect(closing.created).toEqual([]);
    const finalized = fakeDb([{ id: "s1", ...info, status: "ENDED", finalStandings: standings, finalRating: null }]);
    expect(await queueSeasonEndCards(finalized.database, "g", "en", classes, ["s1"])).toBe(1);
    expect(finalized.created.map(j => j.key)).toEqual(["season-card:end:s1"]);
    // A season that ended days ago is not passed in (only seasons that ended in this tick are), so a deploy posts nothing for it.
    expect(await queueSeasonEndCards(fakeDb([{ id: "old", ...info, status: "ENDED", finalStandings: standings }]).database, "g", "en", classes, [])).toBe(0);
    expect(await queueSeasonEndCards(fakeDb([{ id: "s1", ...info, status: "ENDED", finalStandings: standings }], true).database, "g", "en", classes, ["s1"])).toBe(0);
  });

  it("queues the start card once, only with the switch on", async () => {
    expect(await queueSeasonStartCard(fakeDb([]).database, "g", "en")).toBe(1);
    expect(await queueSeasonStartCard(fakeDb([], true).database, "g", "en")).toBe(0);
    expect(await queueSeasonStartCard(fakeDb([], false, false).database, "g", "en")).toBe(0);
  });

  it("re-checks the switch and channel only for season-card jobs", () => {
    expect(seasonCardChannel("season-card:end:s1", { seasonCardsEnabled: true, dungeonLeaderboardChannelId: "c2" })).toBe("c2");
    expect(seasonCardChannel("season-card:end:s1", { seasonCardsEnabled: false, dungeonLeaderboardChannelId: "c2" })).toBeNull();
    expect(seasonCardChannel("weekly-wow:1", { seasonCardsEnabled: false, dungeonLeaderboardChannelId: null })).toBeUndefined();
  });
});

describe("picture refused", () => {
  it("posts the text once when Discord refuses the picture (no Attach Files), and still fails on other errors", async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Missing Permissions"), { code: 50013 })).mockResolvedValue({});
    await sendWithPictureFallback(send, { files: [{ attachment: Buffer.from("x") }] } as never, () => ({ content: "text" }));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toEqual({ content: "text" });
    const other = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code: 500 }));
    await expect(sendWithPictureFallback(other, {} as never, () => ({ content: "t" }))).rejects.toThrow("boom");
    expect(other).toHaveBeenCalledTimes(1);
  });
});
