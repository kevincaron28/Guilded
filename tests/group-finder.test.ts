import { describe, expect, it } from "vitest";
import { activityFromId, activityLabel, activityOfGroup, FINDER_ACTIVITIES, finderChannelFor, finderIsMerged, offeredActivities } from "../src/services/group-finder.js";
import { dungeonSignupGuideText } from "../src/services/dungeon-guide.js";

describe("group finder activities", () => {
  it("maps each activity to a group kind, with arena stored as a PvP activity", () => {
    expect(FINDER_ACTIVITIES.DUNGEON).toMatchObject({ kind: "DUNGEON", activity: null, size: 5 });
    expect(FINDER_ACTIVITIES.BATTLEGROUND).toMatchObject({ kind: "PVP", activity: "battleground", size: 10 });
    expect(FINDER_ACTIVITIES.ARENA).toMatchObject({ kind: "PVP", activity: "arena", size: 5 });
    expect(FINDER_ACTIVITIES.WORLDPVP).toMatchObject({ kind: "WORLDPVP", size: 20 });
  });

  it("reads form ids, treating the old PVP kind as a battleground and anything unknown as a dungeon", () => {
    expect(activityFromId("ARENA")).toBe("ARENA");
    expect(activityFromId("worldpvp")).toBe("WORLDPVP");
    expect(activityFromId("PVP")).toBe("BATTLEGROUND");
    expect(activityFromId("LEVELING")).toBe("DUNGEON");
    expect(activityFromId("")).toBe("DUNGEON");
  });

  it("names the activity of a stored group", () => {
    expect(activityOfGroup("DUNGEON", null)).toBe("DUNGEON");
    expect(activityOfGroup("PVP", "arena")).toBe("ARENA");
    expect(activityOfGroup("PVP", null)).toBe("BATTLEGROUND");
    expect(activityOfGroup("WORLDPVP", null)).toBe("WORLDPVP");
    expect(activityOfGroup("OTHER", null)).toBeNull();
    expect(activityLabel("ARENA", "fr")).toBe("Arène");
    expect(activityLabel("BATTLEGROUND", "en")).toBe("Battleground");
  });
});

describe("where groups are posted", () => {
  const both = { unifiedGroupFinder: true, dungeonSignupChannelId: "finder", bgGroupsChannelId: "pvp" };
  it("sends every activity to the finder when the merge is on and a finder exists", () => {
    for (const id of ["DUNGEON", "BATTLEGROUND", "ARENA", "WORLDPVP"] as const) expect(finderChannelFor(both, id)).toBe("finder");
    expect(finderIsMerged(both)).toBe(true);
  });
  it("keeps PvP in the pvp-groups channel for a server with no finder, or with the switch off", () => {
    expect(finderChannelFor({ unifiedGroupFinder: true, dungeonSignupChannelId: null, bgGroupsChannelId: "pvp" }, "ARENA")).toBe("pvp");
    expect(finderChannelFor({ ...both, unifiedGroupFinder: false }, "BATTLEGROUND")).toBe("pvp");
    expect(finderChannelFor({ ...both, unifiedGroupFinder: false }, "DUNGEON")).toBe("finder");
    expect(finderIsMerged({ ...both, unifiedGroupFinder: false })).toBe(false);
    expect(finderIsMerged({ unifiedGroupFinder: true, dungeonSignupChannelId: null })).toBe(false);
    expect(finderChannelFor(null, "DUNGEON")).toBeNull();
  });
  it("is on by default when the setting is missing", () => {
    expect(finderIsMerged({ dungeonSignupChannelId: "finder" })).toBe(true);
  });
  it("offers all four activities when merged and dungeons only otherwise", () => {
    expect(offeredActivities(true)).toEqual(["DUNGEON", "BATTLEGROUND", "ARENA", "WORLDPVP"]);
    expect(offeredActivities(false)).toEqual(["DUNGEON"]);
  });
  it("tells members the guide covers PvP in both languages", () => {
    expect(dungeonSignupGuideText("en")).toMatch(/battleground, arena or world PvP/);
    expect(dungeonSignupGuideText("fr")).toMatch(/champ de bataille, arène ou JcJ/);
  });
});
