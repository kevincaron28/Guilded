import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fengari from "fengari";

// Runs the addon's real Lua files against a mocked WoW API inside vitest, so
// addon logic is tested without the game. Fengari is Lua 5.3 and WoW is 5.1;
// the prelude adds the few 5.1 globals the addon uses (unpack, loadstring...).

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Guilded");

export function addonSource(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

// A minimal WoW: frames that accept any call, the few globals the addon
// reads at load, and helpers to load an addon file with the shared namespace.
const PRELUDE = String.raw`
unpack = unpack or table.unpack
loadstring = loadstring or load
table.getn = table.getn or function(t) return #t end
string.gmatch = string.gmatch
math.mod = math.mod or math.fmod

local function stub()
  return setmetatable({}, { __index = function(t, k) return function() return t end end, __call = function(t) return t end })
end
FRAMES = {}
function CreateFrame()
  local f = { scripts = {} }
  setmetatable(f, { __index = function(t, k) return function(self) return self end end })
  f.SetScript = function(self, name, fn) self.scripts[name] = fn end
  f.GetScript = function(self, name) return self.scripts[name] end
  f.HookScript = function(self, name, fn) self.scripts[name] = self.scripts[name] or fn end
  FRAMES[#FRAMES + 1] = f
  return f
end
UIParent = stub()
-- Sends a game event to every frame that handles OnEvent (like the client would).
function fire_event(event, ...)
  for _, f in ipairs(FRAMES) do
    local fn = f.scripts.OnEvent
    if fn then fn(f, event, ...) end
  end
end
DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end }
SlashCmdList = {}
C_Timer = { After = function(_, fn) end }
time = os.time
date = os.date
function GetTime() return 0 end
function GetServerTime() return 1800000000 end
function GetLocale() return "enUS" end
function GetBuildInfo() return "1.0.0", "1", "Jan 1 2026", 16001 end
function UnitName(unit) return (MOCK_UNITS and MOCK_UNITS[unit] and MOCK_UNITS[unit].name) or "Tester" end
function UnitClass() return "Warrior", "WARRIOR" end
function UnitRace() return "Night Elf", "NightElf" end
function UnitLevel() return 60 end
function GetRealmName() return "TestRealm" end
function IsInRaid() return MOCK_RAID or false end
function GetNumGroupMembers() return MOCK_GROUP_SIZE or 1 end
function UnitExists(unit) return MOCK_UNITS ~= nil and MOCK_UNITS[unit] ~= nil end
function UnitIsConnected() return true end
function UnitIsUnit(a, b) return a == b end
function IsInGuild() return true end
function GetGuildInfo() return "Test Guild", "Officer", 1 end
C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end, SendAddonMessage = function(prefix, text, target) SENT = SENT or {}; SENT[#SENT + 1] = { prefix = prefix, text = text, target = target } end }

-- Buffs by unit: MOCK_UNITS[unit].buffs = { "Well Fed", ... }
C_UnitAuras = { GetAuraDataByIndex = function(unit, index)
  local u = MOCK_UNITS and MOCK_UNITS[unit]
  local name = u and u.buffs and u.buffs[index]
  if name then return { name = name } end
  return nil
end }

-- Loads addon source the way the client does: chunk(addonName, ns).
function loadaddon(name, source, ns)
  local chunk, err = load(source, "=" .. name)
  if not chunk then error(err) end
  return chunk("Guilded", ns)
end
`;

export interface LuaSession {
  // Runs Lua code (errors become thrown JS errors) and returns its string result, if any.
  run(code: string): string;
  // Loads one of the addon's own files into namespace `ns` (a Lua global name).
  load(file: string, ns?: string): void;
  // Chat lines the addon printed.
  chat(): string[];
  close(): void;
}

export function newLuaSession(): LuaSession {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  function exec(code: string, label = "test"): string {
    const status = lauxlib.luaL_loadbuffer(L, to_luastring(code), code.length, to_luastring(`=${label}`));
    if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
      const message = to_jsstring(lua.lua_tostring(L, -1));
      lua.lua_pop(L, 1);
      throw new Error(message);
    }
    const value = lua.lua_isstring(L, -1) ? to_jsstring(lua.lua_tostring(L, -1)) : "";
    lua.lua_pop(L, 1);
    return value;
  }

  exec(PRELUDE, "prelude");
  return {
    run: (code) => exec(code),
    load(file, ns = "NS") {
      // Every file can use Util.lua's shared helpers (ns.util, ns.comm), as in the game where
      // it loads first; tests that load one module on a fake namespace get the real ones.
      if (file !== "Util.lua" && exec(`return tostring(${ns} ~= nil and ${ns}.comm ~= nil)`) !== "true") {
        this.load("Util.lua", ns);
      }
      // The source travels as a Lua long string, so no escaping is needed.
      const source = addonSource(file);
      lua.lua_pushstring(L, to_luastring(source));
      lua.lua_setglobal(L, to_luastring("__SRC"));
      exec(`${ns} = ${ns} or {}; loadaddon(${JSON.stringify(file)}, __SRC, ${ns})`, file);
    },
    chat: () => {
      const count = Number(exec("return tostring(CHAT_LOG and #CHAT_LOG or 0)"));
      const lines: string[] = [];
      for (let i = 1; i <= count; i++) lines.push(exec(`return CHAT_LOG[${i}]`).replace(/\|c[0-9a-fA-F]{8}|\|r/g, ""));
      return lines;
    },
    close: () => { lua.lua_close(L); }
  };
}
