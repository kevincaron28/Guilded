-- Personal milestones, said once in guild chat so guildmates can cheer (8.4.5).
--
--   level   every 10th level and the edition's maximum level
--   dungeon the first completed run of each dungeon (Dungeon.lua's finished-run hook)
--   hk      lifetime honorable kills: 1, 100, 500, 1000
--   duel    duels won against guildmates: 1, 10, 50, 100 (Duels.lua)
--   prof    profession skill steps 75, 150, 225, 300 (150 and 300 are announced; the others are recorded for the bot)
--   ach     every WoW Forever in-game achievement (Modules/GameAchievements.lua records them here; the newest is announced)
--
-- ON by default for every character (owner decision, 5 Nov 2026): the first time a line is about to go out, a one-time
-- local notice (chat frame only) says so and how to stop. Each player can turn it off, or turn single types off
-- (/guilded announce, Settings); officers can switch it off for the whole guild, which wins over member choices.
-- Every milestone is announced once per character, ever (persisted), at most one line per 30 seconds, to the
-- GUILD channel only, and never in combat. What a character already had when this module first ran, or reached
-- while announcements were off, is recorded silently (and uploaded with the companion), never announced later.
--
--   /guilded announce                         status (also /guilded milestones)
--   /guilded announce on | off                my milestones in guild chat
--   /guilded announce level|dungeon|hk|duel on|off
--   /guilded announce guild off | on          officers: off (or back on) for the whole guild
local _, ns = ...
local ms = {}
ns.milestones = ms

local PREFIX = "GuildedMile"
local THROTTLE = 30
local RETRY_COMBAT = 15
local MAX_TRIES = 4
local MAX_LOG = 200
local KINDS = { "level", "dungeon", "hk", "duel", "prof", "ach" }
local HK_STEPS = { 1, 100, 500, 1000 }
local DUEL_STEPS = { 1, 10, 50, 100 }
local PROF_STEPS = { 75, 150, 225, 300 }
local PROF_ANNOUNCED = { [150] = true, [300] = true }
-- Skill line ids do not depend on the game language; the key is what the bot reads in the upload.
local PROF_KEYS = { [171] = "alchemy", [164] = "blacksmithing", [333] = "enchanting", [202] = "engineering", [182] = "herbalism",
  [165] = "leatherworking", [186] = "mining", [393] = "skinning", [197] = "tailoring", [185] = "cooking", [129] = "firstaid", [356] = "fishing" }
local FOREVER_CAP = 60

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("milestones") end
local function epoch() local ok, v = pcall(GetServerTime); return ok and tonumber(v) or time() end
local function safe(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, ...)
  if not ok or (ns.isSecret and ns.isSecret(value)) then return nil end
  return value
end

local function root()
  local d = ns.getDb and ns.getDb()
  if not d then return nil end
  d.milestones = type(d.milestones) == "table" and d.milestones or {}
  d.milestones.chars = type(d.milestones.chars) == "table" and d.milestones.chars or {}
  return d.milestones
end
local function identity()
  local name, realm = safe(UnitName, "player"), safe(GetRealmName)
  if type(name) ~= "string" or name == "" then return nil end
  return name .. "-" .. tostring(realm or ""), name, tostring(realm or "")
end
-- This character's record: settings (default OFF), what was reached, and the upload log.
local function current()
  local r = root(); local key, name, realm = identity()
  if not r or not key then return nil end
  local c = r.chars[key]
  if type(c) ~= "table" then c = {}; r.chars[key] = c end
  c.name, c.realm = name, realm
  c.done = type(c.done) == "table" and c.done or {}
  c.log = type(c.log) == "table" and c.log or {}
  c.settings = type(c.settings) == "table" and c.settings or {}
  return c, r
end
function ms.enabled(kind)
  local c = current()
  if not c or c.settings.enabled == false or ms.guildOff() then return false end
  return kind == nil or c.settings[kind] ~= false
end
function ms.setEnabled(on, kind)
  local c = current()
  if not c then return false end
  if kind then c.settings[kind] = on and true or false else c.settings.enabled = on and true or false end
    return true
end

local function maxLevel()
  local cap = safe(GetMaxPlayerLevel)
  if type(cap) == "number" and cap >= 10 then return cap end
  return FOREVER_CAP
end

-- ----- announcing ------------------------------------------------------

local queue, lastAt, timerSet = {}, 0, false
local function messageFor(item, name)
  if item.kind == "level" then
    if item.cap then return string.format(L("%s reached the maximum level (%d)!"), name, item.value) end
    return string.format(L("%s reached level %d!"), name, item.value)
  elseif item.kind == "dungeon" then
    return string.format(L("%s cleared %s for the first time!"), name, item.label or "?")
  elseif item.kind == "hk" then
    if item.value == 1 then return string.format(L("%s scored a first honorable kill!"), name) end
    return string.format(L("%s reached %d honorable kills!"), name, item.value)
  elseif item.kind == "prof" then
    return string.format(L("%s reached skill %d in %s!"), name, item.value, item.label or "?")
  elseif item.kind == "ach" then
    return string.format(L("%s earned the achievement %s!"), name, item.label or "?")
  elseif item.kind == "duel" then
    if item.value == 1 then return string.format(L("%s won a first duel!"), name) end
    return string.format(L("%s has won %d duels!"), name, item.value)
  end
end
ms.message = messageFor

local function inCombat()
  return (InCombatLockdown and InCombatLockdown() == true) or (UnitAffectingCombat and UnitAffectingCombat("player") == true)
end
local function schedule(delay)
  if timerSet or not (C_Timer and C_Timer.After) then return end
  timerSet = true
  C_Timer.After(delay, function() timerSet = false; ms.pump() end)
end

-- Sends at most one queued line per THROTTLE seconds. Returns true when a line went out.
function ms.pump()
  if #queue == 0 then return false end
  local item = queue[1]
  local c = current()
  -- Turned off (or the module disabled) since it was queued: drop everything waiting.
  if not c or not active() or c.settings.enabled == false or ms.guildOff() or c.settings[item.kind] == false then queue = {}; return false end
  if not (IsInGuild and IsInGuild()) then queue = {}; return false end
  local wait = lastAt + THROTTLE - epoch()
  if wait > 0 then schedule(wait + 1); return false end
  if inCombat() then schedule(RETRY_COMBAT); return false end
  local text = messageFor(item, c.name)
  -- One local notice (chat frame only, never sent) before the first announcement from this character.
  if text and not c.settings.noticed then
    c.settings.noticed = true
    ns.message(L("Guilded will announce your milestones (levels, first dungeon clears, PvP and duel milestones) in guild chat. Type /guilded announce off to stop, or turn types off in Settings."))
  end
  if not text then table.remove(queue, 1); return false end
  local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
  -- GUILD only. A refusal (restricted chat, no hardware event) keeps the line for a later try, a few times.
  local ok, err = pcall(send, text, "GUILD")
  if ok and err ~= false then
    table.remove(queue, 1); lastAt = epoch()
    if #queue > 0 then schedule(THROTTLE + 1) end
    return true
  end
  item.tries = (item.tries or 0) + 1
  if item.tries >= MAX_TRIES then table.remove(queue, 1) end
  if #queue > 0 then schedule(RETRY_COMBAT) end
  return false
end

-- ----- recording -------------------------------------------------------

-- Marks a milestone reached (once per character, ever). `item` = { kind, value, label, cap }.
-- `silent` records without announcing (older steps of a jump, the first baseline, announcements off).
function ms.reach(id, ref, item, silent)
  local c = current()
  if not c or not active() or c.done[id] then return false end
  -- An achievement carries the date the game gave it (and its text, for the bot's badge catalogue); everything else is "now".
  local at = tonumber(item.at) or epoch()
  c.done[id] = at
  c.log[#c.log + 1] = { id = id, kind = item.kind, ref = ref, value = item.value, at = at, label = item.kind == "ach" and item.label or nil,
    desc = item.kind == "ach" and item.desc or nil, category = item.kind == "ach" and item.category or nil, points = item.kind == "ach" and item.points or nil }
  while #c.log > MAX_LOG do table.remove(c.log, 1) end
  if not silent and c.settings.enabled ~= false and not ms.guildOff() and c.settings[item.kind] ~= false and c.baselined then
    queue[#queue + 1] = item
    ms.pump()
  end
  if ns.syncNow and ns.syncNow.mark then pcall(ns.syncNow.mark) end
  return true
end

-- Every step at or below `value`: the highest new one is announced, lower new ones are recorded silently.
local function reachSteps(kind, steps, value, make)
  local new = {}
  for _, step in ipairs(steps) do
    local c = current()
    if c and value >= step and not c.done[kind .. ":" .. step] then new[#new + 1] = step end
  end
  for i, step in ipairs(new) do
    local item, ref = make(step)
    ms.reach(kind .. ":" .. step, ref, item, i < #new or item.announce == false)
  end
end

function ms.checkLevel(level)
  level = tonumber(level)
  if not level or level < 1 then return end
  local cap, steps = maxLevel(), {}
  for step = 10, cap - 1, 10 do steps[#steps + 1] = step end
  steps[#steps + 1] = cap
  reachSteps("level", steps, level, function(step) return { kind = "level", value = step, cap = step == cap }, "level:" .. step end)
end

function ms.checkHonorableKills()
  local hk = safe(GetPVPLifetimeStats)
  if type(hk) ~= "number" or hk ~= hk or hk < 0 then return end
  reachSteps("hk", HK_STEPS, math.floor(hk), function(step) return { kind = "hk", value = step }, "hk:" .. step end)
end

-- A duel win total from Duels.lua.
function ms.checkDuelWins(wins)
  wins = tonumber(wins)
  if not wins then return end
  reachSteps("duel", DUEL_STEPS, wins, function(step) return { kind = "duel", value = step }, "duel:" .. step end)
end

-- Profession skill steps, per profession (by skill line id, so any game language gives the same key).
-- Reaching 300 while watching (not found already there at the first run) also records `profnew:<key>`, which lets the
-- bot tell "first in the guild to reach 300" from a skill that was simply already there.
function ms.checkProfessions()
  if not (GetProfessions and GetProfessionInfo) then return end
  local ok, a, b, c, d, e, f = pcall(GetProfessions)
  if not ok then return end
  for _, index in ipairs({ a or false, b or false, c or false, d or false, e or false, f or false }) do
    if index then
      local infoOk, name, _, skill, _, _, _, line = pcall(GetProfessionInfo, index)
      local key = infoOk and PROF_KEYS[tonumber(line) or 0]
      skill = infoOk and tonumber(skill)
      if key and skill and skill > 0 and type(name) == "string" and not (ns.isSecret and ns.isSecret(name)) then
        reachSteps("prof:" .. key, PROF_STEPS, math.floor(skill), function(step)
          local cur = current()
          if step == 300 and cur and cur.baselined then ms.reach("profnew:" .. key, "profnew:" .. key, { kind = "prof", value = 300 }, true) end
          return { kind = "prof", value = step, label = name, announce = PROF_ANNOUNCED[step] == true }, "prof:" .. key .. "-" .. step
        end)
      end
    end
  end
end

-- This character's record, for Modules/GameAchievements.lua (settings, what was reached, the upload log).
function ms.state() return (current()) end

-- Dungeon.lua's finished-run hook: the first completed run of each dungeon, for this character.
function ms.onDungeonRun(run)
  if type(run) ~= "table" or run.state ~= "COMPLETED" or type(run.instanceId) ~= "number" then return end
  local c = current()
  if not c then return end
  -- Only a run this character took part in (each player records for themself, never for others).
  if type(run.players) ~= "table" or not run.players[c.name] then return end
  local id = "dungeon:" .. run.instanceId
  ms.reach(id, id, { kind = "dungeon", value = run.instanceId, label = run.name or ("#" .. run.instanceId) }, false)
end

-- First run of the module on a character: everything already reached is recorded silently, so turning
-- announcements on later never replays history.
local function baseline()
  local c = current()
  if not c or c.baselined then return end
  ms.checkLevel(safe(UnitLevel, "player"))
  ms.checkHonorableKills()
  ms.checkProfessions()
  local d = ns.getDb and ns.getDb()
  for _, run in pairs(d and d.dungeon and d.dungeon.runs or {}) do
    if type(run) == "table" and run.state == "COMPLETED" and type(run.instanceId) == "number" and type(run.players) == "table" and run.players[c.name] then
      local id = "dungeon:" .. run.instanceId
      ms.reach(id, id, { kind = "dungeon", value = run.instanceId, label = run.name }, true)
    end
  end
  if ns.duels and ns.duels.myWins then ms.checkDuelWins(ns.duels.myWins()) end
  c.baselined = true
end
ms.baseline = baseline

-- ----- officer guild-wide switch ---------------------------------------

local function send(text)
  if IsInGuild and IsInGuild() then ns.comm.send(PREFIX, text, "GUILD") end
end
-- True when an officer turned announcements off for the whole guild (that wins over every member's choice).
function ms.guildOff()
  local r = root()
  return r and r.guild and r.guild.off == true or false
end
-- Officers only. Shared with online guildmates now and again whenever an officer logs in.
function ms.setGuildOff(off)
  local r = root()
  if not r or not (ns.isOfficer and ns.isOfficer()) then return false end
  r.guild = { off = off and true or false, at = epoch(), by = safe(UnitName, "player") }
  if off then queue = {} end
  send(string.format("GOFF|%d|%d", off and 1 or 0, r.guild.at))
  return true
end

function ms.onAddonMessage(text, sender)
  if type(text) ~= "string" then return end
  local kind, off, at = text:match("^(GOFF)|(%d)|(%d+)$")
  if kind ~= "GOFF" then return end
  at = tonumber(at)
  -- Only an officer's word counts; a future date would pin the switch forever.
  if not at or (ns.isOfficerName and not ns.isOfficerName(sender)) or (ns.util and ns.util.tooFarAhead and ns.util.tooFarAhead(at)) then return end
  local r = root()
  if not r or (r.guild and (r.guild.at or 0) >= at) then return end
  r.guild = { off = off == "1", at = at, by = tostring(sender):match("^[^-]+") }
  if off == "1" then queue = {} end
end

-- ----- commands --------------------------------------------------------

local function stateWord(on) return on and "ON" or "OFF" end
local function status()
  local c = current()
  if not c then return end
  ns.message(string.format(L("Milestone announcements in guild chat: %s. Level %s, dungeons %s, honorable kills %s, duels %s, professions %s."),
    stateWord(c.settings.enabled ~= false), stateWord(c.settings.level ~= false), stateWord(c.settings.dungeon ~= false),
    stateWord(c.settings.hk ~= false), stateWord(c.settings.duel ~= false), stateWord(c.settings.prof ~= false)))
  ns.message(string.format(L("Achievements in guild chat: %s."), stateWord(c.settings.ach ~= false)))
  if ms.guildOff() then ns.message(L("Milestone announcements are turned off for the whole guild by an officer.")) end
end
local function handle(args)
  args = type(args) == "table" and args or {}
  local a, b = string.lower(args[1] or ""), string.lower(args[2] or "")
  if a == "on" or a == "off" then
    ms.setEnabled(a == "on")
    ns.message(a == "on" and L("Milestone announcements are ON. /guilded announce off turns them off.") or L("Milestone announcements are OFF."))
  elseif a == "guild" then
    if b ~= "on" and b ~= "off" then ns.message("/guilded announce guild on | off"); return end
    if ms.setGuildOff(b == "off") then
      ns.message(b == "off" and L("Milestone announcements are turned off for the whole guild by an officer.") or L("Milestone announcements are allowed for the guild again."))
    else ns.message(L("Officer or guild-master rank is required for this command.")) end
  else
    for _, kind in ipairs(KINDS) do
      if a == kind and (b == "on" or b == "off") then ms.setEnabled(b == "on", kind); status(); return end
    end
    status()
    ns.message("/guilded announce on | off | level|dungeon|hk|duel|prof|ach on|off | guild on|off (officers)")
  end
end
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["milestones"] = handle
ns.commandHandlers["announce"] = handle
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded announce on | off - my milestones (level 10, first dungeon clears, honorable kills, duel wins) in guild chat; ON by default")
table.insert(ns.commandHelp, { officer = true, text = "/guilded announce guild off | on - officers: turn milestone announcements off (or back on) for the whole guild" })

-- ----- events ----------------------------------------------------------

-- Dungeon.lua calls ns.onDungeonRunFinished(run) when a run ends; keep whatever was there (Scores.lua) and add ours.
local previousHook = ns.onDungeonRunFinished
ns.onDungeonRunFinished = function(run)
  if previousHook then pcall(previousHook, run) end
  pcall(ms.onDungeonRun, run)
end

local frame = CreateFrame("Frame")
local events = { "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "PLAYER_LEVEL_UP", "PLAYER_PVP_KILLS_CHANGED", "CHAT_MSG_COMBAT_HONOR_GAIN", "SKILL_LINES_CHANGED", "CHAT_MSG_SKILL", "CHAT_MSG_ADDON" }
for _, event in ipairs(events) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event, a, b, c, d)
  local ok, err = pcall(function()
    if not active() then return end
    if event == "PLAYER_LOGIN" then
      ns.comm.register(PREFIX)
    elseif event == "PLAYER_ENTERING_WORLD" then
      baseline()
      ms.checkHonorableKills()
      -- An officer's guild-wide switch is repeated at login so members who were offline get it too.
      local r = root()
      if r and r.guild and r.guild.off and ns.isOfficer and ns.isOfficer() and C_Timer and C_Timer.After then
        C_Timer.After(45, function() send(string.format("GOFF|1|%d", r.guild.at)) end)
      end
    elseif event == "PLAYER_LEVEL_UP" then
      baseline(); ms.checkLevel(a)
    elseif event == "PLAYER_PVP_KILLS_CHANGED" or event == "CHAT_MSG_COMBAT_HONOR_GAIN" then
      ms.checkHonorableKills()
    elseif event == "SKILL_LINES_CHANGED" or event == "CHAT_MSG_SKILL" then
      if current() and current().baselined then ms.checkProfessions() end
    elseif event == "CHAT_MSG_ADDON" and ns.comm.accept(a, b, c, d, PREFIX, function(sender) return ns.isGuildMember and ns.isGuildMember(sender) end) and c == "GUILD" then
      ms.onAddonMessage(b, d)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "milestones: " .. tostring(err)) end
end)
