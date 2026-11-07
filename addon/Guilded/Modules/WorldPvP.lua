-- World PvP stats (9.0): kills, deaths, defends and calls answered, kept per player and per week.
--
--   /guilded worldpvp     my numbers this week and in total (also /guilded wpvp)
--
-- Only what the game and Guilded already tell us, with no combat log (restricted on Forever):
--   kills     the game's own honorable-kill line (CHAT_MSG_COMBAT_HONOR_GAIN), outside instances and
--             battlegrounds, read from the client's global string so every language works
--   deaths    I died within a minute of an attack by an enemy player that Call for help confirmed
--   defends   an honorable kill within 5 minutes of pressing On my way on a guildmate's call
--   calls     calls for help I made, how many a guildmate answered, and how many I answered
-- Stored in the saved variables as worldPvp (totals, the current week, and the last 30 kills) so the
-- companion can carry it to the Discord PvP ladder. Nothing is sent from here.
local _, ns = ...
local wp = {}
ns.worldPvp = wp

local DEFEND_SECONDS = 300
local DEATH_WINDOW_SECONDS = 60
local DEDUPE_SECONDS = 5
local RECENT = 30
local WEEK = 7 * 86400
local WEEK_OFFSET = 5 * 86400 + 15 * 3600 -- Tuesday 15:00 UTC, counted from the epoch (a Thursday)

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("worldpvp") end
local function epoch() local ok, v = pcall(GetServerTime); return ok and tonumber(v) or time() end
local function clock()
  local ok, v = pcall(GetTime)
  return ok and type(v) == "number" and v or time()
end
local function inInstance()
  if not IsInInstance then return false end
  local ok, inside = pcall(IsInInstance)
  return ok and inside == true
end
local function clean(text, limit)
  text = tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[|;~%c]", ""):gsub("^%s+", ""):gsub("%s+$", "")
  return string.sub(text, 1, limit or 40)
end

local FIELDS = { "kills", "deaths", "defends", "calls", "answered", "responded" }
local function blank()
  local t = {}
  for _, field in ipairs(FIELDS) do t[field] = 0 end
  return t
end

-- The saved table, with the week rolled over when a new one has begun.
local function store()
  local db = ns.getDb and ns.getDb()
  if type(db) ~= "table" then return nil end
  local s = type(db.worldPvp) == "table" and db.worldPvp or {}
  db.worldPvp = s
  s.total = type(s.total) == "table" and s.total or blank()
  s.recent = type(s.recent) == "table" and s.recent or {}
  local key = math.floor((epoch() - WEEK_OFFSET) / WEEK)
  if type(s.week) ~= "table" or s.weekKey ~= key then s.week, s.weekKey = blank(), key end
  s.since = s.since or epoch()
  return s
end

function wp.weekKey(t) return math.floor(((t or epoch()) - WEEK_OFFSET) / WEEK) end

local function bump(field, amount)
  local s = store()
  if not s then return false end
  amount = amount or 1
  s.total[field] = (tonumber(s.total[field]) or 0) + amount
  s.week[field] = (tonumber(s.week[field]) or 0) + amount
  return true
end

-- ---------------------------------------------------------------------
-- Reading the honorable-kill line
-- ---------------------------------------------------------------------

local function esc(text) return (text:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
-- "%s dies, honorable kill Rank: %s (%d Honor Points)" -> a pattern whose first capture is the victim.
local function compile(format)
  if type(format) ~= "string" or format == "" then return nil end
  local parts, pos, count = { "^" }, 1, 0
  while true do
    local s, e = format:find("%%%d*%$?[%d%.]*[sdf]", pos)
    if not s then parts[#parts + 1] = esc(format:sub(pos)); break end
    parts[#parts + 1] = esc(format:sub(pos, s - 1))
    count = count + 1
    parts[#parts + 1] = count == 1 and "(.-)" or ".-"
    pos = e + 1
  end
  parts[#parts + 1] = "$"
  return count >= 1 and table.concat(parts) or nil
end

local pattern
function wp.victim(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return nil end
  pattern = pattern or compile(_G.COMBATLOG_HONORGAIN) or "^(.-) dies, honorable kill"
  local name = text:match(pattern) or text:match("^(.-) dies, honorable kill")
  name = name and clean(name, 40)
  return name ~= "" and name or nil
end

-- ---------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------

local lastKill, lastDeathAt
local defendingUntil

function wp.defending() return defendingUntil ~= nil and clock() <= defendingUntil end

-- An honorable kill line from the game. Returns true when it was counted.
function wp.noteKill(text)
  if not active() or inInstance() then return false end
  local victim = wp.victim(text)
  if not victim then return false end
  local t = clock()
  if lastKill and lastKill.name == victim and t - lastKill.at < DEDUPE_SECONDS then return false end
  lastKill = { name = victim, at = t }
  if not bump("kills") then return false end
  local s = store()
  local zone = GetRealZoneText and GetRealZoneText() or ""
  if ns.isSecret and ns.isSecret(zone) then zone = "" end
  s.recent[#s.recent + 1] = { n = victim, z = clean(zone, 40), at = epoch(), d = wp.defending() and 1 or nil }
  while #s.recent > RECENT do table.remove(s.recent, 1) end
  if wp.defending() then bump("defends") end
  return true
end

-- I died. Counts when Call for help confirmed an attack by an enemy player in the last minute.
function wp.noteDeath()
  if not active() or inInstance() then return false end
  local help = ns.callForHelp
  if not (help and help.attacked and help.attacked()) then return false end
  local t = clock()
  if lastDeathAt and t - lastDeathAt < DEATH_WINDOW_SECONDS then return false end
  lastDeathAt = t
  return bump("deaths")
end

-- From Call for help: "call" (I called), "answered" (a guildmate said On my way to my call),
-- "responded" (I pressed On my way).
function wp.note(kind)
  if not active() then return false end
  if kind == "call" then return bump("calls") end
  if kind == "answered" then return bump("answered") end
  if kind == "responded" then
    defendingUntil = clock() + DEFEND_SECONDS
    return bump("responded")
  end
  return false
end

-- ---------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------

function wp.stats()
  local s = store()
  if not s then return blank(), blank() end
  return s.week, s.total
end

local function line(prefix, t)
  return string.format(L("%s: %d kills, %d deaths, %d defends. Calls for help: %d made (%d answered), %d answered by me."),
    prefix, t.kills or 0, t.deaths or 0, t.defends or 0, t.calls or 0, t.answered or 0, t.responded or 0)
end

function wp.summary()
  local week, total = wp.stats()
  return line(L("World PvP this week"), week), line(L("World PvP in total"), total)
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["worldpvp"] = function()
  local a, b = wp.summary()
  ns.message(a)
  ns.message(b)
end
ns.commandHandlers["wpvp"] = ns.commandHandlers["worldpvp"]
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded worldpvp - my open-world kills, deaths, defends and calls for help, this week and in total")

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, true)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("CHAT_MSG_COMBAT_HONOR_GAIN")
register("PLAYER_DEAD")
frame:SetScript("OnEvent", function(_, event, text)
  local ok, err = pcall(function()
    if event == "CHAT_MSG_COMBAT_HONOR_GAIN" then wp.noteKill(text)
    elseif event == "PLAYER_DEAD" then wp.noteDeath() end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "world pvp: " .. tostring(err)) end
end)
