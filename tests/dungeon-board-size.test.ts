import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeStandings } from "../companion/standings.mjs";
import { feedDungeonBoard } from "../src/services/dungeon-board-feed.js";
import { dungeonBoardToLua, ownProfileMatcher } from "../companion/standings-format.mjs";
import { dungeonBoardToLua as dungeonBoardToLua946 } from "./fixtures/standings-format-9.4.6.mjs";
import { newLuaSession, type LuaSession } from "./lua/harness.js";
import { LUA_DUMP, sizedBoard } from "./helpers/dungeon-board-size.js";

// 21 Nov 2026, "shrink the board": the standings feed's dungeon board and the Standings.lua the companion writes from it.
type Board = NonNullable<Awaited<ReturnType<typeof sizedBoard>>>;
const AT = "2026-11-20T12:00:00Z";
let board: Board, fed: Board, lua: LuaSession;
const load = (lines: string[]) => lua.run(`GuildedDungeonBoard = nil\n${lines.join("\n")}\nreturn DUMP(GuildedDungeonBoard)`);
beforeAll(async () => {
  board = await sizedBoard();
  fed = feedDungeonBoard(board)!;
  lua = newLuaSession();
  lua.run(LUA_DUMP);
}, 120_000);
afterAll(() => lua?.close());

describe("the feed's dungeon board", () => {
  it("drops only fields no companion or addon reads, so a 9.4.x companion writes the very same Standings.lua", () => {
    expect(dungeonBoardToLua946(fed, AT).join("\n")).toBe(dungeonBoardToLua946(board, AT).join("\n"));
    const json = JSON.stringify(fed);
    for (const key of ["bestPoints", "routePoints", "bossesKilled"]) expect(json).not.toContain(`"${key}"`);
    expect(JSON.stringify(board)).toContain("\"bestPoints\"");
    expect(board.profiles[0]!.details[0]).toHaveProperty("ratingVersion");
    for (const profile of fed.profiles) for (const detail of [...profile.details, ...(profile.roles ?? []).flatMap(r => r.details)]) expect(detail).not.toHaveProperty("ratingVersion");
    // Everything else is as it was: put the dropped fields back and it is the board again.
    const route = (fed.profiles[0]!.guidance as { routes: Record<string, unknown>[] }).routes[0]!;
    expect(Object.keys(route)).toEqual(expect.arrayContaining(["key", "name", "targetSec", "fit", "penaltyPercent", "next"]));
    expect(fed.rows).toEqual(board.rows);
    expect(fed.catalog).toEqual(board.catalog);
    expect(JSON.stringify(fed).length).toBeLessThan(JSON.stringify(board).length * 0.9);
  });
});

describe("Standings.lua's dungeon board", () => {
  it("without knowing this PC's characters: the same tables as 9.4.6 wrote, in fewer bytes (no nil fields)", () => {
    const before = dungeonBoardToLua946(board, AT), after = dungeonBoardToLua(fed, AT);
    expect(load(after)).toBe(load(before));
    expect(after.join("\n").length).toBeLessThan(before.join("\n").length);
  });

  it("this PC's own characters keep their complete profile; a guildmate's keeps what the addon reads of it", () => {
    const mine = board.profiles[3]!.name;
    const own = ownProfileMatcher([mine])!;
    const before = dungeonBoardToLua946(board, AT), member = dungeonBoardToLua(fed, AT, "GuildedDungeonBoard", { own, officer: false });
    lua.run(`OLD = (function() ${before.join("\n")} return GuildedDungeonBoard end)()`);
    lua.run(`NEW = (function() ${member.join("\n")} return GuildedDungeonBoard end)()`);
    const count = Number(lua.run("return #OLD.profiles"));
    expect(Number(lua.run("return #NEW.profiles"))).toBe(count);
    let full = 0;
    for (let i = 1; i <= count; i++) {
      const name = lua.run(`return NEW.profiles[${i}].name`);
      if (own({ name })) {
        full++;
        expect(lua.run(`return DUMP(NEW.profiles[${i}])`)).toBe(lua.run(`return DUMP(OLD.profiles[${i}])`));
        continue;
      }
      // The projection of the old profile on what any addon reads of a guildmate.
      const project = (v: string) => lua.run(`local p = ${v}.profiles[${i}]; local out = { name = p.name, points = p.points, bracket = p.bracket, characters = p.characters, details = {}, roles = {} }
        for j, d in ipairs(p.details) do out.details[j] = { dungeonKey = d.dungeonKey, name = d.name, points = d.points, speedBonus = d.speedBonus, durationSec = d.durationSec } end
        for j, r in ipairs(p.roles or {}) do out.roles[j] = { role = r.role, points = r.points } end
        return DUMP(out)`);
      expect(project("NEW")).toBe(project("OLD"));
      expect(lua.run(`return tostring(NEW.profiles[${i}].brief) .. tostring(NEW.profiles[${i}].guidance)`)).toBe("truenil");
    }
    expect(full).toBeGreaterThanOrEqual(1);
    expect(full).toBeLessThan(count / 4);
    // The season's other fields (catalog, rows, brackets, the week) are the same tables.
    expect(lua.run("OLD.profiles, NEW.profiles = nil, nil; return DUMP(NEW)")).toBe(lua.run("return DUMP(OLD)"));
    expect(member.join("\n").length).toBeLessThan(before.join("\n").length * 0.2);
  });

  it("an officer's file keeps every guildmate's runs complete, for the officer relay", () => {
    const own = ownProfileMatcher([board.profiles[0]!.name])!;
    const officer = dungeonBoardToLua(fed, AT, "GuildedDungeonBoard", { own, officer: true });
    lua.run(`OLD = (function() ${dungeonBoardToLua946(board, AT).join("\n")} return GuildedDungeonBoard end)()`);
    lua.run(`NEW = (function() ${officer.join("\n")} return GuildedDungeonBoard end)()`);
    for (let i = 1; i <= board.profiles.length; i++) {
      expect(lua.run(`return DUMP(NEW.profiles[${i}].details)`)).toBe(lua.run(`return DUMP(OLD.profiles[${i}].details)`));
      expect(lua.run(`return tostring(NEW.profiles[${i}].brief)`)).toBe("nil");
    }
  });

  it("the companion knows this PC's characters from every account folder of the install and the member's linked ones", async () => {
    const root = mkdtempSync(join(tmpdir(), "qg-board-size-"));
    try {
      const account = (name: string, characters: string[]) => {
        const saved = join(root, "WTF", "Account", name, "SavedVariables");
        mkdirSync(saved, { recursive: true });
        writeFileSync(join(saved, "Guilded.lua"), `GuildedDB = { version = 3, character = { name = ${JSON.stringify(characters[0])}, realm = "", gameEdition = "forever" },
          myCharacters = { ${characters.map(c => `[${JSON.stringify(c)}] = { name = ${JSON.stringify(c)} }`).join(", ")} } }`);
        return join(saved, "Guilded.lua");
      };
      const watchFile = account("ACC", ["Meo Un"]);
      account("ACC2", ["Second Alt"]);
      mkdirSync(join(root, "Interface", "AddOns", "Guilded"), { recursive: true });
      const template = fed.profiles[0]!;
      const profile = (name: string) => ({ ...template, name, characters: [] });
      const dungeonBoard = { ...fed, profiles: ["Meo Un", "Second Alt", "Linked Main", "Guild Mate"].map(profile) };
      const answer = (extra: Record<string, unknown>) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(),
        json: async () => ({ protocolVersion: 2, updatedAt: AT, baseGp: 0, standings: [], gameEdition: "forever", accounts: { "Meo Un": "m1", "Linked Main": "m1", "Guild Mate": "m2" }, dungeonBoard, ...extra }) }));
      const config = { watchFile, uploadUrl: "https://bot.example", guildDiscordId: "1", companionCredential: "c".repeat(43), dataAddon: false };
      const shapes = (text: string) => {
        lua.run(`GuildedDungeonBoard = nil\n${text.replace(/^GuildedLinked[\s\S]*$/m, "")}`);
        return lua.run(`local t = {} for _, p in ipairs(GuildedDungeonBoard.profiles) do t[#t+1] = p.name .. ":" .. (p.brief and "brief" or p.guidance and "full" or "runs") end return table.concat(t, ",")`);
      };
      answer({});
      expect(shapes((await writeStandings(config)).text!)).toBe("Meo Un:full,Second Alt:full,Linked Main:full,Guild Mate:brief");
      answer({ officerInvites: [] });
      expect(shapes((await writeStandings(config)).text!)).toBe("Meo Un:full,Second Alt:full,Linked Main:full,Guild Mate:runs");
      // A first account folder beside them, not played yet: the other folders still say who this PC is.
      answer({});
      const fresh = join(root, "WTF", "Account", "NEW", "SavedVariables", "Guilded.lua");
      expect(shapes((await writeStandings({ ...config, watchFile: fresh })).text!)).toBe("Meo Un:full,Second Alt:full,Linked Main:brief,Guild Mate:brief");
      // Nothing known about this PC (a new install, no saved file yet): every profile complete, as 9.4.6 wrote it.
      rmSync(join(root, "WTF"), { recursive: true, force: true });
      answer({});
      expect(shapes((await writeStandings({ ...config, watchFile: fresh })).text!)).toBe("Meo Un:full,Second Alt:full,Linked Main:full,Guild Mate:full");
    } finally {
      vi.unstubAllGlobals();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes the file again when this PC's characters change, even when the bot's answer did not", async () => {
    const root = mkdtempSync(join(tmpdir(), "qg-board-names-"));
    try {
      const saved = join(root, "WTF", "Account", "ACC", "SavedVariables");
      mkdirSync(saved, { recursive: true });
      mkdirSync(join(root, "Interface", "AddOns", "Guilded"), { recursive: true });
      const watchFile = join(saved, "Guilded.lua");
      const play = (characters: string[]) => writeFileSync(watchFile, `GuildedDB = { version = 3, character = { name = ${JSON.stringify(characters[0])}, realm = "", gameEdition = "forever" },
        myCharacters = { ${characters.map(c => `[${JSON.stringify(c)}] = { name = ${JSON.stringify(c)} }`).join(", ")} } }`);
      const template = fed.profiles[0]!;
      const dungeonBoard = { ...fed, profiles: ["Meo Un", "New Alt", "Guild Mate"].map(name => ({ ...template, name, characters: [] })) };
      const sent: (string | null)[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { headers: Record<string, string> }) => {
        const since = init.headers["if-none-match"] ?? null;
        sent.push(since);
        return since === "e1" ? { ok: false, status: 304, headers: new Headers({ etag: "e1" }), json: async () => ({}) }
          : { ok: true, status: 200, headers: new Headers({ etag: "e1" }), json: async () => ({ protocolVersion: 2, updatedAt: AT, baseGp: 0, standings: [], gameEdition: "forever", accounts: {}, dungeonBoard }) };
      }));
      const config = { watchFile, uploadUrl: "https://bot.example", guildDiscordId: "1", companionCredential: "c".repeat(43), dataAddon: false };
      const shapes = (text: string) => {
        lua.run(`GuildedDungeonBoard = nil\n${text.replace(/^GuildedLinked[\s\S]*$/m, "")}`);
        return lua.run(`local t = {} for _, p in ipairs(GuildedDungeonBoard.profiles) do t[#t+1] = p.name .. ":" .. (p.brief and "brief" or "full") end return table.concat(t, ",")`);
      };
      play(["Meo Un"]);
      const first = await writeStandings(config);
      expect(shapes(first.text!)).toBe("Meo Un:full,New Alt:brief,Guild Mate:brief");
      // Same characters: the ETag goes, the bot says "not modified", nothing is written.
      const same = await writeStandings(config, undefined, { etag: "e1", namesKey: first.namesKey });
      expect(same.notModified).toBe(true);
      expect(sent.at(-1)).toBe("e1");
      // A character played here for the first time: the ETag is left out, the answer comes back whole and the file holds its profile.
      play(["Meo Un", "New Alt"]);
      const next = await writeStandings(config, undefined, { etag: "e1", namesKey: first.namesKey });
      expect(sent.at(-1)).toBeNull();
      expect(next.notModified).toBe(false);
      expect(next.unchanged).toBe(false);
      expect(shapes(readFileSync(join(root, "Interface", "AddOns", "Guilded", "Standings.lua"), "utf8"))).toBe("Meo Un:full,New Alt:full,Guild Mate:brief");
      expect((await writeStandings(config, undefined, { etag: "e1", namesKey: next.namesKey })).notModified).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches this PC's characters loosely (case, spacing, realm, bare first names) and knows nothing without names", () => {
    expect(ownProfileMatcher([])).toBeNull();
    expect(ownProfileMatcher(["", "  "])).toBeNull();
    const own = ownProfileMatcher(["kev  caron-Realm"])!;
    expect(own({ name: "Kev Caron" })).toBe(true);
    expect(own({ name: "Kev" })).toBe(true);
    expect(own({ name: "Other", characters: ["KEV CARON"] })).toBe(true);
    expect(own({ name: "Ann Caron" })).toBe(false);
  });
});
