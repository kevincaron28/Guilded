import { describe, expect, it, vi } from "vitest";
import { queueSeasonCards, seasonCardChannel, seasonEndCard, seasonStartCard } from "../src/services/season-cards.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";

const info = { name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: new Date("2026-12-02T23:00:00Z") };
const rows = [{ memberId: "a", name: "Aldric", points: 300 }, { memberId: "b", name: "Brenna", points: 250 }, { memberId: "c", name: "Cedric", points: 90 }, { memberId: "d", name: "Dara", points: 10 }];
const classes = new Map([["aldric", "Warrior"]]);

describe("season cards", () => {
  it("draws the podium of the season that ended", async () => {
    const card = seasonEndCard(info, rows, "en", classes);
    expect(card.title).toBe("Season 1 is over");
    expect(card.rows?.map(r => r.name)).toEqual(["Aldric", "Brenna", "Cedric"]);
    expect(card.rows?.[0]).toMatchObject({ color: "#c79c6e", right: "300 pts" });
    expect(card.stats[1]!.value).toBe("4");
    expect(cardAltText(card)).toContain("Season 1 is over");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("says so in words when nobody was ranked, in French too", () => {
    const card = seasonEndCard(info, null, "fr", new Map());
    expect(card.title).toBe("Season 1 est terminée");
    expect(card.rows?.[0]?.name).toBe("Aucun joueur classé cette saison");
  });

  it("draws the start card with or without an end date", async () => {
    expect(seasonStartCard({ ...info, endsAt: null }, "en").subtitle).toBe("From 2026-11-04");
    expect((await scoreCardPng(seasonStartCard(info, "fr")))?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("queues each season's cards once, only with the switch on and a channel", async () => {
    const created: { key: string; payload: { route: string } }[] = [];
    const db = (switchOn: boolean, existing = false) => ({
      guildSettings: { findUnique: vi.fn().mockResolvedValue({ seasonCardsEnabled: switchOn, dungeonLeaderboardChannelId: "c1" }) },
      dungeonSeason: { findFirst: vi.fn(async ({ where }: { where: { status: unknown } }) => where.status === "ACTIVE" ? { id: "s2", name: "Season 2", startsAt: new Date(), endsAt: null } : { id: "s1", ...info, finalStandings: rows }) },
      discordJob: { findUnique: vi.fn().mockResolvedValue(existing ? { id: "x" } : null), create: vi.fn(async ({ data }: { data: { key: string; payload: { route: string } } }) => { created.push(data); }) }
    }) as never;
    expect(await queueSeasonCards(db(true), "g", "Season 1", "en", classes)).toBe(2);
    expect(created.map(j => j.key)).toEqual(["season-card:end:s1", "season-card:start:s2"]);
    expect(created[0]!.payload.route).toBe("seasonCard");
    expect(await queueSeasonCards(db(false), "g", "Season 1", "en", classes)).toBe(0);
    expect(await queueSeasonCards(db(true, true), "g", "Season 1", "en", classes)).toBe(0);
  });

  it("re-checks the switch and channel only for season-card jobs", () => {
    expect(seasonCardChannel("season-card:end:s1", { seasonCardsEnabled: true, dungeonLeaderboardChannelId: "c2" })).toBe("c2");
    expect(seasonCardChannel("season-card:end:s1", { seasonCardsEnabled: false, dungeonLeaderboardChannelId: "c2" })).toBeNull();
    expect(seasonCardChannel("weekly-wow:1", { seasonCardsEnabled: false, dungeonLeaderboardChannelId: null })).toBeUndefined();
  });
});
