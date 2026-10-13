import { describe, expect, it } from "vitest";
import { dungeonAnnouncement } from "../src/services/dungeon-announce.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";

const result = (overrides: Partial<DungeonImportResult>): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Deadmines", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1300, points: 0,
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: ["Kev", "Bob"], deaths: 0, unlinked: [], achievements: [], ...overrides
});

describe("dungeonAnnouncement", () => {
  it("shows only guild members, including zero-point members, and their death coverage", () => {
    const players = ["Kev", "Guest", "A", "B", "C", "Replacement"];
    const run = result({ players, unlinked: ["Guest", "A", "B", "Replacement"], endedAt: 1791901866, completedBy: "final boss", points: 58,
      playerDetails: players.map((character, i) => ({ character, class: "PRIEST", role: "HEALER", deaths: i === 0 ? 0 : i === 1 ? 9 : null, presentSec: 1000, points: i === 0 ? 58 : 0 })) });
    const en = dungeonAnnouncement({ results: [run], duplicates: 0, malformed: 0 }, "en")!.toJSON();
    expect(en.description).toContain("guild deaths: 0 (1/2 tracked)");
    expect(en.description).not.toContain("no deaths");
    expect(en.description).toContain("<t:1791901866:f>");
    expect(en.description).toContain("2 guild member(s)");
    expect(en.description).toContain("PRIEST / Healer");
    expect(en.description).toContain("deaths untracked");
    expect(en.description).toContain("58 total points awarded");
    expect(en.description).toContain("**C**");
    expect(en.description).toContain("0 pts");
    for (const outsider of run.unlinked) expect(en.description).not.toContain(`**${outsider}**`);
    const fr = dungeonAnnouncement({ results: [run], duplicates: 0, malformed: 0 }, "fr")!.toJSON();
    expect(fr.description).toContain("Soigneur");
    expect(fr.description).toContain("morts non suivies");
  });

  it("posts a solo completion and stays within Discord's embed budget for large imports", () => {
    const single = result({ players: ["Kev"] });
    expect(dungeonAnnouncement({ results: [single], duplicates: 0, malformed: 0 }, "en")!.toJSON().description).toContain("1 guild member(s)");
    const many = Array.from({ length: 20 }, (_, i) => result({ runRef: `QG-${i}`, dungeonName: "D".repeat(100),
      playerDetails: Array.from({ length: 40 }, (_, j) => ({ character: `Player${j}`, role: "DPS", deaths: null, points: 0, presentSec: 1000 })) }));
    const embed = dungeonAnnouncement({ results: many, duplicates: 0, malformed: 0 }, "en")!;
    expect(embed.length).toBeLessThanOrEqual(6000);
    expect(embed.toJSON().description!.length).toBeLessThanOrEqual(4096);
  });
  it("filters legacy rosters, records and achievements and omits runs without guild members", () => {
    const run = result({ unlinked: ["Bob"], deaths: 9,
      personalRecords: [{ character: "Bob", previous: 1500, now: 1300 }],
      achievements: [{ character: "Bob", key: "firstBlood" }] });
    const embed = dungeonAnnouncement({ results: [run], duplicates: 0, malformed: 0 }, "en")!.toJSON();
    expect(JSON.stringify(embed)).not.toContain("Bob");
    expect(embed.description).not.toContain("guild deaths: 9");
    expect(dungeonAnnouncement({ results: [result({ unlinked: ["Kev", "Bob"] })], duplicates: 0, malformed: 0 }, "en")).toBeNull();
  });

  it("posts nothing when no run was completed and valid", () => {
    const summary = { results: [result({ state: "ABANDONED" }), result({ valid: false, invalidReason: "too short" })], duplicates: 3, malformed: 0 };
    expect(dungeonAnnouncement(summary, "en")).toBeNull();
  });

  it("lists completed runs and the records they set, in the guild language", () => {
    const summary = {
      results: [
        result({ guildRecord: true, previousGuildBest: 1500, personalRecords: [{ character: "Kev", previous: 1500, now: 1300 }] }),
        result({ runRef: "QG-2", dungeonName: "Shadowfang Keep", difficultyId: 0, deaths: null }),
        result({ runRef: "QG-3", state: "ABANDONED" })
      ],
      duplicates: 0, malformed: 0
    };
    const embed = dungeonAnnouncement(summary, "fr")?.toJSON();
    expect(embed?.description).toContain("✅ **Deadmines (Normal)** 21:40 · morts de guilde: 0");
    expect(embed?.description).toContain("✅ **Shadowfang Keep** 21:40\n");
    expect(embed?.description?.match(/✅/g)).toHaveLength(2);
    expect(embed?.fields?.[0]?.value).toContain("Nouveau record de guilde dans **Deadmines (Normal)** : 25:00 → **21:40**");
    expect(embed?.fields?.[0]?.value).toContain("Record personnel dans Deadmines (Normal) : Kev");
  });
});

describe("test dungeon runs", () => {
  it("are marked [TEST] in the channel", () => {
    const embed = dungeonAnnouncement({ results: [result({ runRef: "SIM-1790000000-abcde", dungeonName: "Test Dungeon" })], duplicates: 0, malformed: 0 }, "en");
    expect(embed?.toJSON().description).toContain("**[TEST] Test Dungeon (Normal)**");
  });
});
