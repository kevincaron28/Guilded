import { describe, expect, it } from "vitest";
import { voiceAttendancePlan } from "../src/services/voice-attendance.js";

describe("voice-channel attendance", () => {
  it("marks this guild's members present, keeps existing records and never marks anyone absent", () => {
    const plan = voiceAttendancePlan({
      inVoice: [{ discordUserId: "1", displayName: "Tank" }, { discordUserId: "2", displayName: "Healer" }, { discordUserId: "9", displayName: "Friend" }],
      known: [{ id: "m1", discordUserId: "1" }, { id: "m2", discordUserId: "2" }, { id: "m3", discordUserId: "3" }],
      recorded: new Set(["m2"]),
      signups: [
        { discordUserId: "1", name: "Tank", status: "SIGNED_UP" },
        { discordUserId: "3", name: "Missing Mage", status: "SIGNED_UP" },
        { discordUserId: "4", name: "Maybe Rogue", status: "MAYBE" }
      ]
    });
    expect(plan).toEqual({ mark: ["m1"], kept: ["m2"], strangers: ["Friend"], missing: ["Missing Mage"] });
  });

  it("handles an empty channel", () => {
    expect(voiceAttendancePlan({ inVoice: [], known: [], recorded: new Set(), signups: [{ discordUserId: "1", name: "A", status: "SIGNED_UP" }] }))
      .toEqual({ mark: [], kept: [], strangers: [], missing: ["A"] });
  });
});
