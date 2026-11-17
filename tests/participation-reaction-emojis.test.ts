import { describe, expect, it } from "vitest";
import { participationRules, reactionEmojiCounts } from "../src/services/participation-rules.js";

// Owner decision, 16 Nov 2026: every reaction emoji earns, unless officers chose their own list.
describe("reaction emojis", () => {
  it("counts every emoji by default and for seasons saved with the old default list", () => {
    expect(reactionEmojiCounts(participationRules.parse({}), "😂")).toBe(true);
    expect(reactionEmojiCounts(participationRules.parse({ emojis: ["👍", "❤️", "🎉"] }), "🔥")).toBe(true);
    expect(reactionEmojiCounts(participationRules.parse({ emojis: ["👍", "❤", "🎉"] }), "123456789012345678")).toBe(true);
  });
  it("keeps an officer's own list", () => {
    const rules = participationRules.parse({ emojis: ["🔥", "123456789012345678"] });
    expect(reactionEmojiCounts(rules, "🔥")).toBe(true);
    expect(reactionEmojiCounts(rules, "123456789012345678")).toBe(true);
    expect(reactionEmojiCounts(rules, "👍")).toBe(false);
  });
});
