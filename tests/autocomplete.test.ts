import { describe, expect, it, vi } from "vitest";
import { craftChoices, raidChoices, raidStatusesFor } from "../src/services/autocomplete.js";

const hour = 3_600_000;

describe("autocomplete", () => {
  it("lists upcoming raids soonest first, then recent ones, filtered by name", async () => {
    const now = Date.now();
    const findMany = vi.fn().mockResolvedValue([
      { id: "old", title: "Molten Core", status: "COMPLETED", scheduledAt: new Date(now - 48 * hour) },
      { id: "older", title: "Onyxia", status: "COMPLETED", scheduledAt: new Date(now - 96 * hour) },
      { id: "soon", title: "Molten Core", status: "PLANNED", scheduledAt: new Date(now + 2 * hour) },
      { id: "later", title: "Blackwing Lair", status: "PLANNED", scheduledAt: new Date(now + 48 * hour) }
    ]);
    const all = await raidChoices({ raid: { findMany } } as never, { guildId: "g", query: "", statuses: ["PLANNED", "COMPLETED"], timeZone: "America/Toronto", language: "en" });
    expect(all.map((choice) => choice.value)).toEqual(["soon", "later", "old", "older"]);
    expect(all[0]?.name).toMatch(/^Molten Core — .* \(planned\)$/);
    const mc = await raidChoices({ raid: { findMany } } as never, { guildId: "g", query: "molten", statuses: ["PLANNED"], timeZone: "America/Toronto", language: "en" });
    expect(mc.map((choice) => choice.value)).toEqual(["soon", "old"]);
  });

  it("only offers raids a subcommand can act on", () => {
    expect(raidStatusesFor("cancel-signup")).toEqual(["PLANNED"]);
    expect(raidStatusesFor("end")).toEqual(["ACTIVE"]);
    expect(raidStatusesFor("report")).toEqual(["PLANNED", "ACTIVE", "COMPLETED"]);
  });

  it("offers crafters the requests they claimed, to finish or give back", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await craftChoices({ craftRequest: { findMany } } as never, "g", "", "done", "me");
    expect(findMany.mock.calls[0]?.[0].where).toEqual({ guildId: "g", status: "CLAIMED", crafterId: "me" });
  });

  it("keeps choice names within Discord's 100-character limit", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "x", title: "A".repeat(150), status: "PLANNED", scheduledAt: new Date(Date.now() + hour) }]);
    const [choice] = await raidChoices({ raid: { findMany } } as never, { guildId: "g", query: "", statuses: ["PLANNED"], timeZone: "UTC", language: "en" });
    expect(choice?.name.length).toBeLessThanOrEqual(100);
  });
});
