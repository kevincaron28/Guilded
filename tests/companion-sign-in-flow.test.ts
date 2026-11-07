import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatSeconds, isUnreachable, retryDelaySeconds, secondsLeft, signInOutcome, timeLeftLine, SERVER_RESTARTING } from "../companion/sign-in-flow.mjs";
import { wowSearchMessage } from "../companion/wow-search.mjs";

// 8.5 fresh-PC sign-in test (French UI, WoW on D:\Jeux): the friction fixes that are plain logic.
const fr = createRequire(import.meta.url)("../companion-app/locales/fr.json") as Record<string, string>;
const detect = createRequire(import.meta.url)("../companion-app/detect-wow.cjs");
const now = Date.parse("2026-11-06T18:00:00Z");

describe("sign-in waiting box", () => {
  it("counts down to the request's expiry", () => {
    const expiresAt = new Date(now + 20 * 60_000).toISOString();
    expect(secondsLeft(expiresAt, now)).toBe(1200);
    expect(timeLeftLine(expiresAt, now)).toEqual(["Time left: {0}. If it runs out, the companion opens a new page by itself.", "20:00"]);
    expect(timeLeftLine(new Date(now + 65_500).toISOString(), now)?.[1]).toBe("1:06");
    expect(timeLeftLine(new Date(now - 1).toISOString(), now)).toEqual(["Time is up. The companion is opening a new sign-in page."]);
    expect(timeLeftLine(undefined, now)).toBeNull();
    expect(formatSeconds(845)).toBe("14:05");
  });

  it("always has something to say when a sign-in ends", () => {
    expect(signInOutcome({ ok: true, message: "Discord account paired." })).toEqual({ ok: true, message: "Discord account paired." });
    expect(signInOutcome({ ok: true })).toEqual({ ok: true, message: "Discord account connected." });
    for (const silent of [undefined, null, {}, { ok: false }, { ok: false, message: "  " }]) {
      expect(signInOutcome(silent)).toEqual({ ok: false, message: "The sign-in did not finish. Press Sign in with Discord to try again." });
    }
  });

  it("reads a bot restart as an outage and retries soon, then less often", () => {
    expect(isUnreachable("Could not reach the bot. Is it running, and is the bot address right?")).toBe(true);
    expect(isUnreachable("The bot answered (530).")).toBe(true);
    expect(isUnreachable("Pair this companion with /character pair.")).toBe(false);
    expect([0, 1, 2, 9].map(retryDelaySeconds)).toEqual([15, 30, 60, 60]);
  });

  it("has French for every new sign-in text", () => {
    for (const key of [SERVER_RESTARTING, timeLeftLine(new Date(now + 1000).toISOString(), now)![0], timeLeftLine(new Date(now).toISOString(), now)![0],
      signInOutcome(null).message, "Finish in your browser (it may be behind this window)", "Reopen the page", "Link to my guild",
      "That sign-in expired. Choose Sign in with Discord again."]) expect(fr[key], key).toBeTypeOf("string");
  });
});

describe("WoW folder search", () => {
  const folders: string[] = [];
  afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
  const drive = () => { const root = mkdtempSync(join(tmpdir(), "guilded-drive-")); folders.push(root); return root; };
  const account = (install: string, name = "ACCOUNT1") => { const folder = join(install, "_forever_", "WTF", "Account", name); mkdirSync(folder, { recursive: true }); return folder; };

  it("finds WoW in any folder of any drive (D:\\Jeux\\World of Warcraft), not only the usual places", () => {
    const c = drive(), d = drive();
    const install = join(d, "Jeux", "World of Warcraft");
    account(install);
    const options = { drives: [c, d], home: join(c, "nobody"), recorded: [] };
    expect(detect.wowInstalls(options)).toEqual([install]);
    const entries = detect.detectSavedVariables(["Guilded.lua"], () => false, options);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ exists: false, game: "_forever_", account: "ACCOUNT1" });
    expect(entries[0].path).toBe(join(install, "_forever_", "WTF", "Account", "ACCOUNT1", "SavedVariables", "Guilded.lua"));
  });

  it("looks one level deeper under a games or Blizzard folder, and counts the game folder once", () => {
    const d = drive();
    const install = join(d, "Games", "Blizzard", "World of Warcraft");
    account(install);
    expect(detect.wowInstalls({ drives: [d], home: join(d, "nobody"), recorded: [] })).toEqual([install]);
  });

  it("uses the install paths Battle.net records", () => {
    const d = drive();
    const install = join(d, "Somewhere", "Deep", "Inside", "World of Warcraft");
    account(install);
    // product.db holds the paths as plain text between protobuf bytes.
    const text = "\u0012\u0000D:\\Jeux\\World of Warcraft\u0012\u0004wow_frFR\u0000E:/Games/World of Warcraft\u0000";
    expect(detect.battleNetInstallPaths(text).map((item: string) => item.replaceAll("\\", "/"))).toEqual(["D:/Jeux/World of Warcraft", "E:/Games/World of Warcraft"]);
    // A recorded path that exists is used even where no drive scan would reach it; a missing one is not.
    expect(detect.wowInstalls({ drives: [], home: join(d, "nobody"), recorded: [install, join(d, "Missing", "World of Warcraft")] })).toEqual([install]);
  });

  it("reports installs that have no account folder yet", () => {
    const d = drive();
    const install = join(d, "World of Warcraft");
    mkdirSync(join(install, "_forever_"), { recursive: true });
    const result = detect.searchWow(["Guilded.lua"], () => false, { drives: [d], home: join(d, "nobody"), recorded: [] });
    expect(result.entries).toEqual([]);
    expect(result.installs).toEqual([install]);
  });

  it("starts Browse at the WoW folder, never Windows' own choice", () => {
    const d = drive();
    const install = join(d, "World of Warcraft");
    mkdirSync(install, { recursive: true });
    expect(detect.pickerStart(undefined, [], [install])).toBe(install);
  });
});

describe("Find it always says what happened", () => {
  it("names what it found, or the drives it searched", () => {
    expect(wowSearchMessage({ entries: [{ path: "D:\\WoW\\Guilded.lua", exists: true }] })).toEqual({ ok: true, path: "D:\\WoW\\Guilded.lua", text: ["Found your addon data."] });
    expect(wowSearchMessage({ entries: [{ path: "a", exists: false }] }).text[0]).toMatch(/Account found/);
    expect(wowSearchMessage({ entries: [{ path: "a", exists: true }, { path: "b", exists: true }] }).text).toEqual(["Found {0} accounts. Check the selected file before saving.", 2]);
    expect(wowSearchMessage({ entries: [], installs: ["D:\\Jeux\\World of Warcraft"], drives: ["C:", "D:"] }).text).toEqual(["Found World of Warcraft in {0}, but no account folder yet. Start WoW, log in once, then press Find it again.", "D:\\Jeux\\World of Warcraft"]);
    expect(wowSearchMessage({ entries: [], installs: [], drives: ["C:", "D:"] }).text).toEqual(["No World of Warcraft folder found on {0}. Choose WoW folder and pick it yourself.", "C:, D:"]);
    expect(wowSearchMessage({ otherEdition: 1 }).text[0]).toMatch(/WoW Forever only/);
    for (const result of [{ entries: [{ path: "a", exists: true }] }, { entries: [{ path: "a", exists: false }] }, { entries: [{ path: "a", exists: false }] }, { installs: ["x"] }, {}, { otherEdition: 1 }]) {
      expect(fr[wowSearchMessage(result).text[0] as string], String(wowSearchMessage(result).text[0])).toBeTypeOf("string");
    }
    expect(fr[wowSearchMessage({ entries: [{ path: "a", exists: false }] }, { personal: true }).text[0] as string]).toBeTypeOf("string");
  });
});
