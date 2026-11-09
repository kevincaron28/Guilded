import { describe, expect, it } from "vitest";
import { addonDownloadMirror, addonDownloadUrl, companionProblems, newerVersion, problemReference, problemReport, reportableProblems, wowRunningFrom, NOT_SAVED_WITH_OTHERS_MS } from "../companion/problems.mjs";

// Problems panel (8.5, track F1): one test per check that makes it fire, plus the quiet cases.
const watchFile = "C:\\Games\\World of Warcraft\\_forever_\\WTF\\Account\\PRIVATEACCOUNT\\SavedVariables\\Guilded.lua";
const linked = { companionCredential: "connected", watchFile, wowEnabled: true };
const fine = { changedAt: new Date().toISOString(), stale: false, candidate: null, othersChangedAt: null, addon: { status: "ok", expected: "forever", installed: ["forever"], version: "8.4.6" } };
const ids = (input: Parameters<typeof companionProblems>[0]) => companionProblems(input).map((problem) => problem.id);

describe("companion problem checks", () => {
  it("reports nothing when everything is fine", () => {
    expect(companionProblems({ config: linked, state: { running: true, addonVersion: "8.4.6" }, savedFile: fine, version: "8.4.6", wowRunning: true })).toEqual([]);
  });

  it("addon not installed in the watched game folder", () => {
    const problems = companionProblems({ config: linked, savedFile: { ...fine, changedAt: null, addon: { status: "not-installed", expected: "forever" } } });
    expect(problems).toEqual([{ id: "addon-missing", data: { expected: "forever" } }]);
  });

  it("fresh PC: empty AddOns folder found before any saved file is chosen (8.4.7 second-PC test)", () => {
    const notChosen = { companionCredential: "connected", wowEnabled: true };
    const problems = companionProblems({ config: notChosen, savedFile: { addon: { status: "not-installed", expected: "forever" } } as never });
    expect(problems).toEqual([{ id: "addon-missing", data: { expected: "forever" } }]);
    expect(ids({ config: { wowEnabled: true }, savedFile: { addon: { status: "not-installed", expected: "forever" } } as never })).toEqual(["addon-missing"]);
    expect(ids({ config: { ...notChosen, wowEnabled: false }, savedFile: { addon: { status: "not-installed", expected: "forever" } } as never })).toEqual([]);
  });

  it("addon older than the companion: offer Update addon", () => {
    const older = { ...fine, addon: { ...fine.addon, version: "8.4.6" } };
    // (9.1.3) The companion updates the addon by itself (right away, or when WoW closes): a problem only when that is off or failed.
    expect(ids({ config: linked, savedFile: older, version: "8.5.0" })).toEqual([]);
    expect(companionProblems({ config: linked, savedFile: older, version: "8.5.0", autoUpdate: false })).toEqual([{ id: "addon-outdated", data: { installed: "8.4.6", current: "8.5.0" } }]);
    expect(ids({ config: linked, savedFile: older, version: "8.5.0", addonUpdateFailed: true })).toEqual(["addon-outdated"]);
    expect(ids({ config: linked, savedFile: older, version: "8.4.6" })).toEqual([]);
    expect(ids({ config: linked, savedFile: { ...older, addon: { ...older.addon, expected: "retail", installed: ["retail"] } }, version: "8.5.0" })).toEqual([]);
  });

  it("Get the addon opens this release's Forever zip", () => {
    // The website's copy first (8 November 2026); the GitHub one when the website does not have it.
    expect(addonDownloadUrl("forever", "8.4.7")).toBe("https://guilded.kcaron.top/downloads/Guilded-v8.4.7-forever.zip");
    expect(addonDownloadUrl("forever", "8.5.0-beta.1")).toBe("https://guilded.kcaron.top/downloads/Guilded-v8.5.0-forever.zip");
    expect(addonDownloadMirror("forever", "8.4.7")).toBe("https://github.com/kevincaron28/Guilded/releases/download/v8.4.7/Guilded-v8.4.7-forever.zip");
    expect(addonDownloadMirror("retail", "8.4.7")).toBe("https://www.curseforge.com/wow/addons/guilded");
    expect(addonDownloadUrl("retail", "8.4.7")).toBe("https://www.curseforge.com/wow/addons/guilded");
    expect(addonDownloadUrl("forever", "dev")).toBe("https://www.curseforge.com/wow/addons/guilded");
    expect(addonDownloadUrl(null, null)).toBe("https://www.curseforge.com/wow/addons/guilded");
  });

  it("addon for the wrong edition, without also blaming the saved file", () => {
    const problems = companionProblems({ config: linked, savedFile: { ...fine, changedAt: null, addon: { status: "wrong-edition", expected: "forever", installed: ["classic-tbc"] } } });
    expect(problems).toEqual([{ id: "addon-wrong-edition", data: { expected: "forever", installed: "classic-tbc" } }]);
  });

  it("saved file missing: never saved, or not chosen at all", () => {
    expect(companionProblems({ config: linked, savedFile: { ...fine, changedAt: null } })).toEqual([{ id: "saved-file-missing", data: { chosen: true, othersSaved: false } }]);
    expect(companionProblems({ config: linked, savedFile: { ...fine, changedAt: null, othersChangedAt: new Date().toISOString() } })[0]?.data).toMatchObject({ othersSaved: true });
    expect(ids({ config: linked, state: { uploadError: "Guilded hasn't saved yet: in WoW, make sure the Guilded addon is enabled, then type /reload or log out once." } })).toEqual(["saved-file-missing"]);
    expect(companionProblems({ config: { companionCredential: "connected", wowEnabled: true } })).toEqual([{ id: "saved-file-missing", data: { chosen: false } }]);
    // Not linked, leaderboards-only before a file, or WoW sync off: nothing to nag about.
    expect(ids({ config: { wowEnabled: true } })).toEqual([]);
    expect(ids({ config: { ...linked, wowEnabled: false }, savedFile: { ...fine, changedAt: null } })).toEqual([]);
  });

  it("saved file not updated after /reload: other addons saved later, or the game moved folders", () => {
    const changed = Date.parse("2026-11-01T20:00:00Z");
    const later = { ...fine, changedAt: new Date(changed).toISOString(), othersChangedAt: new Date(changed + NOT_SAVED_WITH_OTHERS_MS + 1000).toISOString() };
    expect(companionProblems({ config: linked, savedFile: later })).toEqual([{ id: "saved-file-not-updated", data: { moved: false, days: 0 } }]);
    // Saved in the same /reload (seconds apart): fine.
    expect(ids({ config: linked, savedFile: { ...later, othersChangedAt: new Date(changed + 3000).toISOString() } })).toEqual([]);
    expect(companionProblems({ config: linked, savedFile: { ...fine, stale: true, candidate: { path: "x", reason: "stale" } } })[0]).toMatchObject({ id: "saved-file-not-updated", data: { moved: true } });
  });

  it("WoW running during an addon update: newer Guilded on disk than the one that last saved", () => {
    const savedFile = { ...fine, addon: { ...fine.addon, version: "8.5.0" } };
    expect(companionProblems({ config: linked, state: { addonVersion: "8.4.6" }, savedFile, wowRunning: true })).toEqual([{ id: "wow-running-update", data: { installed: "8.5.0", running: "8.4.6" } }]);
    expect(ids({ config: linked, state: { addonVersion: "8.4.6" }, savedFile, wowRunning: false })).toEqual([]);
    expect(ids({ config: linked, state: { addonVersion: "8.5.0" }, savedFile, wowRunning: true })).toEqual([]);
  });

  it("sign-in expired or revoked (401), from uploads, standings or a background connection", () => {
    expect(ids({ config: linked, savedFile: fine, state: { uploadError: "Upload failed (401): Unknown companion credential" } })).toEqual(["sign-in-expired"]);
    expect(ids({ config: linked, savedFile: fine, state: { standingsError: "Standings request failed (401): Unknown companion credential" } })).toEqual(["sign-in-expired"]);
    expect(ids({ config: linked, savedFile: fine, state: { profiles: [{ error: "The website refused this companion. Choose Sign in with Discord again in Connection & setup." }] } })).toEqual(["sign-in-expired"]);
    // Paused connection or never linked: not a sign-in problem.
    expect(ids({ config: { ...linked, syncEnabled: false }, savedFile: fine, state: { uploadError: "Upload failed (401): x" } })).not.toContain("sign-in-expired");
  });

  it("upload rejected, with the bot's reason kept for the screen", () => {
    expect(companionProblems({ config: linked, savedFile: fine, state: { uploadError: "Upload failed (403): You are not a member of this guild." } }))
      .toEqual([{ id: "upload-rejected", data: { status: 403, reason: "You are not a member of this guild." } }]);
    expect(companionProblems({ config: linked, savedFile: fine, state: { uploadError: "This upload is 1200 KB; the bot accepts at most 1000 KB." } })[0]).toMatchObject({ id: "upload-rejected", data: { status: 413 } });
    expect(companionProblems({ config: linked, savedFile: fine, state: { syncPhase: "apply-error" } })[0]).toMatchObject({ id: "upload-rejected", data: { applyError: true } });
    // Rate limits and server errors retry by themselves: not a rejection.
    expect(ids({ config: linked, savedFile: fine, state: { uploadError: "Upload failed (429): slow down" } })).toEqual([]);
  });

  it("companion outdated: only when the member has to act", () => {
    const update = { version: "8.5.0", installer: { name: "x.exe" } };
    expect(ids({ config: linked, savedFile: fine, update, version: "8.4.6", autoUpdate: true })).toEqual([]);
    expect(companionProblems({ config: linked, savedFile: fine, update, version: "8.4.6", autoUpdate: false })).toEqual([{ id: "companion-outdated", data: { latest: "8.5.0", current: "8.4.6", store: false } }]);
    expect(ids({ config: linked, savedFile: fine, update: { version: "8.5.0" }, version: "8.4.6" })).toEqual(["companion-outdated"]);
    expect(ids({ config: linked, savedFile: fine, update, version: "8.4.6", autoUpdate: true, updateAttempts: 2 })).toEqual(["companion-outdated"]);
    // Store build: the bot is a whole minor version ahead and the Store has not updated yet.
    expect(companionProblems({ config: linked, savedFile: fine, state: { botVersion: "8.5.1" }, version: "8.4.6", store: true })[0]).toMatchObject({ id: "companion-outdated", data: { store: true } });
    expect(ids({ config: linked, savedFile: fine, state: { botVersion: "8.4.9" }, version: "8.4.6", store: true })).toEqual([]);
  });

  it("no internet or bot unreachable, which hides the upload refusal it causes", () => {
    expect(companionProblems({ config: linked, savedFile: fine, online: false })).toEqual([{ id: "bot-unreachable", data: { offline: true } }]);
    expect(ids({ config: linked, savedFile: fine, state: { uploadError: "Could not reach the bot. Is it running, and is the bot address right?" } })).toEqual(["bot-unreachable"]);
    expect(ids({ config: linked, savedFile: fine, state: { standingsError: "Standings request failed (530): The guild bot is temporarily unavailable." } })).toEqual(["bot-unreachable"]);
  });

  it("orders causes before symptoms", () => {
    const list = ids({ config: linked, online: false, savedFile: { ...fine, changedAt: null, addon: { status: "not-installed", expected: "forever" } }, update: { version: "9.0.0" }, version: "8.4.6" });
    expect(list).toEqual(["bot-unreachable", "addon-missing", "companion-outdated"]);
  });
});

describe("WoW process check", () => {
  it("finds a game client in tasklist output, not the voice proxy", () => {
    expect(wowRunningFrom('"WowClassic.exe","12345","Console","1","1,234,567 K"\r\n')).toBe(true);
    expect(wowRunningFrom('"Wow.exe","1","Console","1","1 K"')).toBe(true);
    expect(wowRunningFrom('"WowVoiceProxy.exe","2","Console","1","1 K"')).toBe(false);
    expect(wowRunningFrom("INFO: No tasks are running which match the specified criteria.")).toBe(false);
    expect(wowRunningFrom("")).toBe(false);
  });
  it("compares versions numerically", () => {
    expect(newerVersion("8.10.0", "8.9.9")).toBe(true);
    expect(newerVersion("8.4.6", "8.4.6")).toBe(false);
    expect(newerVersion("8.4.6", null)).toBe(false);
  });
});

describe("Copy report for the developer", () => {
  const state = { running: true, syncPhase: "needs-attention", uploadError: "Upload failed (403): Secret reason about PrivateCharacter", addonVersion: "8.4.6", botVersion: "8.4.0",
    syncEvidence: { character: "PrivateCharacter", savedAt: "2026-11-06T10:00:00Z" } };
  const config = { ...linked, companionCredential: "very-secret-credential", gameEdition: "forever", wowGuild: "Private Guild" };

  it("holds a short reference, the problem ids and only allowlisted values", () => {
    const problems = companionProblems({ config, state, savedFile: { ...fine, addon: { status: "wrong-edition", expected: "forever", installed: ["classic-tbc"] } } });
    const report = problemReport({ problems, config, state, evidence: state.syncEvidence, companionVersion: "8.4.6", reference: "C-ABCD2345", now: new Date("2026-11-06T12:00:00Z") });
    expect(report.reference).toBe("C-ABCD2345");
    expect(report.text).toContain("Guilded Companion report C-ABCD2345");
    expect(report.summary.problems).toEqual([{ id: "addon-wrong-edition", expected: "forever", installed: "classic-tbc" }, { id: "upload-rejected", status: 403 }]);
    expect(report.summary.sync).toMatchObject({ schemaVersion: 1, edition: "forever", companionVersion: "8.4.6", addonVersion: "8.4.6" });
    for (const secret of ["PRIVATEACCOUNT", "PrivateCharacter", "Secret reason", "very-secret", "Private Guild", "SavedVariables", "Games"]) expect(report.text).not.toContain(secret);
  });

  it("drops unknown ids and values of the wrong kind", () => {
    expect(reportableProblems([{ id: "made-up", data: {} }, { id: "upload-rejected", data: { status: "403; token=x", reason: "x" } }, { id: "wow-running-update", data: { installed: "8.5.0 evil", running: "8.4.6" } }]))
      .toEqual([{ id: "upload-rejected" }, { id: "wow-running-update", running: "8.4.6" }]);
  });

  it("makes eight-character references without look-alike characters", () => {
    let seed = 0;
    const reference = problemReference(() => (seed = (seed + 0.37) % 1));
    expect(reference).toMatch(/^C-[A-HJ-NP-Z2-9]{8}$/);
    expect(problemReference()).not.toBe(problemReference());
  });
});
