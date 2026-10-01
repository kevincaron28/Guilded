import { describe, expect, it } from "vitest";
import { parseWeeklySchedule, weeklyOccurrences, weeklyScheduleData, weeklyScheduleText } from "../src/services/core-weekly-time.js";

const zone = "America/Toronto";
const times = (text: string, now: string) => weeklyOccurrences(parseWeeklySchedule(text), zone, new Date(now)).map(row => row.scheduledAt.toISOString());

describe("weekly core times", () => {
  it("accepts Québec and English days, explicit clocks, shared days and removes duplicates", () => {
    const slots = parseWeeklySchedule("Mar/jeu 8pm; jeudi 20h; vendredi à 20h30\nMonday 12am");
    expect(weeklyScheduleText(slots)).toBe("lundi 00h00; mardi 20h00; jeudi 20h00; vendredi 20h30");
  });
  it.each(["", "off", "arrêt", "stop"])("stops generation with %s", input => {
    expect(weeklyScheduleData(input, zone, "leader")).toEqual({ schedule: null, weeklySchedule: null, weeklyTimezone: null, weeklyCreatedBy: null });
  });
  it.each(["Tue/Thu 8-11pm EST", "mardi 8", "mardi 24h", "mardi 0am", "mardi 13pm", "mardi 20h60", "demain 20h", "2026-10-01 20h"])("rejects ambiguous or invalid schedule %s", input => {
    expect(() => parseWeeklySchedule(input)).toThrow();
  });
  it("opens only the next seven local days and advances without an end-raid command", () => {
    expect(times("mardi 20h; jeudi 20h", "2026-10-01T12:00:00Z")).toEqual(["2026-10-02T00:00:00.000Z", "2026-10-07T00:00:00.000Z"]);
    expect(times("mardi 20h; jeudi 20h", "2026-10-02T00:01:00Z")).toEqual(["2026-10-07T00:00:00.000Z", "2026-10-09T00:00:00.000Z"]);
  });
  it("includes the next week's same start after this week's has passed", () => {
    expect(times("jeudi 20h", "2026-10-02T00:00:00Z")).toEqual(["2026-10-09T00:00:00.000Z"]);
  });
  it("keeps 20h across the spring and fall clock changes", () => {
    expect(times("dimanche 20h", "2026-03-07T12:00:00Z")).toEqual(["2026-03-09T00:00:00.000Z"]);
    expect(times("dimanche 20h", "2026-10-31T12:00:00Z")).toEqual(["2026-11-02T01:00:00.000Z"]);
  });
  it("skips nonexistent times and produces one occurrence at a repeated fall time", () => {
    expect(times("dimanche 2h30", "2026-03-07T12:00:00Z")).toEqual([]);
    expect(times("dimanche 1h30", "2026-10-31T12:00:00Z")).toEqual(["2026-11-01T05:30:00.000Z"]);
  });
  it("uses local dates at midnight across the year boundary", () => {
    expect(times("vendredi 0h", "2026-12-31T23:00:00Z")).toEqual(["2027-01-01T05:00:00.000Z"]);
  });
  it("rejects invalid zones and more than fourteen weekly starts", () => {
    expect(() => weeklyScheduleData("mardi 20h", "EST-fake", "leader")).toThrow(/horaire/);
    expect(() => parseWeeklySchedule(Array.from({ length: 15 }, (_, hour) => `mardi ${hour}h`).join("; "))).toThrow(/14/);
  });
});
