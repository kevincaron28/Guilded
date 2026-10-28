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
  local observedElapsed = run.lastTick and math.max(0, stamp - run.lastTick) or 0
  local observationGap = observedElapsed > TICK_SECONDS * 2
  run.lastTick = stamp
  local inside = run.inside and run.state == "ACTIVE"
  local observations = {}
  for _, member in ipairs(compat.groupMembers()) do
    local player = run.players[member.name]
    if not player then
      player = { firstSeen = stamp, presentSec = 0 }
      run.players[member.name] = player
    end
    if member.level then
      player.level = math.max(player.level or member.level, member.level)
      player.minLevel = math.min(player.minLevel or member.level, member.level)
    end
    player.lastSeen = stamp
    player.class = member.class or player.class
    player.role = ns.util.dungeonRole(member.role) or ns.util.dungeonRole(player.role)
    if run.integrity then
      local seen = player.integrity or { knownSec = 0, unknownSec = 0, mixedRole = false, knownIntervals = {} }
      player.integrity = seen
      if run.state == "ACTIVE" then
        local role = ns.util.dungeonRole(member.role)
        if role and seen.lockedRole and role ~= seen.lockedRole then seen.mixedRole = true end
        if role and not seen.lockedRole then seen.lockedRole = role end
      end
      observations[member.name] = inside and compat.dungeonPresence(member.unit) == true
    end
    player.guid = member.guid or player.guid
    player.inGuild = member.inGuild or player.inGuild
    if member.name == me() then
      local identity = ns.getDb().character
      if identity and type(identity.spec) == "string" and identity.spec ~= "" then player.spec = identity.spec end
    end
    if dungeon.addonUsers[member.name] or member.name == me() then
      player.addon = true
      player.deaths = player.deaths or 0
    end
    if inside and member.online then player.presentSec = player.presentSec + elapsed end
  end
  if run.integrity then
    for name, player in pairs(run.players) do
      local seen = player.integrity
      if seen and run.state == "ACTIVE" then
        if not observationGap and observations[name] and player.knownInside then
          seen.knownIntervals = seen.knownIntervals or {}
          local intervals, began = seen.knownIntervals, stamp - observedElapsed
          local last = intervals[#intervals]
          if last and last[2] == began then
            last[2] = stamp; seen.knownSec = seen.knownSec + observedElapsed
          elseif observedElapsed > 0 and #intervals < 64 then
            intervals[#intervals + 1] = { began, stamp }; seen.knownSec = seen.knownSec + observedElapsed
          else seen.unknownSec = seen.unknownSec + observedElapsed end
        else seen.unknownSec = seen.unknownSec + observedElapsed end
      end
      player.knownInside = observations[name] == true
    end
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
    gameBuild = GetBuildInfo and tostring(select(2, GetBuildInfo())) or nil,
    interface = compat.interfaceVersion(),
    gameEdition = ns.util.gameEdition(),
    state = "DETECTED",
    recorder = recorder,
    instanceId = instance.id,
    name = instance.name,
    difficultyId = instance.difficultyId,
    difficultyName = instance.difficultyName,
    challengeMode = compat.challengeActive(),
    activeChallenge = compat.challengeInfo(),
    detectedAt = stamp,
    encounters = {},
    players = {},
    reporters = { [me()] = true },
    -- Map identity and zero boss kills do not prove a fresh instance copy.
    integrity = { version = 2, startWitness = "unknown", startTrigger = "unknown", continuous = true, observer = me(), detectedAt = stamp },
    inside = true
  }
  local bosses = compat.dungeonBosses(instance.id)
  if bosses and #bosses > 0 then
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
  -- Stay finished across zone notifications and /reload inside the same clear.
  if run.state == "COMPLETED" then d.completedInstanceId = run.instanceId end
  local summary = serialize(run)
  local chunks = {}
  for index = 1, #summary, CHUNK_BYTES do table.insert(chunks, string.sub(summary, index, index + CHUNK_BYTES - 1)) end
  for index, chunk in ipairs(chunks) do send(string.format("SUM|%s|%d|%d|%s", run.id, index, #chunks, chunk), "GUILD") end
  -- Dungeon scores (Scores.lua) learn from every finished run.
  if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
  -- Automatic results wait for a safe exit. The summary hook remains the manual reopen action.
  if ns.onDungeonResultReady then pcall(ns.onDungeonResultReady, run) end
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

local function activate(stamp, trigger)
  local d = db()
  local run = d and d.current
  if not run or run.state ~= "STARTING" then return end
  run.state = "ACTIVE"
  run.startedAt = stamp or now()
  run.startTrigger = trigger or "first combat"
  if run.integrity then
    run.integrity.startTrigger = run.startTrigger
    if run.startTrigger == "first combat" then run.integrity.combatAt = now() end
  end
  run.lastTick = run.startedAt
  updatePlayers(run)
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
  if not inDungeon or instance.id ~= d.completedInstanceId then d.completedInstanceId = nil end

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

  if inDungeon and instance.id ~= d.completedInstanceId then
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
    if encounter.success and encounter.id and encounter.kind ~= "npc" then table.insert(encounters, tostring(encounter.id)) end
  end
  local summary = table.concat({
    "v=" .. PROTOCOL_VERSION, "av=" .. clean(run.addonVersion), "st=" .. run.state,
    "gb=" .. clean(run.gameBuild or ""), "tr=" .. clean(run.startTrigger or ""),
    "api=" .. tostring(run.interface or ""), "ed=" .. clean(run.gameEdition or ""),
    "cm=" .. (run.challengeMode and "1" or "0"),
    "i=" .. tostring(run.instanceId or 0), "n=" .. clean(run.name), "d=" .. tostring(run.difficultyId or 0),
    "s=" .. tostring(run.startedAt or 0), "e=" .. tostring(run.endedAt or 0),
    "cb=" .. clean(run.completedBy or run.endReason or ""), "r=" .. clean(run.recorder),
    "enc=" .. table.concat(encounters, ","), "p=" .. table.concat(players, ",")
  }, ";")
  if run.challenge then
    local c = run.challenge
    summary = summary .. ";ch=" .. table.concat({ c.mapId, c.level, c.durationMs, c.timeLimitSec,
      c.onTime and "1" or "0", c.practiceRun and "1" or "0", c.eligibleForScore and "1" or "0",
      table.concat(c.affixIds or {}, ",") }, ":")
  end
  -- Optional fields keep older peers compatible and respect the 20-chunk limit.
  local specs, timeline = {}, {}
  for name, player in pairs(run.players) do
    if player.spec then specs[#specs + 1] = clean(name) .. ":" .. clean(player.spec) end
  end
  local levels = {}
  for name, player in pairs(run.players or {}) do
    if player.level and player.minLevel then levels[#levels + 1] = clean(name) .. ":" .. player.minLevel .. ":" .. player.level end
  end
  local levelData = ";lv=" .. table.concat(levels, ",")
  if #summary + #levelData <= CHUNK_BYTES * 20 then summary = summary .. levelData end
  local extra = ";sp=" .. table.concat(specs, ",")
  if #summary + #extra <= CHUNK_BYTES * 20 then summary = summary .. extra end
  for _, encounter in ipairs(run.encounters or {}) do
    if encounter.id and encounter.at then
      local row = table.concat({ encounter.id, clean(string.sub(encounter.name or "", 1, 100)), encounter.success and "1" or "0",
        encounter.at, encounter.startedAt or "" }, ":")
      if encounter.kind == "npc" then row = row .. ":npc" end
      local candidate = table.concat(timeline, ",") .. (#timeline > 0 and "," or "") .. row
      if #summary + #candidate + 4 > CHUNK_BYTES * 20 then break end
      timeline[#timeline + 1] = row
    end
  end
  if #timeline > 0 then summary = summary .. ";tl=" .. table.concat(timeline, ",") end
  if run.integrity then
    local observed, intervals, native = {}, {}, {}
    for name, player in pairs(run.players) do
      local p = player.integrity
      if p then observed[#observed + 1] = table.concat({ clean(name), p.knownSec, p.unknownSec, p.lockedRole or "", p.mixedRole and "1" or "0" }, ":") end
      if p and p.knownIntervals then
        local spans = {}
        for _, span in ipairs(p.knownIntervals) do spans[#spans + 1] = span[1] .. "." .. span[2] end
        intervals[#intervals + 1] = clean(name) .. ":" .. table.concat(spans, "/")
      end
    end
    for _, e in ipairs(run.encounters or {}) do if e.source == "native" and e.at then native[#native + 1] = e.id .. ":" .. e.at end end
    local extra = ";iv=2;iw=" .. clean(run.integrity.startWitness) .. ";ic=" .. (run.integrity.continuous and "1" or "0")
      .. ";io=" .. clean(run.integrity.observer) .. ";ie=" .. (run.integrity.detectedAt or "") .. ";ia=" .. (run.integrity.combatAt or "")
      .. ";it=" .. clean(run.integrity.startTrigger) .. ";ip=" .. table.concat(observed, ",")
      .. ";ix=" .. table.concat(intervals, ",") .. ";ns=" .. table.concat(native, ",") .. ";wa=" .. (run.integrity.witnessAt or "")
    if #summary + #extra <= CHUNK_BYTES * 20 then summary = summary .. extra end
  end
  return summary
end

local function deserialize(id, text)
  local fields = {}
  for key, value in string.gmatch(text, "([%a]+)=([^;]*)") do fields[key] = value end
  if tonumber(fields.v) ~= PROTOCOL_VERSION or not fields.st then return nil end
  local run = {
    id = id, protocolVersion = PROTOCOL_VERSION, addonVersion = fields.av, state = fields.st,
    gameBuild = fields.gb ~= "" and fields.gb or nil, startTrigger = fields.tr ~= "" and fields.tr or nil,
    interface = tonumber(fields.api), gameEdition = fields.ed ~= "" and fields.ed or nil,
    challengeMode = fields.cm == "1",
    instanceId = tonumber(fields.i), name = fields.n, difficultyId = tonumber(fields.d),
    startedAt = tonumber(fields.s) ~= 0 and tonumber(fields.s) or nil,
    endedAt = tonumber(fields.e) ~= 0 and tonumber(fields.e) or nil,
    recorder = fields.r, encounters = {}, players = {}, reporters = {}
  }
  if fields.ch and run.gameEdition == "retail" then
    local map, level, duration, limit, onTime, practice, eligible, affixes = string.match(fields.ch,
      "^(%d+):(%d+):(%d+):(%d+):([01]):([01]):([01]):([%d,]*)$")
    if map then
      run.challenge = { mapId = tonumber(map), level = tonumber(level), durationMs = tonumber(duration),
        timeLimitSec = tonumber(limit), onTime = onTime == "1", practiceRun = practice == "1",
        eligibleForScore = eligible == "1", affixIds = {} }
      for value in string.gmatch(affixes, "%d+") do
        if #run.challenge.affixIds >= 10 then run.challenge = nil; break end
        table.insert(run.challenge.affixIds, tonumber(value))
      end
    end
  end
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
        class = class ~= "" and class or nil, role = ns.util.dungeonRole(role),
        deaths = tonumber(deaths), addon = deaths ~= "?", presentSec = tonumber(present) or 0, inGuild = inGuild == "1"
      }
    end
  end
  if fields.tl and fields.tl ~= "" then
    local timeline = {}
    for entry in string.gmatch(fields.tl, "[^,]+") do
      local kind = string.sub(entry, -4) == ":npc" and "npc" or nil
      if kind then entry = string.sub(entry, 1, -5) end
      local bossId, name, success, at, startedAt = string.match(entry, "^(%d+):([^:]*):([01]):(%d+):(%d*)$")
      if bossId and #timeline < 100 then
        timeline[#timeline + 1] = { id = tonumber(bossId), kind = kind, name = name ~= "" and name or nil,
          success = success == "1", at = tonumber(at), startedAt = tonumber(startedAt) }
      end
    end
    if #timeline > 0 then run.encounters = timeline end
  end
  for entry in string.gmatch(fields.lv or "", "[^,]+") do
    local name, low, high = string.match(entry, "^([^:]+):(%d+):(%d+)$")
    name, low, high = name and ns.normalizeName(name), tonumber(low), tonumber(high)
    if name and run.players[name] and low and high and low >= 1 and high <= 100 and low <= high then
      run.players[name].minLevel, run.players[name].level = low, high
    end
  end
  for entry in string.gmatch(fields.sp or "", "[^,]+") do
    local name, spec = string.match(entry, "^([^:]+):([^:]+)$")
    name = name and ns.normalizeName(name)
    if name and run.players[name] then run.players[name].spec = string.sub(spec, 1, 40) end
  end
  if fields.iv == "2" and (fields.iw == "unknown" or fields.iw == "native-reset" and tonumber(fields.wa)) and (fields.ic == "1" or fields.ic == "0") then
    run.integrity = { version = 2, startWitness = fields.iw, witnessAt = tonumber(fields.wa), startTrigger = fields.it or "unknown", continuous = fields.ic == "1",
      observer = fields.io and ns.normalizeName(fields.io), detectedAt = tonumber(fields.ie), combatAt = tonumber(fields.ia) }
    for entry in string.gmatch(fields.ip or "", "[^,]+") do
      local name, known, unknown, role, mixed = string.match(entry, "^([^:]+):(%d+):(%d+):([^:]*):([01])$")
      name = name and ns.normalizeName(name)
      if name and run.players[name] then run.players[name].integrity = { knownSec = tonumber(known), unknownSec = tonumber(unknown), lockedRole = ns.util.dungeonRole(role), mixedRole = mixed == "1" } end
    end
    for entry in string.gmatch(fields.ix or "", "[^,]+") do
      local name, spans = string.match(entry, "^([^:]+):(.*)$")
      name = name and ns.normalizeName(name)
      local player = name and run.players[name]
      if player and player.integrity then
        player.integrity.knownIntervals = {}
        for a, b in string.gmatch(spans, "(%d+)%.(%d+)") do
          if #player.integrity.knownIntervals < 64 then table.insert(player.integrity.knownIntervals, { tonumber(a), tonumber(b) }) end
        end
      end
    end
    for id, at in string.gmatch(fields.ns or "", "(%d+):(%d+)") do
      for _, e in ipairs(run.encounters) do if e.id == tonumber(id) and e.at == tonumber(at) and not e.kind then e.source = "native" end end
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
  -- An officer may first receive an old client's summary with IDs only.
  local function coverage(encounters)
    local count = 0
    for _, boss in ipairs(encounters or {}) do if boss.at then count = count + 1 end end
    return count
  end
  -- Promote a complete source report, never attach a peer's native checkpoints
  -- to our own observer identity. Old clients/prototypes have no origin.
  local oldOrigin = existing.integrity and existing.integrity.observer
  local newOrigin = run.integrity and run.integrity.observer
  local compatible = existing.instanceId == run.instanceId and existing.difficultyId == run.difficultyId
    and existing.startedAt == run.startedAt and existing.endedAt == run.endedAt
  local contains = true
  for _, old in ipairs(existing.encounters or {}) do
    local found = false
    for _, incoming in ipairs(run.encounters or {}) do
      if incoming.id == old.id and incoming.kind == old.kind and incoming.success == old.success
        and (not old.at or incoming.at == old.at) and (old.source ~= "native" or incoming.source == "native") then found = true end
    end
    if not found then contains = false end
  end
  local nativeUpgrade = false
  for _, incoming in ipairs(run.encounters or {}) do
    if incoming.source == "native" then
      local known = false
      for _, old in ipairs(existing.encounters or {}) do if old.id == incoming.id and old.kind == incoming.kind and old.source == "native" then known = true end end
      if not known then nativeUpgrade = true end
    end
  end
  if compatible and contains and newOrigin and (not oldOrigin or oldOrigin == newOrigin)
    and (not oldOrigin or coverage(run.encounters) > coverage(existing.encounters) or nativeUpgrade) then
    run.reporters = existing.reporters
    -- Preserve the superseded raw copy locally for diagnosis, without recursively
    -- exporting it as another witness or resetting any run/season identifier.
    run.previousObservation = existing.previousObservation or { integrity = existing.integrity, encounters = existing.encounters, players = existing.players }
    d.runs[run.id] = run
    if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
    return
  end
  if not existing.integrity and coverage(run.encounters) > coverage(existing.encounters) then existing.encounters = run.encounters end
  for name, player in pairs(run.players) do
    local mine = existing.players[name]
    if mine and player.level then mine.level = math.max(mine.level or player.level, player.level) end
    if mine and player.minLevel then mine.minLevel = math.min(mine.minLevel or player.minLevel, player.minLevel) end
    if mine and not mine.spec and player.spec then mine.spec = player.spec end
    if not mine then
      local copied = {}
      for field, value in pairs(player) do if field ~= "integrity" then copied[field] = value end end
      -- A relayed player's intervals were not observed by this report's author.
      if existing.integrity then copied.integrity = { knownSec = 0, unknownSec = existing.durationSec or 0, knownIntervals = {}, mixedRole = false } end
      existing.players[name] = copied
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
    if run and run.players[sender] and run.id == id and startedAt and startedAt >= (run.detectedAt or 0) - 600 and startedAt <= now() + 60 then
      if run.state == "STARTING" then activate(startedAt, "peer")
      elseif run.state == "ACTIVE" and startedAt and startedAt < (run.startedAt or math.huge) then
        local gap = run.startedAt - startedAt
        run.startedAt = startedAt; run.startTrigger = "peer"
        if run.integrity then
          run.integrity.startTrigger = "peer"
          for _, p in pairs(run.players) do
            if p.integrity then p.integrity.unknownSec = p.integrity.unknownSec + gap end
          end
        end
        save(run)
      end
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
      if state == "COMPLETED" and run.integrity and run.integrity.observer then d.peerCompletedRunId = run.id end
      finalize(run)
    end
  elseif kind == "REQUEST" and ns.isOfficerName and ns.isOfficerName(sender) then
    dungeon.replayPending()
  elseif kind == "SUM" then
    local id, index, total, payload = string.match(text, "^SUM|([^|]+)|(%d+)|(%d+)|(.*)$")
    index, total = tonumber(index), tonumber(total)
    if not id or not index or not total or total < 1 or total > 20 or index < 1 or index > total then return end
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

local function recordEncounter(run, encounterId, name, success, kind)
  local stamp = now()
  local active = run.activeEncounter
  -- Clients can emit both END and BOSS_KILL for the same kill, in either order.
  for index = #run.encounters, 1, -1 do
    local previous = run.encounters[index]
    if success and previous.success and previous.at and math.abs(stamp - previous.at) <= 10
      and (previous.id == encounterId and previous.kind == kind
        or ns.dungeonRoutes and ns.dungeonRoutes.sameBoss(run.instanceId, run.difficultyId, previous, encounterId, kind)) then
      if previous.kind == "npc" and not kind then
        previous.id, previous.kind = encounterId, nil
        previous.source = "native"
        previous.name = name or previous.name
        save(run)
      end
      run.activeEncounter = nil
      return
    end
  end
  if #run.encounters < 100 then
    table.insert(run.encounters, { id = encounterId, kind = kind, source = kind == "npc" and "combat-log" or "native", name = name, success = success, at = stamp,
      startedAt = active and active.id == encounterId and active.startedAt or nil })
  end
  run.activeEncounter = nil
  save(run)
end

-- A peer END can arrive just before this client's native final-boss event.
-- Retain that real local event without reopening the run or announcing it twice.
local function lateNativeCompletion(encounterId, name)
  local d, instance = db(), compat.instance()
  local run = d and d.peerCompletedRunId and d.runs[d.peerCompletedRunId]
  if not run or not instance or instance.type ~= "party" or instance.id ~= run.instanceId
    or ns.isSecret(encounterId) or not tonumber(encounterId) or not run.endedAt or math.abs(now() - run.endedAt) > 5 then return end
  if not (run.finalEncounterId == tonumber(encounterId) or compat.isDungeonFinalBoss(run.instanceId, encounterId, name, run.difficultyId)) then return end
  local gap = math.max(0, now() - run.endedAt)
  run.endedAt = math.max(run.endedAt, now()); run.durationSec = run.endedAt - run.startedAt
  for _, p in pairs(run.players) do if p.integrity then p.integrity.unknownSec = p.integrity.unknownSec + gap end end
  recordEncounter(run, tonumber(encounterId), not ns.isSecret(name) and name or nil, true)
  d.current = nil; d.peerCompletedRunId = nil
  if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
end

local function onEvent(_, event, ...)
  local d = db()
  if event == "PLAYER_LOGIN" then
    if d and d.current and d.current.integrity and d.current.state == "ACTIVE" then
      -- Keep the original wall clock across reloads. The unobserved interval
      -- cannot earn presence, but a reload alone does not prove a reset.
      local gap = math.max(0, now() - (d.current.lastTick or now()))
      for _, p in pairs(d.current.players) do
        if p.integrity then p.integrity.unknownSec = p.integrity.unknownSec + gap end
      end
      d.current.lastTick = now()
      for _, p in pairs(d.current.players) do p.knownInside = false end
    end
    ns.comm.register(PREFIX)
    if C_Timer then C_Timer.After(30, function()
      dungeon.markSynced()
      dungeon.replayPending()
      if ns.isOfficer and ns.isOfficer() then send("REQUEST|1", "GUILD") end
    end) end
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
    if run and run.state == "ACTIVE" and run.inside and run.integrity and not run.integrity.combatAt then run.integrity.combatAt = now() end
    if run and run.state == "STARTING" and run.inside then activate() end
  elseif event == "PLAYER_REGEN_ENABLED" then
    flush()
  elseif event == "CHALLENGE_MODE_START" then
    local instance = compat.instance()
    if not instance or instance.type ~= "party" then return end
    -- Inserting a new key starts a fresh attempt in the same instance.
    if d.current and d.current.state == "ACTIVE" then finish("ABANDONED", "challenge restarted") end
    d.current = nil
    d.completedInstanceId = nil
    evaluate()
    if d.current then
      d.current.challengeMode = true
      d.current.activeChallenge = compat.challengeInfo()
      activate(nil, "challenge start")
    end
  elseif event == "CHALLENGE_MODE_RESET" then
    if d.current and d.current.challengeMode then finish("ABANDONED", "challenge reset") end
  elseif event == "CHALLENGE_MODE_COMPLETED" then
    local run, instance = d.current, compat.instance()
    if run and run.challengeMode and run.state == "ACTIVE" and instance
      and instance.type == "party" and instance.id == run.instanceId then
      run.challenge = compat.challengeCompletion(run.activeChallenge)
      finish("COMPLETED", "challenge objectives")
    end
  elseif event == "ENCOUNTER_START" then
    local encounterId, name = ...
    local run, instance = d.current, compat.instance()
    if not run or TERMINAL[run.state] or not instance or instance.type ~= "party"
      or instance.id ~= run.instanceId or ns.isSecret(encounterId) or not tonumber(encounterId) then return end
    if run.state == "STARTING" then activate(nil, "encounter start") end
    if not run.activeEncounter or run.activeEncounter.id ~= tonumber(encounterId) then
      run.activeEncounter = { id = tonumber(encounterId), startedAt = now(), name = not ns.isSecret(name) and name or nil }
      save(run)
    end
  elseif event == "ENCOUNTER_END" then
    local encounterId, name, _, _, success = ...
    local run = d.current
    if not run and not ns.isSecret(success) and success == 1 then lateNativeCompletion(encounterId, name); return end
    local instance = compat.instance()
    if not run or TERMINAL[run.state] or not instance or instance.type ~= "party"
      or instance.id ~= run.instanceId or ns.isSecret(encounterId) or ns.isSecret(success) then return end
    if run.state == "STARTING" then activate(nil, "encounter end") end
    if not tonumber(encounterId) then return end
    recordEncounter(run, tonumber(encounterId), (not ns.isSecret(name)) and name or nil, success == 1)
    if success == 1 and not run.challengeMode and not compat.challengeActive() and ((run.finalEncounterId and tonumber(encounterId) == run.finalEncounterId)
      or compat.isDungeonFinalBoss(run.instanceId, encounterId, name, run.difficultyId)) then
      finish("COMPLETED", "final boss")
    end
  elseif event == "BOSS_KILL" then
    local run = d.current
    if not run then local encounterId, name = ...; lateNativeCompletion(encounterId, name); return end
    if not run or run.state ~= "ACTIVE" then return end
    local encounterId, name = ...
    if ns.isSecret(encounterId) or ns.isSecret(name) then return end
    local instance = compat.instance()
    if not instance or instance.type ~= "party" or instance.id ~= run.instanceId then return end
    if not tonumber(encounterId) then return end
    recordEncounter(run, tonumber(encounterId), name, true)
    if not run.challengeMode and not compat.challengeActive() and ((run.finalEncounterId and tonumber(encounterId) == run.finalEncounterId)
      or compat.isDungeonFinalBoss(run.instanceId, encounterId, name, run.difficultyId)) then
      finish("COMPLETED", "final boss")
    end
  elseif event == "COMBAT_LOG_EVENT_UNFILTERED" then
    -- Never register or read combat logs on Retail or Forever (restricted APIs).
    local edition = ns.util.gameEdition()
    if edition ~= "classic-era" and edition ~= "classic-tbc" and edition ~= "classic-mists" then return end
    local run, instance = d.current, compat.instance()
    if not run or run.state ~= "ACTIVE" or not instance or instance.type ~= "party"
      or instance.id ~= run.instanceId or not CombatLogGetCurrentEventInfo then return end
    local _, subevent, _, _, _, _, _, guid, name = CombatLogGetCurrentEventInfo()
    if subevent ~= "UNIT_DIED" or type(guid) ~= "string" then return end
    local npcId = tonumber(string.match(guid, "^Creature%-%d+%-%d+%-%d+%-%d+%-(%d+)%-"))
    if not npcId or not ns.dungeonRoutes.knownNpc(run.instanceId, run.difficultyId, npcId) then return end
    recordEncounter(run, npcId, name, true, "npc")
    if not run.challengeMode and ns.dungeonRoutes.sourceFinal(run.instanceId, run.difficultyId, nil, npcId) then
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
    local prefix, text, channel, sender = ...
    if not ns.comm.accept(prefix, text, channel, sender, PREFIX) then return end
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

-- Retry only our own recent unsynced runs. An officer arriving later can request
-- them; the server's run id makes a repeated upload idempotent.
function dungeon.replayPending()
  if dungeon.lastReplay and now() - dungeon.lastReplay < 60 then return end
  dungeon.lastReplay = now()
  local d = db()
  local runs = {}
  for _, run in pairs(d and d.runs or {}) do
    if not run.synced and run.players and run.players[me()] and TERMINAL[run.state]
      and (run.endedAt or 0) >= now() - 7 * 86400 then runs[#runs + 1] = run end
  end
  table.sort(runs, function(a, b) return (a.endedAt or 0) > (b.endedAt or 0) end)
  for index = 1, math.min(5, #runs) do
    local run = runs[index]
    local summary = serialize(run)
    local total = math.ceil(#summary / CHUNK_BYTES)
    if total <= 20 then
      for part = 1, total do
        send(string.format("SUM|%s|%d|%d|%s", run.id, part, total, string.sub(summary, (part - 1) * CHUNK_BYTES + 1, part * CHUNK_BYTES)), "GUILD")
      end
    end
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
    kills, run.bossCount and ("/" .. run.bossCount) or "", ns.displayName(run.recorder or "?")))
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
  elseif action == "results" then
    local latest
    for _, run in pairs(d.runs) do
      if run.players and run.players[me()] and (not latest or (run.endedAt or 0) > (latest.endedAt or 0)) then latest = run end
    end
    if latest and ns.onDungeonSummary then ns.onDungeonSummary(latest)
    else ns.message(ns.L and ns.L("No saved dungeon result yet.") or "No saved dungeon result yet.") end
  elseif action == "check" then check()
  elseif action == "start" then
    if not d.current then ns.message("Not in a tracked dungeon run.") return end
    if not canControl() then ns.message("Only the group leader or an officer can do that.") return end
    activate(nil, "manual")
  elseif action == "complete" then
    if not canControl() then ns.message("Only the group leader or an officer can do that.") return end
    finish("COMPLETED", "manual")
  elseif action == "abandon" then
    if not canControl() then ns.message("Only the group leader or an officer can do that.") return end
    finish("ABANDONED", "manual")
  else
    ns.message("/guilded dungeon status | results | start | complete | abandon | check")
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded dungeon status | results | start | complete | abandon | check - dungeon runs")

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA", "GROUP_ROSTER_UPDATE",
  "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "ENCOUNTER_END", "PLAYER_DEAD", "CHAT_MSG_ADDON" }) do
  compat.registerEvent(frame, event)
end
local clientEdition = ns.util.gameEdition()
if clientEdition == "classic-era" or clientEdition == "classic-tbc" or clientEdition == "classic-mists" then
  compat.registerEvent(frame, "COMBAT_LOG_EVENT_UNFILTERED", true)
end
-- Do not probe restricted combat-log events on Retail/Forever: even pcall(RegisterEvent) can
-- raise Blizzard's blocked-action popup during addon loading.
compat.registerEvent(frame, "BOSS_KILL", true)
compat.registerEvent(frame, "ENCOUNTER_START", true)
compat.registerEvent(frame, "CHALLENGE_MODE_START", true)
compat.registerEvent(frame, "CHALLENGE_MODE_RESET", true)
compat.registerEvent(frame, "CHALLENGE_MODE_COMPLETED", true)
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
