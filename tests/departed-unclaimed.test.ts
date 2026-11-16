import { describe, expect, it } from "vitest";
import { withoutDeparted, loadRosterPresence } from "../src/services/roster-presence.js";
import { loadRosterGaps } from "../src/services/roster-gaps.js";
import { loadRosterSnapshot } from "../src/services/roster-dashboard-store.js";
import { linkView } from "../src/services/character-panel.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const unclaimed = (name: string) => ({ nameKey: name.toLowerCase(), name, displayName: null, realm: "", className: "Mage", race: "Human", level: 20, professions: null, lastSeenAt: NOW, id: `u-${name}`, gameEdition: "forever" });
const roster = [
  { name: "Gone Player", nameKey: "gone player", inGuild: false, observedAt: NOW },
  { name: "Here Player", nameKey: "here player", inGuild: true, observedAt: NOW }
];
const rosterDb = { guildRosterEntry: { findMany: async () => roster } };

describe("departed unclaimed characters are not listed (16 Nov 2026 sweep)", () => {
  it("withoutDeparted keeps unknown names and an empty roster departs nobody", () => {
    const chars = [{ key: "gone player", name: "Gone Player" }, { key: "here player", name: "Here Player" }, { key: "new guy", name: "New Guy" }];
    expect(withoutDeparted(chars, roster).map((c) => c.name)).toEqual(["Here Player", "New Guy"]);
    expect(withoutDeparted(chars, [])).toHaveLength(3);
  });
  it("loadRosterPresence reads one guild's roster", async () => {
    expect(await loadRosterPresence(rosterDb as never, "g1", "forever")).toHaveLength(2);
  });
  it("the roster gaps report leaves a departed player out of 'nobody claimed'", async () => {
    const db = {
      member: { findMany: async () => [] },
      unclaimedCharacter: { findMany: async () => [unclaimed("Gone Player"), unclaimed("Here Player")] },
      guild: { findUnique: async () => ({ officerSyncAt: NOW }) },
      guildSettings: { findUnique: async () => ({ rosterIgnoredRoleIds: [] }) },
      characterVerifyClaim: { findMany: async () => [] },
      ...rosterDb
    };
    const guild = { memberCount: 0, members: { cache: new Map(), list: async () => new Map() } };
    const gaps = await loadRosterGaps(db as never, guild as never, "g1", "forever", NOW);
    expect(gaps.unclaimed.map((row) => row.name)).toEqual(["Here Player"]);
  });
  it("the roster snapshot leaves a departed unclaimed character out, and works without a roster table", async () => {
    const database = { character: { findMany: async () => [] }, unclaimedCharacter: { findMany: async () => [unclaimed("Gone Player"), unclaimed("Here Player")] }, ...rosterDb };
    const guild = { id: "g1", edition: "forever" } as never;
    expect((await loadRosterSnapshot(database as never, guild)).characters.map((c) => c.name)).toEqual(["Here Player"]);
    const noRoster = { character: database.character, unclaimedCharacter: database.unclaimedCharacter };
    expect((await loadRosterSnapshot(noRoster as never, guild)).characters).toHaveLength(2);
  });
  it("the link panel does not offer a departed player", async () => {
    const database = { character: { findMany: async () => [] }, unclaimedCharacter: { findMany: async () => [unclaimed("Gone Player"), unclaimed("Here Player")] }, ...rosterDb };
    const context = { member: { id: "m1", guildId: "g1", guild: { name: "QG", discordId: "d1" } }, lang: "en" as const };
    const result = await linkView(database as never, context);
    const menu = result.components[0]!.components[0]!.toJSON() as { options?: { label: string }[] };
    expect(menu.options?.map((option) => option.label)).toEqual(["Here Player"]);
  });
});
