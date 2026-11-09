import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAddonExport } from "../companion/lua-export.mjs";
import { raidSignupsToLua } from "../companion/standings-format.mjs";
import { standingsToLua } from "../companion/standings.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { upcomingRaidsForAddon } from "../src/services/calendar-sync.js";

const raidService = vi.hoisted(() => ({ signup: vi.fn(), cancelSignup: vi.fn() }));
vi.mock("../src/services/raid.js", () => ({ createRaidService: () => raidService }));

import { addonSignupRows, applySignupAnswers, lastSignupChange, planSignupAnswers, type SignupAnswerJob } from "../src/services/signup-answers.js";

const T = (iso: string) => new Date(iso);
const answer = (extra: Partial<Parameters<typeof planSignupAnswers>[0][number]> = {}) => ({
  raidId: "r1", character: "Kev", realm: "Forever", status: "ACCEPTED" as const, role: "HEALER" as const, at: T("2026-11-10T12:00:00Z"), ...extra
});

describe("planSignupAnswers", () => {
  const characters = [
    { id: "c1", name: "Kev", realm: "Forever", memberId: "m1" },
    { id: "c2", name: "Kevtwo", realm: "Forever", memberId: "m1" },
    { id: "c3", name: "Ann", realm: "Forever", memberId: "m2" }
  ];

  it("turns each answer into a job for the member who owns the character", () => {
    expect(planSignupAnswers([answer(), answer({ character: "Ann", status: "TENTATIVE", role: "DPS" })], characters)).toEqual([
      { raidId: "r1", memberId: "m1", status: "ACCEPTED", role: "HEALER", at: "2026-11-10T12:00:00.000Z" },
      { raidId: "r1", memberId: "m2", status: "TENTATIVE", role: "DPS", at: "2026-11-10T12:00:00.000Z" }
    ]);
  });

  it("leaves out characters that are linked to nobody", () => {
    expect(planSignupAnswers([answer({ character: "Stranger" })], characters)).toEqual([]);
  });

  it("keeps the later click when two characters of one member answer the same raid", () => {
    const jobs = planSignupAnswers([answer({ at: T("2026-11-10T12:00:00Z") }), answer({ character: "Kevtwo", status: "DECLINED", at: T("2026-11-10T13:00:00Z") })], characters);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ memberId: "m1", status: "DECLINED" });
  });

  it("does not ask for a role when the answer has none", () => {
    const noRole: Record<string, unknown> = { ...answer() };
    delete noRole["role"];
    expect(planSignupAnswers([noRole as never], characters)[0]).not.toHaveProperty("role");
  });
});

describe("applySignupAnswers: the latest change per member wins", () => {
  let signup: Record<string, unknown> | null;
  let raid: unknown;
  const database = {
    raid: { findFirst: vi.fn(async () => raid) },
    raidSignup: { findUnique: vi.fn(async () => signup) }
  };
  const job = (extra: Partial<SignupAnswerJob> = {}): SignupAnswerJob => ({ raidId: "r1", memberId: "m1", status: "ACCEPTED", role: "HEALER", at: "2026-11-10T12:00:00.000Z", ...extra });
  const run = (...jobs: SignupAnswerJob[]) => applySignupAnswers(database as never, "g1", jobs);

  beforeEach(() => {
    vi.clearAllMocks();
    signup = null;
    raid = { id: "r1" };
    raidService.signup.mockResolvedValue({ status: "SIGNED_UP" });
    raidService.cancelSignup.mockResolvedValue({});
  });

  it("signs a member up who has no signup, with the role they picked, and respects the signup deadline", async () => {
    const summary = await run(job());
    expect(raidService.signup).toHaveBeenCalledWith("r1", "g1", "m1", "HEALER", "AVAILABLE", undefined, true);
    expect(summary).toEqual({ applied: 1, unchanged: 0, failed: 0, changedRaidIds: ["r1"] });
    // Only a raid of this guild that is still planned and real is looked at.
    expect(database.raid.findFirst).toHaveBeenCalledWith({ where: { id: "r1", guildId: "g1", status: "PLANNED", isTest: false }, select: { id: true } });
  });

  it("Tentative becomes a Maybe signup", async () => {
    await run(job({ status: "TENTATIVE" }));
    expect(raidService.signup).toHaveBeenCalledWith("r1", "g1", "m1", "HEALER", "MAYBE", undefined, true);
  });

  it("applies an answer given after the Discord signup last changed", async () => {
    signup = { status: "SIGNED_UP", role: "DPS", signedUpAt: T("2026-11-10T11:00:00Z"), cancelledAt: null };
    const summary = await run(job({ role: "TANK" }));
    expect(raidService.signup).toHaveBeenCalledWith("r1", "g1", "m1", "TANK", "AVAILABLE", undefined, true);
    expect(summary.applied).toBe(1);
  });

  it("skips an answer older than the member's last Discord change", async () => {
    signup = { status: "SIGNED_UP", role: "DPS", signedUpAt: T("2026-11-10T13:00:00Z"), cancelledAt: null };
    const summary = await run(job({ role: "TANK" }));
    expect(raidService.signup).not.toHaveBeenCalled();
    expect(summary).toEqual({ applied: 0, unchanged: 1, failed: 0, changedRaidIds: [] });
  });

  it("does not undo a later cancellation on Discord with an older in-game signup, but a newer one signs up again", async () => {
    signup = { status: "CANCELLED", role: "DPS", signedUpAt: T("2026-11-09T10:00:00Z"), cancelledAt: T("2026-11-10T13:00:00Z") };
    expect((await run(job())).unchanged).toBe(1);
    expect(raidService.signup).not.toHaveBeenCalled();
    expect((await run(job({ at: "2026-11-10T14:00:00.000Z" }))).applied).toBe(1);
    expect(raidService.signup).toHaveBeenCalledTimes(1);
  });

  it("sending the same answer again changes nothing (the signup was written after the click)", async () => {
    signup = { status: "SIGNED_UP", role: "HEALER", signedUpAt: T("2026-11-10T12:00:05Z"), cancelledAt: null };
    expect((await run(job())).unchanged).toBe(1);
    // And an equal state with a newer click is not rewritten either (no churn, no new embed).
    signup = { status: "WAITLISTED", role: "HEALER", signedUpAt: T("2026-11-10T11:00:00Z"), cancelledAt: null };
    expect((await run(job())).unchanged).toBe(1);
    expect(raidService.signup).not.toHaveBeenCalled();
  });

  it("Can't cancels an active signup and does nothing when there is none", async () => {
    signup = { status: "SIGNED_UP", role: "DPS", signedUpAt: T("2026-11-10T11:00:00Z"), cancelledAt: null };
    expect((await run(job({ status: "DECLINED" }))).applied).toBe(1);
    expect(raidService.cancelSignup).toHaveBeenCalledWith("r1", "g1", "m1");
    signup = null;
    expect((await run(job({ status: "DECLINED" }))).unchanged).toBe(1);
    expect(raidService.cancelSignup).toHaveBeenCalledTimes(1);
  });

  it("keeps the signup's role when the answer names none, and falls back to DPS", async () => {
    signup = { status: "MAYBE", role: "TANK", signedUpAt: T("2026-11-10T11:00:00Z"), cancelledAt: null };
    const noRole: Record<string, unknown> = { ...job() };
    delete noRole["role"];
    await run(noRole as unknown as SignupAnswerJob);
    expect(raidService.signup).toHaveBeenLastCalledWith("r1", "g1", "m1", "TANK", "AVAILABLE", undefined, true);
    signup = null;
    await run(noRole as unknown as SignupAnswerJob);
    expect(raidService.signup).toHaveBeenLastCalledWith("r1", "g1", "m1", "DPS", "AVAILABLE", undefined, true);
  });

  it("counts a closed or missing raid and a refused signup as failed, without stopping the others", async () => {
    raid = null;
    expect((await run(job())).failed).toBe(1);
    raid = { id: "r1" };
    raidService.signup.mockRejectedValueOnce(new Error("Signups are closed for this raid.")).mockResolvedValueOnce({ status: "SIGNED_UP" });
    const summary = await run(job(), job({ raidId: "r1", memberId: "m2" }));
    expect(summary).toMatchObject({ applied: 1, failed: 1 });
    expect(await run(job({ at: "not a date" }))).toMatchObject({ failed: 1 });
  });

  it("reads a signup's last change from its cancellation when it was cancelled", () => {
    expect(lastSignupChange({ status: "CANCELLED", signedUpAt: T("2026-11-09T00:00:00Z"), cancelledAt: T("2026-11-10T00:00:00Z") })).toBe(T("2026-11-10T00:00:00Z").getTime());
    expect(lastSignupChange({ status: "SIGNED_UP", signedUpAt: T("2026-11-09T00:00:00Z"), cancelledAt: null })).toBe(T("2026-11-09T00:00:00Z").getTime());
  });
});

describe("Discord signups on their way to the addon", () => {
  it("turns signups into compact rows with the character's name, class, role and status", () => {
    const rows = addonSignupRows([
      { role: "TANK", status: "SIGNED_UP", signedUpAt: T("2026-11-10T10:00:00Z"), character: { name: "Ann", className: "Death Knight" } },
      { role: "HEALER", status: "MAYBE", signedUpAt: T("2026-11-10T10:05:00Z"), characterName: "Bea", member: { characters: [{ name: "Beamain", className: "Priest" }] } },
      { role: "DPS", status: "WAITLISTED", signedUpAt: T("2026-11-10T10:06:00Z"), member: { characters: [{ name: "Cy", className: "Rogue" }] } },
      { role: "DPS", status: "SIGNED_UP", signedUpAt: T("2026-11-10T10:07:00Z") },
      { role: "DPS", status: "CANCELLED", signedUpAt: T("2026-11-10T10:08:00Z"), characterName: "Gone" }
    ]);
    expect(rows).toEqual([
      { name: "Ann", role: "T", class: "DEATHKNIGHT", status: "S", at: Math.floor(T("2026-11-10T10:00:00Z").getTime() / 1000) },
      { name: "Bea", role: "H", class: "PRIEST", status: "M", at: Math.floor(T("2026-11-10T10:05:00Z").getTime() / 1000) },
      { name: "Cy", role: "D", class: "ROGUE", status: "W", at: Math.floor(T("2026-11-10T10:06:00Z").getTime() / 1000) }
    ]);
  });

  it("puts each of the nearest raids' signups in the raid list, and omits the key when nobody signed up", async () => {
    const signups = [{ role: "TANK", status: "SIGNED_UP", signedUpAt: T("2026-11-10T10:00:00Z"), character: { name: "Ann", className: "Warrior" } }];
    const database = { raid: { findMany: async () => [
      { id: "r1", title: "MC", scheduledAt: T("2026-11-12T02:00:00Z"), description: "", core: null, signups },
      { id: "r2", title: "BWL", scheduledAt: T("2026-11-13T02:00:00Z"), description: "", core: null, signups: [] }
    ] } };
    const rows = await upcomingRaidsForAddon(database as never, "g1", T("2026-11-10T00:00:00Z"));
    expect(rows[0]).toMatchObject({ id: "r1", signups: [{ name: "Ann", role: "T", class: "WARRIOR", status: "S" }] });
    expect(rows[1]).not.toHaveProperty("signups");
  });

  it("writes the list into GuildedRaids for the addon, safely quoted, and nothing when empty", () => {
    const base = { updatedAt: "2026-11-10T00:00:00Z", baseGp: 0, standings: [], nextRaid: null };
    const signups = [{ name: 'An"n', role: "T", class: "DEATHKNIGHT", status: "S", at: 1790000000 }, { name: "Bea", role: "H", class: "PRIEST", status: "M", at: 1790000100 }];
    const lua = standingsToLua({ ...base, raids: [{ id: "r1", title: "MC", at: "2026-11-12T02:00:00.000Z", core: null, note: "", signups }] });
    expect(lua).toContain('note = "", signups = { { "An\\"n", "T", "DEATHKNIGHT", "S", 1790000000 }, { "Bea", "H", "PRIEST", "M", 1790000100 } } },');
    expect(standingsToLua({ ...base, raids: [{ id: "r2", title: "MC", at: "2026-11-12T02:00:00.000Z", core: null, note: "" }] })).not.toContain("signups");
    // Bad values are replaced, not written through.
    expect(raidSignupsToLua([{ name: "X", role: "Z", class: "bad;class", status: "?", at: "soon" }])).toBe(', signups = { { "X", "D", "", "S", 0 } }');
    expect(raidSignupsToLua([{ role: "T" }, null])).toBe("");
  });
});

describe("the in-game answers the companion uploads", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  const LUA = `
GuildedDB = {
  ["guildKey"] = "Quebec Gold-Forever",
  ["signupAnswers"] = {
    ["r1"] = { ["status"] = "ACCEPTED", ["role"] = "HEALER", ["at"] = 1790000000, ["name"] = "Kev" },
    ["r2"] = { ["status"] = "DECLINED", ["at"] = 1790000100, ["name"] = "Kev" },
    ["bad id!"] = { ["status"] = "ACCEPTED", ["at"] = 1790000000, ["name"] = "Kev" },
    ["r3"] = { ["status"] = "SOON", ["at"] = 1790000000, ["name"] = "Kev" },
    ["r4"] = { ["status"] = "ACCEPTED", ["role"] = "WIZARD", ["at"] = 1790000000, ["name"] = "Kev" },
  },
  ["exports"] = { ["2026-10-01T19:00:00Z"] = true },
}
`;

  it("sends each valid answer with its time, and the bot's schema accepts it", async () => {
    dir = await mkdtemp(join(tmpdir(), "qg-signup-"));
    const file = join(dir, "Guilded.lua");
    await writeFile(file, LUA, "utf8");
    const snapshot = parseAddonSnapshot(await readAddonExport(file, "Forever"));
    const byRaid = Object.fromEntries(snapshot.signupAnswers.map((row) => [row.raidId, row]));
    expect(Object.keys(byRaid).sort()).toEqual(["r1", "r2", "r4"]);
    expect(byRaid["r1"]).toMatchObject({ character: "Kev", realm: "Forever", status: "ACCEPTED", role: "HEALER" });
    expect(byRaid["r1"]!.at.getTime()).toBe(1790000000 * 1000);
    expect(byRaid["r2"]).toMatchObject({ status: "DECLINED" });
    // A role the bot does not know is dropped by the schema's row check, never sent as something else.
    expect(byRaid["r4"]?.role).toBeUndefined();
  });

  it("sends nothing when the player never answered", async () => {
    dir = await mkdtemp(join(tmpdir(), "qg-signup-"));
    const file = join(dir, "Guilded.lua");
    await writeFile(file, `GuildedDB = { ["exports"] = {} }`, "utf8");
    expect((await readAddonExport(file, "Forever")).signupAnswers).toBeUndefined();
  });

  it("leaves one malformed answer out of a snapshot instead of rejecting the upload", () => {
    const snapshot = parseAddonSnapshot({ source: "t", exportedAt: "2026-11-10T00:00:00Z", signupAnswers: [
      { raidId: "r1", character: "Kev", realm: "Forever", status: "ACCEPTED", at: "2026-11-10T12:00:00Z" },
      { raidId: "no good", character: "Kev", realm: "Forever", status: "ACCEPTED", at: "2026-11-10T12:00:00Z" }
    ] });
    expect(snapshot.signupAnswers).toHaveLength(1);
    expect(snapshot.rejected).toEqual([expect.objectContaining({ section: "signupAnswers" })]);
  });
});
