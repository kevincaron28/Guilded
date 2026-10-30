import { describe, expect, it } from "vitest";
import { exportBattlegroundReports } from "../companion/lua-export-content.mjs";
import { battlegroundReportSchema } from "../src/services/battleground-record-schema.js";

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
  it.each(["forever", "classic-era", "classic-tbc", "classic-mists", "retail"])("exports and validates a %s report only with that edition's adapter", edition => {
    const own = { ...report, edition, adapter: `${edition}-postmatch-v1` };
    const db = { ...database(own), character: { gameEdition: edition } };
    expect(exportBattlegroundReports(db)).toEqual([own]);
    expect(battlegroundReportSchema.safeParse(own).success).toBe(true);
    // Wrong adapter for the edition, or a report from another edition's database, is refused.
    expect(battlegroundReportSchema.safeParse({ ...own, adapter: "forever-postmatch-v1", edition: edition === "forever" ? "retail" : edition }).success).toBe(false);
    expect(exportBattlegroundReports({ ...db, character: { gameEdition: edition === "retail" ? "forever" : "retail" } })).toEqual([]);
  });
  it("does not coerce malformed values or export records for a different character", () => {
    expect(exportBattlegroundReports(database({ ...report, character: "Other" }))).toEqual([]);
    expect(exportBattlegroundReports(database({ ...report, durationSeconds: NaN }))).toEqual([]);
    expect(exportBattlegroundReports(database({ ...report, reportId: "bad id!" }))).toEqual([]);
  });
});
