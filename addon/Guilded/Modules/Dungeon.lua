-- Dungeon Challenge run tracker (roadmap D2).
--
-- Turns a guild group's dungeon run into one permanent record:
--   DETECTED  entered a 5-player dungeon (type "party")
--   STARTING  waiting for the first pull
--   ACTIVE    timer running (first combat, or /guilded dungeon start)
--   COMPLETED final boss killed (Encounter Journal) or /guilded dungeon complete
--   ABANDONED left for 15 minutes, group disbanded, or /guilded dungeon abandon
--   INVALID   marked unusable (e.g. zero duration)
--
-- Every addon user in the group tracks the run; one "recorder" (lowest
-- character name among addon users, so everyone agrees without talking)
-- announces the shared run id. Each player's own addon counts their own
-- deaths and shares the count after combat (addon messages can be blocked
-- mid-fight). Finished runs are shared with online officers in the guild so
-- the run reaches the bot even if no officer was in the group. Points are
-- NOT computed here: the bot applies its own rules to validated runs.
--
-- All WoW API access goes through ns.compat (Compat.lua). Everything is
-- saved in GuildedDB.dungeon on every change, so /reload, a disconnect,
-- or a crash resumes the run.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedDgn"
local PROTOCOL_VERSION = 1
local SCHEMA_VERSION = 1
local ABANDON_AFTER_SECONDS = 15 * 60
local TICK_SECONDS = 30
local CHUNK_BYTES = 200
local KEEP_SYNCED_DAYS = 30

local compat = ns.compat
local dungeon = { addonUsers = {}, outbox = {}, incoming = {}, lastHello = 0 }
ns.dungeon = dungeon

local TERMINAL = { COMPLETED = true, ABANDONED = true, INVALID = true, ERROR = true }

local function db()
  local root = ns.getDb and ns.getDb()
  if not root then return nil end
  root.dungeon = root.dungeon or {}
  local d = root.dungeon
  d.schema = d.schema or SCHEMA_VERSION
  d.runs = d.runs or {}
  return d
end

local function now() return compat.serverTime() end
local function me() return ns.playerName() end

-- ---------------------------------------------------------------------
-- Messaging (queued while in combat, spaced out)
-- ---------------------------------------------------------------------

local function groupChannel()
  return ns.util.groupChannel()
end

-- Held back while in combat (messages can be blocked mid-fight), then handed to the paced
-- queue in Util.lua.
local function flush()
  if compat.inCombat() then return end
  local queued = dungeon.outbox
  dungeon.outbox = {}
  for _, message in ipairs(queued) do
    local channel = message.channel == "GROUP" and groupChannel() or message.channel
    if channel then ns.comm.send(PREFIX, message.text, channel) end
  end
end

-- channel "GROUP" = party/raid at send time, or "GUILD".
local function send(text, channel)
  table.insert(dungeon.outbox, { text = text, channel = channel or "GROUP" })
  flush()
end

-- ---------------------------------------------------------------------
-- Group, recorder, players
-- ---------------------------------------------------------------------

-- Lowest name among addon users in the group (including you).
local function electRecorder()
  local recorder = me()
  for _, member in ipairs(compat.groupMembers()) do
    if dungeon.addonUsers[member.name] and member.name < recorder then recorder = member.name end
  end
  return recorder
end

local function sayHello(force)
  if not compat.inGroup() then return end
  if not force and now() - dungeon.lastHello < 10 then return end
  dungeon.lastHello = now()
  send("HELLO|" .. compat.addonVersion())
end

-- Updates who is in the run and how long they've been present.
local function updatePlayers(run)
  local stamp = now()
  local elapsed = run.lastTick and math.max(0, math.min(stamp - run.lastTick, TICK_SECONDS * 4)) or 0
  run.lastTick = stamp
  local inside = run.inside and run.state == "ACTIVE"
  for _, member in ipairs(compat.groupMembers()) do
    local player = run.players[member.name]
    if not player then
      player = { firstSeen = stamp, presentSec = 0 }
      run.players[member.name] = player
    end
    player.lastSeen = stamp
    player.class = member.class or player.class
    player.role = member.role or player.role
    player.guid = member.guid or player.guid
    player.inGuild = member.inGuild or player.inGuild
    if dungeon.addonUsers[member.name] or member.name == me() then
      player.addon = true
      player.deaths = player.deaths or 0
    end
    if inside and member.online then player.presentSec = player.presentSec + elapsed end
  end
end

-- ---------------------------------------------------------------------
-- Run lifecycle
-- ---------------------------------------------------------------------

local function makeId(recorder, stamp)
  return string.format("QG-%s-%s", date("!%Y%m%d-%H%M%S", stamp), recorder)
end

local function newRun(instance)
  local stamp = now()
  local recorder = electRecorder()
  local run = {
    id = makeId(recorder, stamp),
    protocolVersion = PROTOCOL_VERSION,
    addonVersion = compat.addonVersion(),
    interface = compat.interfaceVersion(),
    state = "DETECTED",
    recorder = recorder,
    instanceId = instance.id,
    name = instance.name,
    difficultyId = instance.difficultyId,
    difficultyName = instance.difficultyName,
    detectedAt = stamp,
    encounters = {},
    players = {},
    reporters = { [me()] = true },
    inside = true
  }
  local bosses = compat.dungeonBosses(instance.id)
  if bosses then
    run.bossCount = #bosses
    run.finalEncounterId = bosses[#bosses].id
  end
  updatePlayers(run)
  run.state = "STARTING"
  return run
end

local function save(run)
  local d = db()
  if d then d.current = run end
end

local serialize

-- Stores a finished run for export, tells the group, and shares it with
-- officers who are online.
local function finalize(run)
  local d = db()
  if not d then return end
  updatePlayers(run)
  if run.startedAt and run.endedAt then run.durationSec = run.endedAt - run.startedAt end
  if run.state == "COMPLETED" and (not run.durationSec or run.durationSec <= 0) then
    run.state = "INVALID"
    run.endReason = "zero duration"
  end
  run.inside = nil
  run.lastTick = nil
  d.runs[run.id] = run
  d.current = nil
  local summary = serialize(run)
  local chunks = {}
  for index = 1, #summary, CHUNK_BYTES do table.insert(chunks, string.sub(summary, index, index + CHUNK_BYTES - 1)) end
  for index, chunk in ipairs(chunks) do send(string.format("SUM|%s|%d|%d|%s", run.id, index, #chunks, chunk), "GUILD") end
  -- Dungeon scores (Scores.lua) learn from every finished run.
  if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
  ns.message(string.format("Dungeon run %s: %s%s.", run.state, run.name or "?",
    run.durationSec and run.state == "COMPLETED" and string.format(" in %d:%02d", math.floor(run.durationSec / 60), run.durationSec % 60) or ""))
  if ns.onDungeonChange then pcall(ns.onDungeonChange) end
end

local function finish(state, reason)
  local d = db()
  local run = d and d.current
  if not run or TERMINAL[run.state] then return end
  if state == "COMPLETED" and run.state ~= "ACTIVE" then
    ns.message("The run hasn't started yet (no pull). Use /guilded dungeon start first, or abandon it.")
    return
  end
  run.state = state
  run.endedAt = now()
  if state == "COMPLETED" then run.completedBy = reason else run.endReason = reason end
  send(string.format("END|%s|%s|%d|%s", run.id, state, run.endedAt, reason or ""))
  finalize(run)
end

local function activate(stamp)
  local d = db()
  local run = d and d.current
  if not run or run.state ~= "STARTING" then return end
  run.state = "ACTIVE"
  run.startedAt = stamp or now()
  run.lastTick = run.startedAt
  send(string.format("ACTIVE|%s|%d", run.id, run.startedAt))
  save(run)
  ns.message("Dungeon run started: " .. (run.name or "?") .. ". Good luck!")
  if ns.onDungeonChange then pcall(ns.onDungeonChange) end
end

-- Called on zone changes, login, and every tick.
local function evaluate()
  local d = db()
  if not d then return end
  local instance = compat.instance()
  local run = d.current
  local inDungeon = instance and instance.type == "party" and instance.id

  if run and not TERMINAL[run.state] then
    if inDungeon and instance.id == run.instanceId then
      run.inside = true
      run.leftAt = nil
    else
      run.inside = false
      run.leftAt = run.leftAt or now()
      if run.state == "STARTING" or run.state == "DETECTED" then
        -- Never pulled anything: not a run.
        d.current = nil
        return
      end
      if now() - run.leftAt >= ABANDON_AFTER_SECONDS then
        finish("ABANDONED", "left the dungeon")
        return
      end
    end
    updatePlayers(run)
    save(run)
    return
  end

  if inDungeon then
    local fresh = newRun(instance)
    save(fresh)
    if fresh.recorder == me() then send(string.format("START|%s|%d", fresh.id, fresh.instanceId)) end
    ns.message(string.format("Dungeon detected: %s. The timer starts on the first pull (or /guilded dungeon start).", instance.name))
    if ns.onDungeonChange then pcall(ns.onDungeonChange) end
  end
end

-- ---------------------------------------------------------------------
-- Summary format for sharing with officers (and what the export carries)
-- ---------------------------------------------------------------------

local function clean(text)
  return (string.gsub(tostring(text or ""), "[|;:,=]", " "))
end

serialize = function(run)
  local players = {}
  for name, player in pairs(run.players) do
    table.insert(players, table.concat({
      clean(name), clean(player.class or ""), clean(player.role or ""),
      player.deaths ~= nil and tostring(player.deaths) or "?",
      tostring(math.floor(player.presentSec or 0)), player.inGuild and "1" or "0"
    }, ":"))
  end
  local encounters = {}
  for _, encounter in ipairs(run.encounters) do
    if encounter.success then table.insert(encounters, tostring(encounter.id)) end
  end
  return table.concat({
    "v=" .. PROTOCOL_VERSION, "av=" .. clean(run.addonVersion), "st=" .. run.state,
    "i=" .. tostring(run.instanceId or 0), "n=" .. clean(run.name), "d=" .. tostring(run.difficultyId or 0),
    "s=" .. tostring(run.startedAt or 0), "e=" .. tostring(run.endedAt or 0),
    "cb=" .. clean(run.completedBy or run.endReason or ""), "r=" .. clean(run.recorder),
    "enc=" .. table.concat(encounters, ","), "p=" .. table.concat(players, ",")
  }, ";")
end

local function deserialize(id, text)
  local fields = {}
  for key, value in string.gmatch(text, "([%a]+)=([^;]*)") do fields[key] = value end
  if tonumber(fields.v) ~= PROTOCOL_VERSION or not fields.st then return nil end
  local run = {
    id = id, protocolVersion = PROTOCOL_VERSION, addonVersion = fields.av, state = fields.st,
    instanceId = tonumber(fields.i), name = fields.n, difficultyId = tonumber(fields.d),
    startedAt = tonumber(fields.s) ~= 0 and tonumber(fields.s) or nil,
    endedAt = tonumber(fields.e) ~= 0 and tonumber(fields.e) or nil,
    recorder = fields.r, encounters = {}, players = {}, reporters = {}
  }
  if fields.st == "COMPLETED" then run.completedBy = fields.cb else run.endReason = fields.cb end
  if run.startedAt and run.endedAt then run.durationSec = run.endedAt - run.startedAt end
  for encounterId in string.gmatch(fields.enc or "", "[^,]+") do
    table.insert(run.encounters, { id = tonumber(encounterId), success = true })
  end
  for entry in string.gmatch(fields.p or "", "[^,]+") do
    local name, class, role, deaths, present, inGuild = string.match(entry, "^([^:]*):([^:]*):([^:]*):([^:]*):([^:]*):([^:]*)$")
    name = name and ns.normalizeName(name)
    if name then
      run.players[name] = {
        class = class ~= "" and class or nil, role = role ~= "" and role or nil,
        deaths = tonumber(deaths), addon = deaths ~= "?", presentSec = tonumber(present) or 0, inGuild = inGuild == "1"
      }
    end
  end
  return run
end
dungeon.serialize = serialize
dungeon.deserialize = deserialize

-- A run someone else reported: keep it, or merge into our copy (more
-- reporters = more trust; deaths take the highest count anyone saw).
local function storePeerRun(run, sender)
  local d = db()
  if not d or not run.id then return end
  local existing = d.runs[run.id]
  if not existing then
    run.reporters = { [sender] = true }
    d.runs[run.id] = run
    if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
    return
  end
  existing.reporters = existing.reporters or {}
  existing.reporters[sender] = true
  for name, player in pairs(run.players) do
    local mine = existing.players[name]
    if not mine then existing.players[name] = player
    elseif player.deaths and (not mine.deaths or player.deaths > mine.deaths) then mine.deaths = player.deaths; mine.addon = true end
  end
  if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, existing) end
end

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local function run_recorder(run) return run and run.recorder end

-- Is `name` the leader of your party or raid?
local function leaderIs(name)
  if not UnitIsGroupLeader then return false end
  for _, member in ipairs(compat.groupMembers()) do
    if member.name == name then
      local ok, leader = pcall(UnitIsGroupLeader, member.unit)
      return ok and leader == true
    end
  end
  return false
end

local function onAddonMessage(text, sender)
  local d = db()
  local run = d and d.current
  local kind = string.match(text, "^(%u+)|")
  if kind == "HELLO" then
    if not dungeon.addonUsers[sender] then
      dungeon.addonUsers[sender] = true
      sayHello(true)
    end
    if run and run.players[sender] then run.players[sender].addon = true; run.players[sender].deaths = run.players[sender].deaths or 0 end
  elseif kind == "START" then
    local id, instanceId = string.match(text, "^START|([^|]+)|(%d+)$")
    dungeon.addonUsers[sender] = true
    -- Adopt the id of a recorder that sorts before ours, so the group ends
    -- up with a single run id.
    if run and not TERMINAL[run.state] and tonumber(instanceId) == run.instanceId and id ~= run.id and sender < (run.recorder or me()) then
      run.id = id
      run.recorder = sender
      save(run)
    end
  elseif kind == "ACTIVE" then
    local id, startedAt = string.match(text, "^ACTIVE|([^|]+)|(%d+)$")
    startedAt = tonumber(startedAt)
    -- A start time before this run was even detected (or in the future) is not believed.
    if run and run.id == id and startedAt and startedAt >= (run.detectedAt or 0) - 600 and startedAt <= now() + 60 then
      if run.state == "STARTING" then activate(startedAt)
      elseif run.state == "ACTIVE" and startedAt and startedAt < (run.startedAt or math.huge) then run.startedAt = startedAt; save(run) end
    end
  elseif kind == "DEATH" then
    local id, name, count = string.match(text, "^DEATH|([^|]+)|([^|]+)|(%d+)$")
    name = ns.normalizeName(name)
    local target = (run and run.id == id) and run or (d and d.runs[id or ""])
    if target and name == sender then
      local player = target.players[name] or { presentSec = 0 }
      target.players[name] = player
      player.addon = true
      player.deaths = math.max(player.deaths or 0, tonumber(count) or 0)
    end
  elseif kind == "END" then
    local id, state, endedAt, reason = string.match(text, "^END|([^|]+)|(%u+)|(%d+)|(.*)$")
    -- Only the run's recorder or the group leader can end the run for everyone, and only
    -- with an end time that makes sense (after the start, not in the future). Anyone else's
    -- END is ignored; their own client still records the run the normal way.
    local trusted = sender == run_recorder(run) or leaderIs(sender)
    local stamp = tonumber(endedAt)
    local sane = stamp and stamp <= now() + 60 and stamp >= ((run and (run.startedAt or run.detectedAt)) or 0)
    if run and run.id == id and trusted and sane and not TERMINAL[run.state] and (state == "COMPLETED" or state == "ABANDONED") then
      run.state = state
      run.endedAt = tonumber(endedAt)
      if state == "COMPLETED" then run.completedBy = reason else run.endReason = reason end
      if state == "COMPLETED" and not run.startedAt then run.startedAt = run.detectedAt end
      finalize(run)
    end
  elseif kind == "SUM" then
    local id, index, total, payload = string.match(text, "^SUM|([^|]+)|(%d+)|(%d+)|(.*)$")
    index, total = tonumber(index), tonumber(total)
    if not id or not index or not total or total > 20 then return end
    local key = sender .. id
    local pending = dungeon.incoming[key] or { parts = {}, count = 0, total = total }
    dungeon.incoming[key] = pending
    if not pending.parts[index] then pending.parts[index] = payload; pending.count = pending.count + 1 end
    if pending.count >= pending.total then
      dungeon.incoming[key] = nil
      local peer = deserialize(id, table.concat(pending.parts))
      -- Only someone who was in the run can report it, and not with times in the future.
      if peer and peer.players[sender] and not ns.util.tooFarAhead(peer.endedAt or 0)
        and not ns.util.tooFarAhead(peer.startedAt or 0) then
        storePeerRun(peer, sender)
      end
    end
  end
end

local function onEvent(_, event, ...)
  local d = db()
  if event == "PLAYER_LOGIN" then
    ns.comm.register(PREFIX)
    return
  end
  if not d then return end
  if event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
    dungeon.markSynced()
    sayHello(false)
    evaluate()
  elseif event == "GROUP_ROSTER_UPDATE" then
    sayHello(false)
    if not compat.inGroup() and d.current and d.current.state == "ACTIVE" and not d.current.inside then
      finish("ABANDONED", "group disbanded")
    elseif d.current then
      updatePlayers(d.current)
      save(d.current)
    end
  elseif event == "PLAYER_REGEN_DISABLED" then
    local run = d.current
    if run and run.state == "STARTING" and run.inside then activate() end
  elseif event == "PLAYER_REGEN_ENABLED" then
    flush()
  elseif event == "ENCOUNTER_END" then
    local encounterId, name, _, _, success = ...
    local run = d.current
    if not run or TERMINAL[run.state] or ns.isSecret(encounterId) then return end
    if run.state == "STARTING" then activate() end
    table.insert(run.encounters, { id = tonumber(encounterId), name = (not ns.isSecret(name)) and name or nil, success = success == 1, at = now() })
    save(run)
    if success == 1 and run.finalEncounterId and tonumber(encounterId) == run.finalEncounterId then
      finish("COMPLETED", "final boss")
    end
  elseif event == "PLAYER_DEAD" then
    local run = d.current
    if run and run.state == "ACTIVE" then
      local mine = run.players[me()] or { presentSec = 0 }
      run.players[me()] = mine
      mine.addon = true
      mine.deaths = (mine.deaths or 0) + 1
      save(run)
      send(string.format("DEATH|%s|%s|%d", run.id, me(), mine.deaths))
    end
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, _, sender = ...
    if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or prefix ~= PREFIX then return end
    sender = ns.normalizeName(sender)
    if not sender or sender == me() then return end
    onAddonMessage(text, sender)
  end
end

-- ---------------------------------------------------------------------
-- Sync acknowledgement: the companion writes the run ids the bot accepted
-- into Standings.lua (GuildedDungeonAccepted); mark those synced and
-- forget them after 30 days.
-- ---------------------------------------------------------------------

function dungeon.markSynced()
  local d = db()
  if not d then return end
  local accepted = type(GuildedDungeonAccepted) == "table" and GuildedDungeonAccepted or {}
  for _, id in ipairs(accepted) do
    if d.runs[id] then d.runs[id].synced = true end
  end
  local cutoff = now() - KEEP_SYNCED_DAYS * 86400
  for id, run in pairs(d.runs) do
    if run.synced and (run.endedAt or run.detectedAt or 0) < cutoff then d.runs[id] = nil end
  end
end

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

local function canControl()
  return compat.isLeader() or ns.isOfficer() or not compat.inGroup()
end

local function status()
  local d = db()
  local run = d and d.current
  if not run then
    local pending, total = 0, 0
    for _, stored in pairs(d and d.runs or {}) do
      total = total + 1
      if not stored.synced then pending = pending + 1 end
    end
    ns.message(string.format("No dungeon run in progress. Saved runs: %d (%d waiting to reach Discord).", total, pending))
    return
  end
  local elapsed = run.startedAt and (now() - run.startedAt) or 0
  local kills = 0
  for _, encounter in ipairs(run.encounters) do if encounter.success then kills = kills + 1 end end
  ns.message(string.format("%s - %s%s - bosses %d%s - recorder %s", run.name or "?", run.state,
    run.state == "ACTIVE" and string.format(" %d:%02d", math.floor(elapsed / 60), elapsed % 60) or "",
    kills, run.bossCount and ("/" .. run.bossCount) or "", run.recorder or "?"))
end

local function check()
  local features = compat.features()
  local lines = {}
  for name, ok in pairs(features) do table.insert(lines, (ok and "OK " or "NO ") .. name) end
  table.sort(lines)
  ns.message("Dungeon tracking on this client: " .. table.concat(lines, ", "))
  local instance = compat.instance()
  if instance then
    local bosses = compat.dungeonBosses(instance.id)
    ns.message(string.format("Here: %s (id %s, %s, difficulty %s). Final boss from journal: %s", instance.name, tostring(instance.id),
      instance.type, tostring(instance.difficultyId), bosses and bosses[#bosses].name or "not available (use Complete)"))
  end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["dungeon"] = function(args)
  local action = string.lower(args[1] or "status")
  local d = db()
  if not d then return end
  if action == "status" then status()
  elseif action == "check" then check()
  elseif action == "start" then
    if not d.current then ns.message("Not in a tracked dungeon run.") return end
    if not canControl() then ns.message("Only the group leader or an officer can do that.") return end
    activate()
  elseif action == "complete" then
    if not canControl() then ns.message("Only the group leader or an officer can do that.") return end
    finish("COMPLETED", "manual")
  elseif action == "abandon" then
    if not canControl() then ns.message("Only the group leader or an officer can do that.") return end
    finish("ABANDONED", "manual")
  else
    ns.message("/guilded dungeon status | start | complete | abandon | check")
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded dungeon status | start | complete | abandon | check - dungeon runs")

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA", "GROUP_ROSTER_UPDATE",
  "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "ENCOUNTER_END", "PLAYER_DEAD", "CHAT_MSG_ADDON" }) do
  compat.registerEvent(frame, event)
end
frame:SetScript("OnEvent", function(...)
  if ns.moduleActive and not ns.moduleActive("dungeon") then return end -- /guilded modules
  local ok, err = pcall(onEvent, ...)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded dungeon: " .. tostring(err)) end
end)

-- Presence time and the abandon check, every 30 seconds while a run exists.
if C_Timer and C_Timer.NewTicker then
  C_Timer.NewTicker(TICK_SECONDS, function()
    if ns.moduleActive and not ns.moduleActive("dungeon") then return end
    local d = db()
    if d and d.current then pcall(evaluate) end
  end)
end
