-- Who is ready for the raid, and who is not.
--
-- For everyone in your raid or party it combines
--   * a live look at their buffs (flask or elixir, food, augment and vantus rune, raid buffs),
--     which is the freshest,
--   * what each player's own addon reports about themselves (the same, plus weapon enchant and
--     durability, which only they can read; used when the game hides their buffs from you),
--   * the gear digest each addon shared earlier (empty slots, enchants), and
--   * the answers to Blizzard's own ready check,
-- and says "unknown" for anything none of them can tell. A hidden buff is never "missing".
--
-- It runs by itself: when anyone starts a ready check, every Guilded in the group looks at
-- itself and reports, and when the check ends the leader sees who has a problem. Nobody has to
-- press anything. The window's Ready page shows it; /guilded ready prints it. Only officers and
-- group leaders (raid leader or assistant) see it: they can also ask every addon in the group to
-- check itself again and post the result to the group.
--
-- Flask, food and the rest only count while you are in a raid group, like the gear check itself.
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.ready = module

local STALE_SECONDS = 30 * 60
local REPORT_FRESH_SECONDS = 15 * 60
local RESULT_KEEP_SECONDS = 10 * 60
local ASK_COOLDOWN_SECONDS = 20
local PASSIVE_MIN_SECONDS = 15
local ROSTER_MIN_SECONDS = 30
local MAX_POST_CHARS = 240

-- Worst first, so the page starts with what needs attention.
local ORDER = { NOT_READY = 1, PARTIAL = 2, NODATA = 3, READY = 4 }
module.ORDER = ORDER
module.LABEL = { NOT_READY = "Not ready", PARTIAL = "Issues", NODATA = "No data", READY = "Ready" }

local function L(text) return ns.L and ns.L(text) or text end
local function db() return ns.getDb and ns.getDb() end

-- ---------------------------------------------------------------------
-- What the checker requires (officers change it with /guilded ready require ...)
-- ---------------------------------------------------------------------

local DEFAULTS = {
  flask = true, food = true, buffs = true,
  weapon = false, augment = false, vantus = false,
  -- Minutes left on a flask, food or weapon enchant under which it counts as running out (0 = off).
  expiry = 10,
  -- Lowest durability percentage that is fine (0 = off).
  durability = 20,
  -- Print who has a problem when a ready check ends (only you see it); optionally tell the group.
  report = true, autopost = false
}
module.DEFAULTS = DEFAULTS
local CHECKS = { "flask", "food", "buffs", "weapon", "augment", "vantus" }
module.CHECKS = CHECKS

function module.setting(key)
  local settings = ns.getSettings and ns.getSettings()
  local saved = settings and settings.readyChecks
  if saved and saved[key] ~= nil then return saved[key] end
  return DEFAULTS[key]
end

local function saveSetting(key, value)
  local settings = ns.getSettings and ns.getSettings()
  if not settings then return false end
  settings.readyChecks = settings.readyChecks or {}
  settings.readyChecks[key] = value
  return true
end

-- ---------------------------------------------------------------------
-- Time: the addon keeps ISO timestamps ("2026-09-26T12:00:00Z"); this turns one into seconds.
-- ---------------------------------------------------------------------

function module.epoch(iso)
  if not string.match(iso or "", "Z$") then return nil end
  return ns.util.isoEpoch(iso)
end

local function nowEpoch()
  if GetServerTime then
    local ok, value = pcall(GetServerTime)
    if ok and type(value) == "number" then return value end
  end
  return time and time() or 0
end

-- Runs `fn` after `seconds`, or at once where there is no timer (tests, very old clients).
local function later(seconds, fn)
  if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) else fn() end
end

-- ---------------------------------------------------------------------
-- Who may see this: officers, and the leader or an assistant of the current group.
-- ---------------------------------------------------------------------

local function unitFlag(fn, unit)
  if not fn then return false end
  local ok, value = pcall(fn, unit)
  return ok and value == true
end

function module.canView()
  if ns.isOfficer and ns.isOfficer() then return true end
  return unitFlag(UnitIsGroupLeader, "player") or unitFlag(UnitIsGroupAssistant, "player")
end

-- Whether another player (by name) is someone whose ready check we answer.
function module.isRequester(name)
  if ns.isOfficerName and ns.isOfficerName(name) then return true end
  -- The name may come with a realm ("Amy-Realm"); try it as given and without.
  local plain = ns.normalizeName and ns.normalizeName(name) or name
  return unitFlag(UnitIsGroupLeader, name) or unitFlag(UnitIsGroupAssistant, name)
    or unitFlag(UnitIsGroupLeader, plain) or unitFlag(UnitIsGroupAssistant, plain)
end

-- ---------------------------------------------------------------------
-- What each player shared
-- ---------------------------------------------------------------------

-- The same shape as a guildmate's digest: { status, missing, minDurability, flags, at }.
local function ownEntry()
  local d = db()
  local snapshot = d and d.readiness and d.readiness[ns.playerName()]
  if not snapshot then return nil end
  local flags, missing, minDurability = {}, 0, 100
  local enchants
  for _, finding in ipairs(snapshot.findings or {}) do
    if finding.code == "NO_FLASK" then table.insert(flags, "NOFLASK")
    elseif finding.code == "NO_FOOD" then table.insert(flags, "NOFOOD")
    elseif finding.code == "MISSING_ENCHANTS" then
      enchants = string.match(finding.message or "", "Missing enchants: (.-)%.$") or ""
      table.insert(flags, "ENCH:" .. (string.gsub(enchants, ", ", "+")))
    elseif finding.code == "LOW_DURABILITY" then
      minDurability = tonumber(string.match(finding.message or "", "(%d+)%%")) or minDurability
    elseif finding.severity == "ERROR" then missing = missing + 1 end
  end
  return { status = snapshot.status, missing = missing, minDurability = minDurability, flags = table.concat(flags, ","), at = module.epoch(snapshot.inspectedAt) }
end

local function peerEntry(name)
  local d = db()
  local peer = d and d.peerRoster and d.peerRoster[name]
  if not peer then return nil end
  return {
    status = peer.status, missing = tonumber(peer.missing) or 0, minDurability = tonumber(peer.minDurability) or 100,
    flags = peer.flags or "", at = peer.seenAt or module.epoch(peer.updatedAt)
  }
end

-- What each groupmate's addon said about their own consumables: name -> { facts, at }.
-- Only kept in memory: it is old within minutes and every ready check refreshes it.
module.reports = {}

-- A report from a groupmate's addon ("CONSUME|..."). Only they may report themselves, and only
-- through the group channel, so a stranger cannot fill someone else's row.
function module.handleReport(text, channel, sender)
  if channel ~= "RAID" and channel ~= "PARTY" and channel ~= "INSTANCE_CHAT" then return false end
  local consumables = ns.consumables
  if not (consumables and consumables.decode) then return false end
  local facts = consumables.decode(text)
  if not facts then return false end
  local name = ns.normalizeName and ns.normalizeName(sender) or sender
  if not name or name ~= (ns.normalizeName and ns.normalizeName(facts.name) or facts.name) then return false end
  module.reports[name] = { facts = facts, at = nowEpoch() }
  if ns.onPeerReadiness then pcall(ns.onPeerReadiness, name) end
  return true
end

-- ---------------------------------------------------------------------
-- Blizzard's own ready check: who answered
-- ---------------------------------------------------------------------

-- { startedAt, initiator, finished, responses = { name = true | false } } of the latest check.
module.check = nil

local function unitName(unit)
  local name = UnitName and UnitName(unit)
  if not name or (ns.isSecret and ns.isSecret(name)) then return nil end
  return ns.normalizeName and ns.normalizeName(name) or name
end

-- "ready", "notready", "waiting" (still deciding), "silent" (never answered), or nil (no recent check).
local function nativeState(name, unit)
  local check = module.check
  if not check or nowEpoch() - check.startedAt > RESULT_KEEP_SECONDS then return nil end
  local answer = check.responses[name]
  if answer == nil and not check.finished and GetReadyCheckStatus then
    local ok, status = pcall(GetReadyCheckStatus, unit)
    if ok and not (ns.isSecret and ns.isSecret(status)) then
      if status == "ready" then answer = true elseif status == "notready" then answer = false end
    end
  end
  if answer == true then return "ready" end
  if answer == false then return "notready" end
  return check.finished and "silent" or "waiting"
end

-- ---------------------------------------------------------------------
-- The group
-- ---------------------------------------------------------------------

local function groupUnits()
  local units = {}
  local inRaid = IsInRaid and IsInRaid() or false
  local inGroup = inRaid or (IsInGroup and IsInGroup()) or false
  if inRaid then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do table.insert(units, "raid" .. i) end
  elseif inGroup then
    table.insert(units, "player")
    for i = 1, 4 do table.insert(units, "party" .. i) end
  else
    table.insert(units, "player")
  end
  return units, inRaid, inGroup
end

local function unitClass(unit)
  if not UnitClass then return nil end
  local ok, _, classFile = pcall(UnitClass, unit)
  if ok and type(classFile) == "string" and not (ns.isSecret and ns.isSecret(classFile)) then return classFile end
  return nil
end

-- What a buff scan says, as true / false / nil (unknown) per thing. Uses the scanner's own
-- reading when it has one.
local function scanFacts(live)
  local consumables = ns.consumables
  if consumables and consumables.factsFromScan then return consumables.factsFromScan(live) end
  local facts = {}
  if live and live.readable then
    facts.flask = live.flask ~= nil or (live.elixirs ~= nil and #live.elixirs > 0)
    facts.food = live.food ~= nil
  end
  return facts
end

-- "ok" (there), "bad" (missing and required), "none" (missing, not required), "unknown".
local function cellFor(present, required)
  if present == true then return "ok" end
  if present == false then return required and "bad" or "none" end
  return "unknown"
end

local function minutesLeft(seconds) return math.max(1, math.ceil(seconds / 60)) end

-- One player's row: { name, status, reasons = { text }, source, stale, cells }.
-- `extra` (all optional): { class, native, report = { facts, at }, providers = { CLASS = true } }.
function module.assess(name, unit, inRaid, entry, live, connected, extra)
  extra = extra or {}
  local reasons, seen = {}, {}
  local problems = 0
  -- A problem makes the player "Issues"; a note (old data) is only shown.
  local function add(text, note)
    if seen[text] then return end
    seen[text] = true
    table.insert(reasons, text)
    if not note then problems = problems + 1 end
  end
  local cells = { rc = extra.native, gear = "unknown", flask = "unknown", food = "unknown", weapon = "unknown",
    augment = "unknown", vantus = "unknown", buffs = "unknown" }
  local row = { name = name, unit = unit, class = extra.class, reasons = reasons, source = "none", cells = cells }
  if connected == false then
    row.status = "NODATA"
    add(L("offline"), true)
    return row
  end

  local liveKnown = live and live.readable and inRaid
  local liveFacts = liveKnown and scanFacts(live) or nil
  local report = extra.report
  local reportFacts = report and report.facts
  local reportFresh = reportFacts ~= nil and nowEpoch() - (report.at or 0) <= REPORT_FRESH_SECONDS
  if not reportFresh then reportFacts = nil end
  local consumableFacts = inRaid and reportFacts or nil

  -- Live first, then the player's own report; nil = nobody can tell.
  local function pick(key)
    if liveFacts and liveFacts[key] ~= nil then return liveFacts[key], liveFacts[key .. "Left"] end
    if consumableFacts and consumableFacts[key] ~= nil then return consumableFacts[key], consumableFacts[key .. "Left"] end
    return nil
  end
  local expiryLimit = (tonumber(module.setting("expiry")) or 0) * 60
  -- Whether the buffs or the player's own report told us anything at all.
  local learned = false

  -- Gear, from the digest the addon shared.
  local hardProblem = false
  local flags = {}
  if entry then
    row.source = "addon"
    if entry.status == "NOT_READY" then hardProblem = true end
    if (entry.missing or 0) > 0 then add(string.format(L("%d empty slot(s)"), entry.missing)) end
    for flag in string.gmatch(entry.flags or "", "[^,]+") do
      local slots = string.match(flag, "^ENCH:(.*)$")
      if slots then
        if slots ~= "" then add(L("no enchant") .. ": " .. (string.gsub(slots, "%+", ", "))) end
      else
        flags[flag] = true
      end
    end
    cells.gear = ((entry.missing or 0) > 0 or entry.status == "NOT_READY") and "bad" or "ok"
  end
  local durability = (reportFacts and reportFacts.durability) or (entry and entry.minDurability) or nil
  local durabilityLimit = tonumber(module.setting("durability")) or 0
  if durability and durabilityLimit > 0 and durability < durabilityLimit then add(string.format(L("durability %d%%"), durability)) end
  cells.durability = durability

  -- Consumables.
  local function need(key, missingText, endsText)
    local required = module.setting(key) == true
    local present, left = pick(key)
    -- The gear digest remembers "no flask" / "no food" when nothing fresher is known.
    if present == nil and key == "flask" and flags.NOFLASK then present = false end
    if present == nil and key == "food" and flags.NOFOOD then present = false end
    cells[key] = cellFor(present, required)
    if present ~= nil then learned = true end
    if present == false and required then add(L(missingText)) end
    if present == true and left and endsText and expiryLimit > 0 and left <= expiryLimit then
      add(string.format(L(endsText), minutesLeft(left)))
      cells[key] = "warn"
    end
    return present
  end
  if inRaid or flags.NOFLASK or flags.NOFOOD then
    need("flask", "no flask", "flask ends in %d min")
    need("food", "no food", "food ends in %d min")
  end
  if inRaid then
    need("weapon", "no weapon enchant", "weapon enchant ends in %d min")
    need("augment", "no augment rune")
    need("vantus", "no vantus rune")
    -- Raid buffs: only the ones somebody in the group can actually give.
    local held = (liveFacts and liveFacts.buffs) or (consumableFacts and consumableFacts.buffs)
    local data = ns.consumableData
    if held and data and extra.providers then
      local lacking = {}
      for _, buff in ipairs(data.RAID_BUFFS) do
        if extra.providers[buff.class] and not held[buff.key] then table.insert(lacking, L(buff.label)) end
      end
      learned = true
      cells.buffs = cellFor(#lacking == 0, module.setting("buffs") == true)
      if #lacking > 0 and module.setting("buffs") == true then add(L("no raid buff") .. ": " .. table.concat(lacking, ", ")) end
    end
  end

  if liveKnown then row.source = entry and "addon+live" or "live"
  elseif consumableFacts then row.source = entry and "addon+report" or "report" end

  -- Blizzard's ready check.
  if extra.native == "notready" then
    hardProblem = true
    add(L("said not ready"))
  elseif extra.native == "silent" then
    add(L("no ready check answer"), true)
  end

  -- Old data is only a note, shown last.
  if entry and entry.at and nowEpoch() - entry.at > STALE_SECONDS then
    row.stale = true
    add(string.format(L("data %d min old"), math.floor((nowEpoch() - entry.at) / 60)), true)
  end
  if hardProblem or (entry and (entry.missing or 0) > 0) then row.status = "NOT_READY"
  elseif problems > 0 then row.status = "PARTIAL"
  elseif entry or learned or (reportFacts and reportFacts.durability) then row.status = "READY"
  else
    row.status = "NODATA"
    -- Their buffs are on screen but the game hides them: say so, it is not "no addon".
    add(liveKnown and L("buffs hidden by the game") or L("no addon data"), true)
  end
  return row
end

-- Everyone in the group, worst first.
function module.collect()
  local units, inRaid, inGroup = groupUnits()
  local rows, counts, seen = {}, { NOT_READY = 0, PARTIAL = 0, NODATA = 0, READY = 0 }, {}
  local me = ns.playerName and ns.playerName()
  local consumables = ns.consumables
  -- Which classes are here, so a missing raid buff is only blamed when someone can give it.
  local providers = {}
  for _, unit in ipairs(units) do
    if unit == "player" or not UnitExists or UnitExists(unit) then
      local class = unitClass(unit)
      if class then providers[class] = true end
    end
  end
  for _, unit in ipairs(units) do
    if unit == "player" or not UnitExists or UnitExists(unit) then
      local name = unitName(unit)
      if name and not seen[name] then
        seen[name] = true
        local isMe = (name == me)
        local entry = isMe and ownEntry() or peerEntry(name)
        local live
        if consumables and consumables.scanUnit then
          local ok, result = pcall(consumables.scanUnit, unit)
          if ok then live = result end
        end
        local report = module.reports[name]
        if isMe and consumables and consumables.ownFacts then
          -- You know yourself best: weapon enchant and durability too, always fresh.
          local ok, facts = pcall(consumables.ownFacts)
          if ok and facts then report = { facts = facts, at = nowEpoch() } end
        end
        local connected = (unit == "player") or not UnitIsConnected or UnitIsConnected(unit)
        local row = module.assess(name, unit, inRaid, entry, live, connected, {
          class = unitClass(unit), native = nativeState(name, unit), report = report, providers = providers
        })
        table.insert(rows, row)
        counts[row.status] = counts[row.status] + 1
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.status ~= b.status then return ORDER[a.status] < ORDER[b.status] end
    return a.name < b.name
  end)
  return { rows = rows, counts = counts, inRaid = inRaid, inGroup = inGroup, total = #rows, check = module.check }
end

function module.summary(result)
  local c = result.counts
  return string.format(L("%d ready, %d with issues, %d not ready, %d no data"), c.READY, c.PARTIAL, c.NOT_READY, c.NODATA)
end

-- ---------------------------------------------------------------------
-- Telling the others: your own addon reports what you carry
-- ---------------------------------------------------------------------

local lastSentAt = 0
local lastSignature

function module.groupChannel()
  return ns.util.groupChannel()
end

local function consumablesOn()
  return ns.consumables and ns.consumables.ownFacts and (not ns.moduleActive or ns.moduleActive("consumables"))
end

-- What a report would say apart from the seconds left, so a change is told from a tick of the clock.
local function signatureOf(facts)
  local copy = {}
  for key, value in pairs(facts) do
    -- Durability drifts by itself during a fight; it is not worth a message.
    if string.sub(key, -4) ~= "Left" and key ~= "durability" then copy[key] = value end
  end
  return ns.consumables.encode("-", copy)
end

-- Sends what you carry to the group. Never in combat, and only when your addon can read itself.
function module.broadcastSelf(channel)
  if not consumablesOn() then return false end
  channel = channel or module.groupChannel()
  if not channel then return false end
  if InCombatLockdown and InCombatLockdown() then return false end
  local ok, facts, scan = pcall(ns.consumables.ownFacts)
  if not ok or not facts or (scan and not scan.readable) then return false end
  lastSentAt = nowEpoch()
  lastSignature = signatureOf(facts)
  if ns.send then ns.send(ns.consumables.encode(ns.playerName(), facts), channel) end
  return true
end

-- Sends again only if something changed (a flask ran out, food was eaten), and not too often.
local passivePending = false
local function passiveUpdate()
  passivePending = false
  if not consumablesOn() or not (IsInRaid and IsInRaid()) then return end
  if nowEpoch() - lastSentAt < PASSIVE_MIN_SECONDS then return end
  if InCombatLockdown and InCombatLockdown() then return end
  local ok, facts, scan = pcall(ns.consumables.ownFacts)
  if not ok or not facts or (scan and not scan.readable) then return end
  if signatureOf(facts) == lastSignature then return end
  module.broadcastSelf()
end

local function queuePassive()
  if passivePending then return end
  passivePending = true
  later(3, passiveUpdate)
end

-- ---------------------------------------------------------------------
-- Ready check: ask every addon in the group to look at itself again
-- ---------------------------------------------------------------------

local lastAskAt = 0

function module.ask()
  if not module.canView() then
    ns.message(L("Only officers and group leaders use the ready check."))
    return false
  end
  local channel = module.groupChannel()
  if not channel then
    ns.message(L("Join a raid or party first."))
    return false
  end
  local now = nowEpoch()
  if now - lastAskAt < ASK_COOLDOWN_SECONDS then
    ns.message(string.format(L("Just asked; wait %d seconds."), ASK_COOLDOWN_SECONDS - (now - lastAskAt)))
    return false
  end
  lastAskAt = now
  if ns.send then ns.send("READYREQ|" .. now, channel) end
  ns.message(L("Ready check sent. Addons answer within a few seconds; the Ready page updates by itself."))
  return true
end

-- The result as raid or party chat lines: the summary, then who has a problem.
function module.postLines(result, prefix)
  prefix = prefix or "[Guilded] "
  local lines = { prefix .. module.summary(result) }
  local current = ""
  for _, row in ipairs(result.rows) do
    if row.status == "NOT_READY" or row.status == "PARTIAL" then
      local piece = row.name .. " (" .. table.concat(row.reasons, ", ") .. ")"
      local candidate = current == "" and piece or (current .. "; " .. piece)
      if current ~= "" and #candidate + 12 > MAX_POST_CHARS then
        table.insert(lines, prefix .. current)
        current = piece
      else
        current = candidate
      end
    end
  end
  if current ~= "" then table.insert(lines, prefix .. current) end
  return lines
end

function module.post()
  if not module.canView() then
    ns.message(L("Only officers and group leaders use the ready check."))
    return
  end
  local channel = module.groupChannel()
  if not channel then ns.message(L("Join a raid or party first.")) return end
  for _, line in ipairs(module.postLines(module.collect())) do
    pcall(function()
      if C_ChatInfo and C_ChatInfo.SendChatMessage then C_ChatInfo.SendChatMessage(line, channel)
      elseif SendChatMessage then SendChatMessage(line, channel) end
    end)
  end
end

-- ---------------------------------------------------------------------
-- By itself: Blizzard's ready check, joining a group, a buff running out
-- ---------------------------------------------------------------------

local function refreshPage()
  if ns.onPeerReadiness then pcall(ns.onPeerReadiness) end
end

-- Someone (the leader or an assistant) started a ready check.
function module.onReadyCheck(initiator, duration)
  local name = initiator and unitName(initiator)
  module.check = { startedAt = nowEpoch(), initiator = name, finished = false, responses = {} }
  -- The one who asks does not get a "confirm" for themselves; they are ready by asking.
  if name then module.check.responses[name] = true end
  -- Every addon reports itself, spread over a second or two so a big raid does not answer at once.
  local delay = 0.3 + (math.random and math.random() or 0) * 1.2
  later(delay, function()
    if InCombatLockdown and InCombatLockdown() then return end
    if ns.inspectReadiness and module.groupChannel() then pcall(ns.inspectReadiness, true, module.groupChannel()) end
    module.broadcastSelf()
  end)
  refreshPage()
end

function module.onReadyCheckConfirm(unit, isReady)
  if not module.check or module.check.finished then return end
  local name = unit and unitName(unit)
  if name then module.check.responses[name] = isReady == true end
  refreshPage()
end

function module.onReadyCheckFinished(preempted)
  local check = module.check
  if not check or check.finished then return end
  check.finished = true
  check.finishedAt = nowEpoch()
  refreshPage()
  if preempted == true or not module.canView() or not module.setting("report") then return end
  -- Give the last reports a moment to arrive, then tell the leader who has a problem.
  later(2, function()
    local result = module.collect()
    for _, line in ipairs(module.postLines(result, "")) do ns.message(line) end
    if module.setting("autopost") == true then module.post() end
    refreshPage()
  end)
end

local function onEvent(_, event, ...)
  if event == "READY_CHECK" then module.onReadyCheck(...)
  elseif event == "READY_CHECK_CONFIRM" then module.onReadyCheckConfirm(...)
  elseif event == "READY_CHECK_FINISHED" then module.onReadyCheckFinished(...)
  elseif event == "UNIT_AURA" then queuePassive()
  elseif event == "GROUP_ROSTER_UPDATE" or event == "PLAYER_ENTERING_WORLD" then
    -- Joined a group or changed zone: tell the group what you carry, once in a while.
    if module.groupChannel() and nowEpoch() - lastSentAt >= ROSTER_MIN_SECONDS then
      later(5, function() if nowEpoch() - lastSentAt >= ROSTER_MIN_SECONDS then module.broadcastSelf() end end)
    end
  end
end

if CreateFrame then
  local frame = CreateFrame("Frame")
  frame:RegisterEvent("READY_CHECK")
  frame:RegisterEvent("READY_CHECK_CONFIRM")
  frame:RegisterEvent("READY_CHECK_FINISHED")
  frame:RegisterEvent("GROUP_ROSTER_UPDATE")
  frame:RegisterEvent("PLAYER_ENTERING_WORLD")
  -- Only your own buffs matter here; the other units' events are not wanted.
  if frame.RegisterUnitEvent then frame:RegisterUnitEvent("UNIT_AURA", "player") else frame:RegisterEvent("UNIT_AURA") end
  frame:SetScript("OnEvent", function(self, event, ...)
    local ok, err = pcall(onEvent, self, event, ...)
    if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Ready event " .. tostring(event) .. ": " .. tostring(err)) end
  end)
end

-- ---------------------------------------------------------------------
-- /guilded ready [ask | post | require <check> on|off | expiry <minutes> | report on|off | autopost on|off]
-- ---------------------------------------------------------------------

local function onOff(value) return value and L("on") or L("off") end

local function showSettings()
  local parts = {}
  for _, key in ipairs(CHECKS) do table.insert(parts, key .. " " .. onOff(module.setting(key) == true)) end
  ns.message(L("Required") .. ": " .. table.concat(parts, ", "))
  ns.message(string.format("%s: %d min, %s: %d%%, %s: %s, %s: %s", L("running out"), tonumber(module.setting("expiry")) or 0,
    L("durability"), tonumber(module.setting("durability")) or 0, L("report"), onOff(module.setting("report") == true),
    L("post to group"), onOff(module.setting("autopost") == true)))
end

local function changeSetting(args)
  if not (ns.isOfficer and ns.isOfficer()) then
    ns.message(L("Only officers change what the ready check requires."))
    return
  end
  local what, value = string.lower(args[1] or ""), string.lower(args[2] or "")
  if what == "require" then
    local key = value
    local state = string.lower(args[3] or "")
    local known = false
    for _, check in ipairs(CHECKS) do if check == key then known = true end end
    if not known or (state ~= "on" and state ~= "off") then
      ns.message("/guilded ready require <" .. table.concat(CHECKS, "|") .. "> <on|off>")
      return
    end
    saveSetting(key, state == "on")
  elseif what == "expiry" or what == "durability" then
    local number = tonumber(value)
    if not number or number < 0 or number > 100 then ns.message("/guilded ready " .. what .. " <0-100> (0 = off)") return end
    saveSetting(what, math.floor(number))
  elseif what == "report" or what == "autopost" then
    if value ~= "on" and value ~= "off" then ns.message("/guilded ready " .. what .. " <on|off>") return end
    saveSetting(what, value == "on")
  end
  showSettings()
  refreshPage()
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["ready"] = function(args)
  if not module.canView() then
    ns.message(L("Only officers and group leaders use the ready check."))
    return
  end
  local action = string.lower(args[1] or "")
  if action == "ask" or action == "check" then module.ask() return end
  if action == "post" then module.post() return end
  if action == "settings" then showSettings() return end
  if action == "require" or action == "expiry" or action == "durability" or action == "report" or action == "autopost" then
    changeSetting(args)
    return
  end
  local result = module.collect()
  ns.message((result.inGroup and "" or (L("Not in a group: showing only you.") .. " ")) .. module.summary(result))
  local shown = 0
  for _, row in ipairs(result.rows) do
    if row.status ~= "READY" and shown < 12 then
      shown = shown + 1
      ns.message(string.format("  %s: %s%s", row.name, L(module.LABEL[row.status]), #row.reasons > 0 and (" - " .. table.concat(row.reasons, ", ")) or ""))
    end
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded ready [ask|post|settings|require <check> on|off] - who in your group is ready (officers and group leaders; it runs by itself on every ready check; ask = every addon re-checks, post = tell the group)" })
