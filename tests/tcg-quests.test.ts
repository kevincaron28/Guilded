import { describe, expect, it } from "vitest";
import { dayKey, emptyDaily, MAX_PLAY_PACKS_PER_DAY, questsOn, QUESTS, settleProgress } from "../src/services/tcg-quests.js";

const DAY = "2026-11-10";
const win = { won: true, counted: true, winCounts: true, spells: 0, zones: 0 };

describe("daily quests", () => {
  it("shows three of the four quests and rotates which one is left out", () => {
    const days = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
    const left = days.map(day => { const ids = questsOn(day).map(q => q.id); expect(ids).toHaveLength(3); return QUESTS.find(q => !ids.includes(q.id))!.id; });
    expect(new Set(left).size).toBe(4);
    expect(dayKey(new Date("2026-11-10T23:59:59Z"))).toBe("2026-11-10");
  });

  it("counts a win, credits each quest once, and three steps make a pack", () => {
    let daily = emptyDaily(), progress = 0;
    const first = settleProgress(DAY, daily, progress, win);
    expect(first.daily.wins).toBe(1);
    expect(first.steps).toBeGreaterThanOrEqual(1);
    ({ daily, packProgress: progress } = first);
    const second = settleProgress(DAY, daily, progress, win);
    // The win quest is not credited twice.
    expect(second.questsCompleted).not.toContain("win1");
    expect(second.daily.questsDone.filter(q => q === "win1").length).toBeLessThanOrEqual(1);
  });

  it("does not count a match the member left early, and an Easy win is no pack step", () => {
    const early = settleProgress(DAY, emptyDaily(), 0, { ...win, counted: false });
    expect(early.daily.played).toBe(0);
    expect(early.steps).toBe(0);
    const easy = settleProgress(DAY, emptyDaily(), 0, { ...win, winCounts: false });
    expect(easy.steps).toBe(easy.questsCompleted.length);
  });

  it("caps the packs earned from play at three a day and drops the rest", () => {
    let daily = emptyDaily(), progress = 0, packs = 0;
    for (let i = 0; i < 40; i++) {
      const r = settleProgress(DAY, daily, progress, { ...win, spells: 10, zones: 1 });
      daily = r.daily; progress = r.packProgress; packs += r.packs;
    }
    expect(packs).toBe(MAX_PLAY_PACKS_PER_DAY);
    expect(daily.packsEarned).toBe(MAX_PLAY_PACKS_PER_DAY);
    expect(daily.questsDone).toHaveLength(3);
  });
});
