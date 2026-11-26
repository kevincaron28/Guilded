-- Raid progress (9 December 2026, WoW Forever's first raids): boss kills inside raid instances.
--
--   /guilded raidprogress     what this character has recorded so far
--
-- Records a kill when the game's own ENCOUNTER_END says success inside a raid instance (the same event the dungeon recorder
-- reads for dungeon bosses; BOSS_KILL is the fallback when the client sends only that). One row per kill: the instance, the
-- boss, the kill time and how long the pull took (from ENCOUNTER_START), the difficulty, the size of the raid group and which
-- members are in my guild (their names and count). Nothing is sent from here: the rows are in the saved variables
-- (raidProgress.kills) and the companion carries them to the bot, which ranks guilds on the public Raid progress board.
-- Plain reads only: no combat log, no protected call, and no chat output.
local _, ns = ...
local rp = {}
ns.raidProgress = rp

local KEEP = 200
local MAX_AGE = 180 * 86400
local MAX_NAMES = 40
-- Raid and boss IDs the bot already knows by name. Left empty until Forever's raids open: every kill inside a raid instance is
-- recorded with the names the event gives, and the bot keeps the matching list (src/services/raid-progress.ts).
rp.KNOWN = {}

local function L(text) return ns.L and ns.L(text) or text end
local function epoch() local ok, v = pcall(GetServerTime); return ok and tonumber(v) or time() end
local function plain(text, limit)
  text = tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[|;~%c]", ""):gsub("^%s+", ""):gsub("%s+$", "")
  return string.sub(text, 1, limit or 60)
end
local function secret(v) return ns.isSecret and ns.isSecret(v) or false end

local function store()
  local db = ns.getDb and ns.getDb()
  if type(db) ~= "table" then return nil end
  db.raidProgress = type(db.raidProgress) == "table" and db.raidProgress or {}
  local s = db.raidProgress
  s.kills = type(s.kills) == "table" and s.kills or {}
  return s
end

local pulls = {}

local function raidInstance()
  local compat = ns.compat
  local instance = compat and compat.instance and compat.instance()
  if not instance or instance.type ~= "raid" or not instance.id then return nil end
  return instance
end

local function guildGroup()
  local compat = ns.compat
  local names, total, inGuild = {}, 0, 0
  for _, member in ipairs(compat and compat.groupMembers and compat.groupMembers() or {}) do
    total = total + 1
    if member.inGuild == true then
      inGuild = inGuild + 1
      if #names < MAX_NAMES and type(member.name) == "string" then names[#names + 1] = plain(member.name, 40) end
    end
  end
  return total, inGuild, names
end

local function prune(s, at)
  local rows = {}
  for ref, row in pairs(s.kills) do
    if type(row) ~= "table" or type(row.at) ~= "number" or at - row.at > MAX_AGE then s.kills[ref] = nil
    else rows[#rows + 1] = row end
  end
  if #rows > KEEP then
    table.sort(rows, function(a, b) return a.at > b.at end)
    for i = KEEP + 1, #rows do s.kills[rows[i].ref] = nil end
  end
end

-- Records one boss kill. Returns the stored row, or nil when it is not a raid kill (or a copy of one already recorded).
function rp.record(encounterId, name, difficultyId, groupSize)
  if secret(encounterId) or not tonumber(encounterId) then return nil end
  local instance = raidInstance()
  local s = store()
  if not instance or not s then return nil end
  encounterId = tonumber(encounterId)
  local at = epoch()
  -- A client may send both ENCOUNTER_END and BOSS_KILL for one kill, in either order.
  for _, row in pairs(s.kills) do
    if row.instanceId == instance.id and row.encounterId == encounterId and math.abs(at - row.at) < 120 then return nil end
  end
  local started = pulls[encounterId]
  pulls[encounterId] = nil
  local total, inGuild, names = guildGroup()
  local me = ns.playerName and ns.playerName() or "?"
  local ref = string.format("RK-%d-%d-%d-%d-%s", instance.id, encounterId, tonumber(difficultyId) or instance.difficultyId or 0, at, plain(me, 24))
  local first = true
  for _, row in pairs(s.kills) do
    if row.instanceId == instance.id and row.encounterId == encounterId and row.difficultyId == (tonumber(difficultyId) or instance.difficultyId or 0) then first = false end
  end
  local size = tonumber(groupSize)
  if secret(groupSize) or not size or size < 1 then size = total end
  local row = {
    ref = ref, instanceId = instance.id, instance = plain(instance.name, 60), encounterId = encounterId,
    boss = (not secret(name)) and plain(name, 60) or "", difficultyId = tonumber(difficultyId) or instance.difficultyId or 0,
    difficulty = plain(instance.difficultyName, 30), groupSize = size, guildCount = inGuild, guildNames = names, at = at,
    first = first, reporter = plain(me, 40)
  }
  if started and at >= started and at - started < 6 * 3600 then row.durationSec = at - started end
  s.kills[ref] = row
  prune(s, at)
  return row
end

function rp.list()
  local s = store()
  local out = {}
  for _, row in pairs(s and s.kills or {}) do out[#out + 1] = row end
  table.sort(out, function(a, b) return a.at > b.at end)
  return out
end

local function onEvent(event, ...)
  if event == "ENCOUNTER_START" then
    local encounterId = ...
    if not secret(encounterId) and tonumber(encounterId) and raidInstance() then pulls[tonumber(encounterId)] = epoch() end
  elseif event == "ENCOUNTER_END" then
    local encounterId, name, difficultyId, groupSize, success = ...
    if secret(success) or success ~= 1 then pulls[tonumber(encounterId) or 0] = nil; return end
    rp.record(encounterId, name, difficultyId, groupSize)
  elseif event == "BOSS_KILL" then
    local encounterId, name = ...
    rp.record(encounterId, name)
  end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["raidprogress"] = function()
  local rows = rp.list()
  local say = ns.message or function() end
  if #rows == 0 then say(ns.L and ns.L("No raid boss kills recorded yet. Guilded records them when a boss dies in a raid.") or "No raid boss kills recorded yet.") return end
  for i = 1, math.min(#rows, 8) do
    local row = rows[i]
    say(string.format(L("%s - %s (%d/%d in guild)"), row.instance, row.boss ~= "" and row.boss or tostring(row.encounterId), row.guildCount, row.groupSize))
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded raidprogress - the raid boss kills this character recorded")

local frame = CreateFrame("Frame")
for _, event in ipairs({ "ENCOUNTER_END" }) do
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event) end
end
if ns.compat and ns.compat.registerEvent then
  ns.compat.registerEvent(frame, "BOSS_KILL", true)
  ns.compat.registerEvent(frame, "ENCOUNTER_START", true)
end
frame:SetScript("OnEvent", function(_, event, ...)
  local ok, err = pcall(onEvent, event, ...)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded raidprogress: " .. tostring(err)) end
end)
