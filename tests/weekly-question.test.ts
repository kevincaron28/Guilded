import { describe, expect, it } from "vitest";
import { weeklyQuestionDraft } from "../src/services/weekly-question.js";

const actor = { canManagePolls: true, canViewChannel: true, canSendToChannel: true };
const draft = { question: "Which dungeon next week?", timezone: "America/Toronto", weekday: 5, minute: 19 * 60, channelId: "123456789012345678" };

describe("weekly community question configuration scaffold", () => {
  it("creates disabled, weekly, no-points drafts with no mentions", () => {
    expect(weeklyQuestionDraft(draft, actor)).toMatchObject({ enabled: false, cadence: "weekly", automaticPoints: 0, allowedMentions: { parse: [] } });
  });
  it("requires officer rights and access to the exact target channel", () => {
    for (const key of Object.keys(actor)) expect(() => weeklyQuestionDraft(draft, { ...actor, [key]: false })).toThrow("Officer permission");
  });
  it("validates polls against existing button-poll limits and rejects unknown fields/modes", () => {
    expect(weeklyQuestionDraft({ ...draft, mode: "button-poll", options: ["Dungeon", "Raid"] }, actor).options).toEqual(["Dungeon", "Raid"]);
    for (const change of [{ options: ["yes"] }, { mode: "button-poll", options: ["yes", "YES"] }, { mode: "native-poll" },
      { enabled: true }, { question: "@everyone join us" }, { timezone: "bad/zone" }, { mode: "button-poll", options: ["a", "b", "c", "d", "e", "f"] }]) {
      expect(() => weeklyQuestionDraft({ ...draft, ...change }, actor)).toThrow();
    }
  });
});
