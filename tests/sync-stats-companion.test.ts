import { describe, expect, it } from "vitest";
import { exportSyncStats, parseAddonExportText } from "../companion/lua-export-content.mjs";
import { syncDiagnosticPreview } from "../companion/sync-status.mjs";

// 9.0 maximum sharing: the addon's sync counters reach the support summary (never the bot), and a
// digest forwarded during catch-up feeds the character list but never a readiness row.
const NOW = 1800000000;

describe("guild sync counters in the companion", () => {
  it("keeps whole numbers and two dates only, never the guildmate's name", () => {
    expect(exportSyncStats({ syncStats: { sent: 12, bytes: 900, received: 30, receivedBytes: 4000, relayedIn: 3, relayedOut: -1, rounds: "x",
      since: NOW - 86400, lastCatchUpAt: NOW, lastCatchUpWith: "Lebowski" } })).toEqual({
      sent: 12, bytes: 900, received: 30, receivedBytes: 4000, held: 0, relayedIn: 3, relayedOut: 0, rounds: 0, acksSent: 0, acksHeard: 0,
      since: new Date((NOW - 86400) * 1000).toISOString(), lastCatchUpAt: new Date(NOW * 1000).toISOString()
    });
    expect(exportSyncStats({})).toBeNull();
  });

  it("the support summary shows them; without them it is unchanged", () => {
    const gameSync = { sent: 5, bytes: 100, received: 7, receivedBytes: 300, held: 1, relayedIn: 2, relayedOut: 1, rounds: 1, acksSent: 0, acksHeard: 1,
      lastCatchUpAt: "2027-01-15T08:00:00.000Z", lastCatchUpWith: "Lebowski" };
    const preview = syncDiagnosticPreview({}, { running: true, gameSync }, {});
    expect(preview.gameSync).toEqual({ sent: 5, bytes: 100, received: 7, receivedBytes: 300, held: 1, relayedIn: 2, relayedOut: 1, rounds: 1, acksSent: 0, acksHeard: 1,
      lastCatchUpAt: "2027-01-15T08:00:00.000Z" });
    expect(JSON.stringify(preview)).not.toContain("Lebowski");
    expect("gameSync" in syncDiagnosticPreview({}, { running: true }, {})).toBe(false);
  });

  it("a forwarded digest becomes a character, not a readiness row, and carries no verify code", () => {
    const lua = `GuildedDB = {
      ["character"] = { ["name"] = "Walter", ["realm"] = "Realm" },
      ["peerRoster"] = {
        ["Maude"] = { ["identity"] = { ["class"] = "MAGE", ["race"] = "Human", ["level"] = 24, ["spec"] = "Frost" }, ["professions"] = "Tailoring:150",
          ["professionsAt"] = ${NOW - 7200}, ["professionsComplete"] = true, ["seenAt"] = ${NOW - 3600}, ["updatedAt"] = ${NOW - 3600}, ["status"] = "UNKNOWN",
          ["forwarded"] = true, ["via"] = "Donny" },
        ["Donny"] = { ["identity"] = { ["class"] = "WARRIOR", ["race"] = "Dwarf", ["level"] = 30 }, ["seenAt"] = ${NOW - 60}, ["updatedAt"] = ${NOW - 60}, ["status"] = "READY" },
      },
      ["syncStats"] = { ["sent"] = 4, ["since"] = ${NOW - 86400} },
    }`;
    const out = parseAddonExportText(lua, "Realm") as { readiness: { character: string }[]; characters: { name: string; observedAt?: string; verify?: string }[]; syncStats?: { sent: number } };
    expect(out.readiness.map((row) => row.character)).toEqual(["Donny"]);
    const maude = out.characters.find((row) => row.name === "Maude");
    expect(maude).toMatchObject({ observedAt: new Date((NOW - 3600) * 1000).toISOString() });
    expect(maude?.verify).toBeUndefined();
    expect(out.syncStats?.sent).toBe(4);
  });
});
