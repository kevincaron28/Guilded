import { describe, expect, it } from "vitest";
import { craftCommand } from "../src/commands/craft.js";
import { lotteryCommand } from "../src/commands/community.js";
import { handleRaidSignupButton, raidCommand, RAID_SIGNUP_PREFIX } from "../src/commands/raid.js";
import { handleCraftButton } from "../src/commands/craft-board.js";
import { commands } from "../src/commands/index.js";

// 9.0 cleanup: commands that only repeated a button are gone; the buttons stay.
const subs = (command: { toJSON(): { options?: { name: string }[] } }) => (command.toJSON().options ?? []).map((option) => option.name);

describe("commands that only repeated a button", () => {
  it("/raid signup, /craft claim and /community lottery join are not registered", () => {
    expect(subs(raidCommand)).not.toContain("signup");
    expect(subs(raidCommand)).toContain("cancel-signup");
    expect(subs(craftCommand)).not.toContain("claim");
    expect(subs(craftCommand)).toContain("done");
    expect(subs(lotteryCommand)).not.toContain("join");
    const names = JSON.stringify(commands.map((command) => command.toJSON()));
    expect(names).not.toContain('"name":"claim","description":"Take a request');
    expect(names).not.toContain('"name":"signup","description":"Sign up for a raid');
  });
  it("the role buttons on the raid post and the craft post's claim button are still handled", () => {
    expect(RAID_SIGNUP_PREFIX).toBe("raidsignup:");
    expect(typeof handleRaidSignupButton).toBe("function");
    expect(typeof handleCraftButton).toBe("function");
  });
});
