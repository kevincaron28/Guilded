import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { characterKey } from "../companion/character-identity.mjs";
import { deviceRunCounts, dungeonRunReport, relayedRunReport, signedRunCounts } from "../companion/run-report.mjs";

const require = createRequire(import.meta.url);
const { message } = require("../companion-app/i18n.cjs") as { message: (language: string, value: string) => string };

// 9.3.3 relay audit: what the companion says about runs it carried for players near it, and that a relayed run cannot be placed on
// the wrong character because of a realm label.

describe("the companion's line for relayed runs", () => {
  const own = { id: "own-1" };
  const relayed = [{ id: "far-1", viaGroup: true }, { id: "far-2", viaGroup: true }];

  it("counts relayed runs apart from the PC's own, so they never show as 'not confirmed yet'", () => {
    const counts = deviceRunCounts([own, ...relayed], { runReceipts: { acceptedRunRefs: ["own-1", "group:far-1"], runNotes: {} } });
    expect(dungeonRunReport(counts)).toEqual({ level: "ok", message: "Dungeon runs: 1 sent, 1 stored." });
    expect(relayedRunReport(counts)).toEqual({ level: "info", message: "Runs relayed for players near you: 2 sent, 1 accepted." });
  });

  it("a PC that only relayed has no 'none to send' line, only the relayed one", () => {
    const counts = deviceRunCounts(relayed, { runReceipts: { acceptedRunRefs: ["group:far-1", "group:far-2"], runNotes: {} } });
    expect(dungeonRunReport(counts)).toBeNull();
    expect(relayedRunReport(counts)?.message).toBe("Runs relayed for players near you: 2 sent, 2 accepted.");
  });

  it("says nothing without relayed runs, and the signed-in line only says what was sent", () => {
    expect(relayedRunReport(deviceRunCounts([own], { runReceipts: { acceptedRunRefs: ["own-1"] } }))).toBeNull();
    expect(relayedRunReport(signedRunCounts(relayed, { acceptedRunRefs: [] }), { acceptedKnown: false })?.message).toBe("Runs relayed for players near you: 2 sent.");
  });

  it("is translated in the French companion window", () => {
    expect(message("fr", "Runs relayed for players near you: 2 sent, 1 accepted.")).toBe("Parcours relayés pour des joueurs proches : 2 envoyé(s), 1 accepté(s).");
    expect(message("fr", "Runs relayed for players near you: 2 sent.")).toBe("Parcours relayés pour des joueurs proches : 2 envoyé(s).");
    expect(message("en", "Runs relayed for players near you: 2 sent.")).toBe("Runs relayed for players near you: 2 sent.");
  });
});

describe("a relayed run is placed by character name only on WoW Forever", () => {
  it("ignores the realm label, so one player under two realm labels is one character and a run never splits", () => {
    expect(characterKey("Walter", "Doomhowl")).toBe(characterKey("Walter", "Another Realm"));
    expect(characterKey("  WALTER ", "x")).toBe("walter");
  });
  it("keeps different names apart", () => {
    expect(characterKey("Walter", "Doomhowl")).not.toBe(characterKey("Donny", "Doomhowl"));
  });
});
