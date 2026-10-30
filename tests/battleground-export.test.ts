import { describe, expect, it } from "vitest";
import { exportBattlegroundReports } from "../companion/lua-export-content.mjs";

const report = { version: 1, reportId: "bg:1800000000:1", adapter: "forever-postmatch-v1", edition: "forever",
  character: "Kev", realm: "Realm", realmType: "normal", mode: "casual", mapId: 489, bracket: "6",
  endedAt: 1800000000, durationSeconds: 600, outcome: "win", presence: "complete", reloaded: false,
  postmatch: true, consent: true };
const database = (row = report, consent = true) => ({ character: { gameEdition: "forever" },
  battleground: { consents: { "Kev-Realm": consent }, reports: { [row.reportId]: row } } });

describe("private battleground export", () => {
  it("exports only whitelisted self-report fields and preserves its durable ID", () => {
    const input = database({ ...report, opponents: ["Private"] } as typeof report);
    expect(exportBattlegroundReports(input)).toEqual([report]);
    expect(exportBattlegroundReports(input)).toEqual(exportBattlegroundReports(input));
  });
  it("suppresses revoked consent, active-match data and other editions", () => {
    expect(exportBattlegroundReports(database(report, false))).toEqual([]);
    expect(exportBattlegroundReports(database({ ...report, postmatch: false }))).toEqual([]);
    expect(exportBattlegroundReports({ ...database(), character: { gameEdition: "retail" } })).toEqual([]);
  });
  it("does not coerce malformed values or export records for a different character", () => {
    expect(exportBattlegroundReports(database({ ...report, character: "Other" }))).toEqual([]);
    expect(exportBattlegroundReports(database({ ...report, durationSeconds: NaN }))).toEqual([]);
    expect(exportBattlegroundReports(database({ ...report, reportId: "bad id!" }))).toEqual([]);
  });
});
