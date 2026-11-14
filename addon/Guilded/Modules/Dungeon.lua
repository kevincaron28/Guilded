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
local dungeon = { addonUsers = {}, outbox = {}, incoming = {}, lastHello = 0, acked = {},
  stats = { acksSent = 0, acksHeard = 0, pruned = 0 } }
ns.dungeon = dungeon

local TERMINAL = { COMPLETED = true, ABANDONED = true, INVALID = true, ERROR = true }
-- (9.0) Guildmates' runs nobody's bot confirmed are dropped after this long (the bot takes
-- relayed runs up to 30 days old, so older copies can never reach it).
local KEEP_PEER_DAYS = 45
local REPLAY_DAYS = 30
local REPLAY_RUNS = 10
-- The note a 9.1.3 bot gave an unsigned companion for a guildmate's run it refused (see markSynced).
local NOT_THIS_PC = "Not one of this PC's characters"

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
-- Member-facing text through the locale table when it is loaded (Locale.lua comes before this file).
local function T(text) return ns.L and ns.L(text) or text end

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
    -- (9.0) Guild summaries wait until the player is outside: guild messages from inside an
    -- instance are unreliable, and nobody in the guild needs them before the group leaves.
    if channel then ns.comm.send(PREFIX, message.text, channel, nil, nil, channel == "GUILD" and "hold-in-instance" or nil, message.onLost) end
  end
end

-- channel "GROUP" = party/raid at send time, or "GUILD".
local function send(text, channel, onLost)
  table.insert(dungeon.outbox, { text = text, channel = channel or "GROUP", onLost = onLost })
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
    -- (9.3) The guild the game reports for this player; kept when it is unknown for a moment (out of range).
    if member.guild then player.guild = member.guild end
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

-- Death positions (9.1): where in the dungeon the group fell, for the death map on the run card.
-- Each client records its OWN death (position of the player unit) and tells the group with a separate
-- DPOS message, so older clients that do not know it simply ignore it. Positions are thousandths (0..1000)
-- of the map, per uiMapID; at most MAX_DEATH_POINTS per run. Unknown positions (indoor maps that return
-- nothing or 0,0) are never recorded.
local MAX_DEATH_POINTS = 60
local function playerPosition()
  if not (C_Map and C_Map.GetBestMapForUnit and C_Map.GetPlayerMapPosition) then return nil end
  local okMap, mapId = pcall(C_Map.GetBestMapForUnit, "player")
  if not okMap or type(mapId) ~= "number" or ns.isSecret(mapId) or mapId <= 0 then return nil end
  local okPos, position = pcall(C_Map.GetPlayerMapPosition, mapId, "player")
  if not okPos or type(position) ~= "table" or not position.GetXY then return nil end
  local okXY, x, y = pcall(position.GetXY, position)
  if not okXY or type(x) ~= "number" or type(y) ~= "number" or ns.isSecret(x) or ns.isSecret(y) then return nil end
  if x < 0 or x > 1 or y < 0 or y > 1 or (x == 0 and y == 0) then return nil end
  return math.floor(x * 1000 + 0.5), math.floor(y * 1000 + 0.5), mapId
end
local function addDeathPoint(run, name, x, y, mapId)
  if type(run) ~= "table" or type(name) ~= "string" then return false end
  x, y, mapId = tonumber(x), tonumber(y), tonumber(mapId)
  if not x or not y or not mapId or x < 0 or x > 1000 or y < 0 or y > 1000 or mapId <= 0 or mapId > 100000 then return false end
  run.deathPoints = run.deathPoints or {}
  if #run.deathPoints >= MAX_DEATH_POINTS then return false end
  table.insert(run.deathPoints, { name = name, x = math.floor(x) / 1000, y = math.floor(y) / 1000, map = math.floor(mapId) })
  return true
end

-- Traced dungeon maps (9.2): while a run is active inside an instance, a light breadcrumb of where the player walked, so the
-- bot can draw an accurate outline of each dungeon floor in the same coordinates as the death positions. Positions are snapped
-- to a TRACE_GRID x TRACE_GRID grid of the floor's map (uiMapID) and kept only as a set of cells per floor: no timestamps, no
-- order. Short steps between two samples are filled in a straight line (a long jump, a teleport or a floor change never draws a
-- corridor). At most MAX_TRACE_CELLS per run. Stored as run.trace = { { map = id, cells = "key,key,..." } } (key = cx * grid + cy)
-- so SavedVariables and the companion read it simply. Only the recorder's own export uploads it; nothing is sent to the group.
-- On by default; members turn it off with /guilded maptrace off.
local TRACE_GRID, MAX_TRACE_CELLS, TRACE_SECONDS, TRACE_MAX_STEP = 200, 600, 1.5, 12
local traceSets, lastTrace = {}, nil
local function traceOn()
  local s = ns.getSettings and ns.getSettings()
  return not (s and (s.dungeonTrace == false or s.mapShare == false))
end
local function traceEntry(run, mapId)
  run.trace = run.trace or {}
  for _, entry in ipairs(run.trace) do if entry.map == mapId then return entry end end
  local entry = { map = mapId, cells = "" }
  table.insert(run.trace, entry)
  return entry
end
local function traceCount(run)
  local count = 0
  for _, entry in ipairs(run.trace or {}) do for _ in string.gmatch(entry.cells or "", "%d+") do count = count + 1 end end
  return count
end
local function addTraceCell(run, mapId, cx, cy)
  if cx < 0 or cy < 0 or cx >= TRACE_GRID or cy >= TRACE_GRID then return false end
  local id = tostring(run.id) .. ":" .. mapId
  local set = traceSets[id]
  local entry = traceEntry(run, mapId)
  if not set then
    set = {}
    for key in string.gmatch(entry.cells or "", "%d+") do set[tonumber(key)] = true end
    traceSets[id] = set
  end
  local key = cx * TRACE_GRID + cy
  if set[key] then return true end
  run.traceCount = run.traceCount or traceCount(run)
  if run.traceCount >= MAX_TRACE_CELLS then return false end
  set[key] = true
  entry.cells = entry.cells == "" and tostring(key) or (entry.cells .. "," .. key)
  run.traceCount = run.traceCount + 1
  return true
end
-- One breadcrumb sample (called by a ticker every TRACE_SECONDS; tests call it directly).
local function traceSample()
  local d = db()
  local run = d and d.current
  if not run or run.state == "INVALID" or not traceOn() or not (ns.util and ns.util.inInstance and ns.util.inInstance()) then lastTrace = nil; return false end
  local x, y, mapId = playerPosition()
  if not x then return false end
  local cx = math.min(TRACE_GRID - 1, math.floor(x * TRACE_GRID / 1000))
  local cy = math.min(TRACE_GRID - 1, math.floor(y * TRACE_GRID / 1000))
  local last = lastTrace
  if last and last.run == run.id and last.map == mapId then
    local dx, dy = cx - last.cx, cy - last.cy
    local steps = math.max(math.abs(dx), math.abs(dy))
    if steps > 1 and steps <= TRACE_MAX_STEP then
      for i = 1, steps - 1 do addTraceCell(run, mapId, last.cx + math.floor(dx * i / steps + 0.5), last.cy + math.floor(dy * i / steps + 0.5)) end
    end
  end
  addTraceCell(run, mapId, cx, cy)
  lastTrace = { run = run.id, map = mapId, cx = cx, cy = cy }
  return true
end
ns.dungeonTrace = { sample = traceSample, grid = TRACE_GRID, maxCells = MAX_TRACE_CELLS, enabled = traceOn }

local function save(run)
  local d = db()
  if d then d.current = run end
end

local serialize

-- (9.3) Never silent: a run that ended ABANDONED after bosses died will not count, and the member is told
-- once why and what to do. A compact diagnostic (dungeon, instance id, last kills, how the final boss is
-- known) is saved on the run and goes to the bot with it, so a final boss the addon does not know can be
-- found from production instead of guessed. Only ids and boss names; nothing about people.
local function diagText(value, max) return string.sub((string.gsub(tostring(value or ""), "[|;:,=\r\n]", " ")), 1, max) end
local function explainAbandoned(run)
  if run.state ~= "ABANDONED" or run.explained then return end
  local kills = {}
  for _, encounter in ipairs(run.encounters or {}) do
    if encounter.success and not encounter.kind and tonumber(encounter.id) then kills[#kills + 1] = encounter end
  end
  if #kills == 0 then return end
  run.explained = true
  local how = "unknown"
  if run.finalEncounterId then how = "journal"
  elseif compat.dungeonFinalKnown and compat.dungeonFinalKnown(tonumber(run.instanceId)) then how = "table" end
  local last = {}
  for index = math.max(1, #kills - 2), #kills do last[#last + 1] = tostring(tonumber(kills[index].id)) .. "/" .. diagText(kills[index].name, 30) end
  run.diagnostic = string.sub(string.format("i=%s;d=%s;ed=%s;k=%d;f=%s;last=%s;why=%s", tostring(tonumber(run.instanceId) or 0),
    tostring(tonumber(run.difficultyId) or 0), diagText(run.gameEdition, 20), #kills, how, table.concat(last, "+"), diagText(run.endReason, 30)), 1, 240)
  if run.endReason == "manual" then return end
  -- One line per session at most: a login that finishes several old runs must not flood the chat.
  if dungeon.explainedThisSession then return end
  dungeon.explainedThisSession = true
  local command = ns.standalone and "/gdungeons check" or "/guilded dungeon check"
  ns.message(string.format(T("This dungeon run (%s) ended before its final boss was killed (%d boss(es) down), so it will not count. If you did kill the final boss, type %s and tell an officer what it says."),
    tostring(run.name or "?"), #kills, command))
end

dungeon.explain = explainAbandoned

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
  pcall(dungeon.sendRun, run)
  -- Dungeon scores (Scores.lua) learn from every finished run.
  if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
  -- Automatic results wait for a safe exit. The summary hook remains the manual reopen action.
  if ns.onDungeonResultReady then pcall(ns.onDungeonResultReady, run) end
  ns.message(string.format("Dungeon run %s: %s%s.", run.state, run.name or "?",
    run.durationSec and run.state == "COMPLETED" and string.format(" in %d:%02d", math.floor(run.durationSec / 60), run.durationSec % 60) or ""))
  pcall(explainAbandoned, run)
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
  -- Kills were recorded but none was recognised as the final boss: leave a trace (game ids and
  -- boss names only) so an unknown Forever dungeon id or name can be added to Compat.lua.
  -- (9.1.7) Kills were recorded but none was recognised as the final boss: leave a trace. Skipped only when the
  -- final boss is KNOWN (journal id or Compat) and the last successful kill is clearly not it (Wailing Caverns,
  -- 12 November: last kill Verdan, final boss Mutanus, group disbanded): that run is just unfinished. A last kill
  -- that IS the final boss but went unmatched (name variant, id mismatch) is exactly what the trace is for.
  if state == "ABANDONED" and ns.logDiagnostic then
    local last
    for _, encounter in ipairs(run.encounters or {}) do if encounter.success and not encounter.kind then last = encounter end end
    if last then
      local finalKnown = run.finalEncounterId ~= nil or (ns.compat and ns.compat.dungeonFinalKnown and ns.compat.dungeonFinalKnown(tonumber(run.instanceId)))
      local lastIsFinal = (run.finalEncounterId ~= nil and tonumber(last.id) == run.finalEncounterId)
        or (ns.compat and ns.compat.isForeverFinalBossName and ns.compat.isForeverFinalBossName(run.instanceId, last.name))
        or (ns.compat and ns.compat.isDungeonFinalBoss and ns.compat.isDungeonFinalBoss(run.instanceId, last.id, last.name, run.difficultyId))
      if not (finalKnown and not lastIsFinal) then
        pcall(ns.logDiagnostic, "DUNGEON_FINAL_UNMATCHED", string.format("instance %s (%s) last kill %s %s; abandoned: %s",
          tostring(run.instanceId), tostring(run.gameEdition), tostring(last.id), tostring(last.name), tostring(reason)))
      end
    end
  end
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
      -- (9.3) The Encounter Journal is skipped in combat and may not know the map right at the zone-in, so a run
      -- that started without its final boss id looks again on the next quiet ticks (the same rule as newRun).
      if not run.finalEncounterId and (run.bossLookups or 0) < 10 and not compat.inCombat() then
        run.bossLookups = (run.bossLookups or 0) + 1
        local bosses = compat.dungeonBosses(instance.id)
        if bosses and #bosses > 0 then
          run.bossCount = #bosses
          run.finalEncounterId = bosses[#bosses].id
        end
      end
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
    "i=" .. tostring(run.instanceId or 0), "n=" .. clean(run.name), "d=" .. tostring(run.difficultyId or 0),
    "s=" .. tostring(run.startedAt or 0), "e=" .. tostring(run.endedAt or 0),
    "cb=" .. clean(run.completedBy or run.endReason or ""), "r=" .. clean(run.recorder),
    "enc=" .. table.concat(encounters, ","), "p=" .. table.concat(players, ",")
  }, ";")
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
  -- (9.3) Last, so it never crowds out the timeline or the integrity data: each player's guild as the game reported
  -- it, so a guildmate's copy of the run carries it too.
  local guilds = {}
  for name, player in pairs(run.players) do
    if player.guild and player.guild ~= "" then guilds[#guilds + 1] = clean(name) .. ":" .. clean(string.sub(player.guild, 1, 40)) end
  end
  if #guilds > 0 then
    local guildData = ";gu=" .. table.concat(guilds, ",")
    if #summary + #guildData <= CHUNK_BYTES * 20 then summary = summary .. guildData end
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
  for entry in string.gmatch(fields.gu or "", "[^,]+") do
    local name, guild = string.match(entry, "^([^:]+):([^:]+)$")
    name = name and ns.normalizeName(name)
    if name and run.players[name] then run.players[name].guild = string.sub(guild, 1, 80) end
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

-- Recovery for runs that ended ABANDONED although the final boss was recorded (see dungeon.recoverRuns below).
-- A run is completed only from a saved, timestamped, successful kill of a boss that today's tables call final,
-- taken inside the run's own time span: the client's own native kill, or (9.3) the same kill in a guildmate's copy
-- of this run (storePeerRun adds it with viaPeer). Nothing else is invented; the end time becomes the kill.
local RECOVERY_VERSION = 1
local function recoverOne(run)
  if not (run.state == "ABANDONED" and run.startedAt and run.endedAt and run.gameEdition == ns.util.gameEdition()) then return false end
  local final
  for _, encounter in ipairs(run.encounters or {}) do
    if encounter.success and not encounter.kind and (encounter.source == "native" or encounter.viaPeer) and tonumber(encounter.id)
      and tonumber(encounter.at) and encounter.at > run.startedAt and encounter.at <= run.endedAt
      and ((run.finalEncounterId and tonumber(encounter.id) == run.finalEncounterId)
        or compat.isDungeonFinalBoss(run.instanceId, encounter.id, encounter.name, run.difficultyId)) then
      if not final or encounter.at > final.at then final = encounter end
    end
  end
  if not final then return false end
  local abandonedAt = run.endedAt
  run.state, run.endedAt, run.completedBy = "COMPLETED", final.at, "final boss"
  run.endReason, run.synced, run.diagnostic, run.explained = nil, nil, nil, nil
  run.recoveredFrom = { state = "ABANDONED", endedAt = abandonedAt, version = RECOVERY_VERSION, via = final.viaPeer }
  -- (9.3) A kill only a guildmate's copy vouched for: exported as such, never as this client's own native kill.
  run.peerConfirmed = final.viaPeer and true or nil
  run.durationSec = run.endedAt - run.startedAt
  -- Presence never exceeds the (shorter) run; observed intervals stop at the kill.
  for _, player in pairs(run.players or {}) do
    player.presentSec = math.min(player.presentSec or 0, run.durationSec)
    local seen = player.integrity
    if seen then
      local kept, known = {}, 0
      for _, span in ipairs(seen.knownIntervals or {}) do
        local from, to = span[1], math.min(span[2], run.endedAt)
        if from < to then kept[#kept + 1] = { from, to }; known = known + (to - from) end
      end
      seen.knownIntervals, seen.knownSec = kept, known
      seen.unknownSec = math.max(0, math.min(seen.unknownSec or 0, run.durationSec - known))
    end
  end
  if run.durationSec > 0 then
    if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
    return true
  end
  run.state, run.endedAt, run.completedBy, run.endReason, run.recoveredFrom, run.peerConfirmed = "ABANDONED", abandonedAt, nil, "left the dungeon", nil, nil
  run.durationSec = run.endedAt - run.startedAt
  return false
end

-- A run someone else reported: keep it, or merge into our copy (more
-- reporters = more trust; deaths take the highest count anyone saw).
local function storePeerRun(run, sender, delivery)
  local d = db()
  if not d or not run.id then return end
  local existing = d.runs[run.id]
  if not existing then
    run.reporters = { [sender] = true }
    -- (9.3.1) A run that only reached this PC through the group (a player outside the guild) is marked, so the bot can place it
    -- on the public boards instead of a guild's. A copy that comes through the guild later clears the mark.
    if delivery ~= nil and delivery ~= "GUILD" then
      -- Carried runs still waiting for the companion are limited in total and per sender (a stranger cannot fill the saved file,
      -- and the ones the companion already took do not count).
      local held, fromSender = 0, 0
      for _, other in pairs(d.runs) do
        if other.viaGroup and not other.groupSynced then
          held = held + 1
          if other.reporters and other.reporters[sender] then fromSender = fromSender + 1 end
        end
      end
      if held >= 100 or fromSender >= 10 then return end
      run.viaGroup = true
    end
    d.runs[run.id] = run
    if ns.onDungeonRunFinished then pcall(ns.onDungeonRunFinished, run) end
    return
  end
  existing.reporters = existing.reporters or {}
  existing.reporters[sender] = true
  -- A copy through the guild lets the run go to the guild too: the mark and the "carried" receipt are cleared, so it is sent again.
  if delivery == "GUILD" and existing.viaGroup then existing.viaGroup, existing.groupSynced = nil, nil end
  -- (9.3) Our copy ended ABANDONED but a guildmate who was in the same run reports it COMPLETED by the final
  -- boss: take their saved kill (inside our own run window, and a boss our tables call final) and recover.
  if existing.state == "ABANDONED" and run.state == "COMPLETED" and run.completedBy == "final boss"
    and existing.instanceId == run.instanceId and existing.players and existing.players[sender] and existing.startedAt and existing.endedAt then
    for _, kill in ipairs(run.encounters or {}) do
      if kill.success and not kill.kind and tonumber(kill.id) and tonumber(kill.at) and kill.at > existing.startedAt and kill.at <= existing.endedAt
        and ((existing.finalEncounterId and tonumber(kill.id) == existing.finalEncounterId)
          or compat.isDungeonFinalBoss(existing.instanceId, kill.id, kill.name, existing.difficultyId)) then
        existing.encounters = existing.encounters or {}
        local known = false
        for _, old in ipairs(existing.encounters) do
          if tonumber(old.id) == tonumber(kill.id) and old.success and not old.kind and old.at == kill.at then known = true end
        end
        if not known and #existing.encounters < 100 then
          table.insert(existing.encounters, { id = tonumber(kill.id), name = diagText(kill.name, 60), success = true, at = kill.at, viaPeer = sender })
        end
      end
    end
    if recoverOne(existing) and not dungeon.peerRecoveryNoticed then
      dungeon.peerRecoveryNoticed = true
      ns.message(string.format("Guilded recovered a dungeon run (%s) from a guildmate's copy: its final boss was killed; it uploads with your next sync.", tostring(existing.name or "?")))
    end
  end
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

local function onAddonMessage(text, sender, delivery)
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
    if target and name == sender and target.players[name] then
      local player = target.players[name]
      player.addon = true
      player.deaths = math.max(player.deaths or 0, tonumber(count) or 0)
    end
  elseif kind == "DPOS" then
    local id, name, x, y, mapId = string.match(text, "^DPOS|([^|]+)|([^|]+)|(%d+)|(%d+)|(%d+)$")
    name = name and ns.normalizeName(name)
    local target = (run and run.id == id) and run or (d and d.runs[id or ""])
    -- Only the player's own death position, only for a player already in that run.
    if target and name == sender and target.players[name] then addDeathPoint(target, name, x, y, mapId) end
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
  elseif kind == "ACK" then
    -- (9.0) A guildmate whose companion's bot already stored this run: stop replaying it at
    -- every login. Only our own copy is marked; the bot still dedupes by run id.
    local id = string.match(text, "^ACK|([^|]+)$")
    if id then dungeon.noteAck(id, sender, delivery) end
  elseif kind == "ACKS" then
    for _, id in ipairs(dungeon.listOf(text, "ACKS")) do dungeon.noteAck(id, sender, delivery) end
  elseif kind == "OFR" then
    dungeon.onOffer(text, sender, delivery)
  elseif kind == "WNT" then
    dungeon.onWant(text, sender, delivery)
  elseif kind == "SUM" then
    local id, index, total, payload = string.match(text, "^SUM|([^|]+)|(%d+)|(%d+)|(.*)$")
    index, total = tonumber(index), tonumber(total)
    if not id or not index or not total or total < 1 or total > 20 or index < 1 or index > total then return end
    if #id > 120 then return end
    -- (9.3) Guilded Dungeons keeps a guildmate's summary too (it only came from an authorized guild member, and the sender
    -- must be a player of the run it describes), so its companion can upload it as a heard run for a member with no
    -- companion. It does not forward copies (no catch-up module); unconfirmed copies are pruned after KEEP_PEER_DAYS.
    local count, senderCount = 0, 0
    for bufferKey, buffer in pairs(dungeon.incoming) do
      if not buffer.at or now() - buffer.at > 60 then dungeon.incoming[bufferKey] = nil
      else
        count = count + 1
        if buffer.sender == sender then senderCount = senderCount + 1 end
      end
    end
    local key = sender .. "|" .. id
    local pending = dungeon.incoming[key]
    if pending and pending.total ~= total then dungeon.incoming[key] = nil; return end
    if not pending and (count >= 64 or senderCount >= 4) then return end
    pending = pending or { parts = {}, count = 0, total = total, at = now(), sender = sender }
    -- (9.3) Every chunk renews the clock: a transfer slower than a minute overall is fine while chunks keep coming.
    pending.at = now()
    dungeon.incoming[key] = pending
    if not pending.parts[index] then pending.parts[index] = payload; pending.count = pending.count + 1 end
    if pending.count >= pending.total then
      dungeon.incoming[key] = nil
      local peer = deserialize(id, table.concat(pending.parts))
      -- Only someone who was in the run can report it, and not with times in the future.
      if peer and peer.players[sender] and not ns.util.tooFarAhead(peer.endedAt or 0)
        and not ns.util.tooFarAhead(peer.startedAt or 0) then
        local known = d and d.runs[id]
        -- (9.0) A replay of a run this PC's bot already stored: say so once, so the sender
        -- (a Guilded Dungeons-only player, or someone without the companion) stops replaying it.
        dungeon.markHeard(id, sender)
        if known and known.synced and not dungeon.ackedRecently(id) then
          dungeon.acked[id] = now()
          dungeon.stats.acksSent = dungeon.stats.acksSent + 1
          if delivery == "GUILD" then dungeon.guild("ack:" .. id, "ACK|" .. id) else dungeon.toGroup("ack:" .. id, "ACK|" .. id) end
        end
        storePeerRun(peer, sender, delivery)
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
    dungeon.loadedAt = now()
    if C_Timer then C_Timer.After(30, function()
      dungeon.markSynced()
      -- After markSynced: a recovered run is changed, so it must upload again.
      pcall(dungeon.recoverRuns)
      pcall(dungeon.remindWaiting)
      pcall(dungeon.remindGuildmateRuns)
      pcall(dungeon.noteOtherAddonVersion)
      dungeon.replayPending()
      if ns.isOfficer and ns.isOfficer() then dungeon.guild("request", "REQUEST|1") end
      -- (9.3) Offer the runs nobody confirmed, a random moment later so a whole guild logging in does not speak at once.
      dungeon.lastOnline = dungeon.onlineGuildmates()
      dungeon.scheduleOffer(10)
    end) end
    return
  end
  if not d then return end
  if event == "PLAYER_LOGOUT" then
    -- Logout and /reload both write the saved file the companion reads (overdueRuns).
    d.saveBeforeAt, d.lastSaveAt = d.lastSaveAt, now()
    return
  end
  if event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
    dungeon.markSynced()
    sayHello(false)
    evaluate()
  elseif event == "GROUP_ROSTER_UPDATE" then
    sayHello(false)
    pcall(dungeon.noteGroupChange)
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
    dungeon.flushAckNotices()
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
    if success == 1 and ((run.finalEncounterId and tonumber(encounterId) == run.finalEncounterId)
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
    if ((run.finalEncounterId and tonumber(encounterId) == run.finalEncounterId)
      or compat.isDungeonFinalBoss(run.instanceId, encounterId, name, run.difficultyId)) then
      finish("COMPLETED", "final boss")
    end
  elseif event == "PLAYER_DEAD" then
    local run = d.current
    if run and run.state == "ACTIVE" then
      local mine = run.players[me()] or { presentSec = 0 }
      run.players[me()] = mine
      mine.addon = true
      mine.deaths = (mine.deaths or 0) + 1
      local x, y, mapId = playerPosition()
      if x and addDeathPoint(run, me(), x, y, mapId) then
        send(string.format("DPOS|%s|%s|%d|%d|%d", run.id, me(), x, y, mapId))
      end
      save(run)
      send(string.format("DEATH|%s|%s|%d", run.id, me(), mine.deaths))
    end
  elseif event == "GUILD_ROSTER_UPDATE" then
    if ns.invalidateRoster then ns.invalidateRoster() end
    dungeon.noteOnline()
    -- Guild messages heard before the roster was loaded are handled now (see CHAT_MSG_ADDON below).
    local held = dungeon.early
    if held and (not ns.rosterReady or ns.rosterReady()) then
      dungeon.early = nil
      for _, item in ipairs(held) do
        if now() - item.at <= 120 then pcall(onEvent, nil, "CHAT_MSG_ADDON", item.prefix, item.text, item.channel, item.sender) end
      end
    end
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, channel, sender = ...
    -- (9.3) Right after login the guild roster may not be loaded yet, so no guildmate can be recognised: keep a guild message
    -- for a short while instead of refusing it (the standalone addon reads the game's roster; Guilded has its own saved one).
    if ns.rosterReady and not ns.rosterReady() and prefix == PREFIX and channel == "GUILD" and type(text) == "string"
      and not ns.isSecret(text) and not ns.isSecret(sender) then
      dungeon.holdEarly(prefix, text, channel, sender)
      return
    end
    if not ns.comm.accept(prefix, text, channel, sender, PREFIX, function(author, delivery)
      local kind = string.match(text, "^(%u+)|")
      if kind == "SUM" or kind == "ACK" or kind == "ACKS" or kind == "OFR" or kind == "WNT" then
        if delivery == "GUILD" then return ns.comm.authorized(author, "guild") end
        -- (9.3.1) The same run messages also travel in a party or raid, from players of any guild, to a player who carries them.
        return (delivery == "PARTY" or delivery == "RAID" or delivery == "INSTANCE_CHAT")
          and (kind ~= "SUM" or dungeon.canCarry()) and ns.comm.authorized(author, "group")
      end
      if kind == "REQUEST" then return delivery == "GUILD" and ns.comm.authorized(author, "guild") end
      return (delivery == "PARTY" or delivery == "RAID" or delivery == "INSTANCE_CHAT")
        and ns.comm.authorized(author, "group")
    end) then return end
    if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or prefix ~= PREFIX then return end
    sender = ns.normalizeName(sender)
    if not sender or sender == me() then return end
    onAddonMessage(text, sender, channel)
  end
end

-- ---------------------------------------------------------------------
-- Sync acknowledgement: the companion writes the run ids the bot received
-- into Standings.lua (GuildedDungeonAccepted); mark those synced and
-- forget them after 30 days. Since 9.0.8 the bot lists every run it received,
-- including a guildmate's copy of a run it already had and runs it refused,
-- and GuildedDungeonNotes says in a few words why a run earned nothing.
-- ---------------------------------------------------------------------

function dungeon.markSynced()
  local d = db()
  if not d then return end
  local accepted = type(GuildedDungeonAccepted) == "table" and GuildedDungeonAccepted or {}
  local notes = type(GuildedDungeonNotes) == "table" and GuildedDungeonNotes or nil
  -- (9.1.4) A 9.1.3 unsigned companion listed a guildmate's run it could not upload as received.
  -- No bot holds it: it is not synced, and nobody may be told it is (ACK, catch-up). Undo the
  -- marks saved then (the updated companion no longer lists those runs), and never set one again.
  for _, run in pairs(d.runs) do
    if run.syncNote == NOT_THIS_PC then run.synced, run.syncNote = nil, nil end
  end
  dungeon.hasCompanion() -- remembers that a companion has synced with this PC (the guildmate-run reminder needs it)
  for _, id in ipairs(accepted) do
    local carried = type(id) == "string" and string.sub(id, 1, 6) == "group:"
    if carried then
      -- (9.3.1) The companion took a run that only reached this PC through the group: it went to the public boards, not a guild.
      local viaGroupRun = d.runs[string.sub(id, 7)]
      if viaGroupRun and viaGroupRun.viaGroup then viaGroupRun.groupSynced = true end
    end
    local run = (not carried) and d.runs[id] or nil
    local note = notes and notes[id]
    if run and note ~= NOT_THIS_PC then
      run.synced = true
      -- Only a companion that writes notes (9.0.8+) may clear one.
      if notes then
        run.syncNote = type(note) == "string" and note ~= "" and string.sub(string.gsub(note, "|", ""), 1, 80) or nil
      end
    end
  end
  local cutoff = now() - KEEP_SYNCED_DAYS * 86400
  local peerCutoff = now() - KEEP_PEER_DAYS * 86400
  local mine = me()
  for id, run in pairs(d.runs) do
    local at = run.endedAt or run.detectedAt or 0
    -- (9.0) A copy a guildmate's bot confirmed (ACK or catch-up) ages out like a synced one; a
    -- guildmate's run nobody confirmed goes after 45 days. Our own unconfirmed runs stay.
    local confirmed = run.synced or run.syncedVia or run.groupSynced
    local ours = mine and run.players and run.players[mine]
    if (confirmed and at < cutoff) or (not confirmed and not ours and at < peerCutoff) then
      d.runs[id] = nil
      dungeon.stats.pruned = dungeon.stats.pruned + 1
    end
  end
  -- (9.3.1) The runs of a guild another character of this PC belongs to (parked in GuildedDB.otherGuilds) age out the same way: a
  -- synced one after the synced window, an unsent one when the companion would no longer read it. Said once, in neutral words.
  local root = GuildedDB
  local dropped = 0
  for _, parked in pairs(type(root) == "table" and type(root.otherGuilds) == "table" and root.otherGuilds or {}) do
    local parkedRuns = type(parked) == "table" and type(parked.dungeon) == "table" and parked.dungeon.runs or nil
    for id, run in pairs(type(parkedRuns) == "table" and parkedRuns or {}) do
      local at = type(run) == "table" and (run.endedAt or run.detectedAt) or 0
      if type(run) ~= "table" then parkedRuns[id] = nil
      elseif run.synced and at < cutoff then parkedRuns[id] = nil
      elseif not run.synced and at < peerCutoff then
        parkedRuns[id] = nil
        dropped = dropped + 1
      end
    end
  end
  if dropped > 0 then
    dungeon.parkedDropped = true
    dungeon.flushAckNotices()
  end
end

-- A run one of this PC's characters played (the character logged in, or one Guilded saw log in here).
local function playedHere(run)
  local players = type(run.players) == "table" and run.players or {}
  if players[me()] then return true end
  local d = ns.getDb and ns.getDb()
  for _, info in pairs(d and type(d.myCharacters) == "table" and d.myCharacters or {}) do
    local name = type(info) == "table" and ns.normalizeName(info.name)
    if name and players[name] then return true end
  end
  return false
end

-- (9.0.8) Finished runs no bot has confirmed yet: neither ours (synced) nor a guildmate's (syncedVia).
-- (9.1.4) A companion without Discord sign-in (GuildedCompanion.mode = "device") uploads only runs
-- this PC's characters played, so a guildmate's run is not waiting on this PC: it stays unconfirmed
-- for a signed-in guildmate's companion, and is not counted here.
function dungeon.waitingRuns()
  local d = db()
  local list = {}
  local deviceOnly = type(GuildedCompanion) == "table" and GuildedCompanion.mode == "device"
  for _, run in pairs(d and d.runs or {}) do
    if not run.synced and not run.syncedVia and not run.groupSynced and TERMINAL[run.state] and (not deviceOnly or playedHere(run)) then list[#list + 1] = run end
  end
  return list
end

-- (9.0.8) Runs the companion should already have delivered: saved to disk before the last save
-- (logout or /reload) with time for the companion to send them and bring the answer back before
-- this load. The companion answers within a minute, and Standings.lua is only read at load time.
local COMPANION_GRACE = 5 * 60
function dungeon.overdueRuns()
  local d = db()
  if not d then return {} end
  local last, before, loadedAt = tonumber(d.lastSaveAt), tonumber(d.saveBeforeAt), tonumber(dungeon.loadedAt) or now()
  local cutoff
  if last and loadedAt - last >= COMPANION_GRACE then cutoff = last
  elseif before and last and last - before >= COMPANION_GRACE then cutoff = before end
  local list = {}
  if not cutoff then return list end
  for _, run in ipairs(dungeon.waitingRuns()) do
    if (run.endedAt or 0) > 0 and run.endedAt < cutoff then list[#list + 1] = run end
  end
  return list
end

local function L(text) return ns.L and ns.L(text) or text end

-- (9.1) The three companion steps and the page link, one chat line each, for members who have no
-- companion running (also in the standalone Guilded Dungeons addon, which has no Home page).
local function sayCompanionSteps()
  local util = ns.util
  if not (util and util.companionSteps) then return end
  for _, line in ipairs(util.companionSteps()) do ns.message(line) end
  ns.message(util.COMPANION_PAGE)
end

-- (9.1.3) Guilded and Guilded Dungeons are one product with one version. Side by side at different
-- versions (an older Guilded Dungeons left behind by an update) Guilded alone records the runs, so
-- nothing breaks, but say so once per session: the companion updates both, or the member can remove
-- Guilded Dungeons, which Guilded replaces.
function dungeon.noteOtherAddonVersion(force)
  if ns.standalone then return false end
  local other
  if C_AddOns and C_AddOns.GetAddOnMetadata then other = select(2, pcall(C_AddOns.GetAddOnMetadata, "GuildedDungeons", "Version")) end
  if type(other) ~= "string" and GetAddOnMetadata then other = select(2, pcall(GetAddOnMetadata, "GuildedDungeons", "Version")) end
  local mine = compat.addonVersion()
  if type(other) ~= "string" or other == "" or other == mine then return false end
  if dungeon.otherVersionSaid and not force then return false end
  if dungeon.otherVersionSaid == other and force then return false end
  dungeon.otherVersionSaid = other
  ns.message(string.format(L("Guilded Dungeons %s is installed next to Guilded %s. Guilded records your runs; update Guilded Dungeons with the Guilded Companion (or remove it)."), other, tostring(mine)))
  return true
end

-- Once per session, after login or /reload: runs are waiting and the companion did not deliver them.
function dungeon.remindWaiting()
  if dungeon.waitingReminded then return false end
  if compat.inCombat() then dungeon.remindAfterCombat = true return false end
  local overdue = #dungeon.overdueRuns()
  if overdue == 0 then return false end
  dungeon.waitingReminded = true
  ns.message(string.format(L("%d dungeon run(s) have not reached Discord yet. Is the Guilded Companion app running on this PC? Start it from the Windows Start menu: it sends your runs when you /reload or log out."), overdue))
  sayCompanionSteps()
  return true
end

-- (9.0) Every saved run, for the catch-up module (Modules/CatchUp.lua).
function dungeon.savedRuns()
  local d = db()
  return d and d.runs or {}
end

-- (9.0) A run a guildmate forwarded during catch-up: stored exactly as if `reporter` (who was
-- in the run, checked by the caller) had sent it, plus who passed it on. Returns true when new.
function dungeon.storeForwarded(run, reporter, via)
  local d = db()
  if not d or not run or not run.id or not run.players or not run.players[reporter] then return false end
  local isNew = d.runs[run.id] == nil
  storePeerRun(run, reporter)
  if isNew and d.runs[run.id] then d.runs[run.id].forwardedBy = via end
  if isNew and ns.onDungeonChange then pcall(ns.onDungeonChange) end
  return isNew
end

-- Recovery for runs that ended ABANDONED although the client's own ENCOUNTER_END/BOSS_KILL
-- already recorded the final boss (8.4.4-8.4.6 did not know Forever's final-boss ids: a
-- Ragefire Chasm run with Bazzalan killed finished as ABANDONED). A run is completed only
-- from its own saved, timestamped, successful native kill of a boss that today's tables
-- call final, taken inside the run's own time span. Nothing else is invented: a run with
-- no such kill stays ABANDONED, and the end time becomes the kill, not the abandon time.
function dungeon.recoverRuns()
  local d = db()
  if not d then return 0 end
  local recovered = 0
  for _, run in pairs(d.runs) do
    if recoverOne(run) then recovered = recovered + 1 end
  end
  if recovered > 0 then
    ns.message(string.format("Guilded recovered %d dungeon run(s) whose final boss was killed; they upload with your next sync.", recovered))
    if ns.onDungeonChange then pcall(ns.onDungeonChange) end
  end
  return recovered
end

-- Retry only our own recent unsynced runs. An officer arriving later can request
-- them; the server's run id makes a repeated upload idempotent.
-- (9.1.4) 30 days and 10 runs (were 7 and 5): the bot takes a guildmate's relayed run up to 30
-- days old (guildmate-relay.ts), and a run no guildmate heard in its first week was lost for good.
function dungeon.replayPending()
  if dungeon.lastReplay and now() - dungeon.lastReplay < 60 then return end
  dungeon.lastReplay = now()
  local runs = dungeon.ownUnconfirmed()
  for index = 1, math.min(REPLAY_RUNS, #runs) do dungeon.sendRun(runs[index]) end
end

-- ---------------------------------------------------------------------
-- (9.3) Runs-only catch-up on the GuildedDgn prefix (both addons). The summary of a finished run goes to the guild once, at
-- its end, and again at login; a guildmate who comes online later never heard it, and the standalone addon has no catch-up
-- module. Now a player with runs nobody confirmed OFFERS their ids (OFR, at most OFFER_IDS, once per OFFER_EVERY seconds, at
-- login and when more guildmates are online); a holder whose bot has a run answers ACKS, a holder with a companion that lacks
-- it answers WNT, and the author re-sends only what was asked for (at most RESEND_RUNS runs a round). Every answer waits a
-- random moment and is dropped when someone else answered first, so one holder answers in a big guild. Same acceptance as
-- every GuildedDgn guild message (GUILD channel, authorized sender; a SUM still needs the sender to be in the run).
-- ---------------------------------------------------------------------
local OFFER_EVERY = 600
local OFFER_IDS = 5
local RESEND_RUNS = 3
local RESEND_COOLDOWN = 300
local RESEND_GAP_MAX = 14400
local ANSWER_IDS = 24
local OFFER_FROM_SENDER_EVERY = 240
local ACK_EXPIRE = 600
local SOLICIT_WINDOW = 900
local SLOW_REOFFER = 21600
local LATER_EVERY = 30
dungeon.offerSeen, dungeon.resentAt, dungeon.resendGap = {}, {}, {}
dungeon.solicited, dungeon.heard, dungeon.later = {}, {}, {}
dungeon.answers = { acks = {}, wants = {}, count = 0, scheduled = false }
dungeon.groupAnswers = { acks = {}, wants = {}, count = 0, scheduled = false }

-- (9.3) Guild traffic never queues while the player is inside an instance: the queue is one line per prefix, so a guild
-- message held back there would also hold back this player's own START, DEATH and END for the live run. It waits here instead
-- (one slot per kind of job, so this cannot grow) and runs when the player is outside again.
local function outside() return not (ns.util and ns.util.inInstance and ns.util.inInstance()) end
function dungeon.runLater()
  dungeon.laterScheduled = false
  if next(dungeon.later) == nil then return end
  if not outside() then
    if C_Timer and C_Timer.After then dungeon.laterScheduled = true; C_Timer.After(LATER_EVERY + math.random(0, 10), dungeon.runLater) end
    return
  end
  local list = dungeon.later
  dungeon.later = {}
  for _, job in pairs(list) do pcall(job) end
end
function dungeon.defer(key, job)
  dungeon.later[key] = job
  if not dungeon.laterScheduled and C_Timer and C_Timer.After then
    dungeon.laterScheduled = true
    C_Timer.After(LATER_EVERY + math.random(0, 10), dungeon.runLater)
  end
end

-- A companion has synced with this PC when its files exist with content (the empty Accepted.lua shipped with the addon is not one).
local function companionSeen()
  if type(GuildedCompanion) == "table" or type(GuildedLinkedMeta) == "table" then return true end
  if type(GuildedDungeonAccepted) == "table" and next(GuildedDungeonAccepted) ~= nil then return true end
  if type(GuildedDungeonNotes) == "table" and next(GuildedDungeonNotes) ~= nil then return true end
  return false
end
function dungeon.hasCompanion()
  local d = db()
  if companionSeen() then
    if d then d.companionEver = true end
    return true
  end
  return d and d.companionEver == true or false
end
-- A device-mode companion only uploads runs this PC's own characters played, so it never sends a guildmate's run: it must
-- neither ask for one nor count as a holder for it.
function dungeon.canUploadOthers()
  if type(GuildedCompanion) == "table" and GuildedCompanion.mode == "device" then return false end
  return dungeon.hasCompanion()
end

-- Who is known to hold a run (heard sending its summary or offering it): only such a sender's confirmation is trusted at once.
local function markHeard(id, sender)
  if not id or not sender then return end
  local list = dungeon.heard[id]
  if not list then
    dungeon.heardCount = (dungeon.heardCount or 0) + 1
    if dungeon.heardCount > 400 then dungeon.heard, dungeon.heardCount = {}, 1 end
    list = {}
    dungeon.heard[id] = list
  end
  list[sender] = true
end
dungeon.markHeard = markHeard
local function solicitedRecently(id)
  local at = dungeon.solicited[id]
  return at ~= nil and now() - at <= SOLICIT_WINDOW
end
local function ackedRecently(id)
  local at = dungeon.acked[id]
  return type(at) == "number" and now() - at < ACK_EXPIRE
end
dungeon.ackedRecently = ackedRecently

-- Own finished runs nobody confirmed yet, newest first (a run whose chunks were lost goes first). A run a guildmate's bot
-- confirmed once is only offered again slowly (a confirmation is not proof: anyone in the guild can send one); two different
-- guildmates, or this player's own companion, end it.
local function offerable(run)
  if run.synced or (run.ackCount or 0) >= 2 then return false end
  if run.syncedVia then
    local at = run.slowOfferedAt or run.syncedViaAt
    return at ~= nil and now() - at >= SLOW_REOFFER
  end
  return true
end
function dungeon.ownUnconfirmed()
  local d = db()
  local runs = {}
  for _, run in pairs(d and d.runs or {}) do
    if offerable(run) and run.players and run.players[me()] and TERMINAL[run.state]
      and (run.endedAt or 0) >= now() - REPLAY_DAYS * 86400 then runs[#runs + 1] = run end
  end
  table.sort(runs, function(a, b)
    if (a.shareLostAt ~= nil) ~= (b.shareLostAt ~= nil) then return a.shareLostAt ~= nil end
    return (a.endedAt or 0) > (b.endedAt or 0)
  end)
  return runs
end

-- Sends the summary of one saved run in chunks; a chunk the game keeps refusing marks the run to be offered first next time.
function dungeon.sendRun(run, channel)
  channel = channel == "GROUP" and "GROUP" or "GUILD"
  -- Inside an instance the chunks wait (see above): held guild chunks at the head of the queue would hold up the live run's own messages.
  if not outside() then dungeon.defer("send:" .. channel .. ":" .. tostring(run.id), function() dungeon.sendRun(run, channel) end) return true end
  local summary = serialize(run)
  local total = math.ceil(#summary / CHUNK_BYTES)
  if total > 20 then return false end
  if channel == "GROUP" then
    -- (9.3.1) To the party you are in now (any guild), for whoever there carries it with a companion. Nothing when alone or in a raid.
    if not dungeon.smallGroup() then return false end
    dungeon.solicited[run.id] = now()
    for part = 1, total do
      send(string.format("SUM|%s|%d|%d|%s", run.id, part, total, string.sub(summary, (part - 1) * CHUNK_BYTES + 1, part * CHUNK_BYTES)), "GROUP")
    end
    return true
  end
  run.shareLostAt = nil
  if run.syncedVia then run.slowOfferedAt = now() end
  dungeon.solicited[run.id] = now()
  local function lost() run.shareLostAt = now(); dungeon.resentAt[run.id] = nil; dungeon.lastReplay = nil end
  for part = 1, total do
    send(string.format("SUM|%s|%d|%d|%s", run.id, part, total, string.sub(summary, (part - 1) * CHUNK_BYTES + 1, part * CHUNK_BYTES)), "GUILD", lost)
  end
  -- A finished run of this player also goes to the group once, when it ends (a player with no companion and no guild is carried by it).
  if run.state == "COMPLETED" and not run.groupShared and run.players and run.players[me()] and dungeon.smallGroup() then
    run.groupShared = true
    dungeon.sendRun(run, "GROUP")
  end
  return true
end
-- A re-send asked for by a guildmate or a group member (sendRun itself waits for the end of an instance).
function dungeon.resend(run, channel) return dungeon.sendRun(run, channel) end

-- (9.3.1) Only a party of five or fewer shares runs with the group: in a raid, up to forty players would each send a summary.
function dungeon.smallGroup()
  if ns.util.groupChannel() ~= "PARTY" then return false end
  local size = GetNumGroupMembers and GetNumGroupMembers() or 1
  return type(size) == "number" and size <= 5
end

-- (9.3.1) Carrying for other players: this PC's companion uploads the runs of players near it. On by default; /guilded dungeon carry off.
function dungeon.carryOn()
  local d = db()
  return not d or d.carryGroupRuns ~= false
end
-- A player who carries needs a companion on this PC (it is the only thing that can leave the game).
function dungeon.canCarry() return dungeon.carryOn() and dungeon.hasCompanion() end
-- A short group message (a confirmation): the same waiting rule as guild messages.
function dungeon.toGroup(key, text)
  if outside() then send(text, "GROUP") else dungeon.defer(key, function() dungeon.toGroup(key, text) end) end
end
-- A short guild message (a confirmation, an officer request): the same waiting rule.
dungeon.outside = outside
function dungeon.guild(key, text)
  if outside() then send(text, "GUILD") else dungeon.defer(key, function() dungeon.guild(key, text) end) end
end

function dungeon.offerRuns(force)
  local d = db()
  if not d then return false end
  if not outside() then dungeon.defer("offer", function() dungeon.offerRuns(force) end) return false end
  if not force and dungeon.lastOffer and now() - dungeon.lastOffer < OFFER_EVERY then return false end
  local ids, size = {}, 4
  for _, run in ipairs(dungeon.ownUnconfirmed()) do
    if #ids >= OFFER_IDS or size + #run.id + 1 > 240 then break end
    ids[#ids + 1] = run.id
    size = size + #run.id + 1
    dungeon.solicited[run.id] = now()
    if run.syncedVia then run.slowOfferedAt = now() end
  end
  if #ids == 0 then return false end
  dungeon.lastOffer = now()
  send("OFR|" .. table.concat(ids, ","), "GUILD")
  return true
end

-- At login (once the 30 s timer ran) and when more guildmates are online than at the last look, after a random moment.
local function scheduleOffer(delayBase)
  if dungeon.offerScheduled or not C_Timer or not C_Timer.After then return end
  dungeon.offerScheduled = true
  C_Timer.After((delayBase or 5) + math.random(0, 30), function()
    dungeon.offerScheduled = false
    pcall(dungeon.offerRuns)
  end)
end
dungeon.scheduleOffer = scheduleOffer

-- (9.3.1) The same offer to the party or raid you are in: the ids of your runs nobody confirmed, so a player there whose companion
-- lacks one asks for it (WNT) and gets it (SUM) in the group. At most once per OFFER_EVERY seconds, a random moment after the
-- group changed.
function dungeon.offerToGroup()
  local d = db()
  if not d or not dungeon.smallGroup() then return false end
  if not outside() then dungeon.defer("offer-group", dungeon.offerToGroup) return false end
  if dungeon.lastGroupOffer and now() - dungeon.lastGroupOffer < OFFER_EVERY then return false end
  local ids, size = {}, 4
  for _, run in ipairs(dungeon.ownUnconfirmed()) do
    -- A run a group member said they hold is offered again slowly: only the companion's own receipt ends the offers.
    local slow = run.groupAckedAt and now() - run.groupAckedAt < SLOW_REOFFER
    if not slow and #ids < OFFER_IDS and size + #run.id + 1 <= 240 then
      ids[#ids + 1] = run.id
      size = size + #run.id + 1
      dungeon.solicited[run.id] = now()
    end
  end
  if #ids == 0 then return false end
  dungeon.lastGroupOffer = now()
  send("OFR|" .. table.concat(ids, ","), "GROUP")
  return true
end
function dungeon.noteGroupChange()
  if dungeon.groupOfferScheduled or not C_Timer or not C_Timer.After or not dungeon.smallGroup() then return end
  dungeon.groupOfferScheduled = true
  C_Timer.After(20 + math.random(0, 20), function()
    dungeon.groupOfferScheduled = false
    pcall(dungeon.offerToGroup)
  end)
end

local function onlineGuildmates()
  if not GetNumGuildMembers then return nil end
  local ok, _, online = pcall(GetNumGuildMembers)
  return ok and type(online) == "number" and online or nil
end
dungeon.onlineGuildmates = onlineGuildmates
-- Called on roster updates: a guildmate came online since the last look.
function dungeon.noteOnline()
  local online = onlineGuildmates()
  if not online then return end
  local more = dungeon.lastOnline and online > dungeon.lastOnline
  dungeon.lastOnline = online
  if more and dungeon.loadedAt and now() - dungeon.loadedAt >= 30 then scheduleOffer(5) end
end

local function listOf(text, tag)
  local list = string.match(text, "^" .. tag .. "|([^|]*)$")
  local ids = {}
  for id in string.gmatch(list or "", "[^,]+") do
    if #id <= 120 and #ids < 40 then ids[#ids + 1] = id end
  end
  return ids
end
dungeon.listOf = listOf

function dungeon.flushAnswers(channel)
  channel = channel == "GROUP" and "GROUP" or "GUILD"
  local q = channel == "GROUP" and dungeon.groupAnswers or dungeon.answers
  if not outside() then dungeon.defer("answers" .. channel, function() dungeon.flushAnswers(channel) end) return end
  q.scheduled = false
  local acks, wants = {}, {}
  for id in pairs(q.acks) do acks[#acks + 1] = id end
  for id in pairs(q.wants) do wants[#wants + 1] = id end
  table.sort(acks); table.sort(wants)
  q.acks, q.wants, q.count = {}, {}, 0
  local function emit(tag, ids)
    local line, used = {}, 0
    for _, id in ipairs(ids) do
      if used + #id + 1 > 200 and #line > 0 then send(tag .. "|" .. table.concat(line, ","), channel); line, used = {}, 0 end
      line[#line + 1] = id
      used = used + #id + 1
    end
    if #line > 0 then send(tag .. "|" .. table.concat(line, ","), channel) end
  end
  -- Remembered for a few minutes only: an answer the game dropped is given again when the offer comes back.
  for _, id in ipairs(acks) do dungeon.acked[id] = now() end
  dungeon.stats.acksSent = dungeon.stats.acksSent + #acks
  emit("ACKS", acks)
  emit("WNT", wants)
end

function dungeon.onOffer(text, sender, delivery)
  local d = db()
  if not d then return end
  local channel = delivery == "GUILD" and "GUILD" or "GROUP"
  local last = dungeon.offerSeen[sender]
  if last and now() - last < OFFER_FROM_SENDER_EVERY then return end
  dungeon.offerSeen[sender] = now()
  local q = channel == "GROUP" and dungeon.groupAnswers or dungeon.answers
  -- A guildmate's run is asked for by a guild companion; a group member's by any companion that carries (device mode included).
  local mayAsk = (channel == "GROUP" and dungeon.canCarry()) or (channel == "GUILD" and dungeon.canUploadOthers())
  for index, id in ipairs(listOf(text, "OFR")) do
    if index > OFFER_IDS or q.count >= ANSWER_IDS then break end
    local saved = d.runs[id]
    if saved then
      if (saved.synced or (channel == "GROUP" and saved.groupSynced)) and not ackedRecently(id) and not q.acks[id] then q.acks[id] = true; q.count = q.count + 1 end
    elseif not q.wants[id] and mayAsk then
      q.wants[id] = true
      q.count = q.count + 1
    end
  end
  if q.count > 0 and not q.scheduled and C_Timer and C_Timer.After then
    q.scheduled = true
    C_Timer.After(2 + math.random(0, 10), function() pcall(dungeon.flushAnswers, channel) end)
  end
end

-- A guildmate asks for a run. Only answered for a run this PC offered a moment ago (or one the asker played), at most
-- RESEND_RUNS runs a round, and a run asked for again and again waits twice as long each time (a holder that keeps asking
-- for a run it then refuses cannot make this PC repeat it).
function dungeon.onWant(text, sender, delivery)
  local d = db()
  if not d then return end
  local channel = delivery == "GUILD" and "GUILD" or "GROUP"
  local sent = 0
  for _, id in ipairs(listOf(text, "WNT")) do
    dungeon.answers.wants[id] = nil -- someone asked already: no second ask from this PC
    dungeon.groupAnswers.wants[id] = nil
    local run = d.runs[id]
    if run and not run.synced and (run.ackCount or 0) < 2 and run.players and run.players[me()] and TERMINAL[run.state] and sent < RESEND_RUNS
      and (solicitedRecently(id) or run.players[sender])
      and (not dungeon.resentAt[id] or now() - dungeon.resentAt[id] >= (dungeon.resendGap[id] or RESEND_COOLDOWN)) then
      dungeon.resentAt[id] = now()
      dungeon.resendGap[id] = math.min((dungeon.resendGap[id] or RESEND_COOLDOWN / 2) * 2, RESEND_GAP_MAX)
      if dungeon.resend(run, channel) then sent = sent + 1 end
    end
  end
end

-- A guildmate's bot says it has this run. Trusted at once only from someone in the run or someone heard sending its summary
-- (an offer or a recent exchange proves nothing: anyone can offer or answer); anything else is remembered and counts only when a second guildmate says the same. Even a trusted
-- confirmation only slows the offers down (see offerable): this PC's own companion, or two guildmates, end them.
local function plausibleAcker(saved, id, sender)
  if saved.players and saved.players[sender] then return true end
  if saved.reporters and saved.reporters[sender] then return true end
  return dungeon.heard[id] ~= nil and dungeon.heard[id][sender] == true
end
function dungeon.noteAck(id, sender, delivery)
  local d = db()
  local saved = id and d and d.runs[id]
  dungeon.answers.acks[id or ""] = nil
  dungeon.answers.wants[id or ""] = nil
  dungeon.groupAnswers.acks[id or ""] = nil
  dungeon.groupAnswers.wants[id or ""] = nil
  if not saved or saved.synced or not sender then return end
  -- (9.3.1) A confirmation heard in a group proves nothing (any player in it can send one): it only makes the next offer to the
  -- group slower. Only the guild's confirmations, or this PC's own companion, mark a run as taken.
  if delivery ~= nil and delivery ~= "GUILD" then
    saved.groupAckedAt = now()
    return
  end
  saved.ackers = saved.ackers or {}
  if saved.ackers[sender] == nil and (saved.ackCount or 0) < 5 then
    saved.ackers[sender] = now()
    saved.ackCount = (saved.ackCount or 0) + 1
  end
  if not (plausibleAcker(saved, id, sender) or (saved.ackCount or 0) >= 2) then return end
  if saved.syncedVia then return end
  saved.syncedVia = sender
  saved.syncedViaAt = now()
  dungeon.stats.acksHeard = dungeon.stats.acksHeard + 1
  if saved.players and saved.players[me()] and not saved.ackNoticed then
    saved.ackNoticed = true
    dungeon.ackNotices = dungeon.ackNotices or {}
    dungeon.ackNotices[#dungeon.ackNotices + 1] = { id = id, who = sender }
    dungeon.flushAckNotices()
  end
end

-- Chat lines wait for the end of combat: the notice of an upload, and the two once-a-session reminders.
function dungeon.flushAckNotices()
  if compat.inCombat() then return end
  local d = db()
  local list = dungeon.ackNotices
  dungeon.ackNotices = nil
  for _, item in ipairs(list or {}) do
    local run = d and d.runs[item.id]
    local who = ns.displayName and ns.displayName(item.who) or item.who
    ns.message(string.format(L("Your run %s was uploaded by %s's companion."), tostring(run and run.name or "?"), tostring(who or item.who)))
  end
  if dungeon.parkedDropped then
    dungeon.parkedDropped = nil
    ns.message(L("Some old dungeon runs of another guild could no longer be sent and were removed."))
  end
  if dungeon.remindAfterCombat then
    dungeon.remindAfterCombat = nil
    pcall(dungeon.remindWaiting)
    pcall(dungeon.remindGuildmateRuns)
  end
end

-- Once per session: guildmates' runs wait for THIS PC's companion (only for a player who has a companion).
function dungeon.remindGuildmateRuns()
  if dungeon.guildmateReminded or not dungeon.hasCompanion() then return false end
  if compat.inCombat() then dungeon.remindAfterCombat = true return false end
  local count = 0
  for _, run in ipairs(dungeon.waitingRuns()) do
    if not (run.players and run.players[me()]) then count = count + 1 end
  end
  if count == 0 then return false end
  dungeon.guildmateReminded = true
  ns.message(string.format(L("%d guildmate run(s) are waiting: /reload sends them to your companion."), count))
  return true
end

-- Guild messages that arrived before the guild roster did (right after login) wait here and are handled once it is there.
function dungeon.holdEarly(prefix, text, channel, sender)
  dungeon.early = dungeon.early or {}
  if #dungeon.early >= 30 then return end
  dungeon.early[#dungeon.early + 1] = { prefix = prefix, text = text, channel = channel, sender = sender, at = now() }
end

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

local function canControl()
  return compat.isLeader() or ns.isOfficer() or not compat.inGroup()
end

-- (9.1.4, run trust) Runs the bot received from this PC's companion but does not count yet: it needs a second
-- player's addon (or a party member known to the guild roster). Written by the companion as GuildedDungeonPending
-- { [runId] = reason }. They are NOT synced: the author keeps replaying them and nobody ACKs them.
function dungeon.pendingRuns()
  local d = db()
  local list = {}
  local notes = type(GuildedDungeonPending) == "table" and GuildedDungeonPending or {}
  for id, reason in pairs(notes) do
    local run = d and d.runs[id]
    if run and not run.synced and not run.syncedVia and type(reason) == "string" then list[#list + 1] = { run = run, reason = reason } end
  end
  return list
end

local function status()
  local d = db()
  local run = d and d.current
  if not run then
    local total = 0
    for _ in pairs(d and d.runs or {}) do total = total + 1 end
    local pending = #dungeon.waitingRuns()
    ns.message(string.format(L("No dungeon run in progress. Saved runs: %d (%d waiting to reach Discord)."), total, pending))
    local mine = #dungeon.ownUnconfirmed()
    if mine > 0 then ns.message(string.format(L("Not uploaded yet: %d of your runs."), mine)) end
    local held = dungeon.pendingRuns()
    if #held > 0 then
      ns.message(string.format(L("%d received by Discord, not counted yet: %s."), #held, string.sub((string.gsub(held[1].reason, "|", "")), 1, 80)))
    end
    if pending > 0 then
      local overdue = #dungeon.overdueRuns() > 0
      ns.message(overdue
        and L("Is the Guilded Companion app running on this PC? Start it from the Windows Start menu: it sends your runs when you /reload or log out.")
        or L("They go to Discord when you /reload or log out while the Guilded Companion app is running."))
      if overdue then sayCompanionSteps() end
    end
    return
  end
  local elapsed = run.startedAt and (now() - run.startedAt) or 0
  local kills = 0
  for _, encounter in ipairs(type(run.encounters) == "table" and run.encounters or {}) do if encounter.success then kills = kills + 1 end end
  local recorder = run.recorder or "?"
  if ns.displayName then recorder = ns.displayName(recorder) or recorder end
  ns.message(string.format("%s - %s%s - bosses %d%s - recorder %s", run.name or "?", tostring(run.state),
    run.state == "ACTIVE" and string.format(" %d:%02d", math.floor(elapsed / 60), elapsed % 60) or "",
    kills, run.bossCount and ("/" .. run.bossCount) or "", tostring(recorder)))
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
local function handleDungeonCommand(args)
  local action = string.lower(args[1] or "status")
  local d = db()
  -- (9.1.3) Never silent: a member who types /guilded dungeon always gets a line back.
  if not d then ns.message(L("Dungeon data is not loaded yet. Try again in a moment, or /reload.")) return end
  if action == "status" then status()
  elseif action == "results" then
    local latest
    for _, run in pairs(d.runs) do
      if run.players and run.players[me()] and (not latest or (run.endedAt or 0) > (latest.endedAt or 0)) then latest = run end
    end
    if latest and ns.onDungeonSummary then ns.onDungeonSummary(latest)
    else ns.message(ns.L and ns.L("No saved dungeon result yet.") or "No saved dungeon result yet.") end
  elseif action == "check" then check()
  elseif action == "carry" then
    local choice = string.lower(args[2] or "")
    if choice == "on" then d.carryGroupRuns = nil elseif choice == "off" then d.carryGroupRuns = false end
    ns.message(dungeon.carryOn() and L("Your companion carries the runs of players in your group: on.") or L("Your companion carries the runs of players in your group: off."))
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
    ns.message("/guilded dungeon status | results | start | complete | abandon | check | carry on|off")
  end
end
ns.commandHandlers["dungeon"] = function(args)
  local ok, err = pcall(handleDungeonCommand, args or {})
  if not ok then
    -- A failure is said, never swallowed: the member sees it and the diagnostics keep it.
    if ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "dungeon command: " .. tostring(err)) end
    ns.message(L("The dungeon command failed. /guilded diag shows the details."))
  end
  pcall(dungeon.noteOtherAddonVersion, true)
end
-- (9.1.3) /gdungeons and /gdg answer with Guilded alone (without them WoW says the command does not exist, in
-- the client's language). The standalone Guilded Dungeons addon loads after this one and takes them over.
if not ns.standalone and SLASH_GUILDEDDUNGEONS1 == nil then
  SLASH_GUILDEDDUNGEONS1 = "/gdungeons"
  SLASH_GUILDEDDUNGEONS2 = "/gdg"
  SlashCmdList["GUILDEDDUNGEONS"] = function(text)
    local args = {}
    for word in string.gmatch(text or "", "%S+") do args[#args + 1] = word end
    local action = string.lower(args[1] or "")
    if action == "" and ns.dungeonScorePanel then
      ns.dungeonScorePanel.openOrSay("run") -- /gdg alone opens the window (or says why not)
    elseif (action == "score" or action == "lang") and ns.commandHandlers[action] then
      table.remove(args, 1)
      ns.commandHandlers[action](args)
    else
      ns.commandHandlers["dungeon"](args)
    end
  end
end
-- /guilded dungeons opens the dungeons window (/guilded dungeon is the run commands).
ns.commandHandlers["dungeons"] = function()
  if ns.dungeonScorePanel and ns.dungeonScorePanel.openOrSay then ns.dungeonScorePanel.openOrSay("run")
  else ns.message(L("The dungeons window is not available.")) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded dungeons - open the dungeons window")
table.insert(ns.commandHelp, "/guilded dungeon status | results | start | complete | abandon | check - dungeon runs")

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_LOGOUT", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA", "GROUP_ROSTER_UPDATE",
  "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "ENCOUNTER_END", "PLAYER_DEAD", "CHAT_MSG_ADDON", "GUILD_ROSTER_UPDATE" }) do
  compat.registerEvent(frame, event)
end
compat.registerEvent(frame, "BOSS_KILL", true)
compat.registerEvent(frame, "ENCOUNTER_START", true)
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
  -- Traced dungeon maps: one breadcrumb sample every TRACE_SECONDS while a run is active.
  C_Timer.NewTicker(TRACE_SECONDS, function()
    if ns.moduleActive and not ns.moduleActive("dungeon") then return end
    local d = db()
    if d and d.current then pcall(traceSample) end
  end)
end

-- /guilded maptrace on | off: the member's own switch for traced dungeon maps (on by default).
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["maptrace"] = function(args)
  local s = ns.getSettings and ns.getSettings()
  local word = string.lower(type(args) == "table" and tostring(args[1] or "") or "")
  if s and (word == "on" or word == "off") then s.dungeonTrace = word == "on" end
  ns.message(traceOn() and L("Dungeon map tracing is on: in dungeons, Guilded notes the map squares you walk through (no times) to draw the dungeon's map. /guilded maptrace off stops it.")
    or L("Dungeon map tracing is off. /guilded maptrace on turns it back on."))
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded maptrace on | off - help draw accurate dungeon maps from the squares you walk through in dungeons (no times); ON by default")
