import { describe, expect, it, vi } from "vitest";
import { executeOwnerSeason, ownerSeasonCommand } from "../src/commands/owner-season.js";

// Only the Discord application's owner may change the season calendar.
describe("/guilded-season", () => {
  const interaction = (userId: string) => {
    const reply = vi.fn(async () => undefined);
    return { reply, value: { user: { id: userId }, client: { application: { fetch: async () => ({ owner: { id: "owner-1" } }) } },
      options: { getSubcommand: () => "next" }, reply } };
  };

  it("refuses everyone but the bot owner, before reading any option", async () => {
    const officer = interaction("officer-9");
    await executeOwnerSeason(officer.value as never);
    expect(officer.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Only the Guilded bot's owner") }));
  });

  it("is hidden from non-administrators in the home server", () => {
    expect(ownerSeasonCommand.toJSON().default_member_permissions).toBe("8");
    expect(ownerSeasonCommand.toJSON().options?.map((o) => o.name)).toEqual(["status", "next", "cancel"]);
  });
});
