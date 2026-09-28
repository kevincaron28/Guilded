-- Guilded is intentionally manual-first. Combat and loot events are hints, not proof.
local addonName, ns = ...
ns = ns or {}
Guilded = ns

local PREFIX = "Guilded"
local DB_VERSION = 4
-- SavedVariables are rewritten on every logout; unbounded journals slowly
-- make login/logout (and the companion's parse) slower for months, so the
-- informational logs are capped. The EPGP ledger is NOT capped: the
-- companion identifies entries by id/position and it is the audit trail.
local MAX_EVENTS = 1000
local MAX_EXPORT_MARKERS = 10
local MAX_EPGP_AMOUNT = 100000
-- Addon messages longer than 255 bytes are rejected by the client.
local MAX_ADDON_MESSAGE = 255
local db
local activeRaid

local function now()
  return date("!%Y-%m-%dT%H:%M:%SZ")
end

local function playerName()
  local name = UnitName("player")
  -- Same spelling as everyone else's entry for you (no realm part).
  if type(name) == "string" and not (issecretvalue ~= nil and issecretvalue(name) == true) then
    name = string.match(name, "^([^%-%s]+)") or name
  end
  return name or "Unknown"
end

local function message(text)
  -- The optional Guilded chat tab (Modules/ChatTab.lua), otherwise the main chat window.
  local tab = ns.chatFrame and select(2, pcall(ns.chatFrame)) or nil
  local frame = (type(tab) == "table" and tab.AddMessage) and tab or DEFAULT_CHAT_FRAME
  frame:AddMessage("|cffd4af37[Guilded]|r " .. tostring(text))
  -- Lets the tools panel show the latest result without reading chat.
  if ns.onMessage then pcall(ns.onMessage, tostring(text)) end
end

-- Midnight-era clients can hand addons "secret" values (e.g. chat text during
-- boss encounters) that error when compared or pattern-matched.
local function isSecret(value)
  return issecretvalue ~= nil and issecretvalue(value) == true
end

-- One canonical spelling per character, so "bob", "Bob" and "Bob-Realm"
-- (addon-message senders and guild roster names carry the realm) never end
-- up as separate ledger, roster, or attendance entries. Only ASCII letters
-- change case; accented names pass through untouched.
local function normalizeName(name)
  if type(name) ~= "string" or isSecret(name) then return nil end
  name = string.match(name, "^%s*(.-)%s*$")
  -- A character name is one word of letters: whatever follows a hyphen or a space is the realm
  -- ("Ray-Realm", "Ray Realm"), never part of the name, so one player is one entry.
  name = string.match(name, "^([^%-%s]+)") or name
  if name == "" then return nil end
  return string.upper(string.sub(name, 1, 1)) .. string.lower(string.sub(name, 2))
end

local function defaultSettings()
  return {
    officerRanks = { [0] = true, [1] = true },
    officers = {},
    announceChannel = "RAID",
    captureLoot = true
  }
end

local function ensureDb()
  -- Early builds saved under the old name; adopt that data once.
  if not GuildedDB and type(_G.QuebecGoldDB) == "table" then
    GuildedDB = _G.QuebecGoldDB
    _G.QuebecGoldDB = nil
  end
  GuildedDB = GuildedDB or {}
  db = GuildedDB
  db.version = DB_VERSION
  -- Fill in any setting missing from an older saved file instead of only
  -- creating settings when the whole table is absent.
  db.settings = db.settings or {}
  for key, value in pairs(defaultSettings()) do
    if db.settings[key] == nil then db.settings[key] = value end
  end
  db.raids = db.raids or {}
  db.roster = db.roster or {}
  db.attendance = db.attendance or {}
  db.bosses = db.bosses or {}
  db.epgp = db.epgp or {}
  if db.dkp then
    for name, old in pairs(db.dkp) do
      db.epgp[name] = db.epgp[name] or { ep = 0, gp = 0, ledger = {} }
      for _, entry in pairs(old.ledger or {}) do
        table.insert(db.epgp[name].ledger, {
          epAmount = entry.amount, gpAmount = 0, type = "IMPORT",
          reason = "Legacy DKP: " .. tostring(entry.reason or "Imported"),
          at = entry.at, by = entry.by, raid = entry.raid
        })
      end
      db.epgp[name].ep = db.epgp[name].ep + (old.balance or 0)
    end
    db.dkp = nil
  end
  db.ledgerSeq = db.ledgerSeq or 0
  db.readiness = db.readiness or {}
  db.attunements = db.attunements or {}
  -- Diagnostics: blocked-action reports (ADDON_ACTION_BLOCKED/FORBIDDEN,
  -- which name the exact function WoW refused to let an addon call) and
  -- captured Lua errors. See /guilded diag.
  db.diagnostics = db.diagnostics or {}
  -- Roster digests broadcast by other guildmates' clients (gear/profession
  -- summary only, not full detail) so one officer's export can carry the
  -- whole online guild's readiness picture, not just their own.
  db.peerRoster = db.peerRoster or {}
  db.loot = db.loot or {}
  -- Who was actually in the raid group during each raid: [raidId][name] =
  -- { firstSeen, lastSeen }. Filled automatically while a raid is active.
  db.presence = db.presence or {}
  db.events = db.events or {}
  while #db.events > MAX_EVENTS do table.remove(db.events, 1) end
  -- Older versions stored a full copy of the database per export, which
  -- the SavedVariables writer duplicates on disk every time. Keep markers only.
  db.exports = db.exports or {}
  for key, value in pairs(db.exports) do
    if type(value) == "table" and value.roster then db.exports[key] = { exportedAt = key } end
  end

  -- A raid survives /reload and disconnects: without this, a crash mid-raid
  -- left the raid open forever and every later attendance call failed.
  activeRaid = nil
  if db.activeRaidId then
    for _, raid in ipairs(db.raids) do
      if raid.id == db.activeRaidId and not raid.endedAt then activeRaid = raid end
    end
    if not activeRaid then db.activeRaidId = nil end
  end
end

-- The roster keeps everyone the addon has met. Only entries the guild roster confirmed are
-- guild members: raid pugs are kept (attendance history needs them) with inGuild = false,
-- and a member who leaves the guild is marked inGuild = false the next time the roster loads.
-- Entries from before this field existed have no inGuild and count as members.
local function noteSeen(name)
  if not db.roster[name] then db.roster[name] = { firstSeen = now(), inGuild = false } end
end

local function isGuildMember(name)
  name = normalizeName(name)
  local entry = name and db and db.roster[name]
  return entry ~= nil and entry.inGuild ~= false
end

local function logEvent(kind, payload)
  table.insert(db.events, {
    at = now(), kind = kind, player = playerName(), data = payload
  })
  while #db.events > MAX_EVENTS do table.remove(db.events, 1) end
  -- Something worth saving happened: tell the sync module (Modules/SyncNow.lua).
  if ns.syncNow and ns.syncNow.mark then ns.syncNow.mark() end
end

-- Records a diagnostic entry (blocked action or captured Lua error) so it
-- survives past the moment it happened -- the in-game popup for a blocked
-- action disappears without saying which function was blocked, and a
-- regular Lua error can scroll off before anyone reads it. /guilded diag prints
-- the last few of these.
-- `foreign` marks noise from other addons (recorded quietly, evicted first).
-- Consecutive identical entries collapse into one with a count, so an
-- unrelated addon erroring every few seconds can't flood the log.
-- Anything reported before the saved database exists (which is exactly when a
-- load-time blocked-action popup fires) is held here and flushed on login,
-- instead of being silently dropped.
local pendingDiagnostics = {}

local function logDiagnostic(kind, detail, foreign)
  if not db then
    if #pendingDiagnostics < 25 then
      table.insert(pendingDiagnostics, { kind = kind, detail = detail, foreign = foreign })
    end
    return
  end
  db.diagnostics = db.diagnostics or {}
  local list = db.diagnostics
  local last = list[#list]
  if last and last.kind == kind and last.detail == detail then
    last.count = (last.count or 1) + 1
    last.at = now()
    return
  end
  table.insert(list, { at = now(), kind = kind, detail = detail, count = 1, foreign = foreign or false })
  while #list > 25 do
    local removeIndex = 1
    for i = 1, #list do
      if list[i].foreign then
        removeIndex = i
        break
      end
    end
    table.remove(list, removeIndex)
  end
  -- Slow-handler timings are recorded quietly; only real problems print.
  if not foreign and kind ~= "SLOW" and kind ~= "SEND" then
    message("|cffff5555[Diagnostic]|r " .. kind .. ": " .. detail .. " (see /guilded diag)")
  end
end

-- Records Lua errors (other addons' errors are kept quietly as "foreign")
-- and always chains to the previous handler, so BugSack/the default error
-- frame keep working. The recording itself is pcall-guarded: an error inside
-- an error handler would hide the original error.
local previousErrorHandler = geterrorhandler and geterrorhandler()
if seterrorhandler then
  seterrorhandler(function(err)
    pcall(function()
      local text = tostring(err)
      logDiagnostic("LUA_ERROR", text, not string.find(text, "Guilded", 1, true))
    end)
    if previousErrorHandler then return previousErrorHandler(err) end
  end)
end

local function isOfficer()
  if not db then return false end
  local name = playerName()
  if db.settings.officers[name] then return true end
  local _, _, rankIndex = GetGuildInfo("player")
  return rankIndex ~= nil and db.settings.officerRanks[rankIndex] == true
end

local function isGuildMaster()
  local _, _, rankIndex = GetGuildInfo("player")
  return rankIndex == 0
end

-- Rank check for someone else, from the guild roster (used to decide whether
-- to trust an officer-only message another client broadcast).
local function isOfficerName(name)
  name = normalizeName(name)
  if not db or not name then return false end
  if db.settings.officers[name] then return true end
  if not GetNumGuildMembers or not GetGuildRosterInfo then return false end
  for i = 1, GetNumGuildMembers() do
    local rosterName, _, rankIndex = GetGuildRosterInfo(i)
    if normalizeName(rosterName) == name then
      return rankIndex ~= nil and db.settings.officerRanks[rankIndex] == true
    end
  end
  return false
end

local function requireOfficer()
  if not isOfficer() then
    message("Officer or guild-master rank is required for this command.")
    return false
  end
  return true
end

-- Splits on whitespace but keeps "double quoted phrases" together, so
-- /guilded attune Bob "Onyxia Key" works as documented.
local function split(text)
  local result = {}
  text = text or ""
  local pos = 1
  while true do
    local s = string.find(text, "%S", pos)
    if not s then break end
    if string.sub(text, s, s) == '"' then
      local e = string.find(text, '"', s + 1, true)
      table.insert(result, string.sub(text, s + 1, (e or 0) - 1))
      if not e then break end
      pos = e + 1
    else
      local e = string.find(text, "%s", s)
      table.insert(result, string.sub(text, s, (e or 0) - 1))
      if not e then break end
      pos = e
    end
  end
  return result
end

-- Shared helpers and the paced message queue live in Util.lua (loaded first).
local util = ns.util
local comm = ns.comm

-- Sending can be refused (not in a group, throttled, encounter lockdown);
-- none of that should ever break the command that triggered it.
local function send(messageText, target)
  comm.send(PREFIX, messageText, target or "RAID")
end

local function registerPrefix()
  comm.register(PREFIX)
end

-- Assigned below groupMembers(); declared here so raid start/end can use it.
local recordPresence

local function raidStart(title)
  if activeRaid then
    message("Raid '" .. activeRaid.title .. "' is still active. Use /guilded end first.")
    return
  end
  if not title or title == "" then title = "Raid" end
  activeRaid = {
    -- Server clock, so ids and times from different officers' clients agree.
    id = tostring(util.serverTime()) .. "-" .. playerName(),
    title = title,
    startedAt = now(), endedAt = nil, startedBy = playerName()
  }
  table.insert(db.raids, activeRaid)
  recordPresence()
  db.activeRaidId = activeRaid.id
  logEvent("RAID_START", { id = activeRaid.id, title = activeRaid.title })
  send("RAID_START|" .. activeRaid.id .. "|" .. activeRaid.title)
  message("Started raid: " .. activeRaid.title)
end

local function raidEnd()
  if not activeRaid then message("No active raid."); return end
  recordPresence()
  activeRaid.endedAt = now()
  logEvent("RAID_END", { id = activeRaid.id })
  send("RAID_END|" .. activeRaid.id)
  message("Ended raid: " .. activeRaid.title)
  activeRaid = nil
  db.activeRaidId = nil
end

local function setAttendance(name, status, quiet)
  if not activeRaid then message("Start a raid first."); return end
  name = normalizeName(name) or playerName()
  status = string.upper(status or "PRESENT")
  if status ~= "PRESENT" and status ~= "ABSENT" and status ~= "LATE" then
    message("Status must be PRESENT, ABSENT, or LATE."); return
  end
  db.attendance[activeRaid.id] = db.attendance[activeRaid.id] or {}
  db.attendance[activeRaid.id][name] = { status = status, at = now(), by = playerName() }
  noteSeen(name)
  logEvent("ATTENDANCE", { raid = activeRaid.id, name = name, status = status })
  send("ATTENDANCE|" .. activeRaid.id .. "|" .. name .. "|" .. status)
  if not quiet then message(name .. " marked " .. status .. ".") end
  return true
end

local function bossKill(name)
  if not activeRaid then message("Start a raid first."); return end
  if not name or name == "" then message("Usage: /guilded boss <name>"); return end
  db.bosses[activeRaid.id] = db.bosses[activeRaid.id] or {}
  table.insert(db.bosses[activeRaid.id], { name = name, at = now(), by = playerName() })
  logEvent("BOSS_KILL", { raid = activeRaid.id, boss = name })
  send("BOSS_KILL|" .. activeRaid.id .. "|" .. name)
  message("Recorded boss kill: " .. name)
end

local EPGP_KINDS = {
  EP_AWARD = { command = "award", ep = 1, gp = 0 },
  GP_AWARD = { command = "gp", ep = 0, gp = 1 },
  ADJUSTMENT = { command = "deduct", ep = -1, gp = 0 }
}

-- Every ledger entry gets a permanent unique id. The companion sends it to
-- the bot, which uses it to skip entries it already imported: each export
-- carries the whole ledger, so without ids every import would re-add them.
local function nextLedgerId()
  db.ledgerSeq = (db.ledgerSeq or 0) + 1
  return string.format("%s-%d-%d", playerName(), util.serverTime(), db.ledgerSeq)
end

local function changeEpgp(rawName, rawAmount, reason, kind, quiet)
  local spec = EPGP_KINDS[kind]
  local name = normalizeName(rawName)
  local amount = tonumber(rawAmount)
  if not name or not amount or amount <= 0 or amount > MAX_EPGP_AMOUNT then
    message(string.format("Usage: /guilded %s <player> <amount 1-%d> [reason]", spec.command, MAX_EPGP_AMOUNT)); return
  end
  amount = math.floor(amount + 0.5)
  -- The bot requires a reason of at least 3 characters on import.
  if not reason or string.len(reason) < 3 then reason = "Manual adjustment" .. (reason and reason ~= "" and (": " .. reason) or "") end
  local epAmount, gpAmount = spec.ep * amount, spec.gp * amount
  db.epgp[name] = db.epgp[name] or { ep = 0, gp = 0, ledger = {} }
  local account = db.epgp[name]
  account.ep = account.ep + epAmount
  account.gp = account.gp + gpAmount
  table.insert(account.ledger, {
    id = nextLedgerId(), epAmount = epAmount, gpAmount = gpAmount, type = kind, reason = reason,
    at = now(), by = playerName(), raid = activeRaid and activeRaid.id
  })
  logEvent(kind, { name = name, epAmount = epAmount, gpAmount = gpAmount, reason = reason })
  send("EPGP|" .. name .. "|" .. epAmount .. "|" .. gpAmount .. "|" .. reason)
  if not quiet then
    message(string.format("%s EP %d, GP %d (%s), PR %.3f.", name, account.ep, account.gp, reason,
      account.gp > 0 and account.ep / account.gp or 0))
  end
  return true
end

-- Everyone in your current raid or party, plus you, as normalized names.
local function groupMembers()
  local names, seen = {}, {}
  local function add(name)
    name = normalizeName(name)
    if name and not seen[name] then
      seen[name] = true
      table.insert(names, name)
    end
  end
  add(playerName())
  if IsInRaid and IsInRaid() and GetNumGroupMembers and GetRaidRosterInfo then
    for i = 1, GetNumGroupMembers() do add((GetRaidRosterInfo(i))) end
  elseif IsInGroup and IsInGroup() then
    for i = 1, 4 do
      if UnitExists("party" .. i) then add((UnitName("party" .. i))) end
    end
  end
  return names
end

-- /guilded attendance group [status]: one command for the whole raid.
recordPresence = function()
  if not activeRaid then return end
  db.presence[activeRaid.id] = db.presence[activeRaid.id] or {}
  local seen = db.presence[activeRaid.id]
  for _, name in ipairs(groupMembers()) do
    seen[name] = seen[name] or { firstSeen = now() }
    seen[name].lastSeen = now()
    noteSeen(name)
  end
end

-- /guilded attendance seen: PRESENT for everyone who was in the group at any
-- point during this raid, without overwriting anything already recorded
-- (so a manual LATE or ABSENT stays).
local function seenAttendance()
  if not activeRaid then message("Start a raid first."); return end
  recordPresence()
  local recorded = db.attendance[activeRaid.id] or {}
  local count = 0
  for name in pairs(db.presence[activeRaid.id] or {}) do
    if not recorded[name] and setAttendance(name, "PRESENT", true) then count = count + 1 end
    recorded = db.attendance[activeRaid.id]
  end
  message(string.format("Marked %d more player(s) PRESENT from who was in the raid group.", count))
end

local function groupAttendance(status)
  if not activeRaid then message("Start a raid first."); return end
  local count = 0
  for _, name in ipairs(groupMembers()) do
    if setAttendance(name, status or "PRESENT", true) then count = count + 1 end
  end
  message(string.format("Marked %d group member(s) %s.", count, string.upper(status or "PRESENT")))
end

-- /guilded snapshot [label]: a named "who is here right now" (pre-pull, after a
-- boss...). It also records presence for the active raid, so it counts toward
-- attendance, and is kept (last 50) for disputes: /guilded snapshot list.
local function takeSnapshot(label)
  local names = groupMembers()
  db.snapshots = db.snapshots or {}
  table.insert(db.snapshots, { at = now(), label = label or "", raid = activeRaid and activeRaid.id or nil, names = names })
  while #db.snapshots > 50 do table.remove(db.snapshots, 1) end
  if activeRaid then recordPresence() end
  message(string.format("Snapshot%s: %d player(s)%s.", (label and label ~= "") and (" '" .. label .. "'") or "", #names,
    activeRaid and (" in raid '" .. activeRaid.title .. "'") or " (no raid running, so not counted for attendance)"))
end

local function listSnapshots()
  local list = db.snapshots or {}
  if #list == 0 then message("No snapshots yet. /guilded snapshot [label]"); return end
  for i = math.max(1, #list - 4), #list do
    local entry = list[i]
    message(string.format("%s  %s  %d player(s)", entry.at, entry.label ~= "" and entry.label or "(no label)", #entry.names))
  end
end

-- /guilded award group <amount> [reason]: EP to everyone in the group.
local function groupAward(rawAmount, reason)
  local names = groupMembers()
  local count = 0
  for _, name in ipairs(names) do
    if changeEpgp(name, rawAmount, reason, "EP_AWARD", true) then count = count + 1 else return end
  end
  message(string.format("Awarded %s EP to %d group member(s)%s.", tostring(rawAmount), count,
    (reason and reason ~= "") and (" (" .. reason .. ")") or ""))
end

local function collectProfessions()
  -- GetProfessions() returns up to 6 slot indices (some may be nil), so index
  -- by count rather than ipairs, which would stop at the first hole.
  local result = {}
  if not GetProfessions or not GetProfessionInfo then return result end
  local indices = { GetProfessions() }
  local count = select("#", GetProfessions())
  for i = 1, count do
    local index = indices[i]
    if index then
      local name, _, skillLevel = GetProfessionInfo(index)
      if name then table.insert(result, { name = name, skillLevel = skillLevel or 0 }) end
    end
  end
  return result
end

-- Who this character is, for the Discord bot's /character import. Class and
-- race use the English file tokens (WARRIOR, NightElf) so the bot reads them
-- the same on any client language.
local function collectCharacter()
  local _, classFile = UnitClass("player")
  local _, raceFile = UnitRace("player")
  local spec
  if GetSpecialization and GetSpecializationInfo then
    local index = GetSpecialization()
    if index then
      local _, specName = GetSpecializationInfo(index)
      spec = specName
    end
  end
  return {
    name = playerName(),
    realm = (ns.compat and ns.compat.identity().realm) or (GetRealmName and GetRealmName()) or "",
    class = classFile or "",
    race = raceFile or "",
    level = UnitLevel("player") or 0,
    spec = spec or "",
    professions = collectProfessions(),
    capturedAt = now()
  }
end

-- One line the player pastes into Discord: /character import code:<line>
local function characterString(info)
  local professions = {}
  for _, profession in ipairs(info.professions or {}) do
    table.insert(professions, (string.gsub(profession.name, "[|;,:]", "")) .. ":" .. tostring(profession.skillLevel))
  end
  -- ";" separates the fields: "|" is WoW's colour-code escape, and a "|R" in
  -- the name ("Ray") was being eaten by the chat frame (QG1 lines broke).
  local function clean(value) return (string.gsub(tostring(value or ""), "[|;]", "")) end
  return "QG2;" .. table.concat({
    clean(info.name), clean(info.realm), clean(info.class), clean(info.race),
    tostring(info.level or 0), clean(info.spec), table.concat(professions, ",")
  }, ";")
end

local base64Encode = util.base64Encode

-- One paste for Discord's /character import: who you are (the QG1 line), your
-- last gear check, active consumables and attunements. It is only ever YOUR
-- data, so there is no ledger and no officer review step.
local function selfExportString(info, snapshot, attunements)
  local lines = { characterString(info) }
  if snapshot then
    table.insert(lines, string.format("R|%s|%s", tostring(snapshot.status or ""), tostring(snapshot.itemLevel or "")))
    for _, finding in ipairs(snapshot.findings or {}) do
      table.insert(lines, string.format("F|%s|%s|%s", finding.code or "", finding.severity or "", (string.gsub(finding.message or "", "[\n|]", " "))))
    end
    for _, row in ipairs(snapshot.consumables or {}) do
      table.insert(lines, string.format("C|%s|%s", row.category or "", (string.gsub(row.name or "", "|", " "))))
    end
  end
  local names = {}
  for name in pairs(attunements or {}) do table.insert(names, name) end
  table.sort(names)
  for _, name in ipairs(names) do
    table.insert(lines, string.format("A|%s|%d", (string.gsub(name, "|", " ")), attunements[name].completed and 1 or 0))
  end
  return "QGEXP1:" .. base64Encode(table.concat(lines, "\n"))
end

local exportFrame
local exportTitle = "Guilded - copy this line (Ctrl+C), then in Discord: /character import"
local function showCharacterExport(text, title)
  exportTitle = title or exportTitle
  if exportFrame and exportFrame.titleText then exportFrame.titleText:SetText(exportTitle) end
  if not exportFrame then
    exportFrame = CreateFrame("Frame", "GuildedCharacterExport", UIParent)
    exportFrame:SetSize(520, 110)
    exportFrame:SetPoint("CENTER")
    exportFrame:SetFrameStrata("DIALOG")
    exportFrame:EnableMouse(true)
    local background = exportFrame:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetColorTexture(0, 0, 0, 0.85)
    local title = exportFrame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOP", 0, -10)
    title:SetText(exportTitle)
    exportFrame.titleText = title
    local box = CreateFrame("EditBox", nil, exportFrame)
    box:SetSize(490, 24)
    box:SetPoint("CENTER", 0, 0)
    box:SetAutoFocus(true)
    box:SetFontObject(ChatFontNormal or GameFontNormal)
    box:SetScript("OnEscapePressed", function() exportFrame:Hide() end)
    box:SetScript("OnEnterPressed", function() exportFrame:Hide() end)
    local close = CreateFrame("Button", nil, exportFrame, "UIPanelButtonTemplate")
    close:SetSize(80, 22)
    close:SetPoint("BOTTOM", 0, 10)
    close:SetText("Close")
    close:SetScript("OnClick", function() exportFrame:Hide() end)
    exportFrame.box = box
  end
  exportFrame.box:SetText(text)
  exportFrame:Show()
  exportFrame.box:SetFocus()
  exportFrame.box:HighlightText()
end

local READINESS_SLOTS = {
  { 1, "Head" }, { 3, "Shoulder" }, { 5, "Chest" }, { 6, "Waist" },
  { 7, "Legs" }, { 8, "Feet" }, { 9, "Wrist" }, { 10, "Hands" },
  { 16, "MainHand" }, { 17, "OffHand" }
}

-- Equipment slots where a missing enchant is worth flagging. Officers can
-- turn the check off or set the level it starts at with /guilded enchants.
local ENCHANTABLE = { Chest = true, Legs = true, Feet = true, Wrist = true, Hands = true, MainHand = true }
local DEFAULT_ENCHANT_MIN_LEVEL = 60

local function inspectReadiness(silent, target)
  local professions = collectProfessions()
  local snapshot = { character = playerName(), inspectedAt = now(), items = {}, consumables = {}, professions = professions, findings = {} }
  local missing = 0
  local missingSlots = {}
  local unenchanted = {}
  local minDurability = 100
  for _, slot in ipairs(READINESS_SLOTS) do
    local link = GetInventoryItemLink("player", slot[1])
    -- Right after login the link can still be loading while the item id is
    -- already known; an equipped item must never count as missing.
    local itemId = GetInventoryItemID and GetInventoryItemID("player", slot[1])
    if link or itemId then
      -- Item links look like |cAARRGGBB|Hitem:ID:...|h[Name]|h|r; pull the
      -- readable name and numeric id out instead of exporting the raw link.
      local itemName = link and string.match(link, "%[(.-)%]")
      if not itemName or itemName == "" then itemName = "Item " .. tostring(itemId or "?") end
      local row = { slot = slot[2], itemName = itemName, itemId = itemId and tostring(itemId) or (link and string.match(link, "item:(%d+)")) }
      -- The enchant id is the second field of an item link: item:<id>:<enchant>:...
      local enchantId = link and tonumber(string.match(link, "item:%d+:(%d+)"))
      if enchantId and enchantId > 0 then
        row.enchants = { { slot = slot[2], name = "Enchant " .. enchantId, enchantId = tostring(enchantId) } }
      elseif link and ENCHANTABLE[slot[2]] then
        table.insert(unenchanted, slot[2])
      end
      local current, maximum
      if GetInventoryItemDurability then current, maximum = GetInventoryItemDurability(slot[1]) end
      if current and maximum and maximum > 0 then
        row.durability = math.floor(current / maximum * 100)
        if row.durability < minDurability then minDurability = row.durability end
      end
      table.insert(snapshot.items, row)
    elseif slot[2] == "OffHand" then
      -- Two-handed weapons (and some specs) legitimately leave OffHand empty;
      -- that can't be told apart from "forgot to equip" without deeper
      -- tooltip parsing, so treat it as a soft warning, not a hard failure.
      table.insert(snapshot.findings, { code = "MISSING_OFFHAND", severity = "WARNING", message = "No off-hand item equipped (expected when using a two-handed weapon)." })
    else
      missing = missing + 1
      table.insert(missingSlots, slot[2])
      table.insert(snapshot.findings, { code = "MISSING_" .. string.upper(slot[2]), severity = "ERROR", message = "Missing " .. slot[2] .. " equipment." })
    end
  end
  -- Consumables: always recorded; only a missing flask/food counts against
  -- readiness while you are in a raid group (idle in town is fine).
  if ns.consumables and (not ns.moduleActive or ns.moduleActive("consumables")) then
    local rowsOk, rows, scanned = pcall(ns.consumables.ownRows)
    if rowsOk and type(rows) == "table" and scanned and scanned.readable then
      snapshot.consumables = rows
      if (IsInRaid and IsInRaid()) or (GetNumRaidMembers and GetNumRaidMembers() > 0) then
        -- Only a complete look proves something is missing (hidden buffs are "unknown").
        local facts = ns.consumables.factsFromScan and ns.consumables.factsFromScan(scanned) or {}
        if facts.flask == false then
          table.insert(snapshot.findings, { code = "NO_FLASK", severity = "WARNING", message = "No flask or elixir active." })
        end
        if facts.food == false then
          table.insert(snapshot.findings, { code = "NO_FOOD", severity = "WARNING", message = "No food buff active." })
        end
      end
    end
  end
  local enchantCheck = db.settings.enchantCheck ~= false
    and (UnitLevel("player") or 0) >= (db.settings.enchantMinLevel or DEFAULT_ENCHANT_MIN_LEVEL)
  if enchantCheck and #unenchanted > 0 then
    table.insert(snapshot.findings, { code = "MISSING_ENCHANTS", severity = "WARNING",
      message = "Missing enchants: " .. table.concat(unenchanted, ", ") .. "." })
  end
  if minDurability < 20 then
    table.insert(snapshot.findings, { code = "LOW_DURABILITY", severity = "WARNING", message = "Lowest equipped durability is " .. minDurability .. "%." })
  end
  if missing == 0 then
    table.insert(snapshot.findings, { code = "GEAR_PRESENT", severity = "INFO", message = "Required gear slots are populated." })
  end
  -- Same rule as the bot's deriveReadinessStatus: any ERROR -> NOT_READY,
  -- any WARNING -> PARTIAL, otherwise READY. (INFO findings don't count; the
  -- old check counted them, so READY was impossible to reach.)
  local hasWarning = false
  for _, finding in ipairs(snapshot.findings) do
    if finding.severity == "WARNING" then hasWarning = true end
  end
  snapshot.status = missing > 0 and "NOT_READY" or hasWarning and "PARTIAL" or "READY"
  -- Item level: earlier notes assumed this client had no such API (it was
  -- thought to be a vanilla-era client). Forever uses the modern API, so try
  -- it, fully guarded so a missing or restricted API can never break inspect.
  pcall(function()
    if GetAverageItemLevel then
      local _, equipped = GetAverageItemLevel()
      if type(equipped) == "number" and equipped > 0 then
        snapshot.itemLevel = math.floor(equipped * 10 + 0.5) / 10
      end
    end
  end)
  db.readiness[playerName()] = snapshot
  logEvent("READINESS", { status = snapshot.status, missing = missing, itemLevel = snapshot.itemLevel })

  local profParts = {}
  for _, profession in ipairs(professions) do
    table.insert(profParts, profession.name .. ":" .. profession.skillLevel)
  end
  -- Compact digest only (no item list/enchants/consumables) so this fits in
  -- a single addon message with no chunking. Broadcast to GUILD by default
  -- so it reaches everyone online, not just the current raid group.
  -- Short reason flags ride along so officers see why a peer is PARTIAL:
  -- NOFLASK, NOFOOD, ENCH:<slots joined by +>. Marked "F:" so an empty
  -- profession field can't shift them.
  local flags = {}
  for _, finding in ipairs(snapshot.findings) do
    if finding.code == "NO_FLASK" then table.insert(flags, "NOFLASK")
    elseif finding.code == "NO_FOOD" then table.insert(flags, "NOFOOD")
    elseif finding.code == "MISSING_ENCHANTS" then table.insert(flags, "ENCH:" .. table.concat(unenchanted, "+")) end
  end
  local digest = string.format("READINESS|%s|%s|%d|%d|%s", playerName(), snapshot.status, missing, minDurability, table.concat(profParts, ","))
  -- Who this is (class, race, level, spec) so officers' exports can discover
  -- every guildmate running the addon: "I:<CLASS>,<Race>,<level>,<spec>".
  local identityOk, identity = pcall(collectCharacter)
  if identityOk and type(identity) == "table" and identity.class ~= "" then
    local field = "I:" .. table.concat({ identity.class, identity.race, tostring(identity.level or 0),
      (string.gsub(identity.spec or "", "[|,;]", "")) }, ",")
    if #digest + 1 + #field <= MAX_ADDON_MESSAGE then digest = digest .. "|" .. field end
  end
  local flagText = table.concat(flags, ",")
  if #flags > 0 and #digest + 3 + #flagText <= MAX_ADDON_MESSAGE then
    digest = digest .. "|F:" .. flagText
  end
  send(digest, target or "GUILD")
  if not silent then
    local detail = ""
    if missing > 0 then
      detail = " Empty slots: " .. table.concat(missingSlots, ", ") .. "."
    elseif snapshot.status == "PARTIAL" then
      for _, finding in ipairs(snapshot.findings) do
        if finding.severity == "WARNING" then detail = detail .. " " .. finding.message end
      end
    end
    local ilvl = snapshot.itemLevel and (" Item level " .. snapshot.itemLevel .. ".") or ""
    message("Readiness captured: " .. snapshot.status .. "." .. detail .. ilvl)
  end
end

-- Title-cases attunement keys so "onyxia key" and "Onyxia Key" are one entry
-- on the bot side (it keys attunements by exact name).
local function canonicalKey(key)
  return (string.gsub(key, "(%a)([%w']*)", function(first, rest)
    return string.upper(first) .. string.lower(rest)
  end))
end

local function setAttunement(name, key, completed, silent)
  key = canonicalKey(key)
  db.attunements[name] = db.attunements[name] or {}
  db.attunements[name][key] = { completed = completed, at = now(), by = playerName() }
  logEvent("ATTUNEMENT", { name = name, key = key, completed = completed })
  send("ATTUNEMENT|" .. name .. "|" .. key .. "|" .. tostring(completed), "GUILD")
  if not silent then message(name .. " attunement " .. (completed and "completed" or "cleared") .. ": " .. key .. ".") end
end
ns.setAttunement = setAttunement
ns.canonicalKey = canonicalKey

-- Automatic sync: re-run inspectReadiness (silently, broadcasting to GUILD)
-- on login, on gear changes, and when the raid roster changes, instead of
-- requiring everyone to run /guilded inspect manually. Deliberately event-driven
-- only (no OnUpdate ticker).
local lastAutoSyncAt = 0
local AUTO_SYNC_DEBOUNCE_SECONDS = 5
local AUTO_SYNC_RAID_INTERVAL_SECONDS = 600

local function inRaidGroup()
  if IsInRaid then return IsInRaid() end
  if GetNumRaidMembers then return GetNumRaidMembers() > 0 end
  return false
end

local function maybeAutoSync(minInterval)
  local nowTime = time()
  if (nowTime - lastAutoSyncAt) < minInterval then return end
  lastAutoSyncAt = nowTime
  inspectReadiness(true, "GUILD")
end

-- /guilded loot <player> <item, may contain spaces or be a shift-clicked link> [cost]
local function recordLoot(args)
  local name = normalizeName(args[2])
  local last = #args
  local cost = 0
  if last >= 4 and tonumber(args[last]) then
    cost = math.floor(tonumber(args[last]))
    last = last - 1
  end
  local item = table.concat(args, " ", 3, last)
  if not name or item == "" then message("Usage: /guilded loot <player> <item> [cost]"); return end
  -- The id lets the bot import each loot row into Discord loot history
  -- exactly once; the boss is the last one killed in this raid, if any.
  local bosses = activeRaid and db.bosses[activeRaid.id]
  local row = { id = nextLedgerId(), player = name, item = item, cost = cost,
    at = now(), by = playerName(), raid = activeRaid and activeRaid.id,
    boss = bosses and bosses[#bosses] and bosses[#bosses].name or nil }
  table.insert(db.loot, row)
  logEvent("LOOT", row)
  send("LOOT|" .. name .. "|" .. item .. "|" .. row.cost)
  message("Recorded loot: " .. item .. " -> " .. name .. ".")
end

local function exportData()
  local key = now()
  -- The companion reads the live tables (epgp, readiness, ...) straight from
  -- SavedVariables; an export is just a timestamped marker that tells it
  -- (and you) when the officer last asked for a sync.
  db.exports[key] = { exportedAt = key, by = playerName() }
  local keys = {}
  for existing in pairs(db.exports) do table.insert(keys, existing) end
  table.sort(keys)
  for i = 1, #keys - MAX_EXPORT_MARKERS do db.exports[keys[i]] = nil end
  message("Export marked at " .. key .. ". /reload (or log out) so the game writes SavedVariables, then run the companion.")
end

local function showIdentity()
  if not ns.compat or not ns.compat.identity then return end
  local id = ns.compat.identity()
  local raw = id.raw
  message("Saved data belongs to guild: " .. tostring(db and db.guildKey or "(not known yet)"))
  message(string.format("Identity: name=%s realm=%s (GetRealmName=%s, normalized=%s, UnitName realm=%s, full=%s)",
    id.name, id.hasRealm and id.realm or "(none)", tostring(raw.realmName), tostring(raw.normalizedRealm),
    tostring(raw.unitNameRealm), tostring(raw.fullName)))
end

local function showDiagnostics()
  showIdentity()
  if (ns.ignoredMessages or 0) > 0 then
    message(string.format("%d addon message(s) from other players were ignored this session (informational only).", ns.ignoredMessages))
  end
  local entries = db.diagnostics or {}
  if #entries == 0 then
    message("No diagnostics recorded.")
    return
  end
  message(string.format("Last %d diagnostic(s):", math.min(5, #entries)))
  for i = math.max(1, #entries - 4), #entries do
    local entry = entries[i]
    local repeats = (entry.count or 1) > 1 and (" x" .. entry.count) or ""
    local origin = entry.foreign and " (other addon)" or ""
    message(entry.at .. " [" .. entry.kind .. "]" .. origin .. repeats .. " " .. entry.detail)
  end
end

-- /guilded officer add|remove <name>, /guilded officer rank <index> on|off, /guilded officer list
-- Guild master only: changes who the addon treats as an officer without
-- hand-editing SavedVariables.
local function officerCommand(args)
  local action = string.lower(args[2] or "list")
  if action == "list" then
    local names = {}
    for name in pairs(db.settings.officers) do table.insert(names, name) end
    local ranks = {}
    for rank, on in pairs(db.settings.officerRanks) do if on then table.insert(ranks, tostring(rank)) end end
    table.sort(ranks)
    message("Officer rank indexes (0 = guild master): " .. (#ranks > 0 and table.concat(ranks, ", ") or "none"))
    message("Extra officers: " .. (#names > 0 and table.concat(names, ", ") or "none"))
    message("You are " .. (isOfficer() and "" or "NOT ") .. "an officer for this addon.")
    return
  end
  if not isGuildMaster() then message("Only the guild master can change officer settings."); return end
  if action == "add" or action == "remove" then
    local name = normalizeName(args[3])
    if not name then message("Usage: /guilded officer add|remove <name>"); return end
    db.settings.officers[name] = action == "add" or nil
    message(name .. (action == "add" and " added as" or " removed as") .. " an addon officer.")
  elseif action == "rank" then
    local rank = tonumber(args[3])
    local on = string.lower(args[4] or "")
    if not rank or (on ~= "on" and on ~= "off") then message("Usage: /guilded officer rank <index> on|off"); return end
    db.settings.officerRanks[rank] = on == "on" or nil
    message("Guild rank index " .. rank .. " is " .. (on == "on" and "now" or "no longer") .. " an officer rank.")
  else
    message("Usage: /guilded officer list | add <name> | remove <name> | rank <index> on|off")
  end
end

-- Each rank only sees the commands it can use. Module help lines are either
-- plain strings (everyone) or { officer = true, text = "..." }.
local function showHelp()
  local officer = isOfficer()
  message("/guilded menu (or click the minimap coin) | inspect | status | roster | standings [player] | diag | version")
  message("/guilded attune <key> [clear] - mark your own attunement")
  message("/guilded snapshot [label] | list - record who is in the group right now (officers)")
  message("/guilded enchants - show or change the missing-enchant check (on/off, starting level)")
  message("/guilded share - one paste with your character, gear check, consumables and attunements (Discord: /character import)")
  message("/guilded character - copy a line to link this character in Discord (/character import)")
  if officer then
    message("Officer: /guilded start [title] | end | attendance <name>|group|seen [PRESENT|ABSENT|LATE] | boss <name>")
    message("Officer: /guilded award <name>|group <amount> [reason] | gp <name> <amount> [reason] | deduct <name> <amount> [reason]")
    message("Officer: /guilded loot <name> <item> [cost] | export | attune <player> <key> [clear] | officer list|add|remove|rank")
  end
  for _, line in pairs(ns.commandHelp or {}) do
    local text = type(line) == "table" and line.text or line
    -- Lines for a module that is off are left out ("/guilded casino ..." -> casino).
    local key = ns.commandModuleOf and ns.commandModuleOf(string.match(text or "", "^/guilded (%a+)"))
    if not key or ns.moduleActive(key) then
      if type(line) ~= "table" or officer or not line.officer then message(text) end
    end
  end
  message("/guilded modules - turn optional parts (games, bidding, dungeons...) on or off")
end

-- Extension point for modules loaded after Core.lua (see Modules/Casino.lua):
-- ns.commandHandlers["casino"] = function(args) ... end registers /guilded casino ...
-- table.insert(ns.commandHelp, "...") adds a line to /guilded help.
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}

-- Optional modules. Each can be turned off for yourself (/guilded modules off
-- casino) or for the whole guild by an officer (/guilded modules guild off
-- casino; shared through Modules/Sync.lua). Core (raids, EPGP, loot, gear
-- check) and Sync (standings, version check) always run: everything else
-- is built on them.
--
-- Saved settings only exist from PLAYER_LOGIN on, so modules are loaded
-- either way and stay dormant when off: their events, commands, help lines
-- and window tabs check ns.moduleActive(). Turning one off works at once;
-- turning one back on needs a /reload (it has to set itself up at login).
ns.MODULES = {
  { key = "games", name = "Roll games", desc = "fun deathroll and high-roll games, no gold", commands = { "games", "casino" } },
  { key = "bidding", name = "GP bidding", desc = "in-game GP bids on loot", commands = { "bid" } },
  { key = "council", name = "Loot council", desc = "BiS / upgrade / off-spec answers for loot council guilds", commands = { "council", "lc" } },
  { key = "reserve", name = "Soft reserves", desc = "reserve items for a raid, see who reserved what", commands = { "reserve", "res" } },
  { key = "recipes", name = "Recipes and cooldowns", desc = "who can craft what, profession cooldowns", commands = { "recipes", "cooldowns" } },
  { key = "dungeon", name = "Dungeons", desc = "dungeon run tracking and points", commands = { "dungeon" } },
  { key = "calendar", name = "Calendar", desc = "guild calendar check", commands = { "calendar" } },
  { key = "syncnow", name = "Send to Discord", desc = "save now / auto-save so the companion uploads sooner", commands = { "sync" } },
  { key = "autoinvite", name = "Auto-invite", desc = "guild invite when someone whispers a phrase", commands = { "autoinvite", "invite" } },
  { key = "backup", name = "Backup and restore", desc = "copy this guild's saved data as one code", commands = { "backup", "restore" } },
  { key = "digest", name = "Login digest", desc = "what changed since your last login", commands = { "digest" } },
  { key = "chattab", name = "Guilded chat tab", desc = "Guilded's own lines in a separate chat tab", commands = { "chat" } },
  { key = "tooltip", name = "Item tooltips", desc = "who wants an item and what it costs, on item tooltips", commands = {} },
  { key = "consumables", name = "Consumable scan", desc = "who is missing a flask or food", commands = { "consumes" } },
  { key = "sim", name = "Test tools", desc = "fake raid and dungeon runs for officers", commands = { "sim" } }
}
local MODULE_ALIASES = { casino = "games", game = "games", bid = "bidding", bids = "bidding", gp = "bidding", lc = "council", reserves = "reserve", recipe = "recipes", cooldown = "recipes", crafting = "recipes", softres = "reserve", sr = "reserve", lootcouncil = "council", dungeons = "dungeon", test = "sim", tests = "sim", consumable = "consumables", consumes = "consumables", flask = "consumables" }
local moduleByKey, commandModule, activeAtLogin = {}, {}, {}
for _, module in ipairs(ns.MODULES) do
  moduleByKey[module.key] = module
  for _, name in ipairs(module.commands) do commandModule[name] = module.key end
end

local function moduleSettings()
  return GuildedDB and GuildedDB.settings
end

-- Wanted by this player and allowed by the guild.
function ns.moduleEnabled(key)
  if not moduleByKey[key] then return true end
  local s = moduleSettings()
  if not s then return true end
  if s.modules and s.modules[key] == false then return false end
  if s.guildModules and s.guildModules.off and s.guildModules.off[key] then return false end
  return true
end

-- Enabled now AND was enabled at login (so it has set itself up).
function ns.moduleActive(key)
  if activeAtLogin[key] == nil then return ns.moduleEnabled(key) end
  return activeAtLogin[key] and ns.moduleEnabled(key)
end

function ns.moduleName(key)
  return moduleByKey[key] and moduleByKey[key].name or key
end

local function snapshotModules()
  for _, module in ipairs(ns.MODULES) do activeAtLogin[module.key] = ns.moduleEnabled(module.key) end
end

local function moduleStateText(key)
  local s = moduleSettings() or {}
  local guildOff = s.guildModules and s.guildModules.off and s.guildModules.off[key]
  if guildOff then return "off for the guild" .. (s.guildModules.by and (" (" .. s.guildModules.by .. ")") or "") end
  if s.modules and s.modules[key] == false then return "off (your choice)" end
  if not activeAtLogin[key] then return "on after /reload" end
  return "on"
end
ns.moduleStateText = moduleStateText

-- Guild-wide switches, shared by Sync.lua. Returns false for a stale update.
function ns.applyGuildModules(off, updatedAt, by)
  local s = moduleSettings()
  if not s then return false end
  local current = s.guildModules
  -- A switch dated in the future would pin itself forever; refuse it.
  if util.tooFarAhead(tonumber(updatedAt) or 0) then return false end
  if current and (current.updatedAt or 0) >= (updatedAt or 0) then return false end
  s.guildModules = { off = off or {}, updatedAt = updatedAt, by = by }
  return true
end

local function modulesCommand(args)
  local s = moduleSettings()
  if not s then return end
  local action = string.lower(args[2] or "list")
  local scope = "self"
  if action == "guild" then scope = "guild"; table.remove(args, 2); action = string.lower(args[2] or "list") end
  if action == "list" then
    message("Modules (Core raid/EPGP/loot/gear and standings always run):")
    for _, module in ipairs(ns.MODULES) do
      message(string.format("  %s (%s) - %s: %s", module.name, module.key, module.desc, moduleStateText(module.key)))
    end
    message("/guilded modules on|off <module> - just for you. Officers: /guilded modules guild on|off <module> - for everyone.")
    return
  end
  if action ~= "on" and action ~= "off" then message("Usage: /guilded modules [list] | on|off <module> | guild on|off <module>"); return end
  local wanted = string.lower(args[3] or "")
  local key = MODULE_ALIASES[wanted] or wanted
  if not moduleByKey[key] then
    local keys = {}
    for _, module in ipairs(ns.MODULES) do table.insert(keys, module.key) end
    message("Unknown module '" .. wanted .. "'. Modules: " .. table.concat(keys, ", "))
    return
  end
  local name = moduleByKey[key].name
  if scope == "guild" then
    if not requireOfficer() then return end
    local off = {}
    for k, v in pairs(s.guildModules and s.guildModules.off or {}) do off[k] = v end
    off[key] = action == "off" or nil
    ns.applyGuildModules(off, (GetServerTime and GetServerTime()) or time(), playerName())
    if ns.onGuildModulesChanged then pcall(ns.onGuildModulesChanged) end
    message(name .. " is now " .. action .. " for the whole guild (shared with online members).")
  else
    s.modules = s.modules or {}
    if action == "on" then s.modules[key] = nil else s.modules[key] = false end
    if action == "off" then
      message(name .. " is off for you. /guilded modules on " .. key .. " to turn it back on.")
    elseif s.guildModules and s.guildModules.off and s.guildModules.off[key] then
      message(name .. " is turned off for the whole guild by an officer, so it stays off.")
    end
  end
  if action == "on" and scope == "self" and ns.moduleEnabled(key) then
    if activeAtLogin[key] then message(name .. " is on for you.")
    else message(name .. " is on. Type /reload to start it.") end
  elseif action == "on" and scope == "guild" and ns.moduleEnabled(key) and not activeAtLogin[key] then
    message(name .. " is on. Type /reload to start it.")
  end
  if ns.onModulesChange then pcall(ns.onModulesChange) end
end

ns.commandModuleOf = function(name) return name and commandModule[string.lower(name)] end

local function command(text)
  if not db then message("Still loading, try again in a moment."); return end
  local args = split(text)
  local action = string.lower(args[1] or "help")
  if action == "help" then showHelp()
  elseif action == "status" then
    message(activeRaid and ("Active raid: " .. activeRaid.title .. " (started " .. activeRaid.startedAt .. ")") or "No active raid.")
  elseif action == "roster" then
    local names = {}
    for name in pairs(db.roster) do
      if isGuildMember(name) then table.insert(names, name) end
    end
    table.sort(names)
    message(#names .. " guild member(s): " .. table.concat(names, ", "))
  elseif action == "snapshot" then
    if string.lower(args[2] or "") == "list" then listSnapshots()
    elseif requireOfficer() then takeSnapshot(table.concat(args, " ", 2)) end
  elseif action == "enchants" then
    local sub = string.lower(args[2] or "")
    if sub == "on" or sub == "off" then
      db.settings.enchantCheck = (sub == "on")
      message("Enchant check " .. sub .. ".")
    elseif sub == "level" and tonumber(args[3]) then
      db.settings.enchantMinLevel = math.floor(tonumber(args[3]))
      message("Enchants are checked from level " .. db.settings.enchantMinLevel .. ".")
    else
      message(string.format("Enchant check is %s, from level %d. /guilded enchants on|off|level <n>.",
        db.settings.enchantCheck ~= false and "on" or "off", db.settings.enchantMinLevel or DEFAULT_ENCHANT_MIN_LEVEL))
    end
  elseif action == "share" then
    -- Refresh the gear check, then export everything about YOU in one paste.
    inspectReadiness(true, "GUILD")
    local info = collectCharacter()
    db.character = info
    local code = selfExportString(info, db.readiness[playerName()], db.attunements[playerName()])
    message("Your share code is " .. #code .. " characters (also shown in a box to copy). In Discord: /character import")
    showCharacterExport(code, "Guilded - copy this (Ctrl+C), then in Discord: /character import")
    ns.lastShareCode = code
  elseif action == "character" then
    local info = collectCharacter()
    db.character = info
    local line = characterString(info)
    message("Your character line (also shown in a box to copy): " .. line)
    showCharacterExport(line)
  elseif action == "start" then if requireOfficer() then raidStart(table.concat(args, " ", 2)) end
  elseif action == "end" then if requireOfficer() then raidEnd() end
  elseif action == "attendance" and string.lower(args[2] or "") == "group" then
    if requireOfficer() then groupAttendance(args[3]) end
  elseif action == "attendance" and string.lower(args[2] or "") == "seen" then
    if requireOfficer() then seenAttendance() end
  elseif action == "award" and string.lower(args[2] or "") == "group" then
    if requireOfficer() then groupAward(args[3], table.concat(args, " ", 4)) end
  elseif action == "attendance" then if requireOfficer() then setAttendance(args[2], args[3]) end
  elseif action == "boss" then if requireOfficer() then bossKill(table.concat(args, " ", 2)) end
  elseif action == "award" then if requireOfficer() then changeEpgp(args[2], args[3], table.concat(args, " ", 4), "EP_AWARD") end
  elseif action == "gp" then if requireOfficer() then changeEpgp(args[2], args[3], table.concat(args, " ", 4), "GP_AWARD") end
  elseif action == "deduct" then if requireOfficer() then changeEpgp(args[2], args[3], table.concat(args, " ", 4), "ADJUSTMENT") end
  elseif action == "loot" then if requireOfficer() then recordLoot(args) end
  elseif action == "attune" and ns.attunements and (function()
      local sub = string.lower(args[2] or "")
      return sub == "auto" or sub == "track" or sub == "untrack" or sub == "tracked"
    end)() then
    ns.attunements.command(args)
  elseif action == "attune" then
    local completed = true
    local last = string.lower(args[#args] or "")
    if #args > 2 and (last == "false" or last == "clear" or last == "no") then
      completed = false
      table.remove(args, #args)
    end
    -- "/guilded attune Onyxia Key" is a key for yourself; the first word is only
    -- treated as a player when it is a known guild member and a key follows.
    local target = playerName()
    local keyStart = 2
    local candidate = normalizeName(args[2])
    if args[3] and candidate and isGuildMember(candidate) and candidate ~= playerName() then
      target, keyStart = candidate, 3
    end
    local key = table.concat(args, " ", keyStart)
    if key == "" then message("Usage: /guilded attune <key> [clear] | /guilded attune <player> <key> [clear]"); return end
    if target ~= playerName() and not requireOfficer() then return end
    setAttunement(target, key, completed)
  elseif action == "inspect" then inspectReadiness()
  elseif action == "export" then if requireOfficer() then exportData() end
  elseif action == "diag" then showDiagnostics()
  elseif action == "officer" then officerCommand(args)
  elseif action == "modules" or action == "module" then modulesCommand(args)
  elseif commandModule[action] and not ns.moduleActive(commandModule[action]) then
    local key = commandModule[action]
    message(ns.moduleName(key) .. " is " .. moduleStateText(key) .. ". /guilded modules to see or change it.")
  elseif ns.commandHandlers[action] then
    -- args[1] is the action itself; hand the module the remaining tokens.
    table.remove(args, 1)
    ns.commandHandlers[action](args)
  else showHelp() end
end

-- /roll results. The pattern is built from the client's own
-- RANDOM_ROLL_RESULT text so French (and other) clients work, with the
-- English form as a fallback. Returns name, value, min, max.
local function buildRollPattern(template)
  template = string.gsub(template, "%%%d*%$?s", "\001")
  template = string.gsub(template, "%%%d*%$?d", "\002")
  template = string.gsub(template, "([%%%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
  template = string.gsub(template, "\001", "(.-)")
  template = string.gsub(template, "\002", "(%%d+)")
  return "^" .. template .. "$"
end

local ROLL_PATTERNS = { buildRollPattern("%s rolls %d (%d-%d)") }
if type(RANDOM_ROLL_RESULT) == "string" then
  table.insert(ROLL_PATTERNS, 1, buildRollPattern(RANDOM_ROLL_RESULT))
end

local function parseRoll(text)
  if type(text) ~= "string" or isSecret(text) then return nil end
  for _, pattern in ipairs(ROLL_PATTERNS) do
    local roller, value, minValue, maxValue = string.match(text, pattern)
    if roller then return normalizeName(roller), tonumber(value), tonumber(minValue), tonumber(maxValue) end
  end
  return nil
end

local function handlePeerReadiness(text, sender, channel)
  local parts = {}
  for part in string.gmatch(text, "[^|]+") do table.insert(parts, part) end
  if parts[1] ~= "READINESS" or not parts[2] then return end
  -- A client may only report its own character; otherwise anyone could
  -- overwrite a guildmate's readiness in every officer's export.
  local name = normalizeName(parts[2])
  if not name or name ~= normalizeName(sender) then return end
  -- The guild channel only carries guildmates; in a raid or party a pug's digest would end
  -- up in every officer's export (and the bot would "discover" them), so only members count.
  if channel ~= "GUILD" and not isGuildMember(name) then return end
  local professions, flags, identity = "", "", nil
  for index = 6, #parts do
    if string.sub(parts[index], 1, 2) == "F:" then flags = string.sub(parts[index], 3)
    elseif string.sub(parts[index], 1, 2) == "I:" then
      local class, race, level, spec = string.match(string.sub(parts[index], 3), "^([^,]*),([^,]*),(%d*),?(.*)$")
      if class and class ~= "" then identity = { class = class, race = race, level = tonumber(level) or 0, spec = spec or "" } end
    elseif professions == "" then professions = parts[index] end
  end
  db.peerRoster[name] = {
    status = parts[3] or "UNKNOWN",
    missing = tonumber(parts[4]) or 0,
    minDurability = tonumber(parts[5]) or 100,
    professions = professions,
    flags = flags,
    identity = identity,
    updatedAt = now(),
    -- When it arrived (seconds), so the Ready page can say how old it is.
    seenAt = (GetServerTime and GetServerTime()) or time(),
    reportedBy = name
  }
  if ns.onPeerReadiness then pcall(ns.onPeerReadiness, name) end
end

-- A "ready check" from someone in your raid or party: look at yourself again and answer on
-- the group channel. At most once per 20 seconds, never in combat, and only when it
-- came through the raid or party channel (not from a stranger's whisper).
local lastReadyAnswerAt = 0
local function handleReadyRequest(channel, sender)
  if channel ~= "RAID" and channel ~= "PARTY" then return end
  -- Only an officer, the group leader or an assistant can ask (not any random raider).
  if not (ns.ready and ns.ready.isRequester and ns.ready.isRequester(sender)) then return end
  if (InCombatLockdown and InCombatLockdown()) then return end
  local nowSeconds = (GetServerTime and GetServerTime()) or time()
  if nowSeconds - lastReadyAnswerAt < 20 then return end
  lastReadyAnswerAt = nowSeconds
  if ns.inspectReadiness then pcall(ns.inspectReadiness, true, channel) end
  -- Also share what you carry right now (flask, food, weapon enchant, ...): the requester's
  -- page shows it even when the game hides your buffs from them.
  if ns.ready and ns.ready.broadcastSelf then pcall(ns.ready.broadcastSelf, channel) end
end

-- ---------------------------------------------------------------------
-- One saved-data set per WoW guild. A WoW install with characters in two
-- guilds must not mix their ledgers, rosters and raids, so the active data
-- lives at the top of GuildedDB (every module reads it as before) and the
-- data of other guilds is parked in GuildedDB.otherGuilds[key]. When the
-- character's guild differs from the one the data belongs to, the two are
-- swapped in place. The guild is only known once the client has loaded it,
-- so this is tried on entering the world and on guild roster updates.
-- ---------------------------------------------------------------------
local KEEP_AT_ROOT = { version = true, guildKey = true, otherGuilds = true }
local guildResolved = false

local function currentGuildKey()
  if not (IsInGuild and IsInGuild()) then return nil end
  local guildName = GetGuildInfo and GetGuildInfo("player")
  if type(guildName) ~= "string" or guildName == "" or isSecret(guildName) then return nil end
  local realm = (ns.compat and ns.compat.identity().realm) or (GetRealmName and GetRealmName()) or ""
  return guildName .. "-" .. realm
end

-- Returns "recorded", "same", "switched" or nil (guild not known yet / no guild).
local function resolveGuildData()
  if guildResolved or not db then return nil end
  local key = currentGuildKey()
  if not key then return nil end
  guildResolved = true
  if not db.guildKey then
    -- First time: the data already saved belongs to this guild.
    db.guildKey = key
    return "recorded"
  end
  if db.guildKey == key then return "same" end
  local old = db.guildKey
  db.otherGuilds = db.otherGuilds or {}
  -- Same guild name, new realm text (the realm name changes when the game
  -- goes from beta to release): keep the data, just rename the key. Only when
  -- nothing is parked under the new key, so two same-named guilds on
  -- different realms are still told apart.
  local function guildPart(text) return (string.match(text, "^(.*)%-[^%-]*$")) or text end
  if guildPart(old) == guildPart(key) and not db.otherGuilds[key] then
    db.guildKey = key
    message(string.format("Guild realm changed from \"%s\" to \"%s\": your saved data was kept (same guild name).", old, key))
    return "rekeyed"
  end
  local parked = {}
  for field, value in pairs(db) do
    if not KEEP_AT_ROOT[field] then parked[field] = value end
  end
  for field in pairs(parked) do db[field] = nil end
  db.otherGuilds[old] = parked
  local incoming = db.otherGuilds[key]
  db.otherGuilds[key] = nil
  local restored = false
  if incoming then
    for field, value in pairs(incoming) do db[field] = value end
    restored = true
  end
  db.guildKey = key
  ensureDb()
  message(string.format("Guild changed: now using the saved data for %s (%s). Data for %s is kept and comes back if you play there. /reload is recommended.",
    key, restored and "restored" or "new", old))
  return "switched"
end

local function onEvent(_, event, ...)
  if event == "PLAYER_LOGIN" then
    ensureDb()
    -- Keep the character block fresh for the companion export.
    local capturedOk, captured = pcall(collectCharacter)
    if capturedOk then db.character = captured end
    snapshotModules()
    registerPrefix()
    message("Loaded. /guilded help for commands" .. (activeRaid and (" - raid '" .. activeRaid.title .. "' is still active.") or "."))
    for _, pending in ipairs(pendingDiagnostics) do
      logDiagnostic(pending.kind, pending.detail, pending.foreign)
    end
    pendingDiagnostics = {}
    return
  end
  if not db then return end
  if event == "PLAYER_ENTERING_WORLD" then
    resolveGuildData()
    maybeAutoSync(AUTO_SYNC_DEBOUNCE_SECONDS)
  elseif event == "UNIT_INVENTORY_CHANGED" then
    local unit = ...
    if unit == "player" then maybeAutoSync(AUTO_SYNC_DEBOUNCE_SECONDS) end
  elseif event == "GROUP_ROSTER_UPDATE" then
    if activeRaid then recordPresence() end
    if inRaidGroup() then maybeAutoSync(AUTO_SYNC_RAID_INTERVAL_SECONDS) end
  elseif event == "GUILD_ROSTER_UPDATE" then
    -- Before anything is added to the roster: make sure it is the right guild's data.
    resolveGuildData()
    local count = GetNumGuildMembers and GetNumGuildMembers() or 0
    db.lastRosterUpdate = now()
    local inRoster = {}
    for i = 1, count do
      local name = normalizeName(GetGuildRosterInfo(i))
      if name then
        inRoster[name] = true
        local entry = db.roster[name]
        if not entry then
          db.roster[name] = { firstSeen = now(), inGuild = true, joinedAt = now() }
        elseif entry.inGuild == false then
          entry.inGuild, entry.joinedAt, entry.leftAt = true, now(), nil
        end
      end
    end
    -- A full roster that no longer lists someone means they left. Nothing is concluded from
    -- an empty roster (not loaded yet) or one that hides offline members.
    local showsOffline = true
    if GetGuildRosterShowOffline then
      local ok, value = pcall(GetGuildRosterShowOffline)
      if ok and value == false then showsOffline = false end
    end
    if next(inRoster) and showsOffline then
      for name, entry in pairs(db.roster) do
        if not inRoster[name] and entry.inGuild ~= false then entry.inGuild, entry.leftAt = false, now() end
      end
    end
  elseif event == "CHAT_MSG_LOOT" and db.settings.captureLoot then
    local text = ...
    if not isSecret(text) then logEvent("LOOT_HINT", { text = text }) end
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, channel, sender = ...
    if isSecret(prefix) or isSecret(text) or isSecret(sender) then return end
    if prefix ~= PREFIX or normalizeName(sender) == playerName() then return end
    if string.sub(text, 1, 10) == "READINESS|" then
      -- Every online guildmate sends these; keep them out of the journal.
      handlePeerReadiness(text, sender, channel)
    elseif string.sub(text, 1, 9) == "READYREQ|" then
      handleReadyRequest(channel, sender)
    elseif string.sub(text, 1, 11) == "ATTUNEMENT|" then
      -- Other players' own attunements (Modules/Attunements.lua keeps only self-reports).
      if ns.attunements and ns.attunements.handleMessage then pcall(ns.attunements.handleMessage, text, channel, sender) end
    elseif string.sub(text, 1, 8) == "CONSUME|" then
      -- What a groupmate carries, sent by their own addon (Modules/Ready.lua checks who and where).
      if ns.ready and ns.ready.handleReport then pcall(ns.ready.handleReport, text, channel, sender) end
    else
      -- Everything else on this prefix is informational (other officers' raid, loot and
      -- EP lines). It is not saved: a chatty or broken client would push real history out
      -- of the journal and keep marking the data as changed. /guilded diag shows the count.
      ns.ignoredMessages = (ns.ignoredMessages or 0) + 1
    end
  elseif event == "ADDON_ACTION_BLOCKED" or event == "ADDON_ACTION_FORBIDDEN" then
    -- Fires with the exact addon and function name WoW refused to let run --
    -- this is the precise diagnostic the "blocked from an action only
    -- available to the Blizzard UI" popup itself doesn't show you.
    local blockedAddon, blockedFunction = ...
    logDiagnostic(event, string.format("%s tried to call %s", tostring(blockedAddon), tostring(blockedFunction)),
      blockedAddon ~= addonName)
  elseif event == "UI_ERROR_MESSAGE" then
    -- Fallback net in case the blocked-action popup surfaces as a generic UI
    -- error toast instead of ADDON_ACTION_BLOCKED/FORBIDDEN -- log it only
    -- when it looks relevant, since this event also fires constantly for
    -- ordinary gameplay ("not enough mana", etc.).
    local errorType, errorText = ...
    if isSecret(errorText) then return end
    local text = string.lower(tostring(errorText or errorType or ""))
    if string.find(text, "block") or string.find(text, "forbidden") or string.find(text, "addon") then
      logDiagnostic("UI_ERROR_MESSAGE", tostring(errorText or errorType))
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("UNIT_INVENTORY_CHANGED")
frame:RegisterEvent("GROUP_ROSTER_UPDATE")
frame:RegisterEvent("GUILD_ROSTER_UPDATE")
frame:RegisterEvent("CHAT_MSG_LOOT")
-- Deliberately NOT registering COMBAT_LOG_EVENT_UNFILTERED: since patch 12.0.0
-- addons cannot register it, and WoW Forever inherits that restriction.
-- Trying to is what produced the "blocked from an action only available to
-- the Blizzard UI" popup at load. Boss kills and attendance are manual anyway.
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:RegisterEvent("ADDON_ACTION_BLOCKED")
frame:RegisterEvent("ADDON_ACTION_FORBIDDEN")
frame:RegisterEvent("UI_ERROR_MESSAGE")
-- One bad event must not stop the handler for every later event.
local SLOW_HANDLER_MS = 50
frame:SetScript("OnEvent", function(_, event, ...)
  local started = debugprofilestop and debugprofilestop()
  local ok, err = pcall(onEvent, _, event, ...)
  if not ok then logDiagnostic("LUA_ERROR", "Guilded event handler: " .. tostring(err)) end
  if started then
    local elapsed = debugprofilestop() - started
    if elapsed >= SLOW_HANDLER_MS then
      logDiagnostic("SLOW", string.format("%s took %.0f ms", tostring(event), elapsed))
    end
  end
end)

SLASH_GUILDED1 = "/guilded"
SLASH_GUILDED2 = "/gd"
SlashCmdList["GUILDED"] = command

-- Shared namespace API for modules (see Modules/Casino.lua).
ns.ensureDb = ensureDb
ns.playerName = playerName
ns.normalizeName = normalizeName
ns.parseRoll = parseRoll
ns.isSecret = isSecret
ns.now = now
ns.message = message
ns.send = send
ns.inspectReadiness = inspectReadiness
ns.isOfficer = isOfficer
ns.isOfficerName = isOfficerName
ns.isGuildMember = isGuildMember
ns.runCommand = command
ns.getSettings = function() return db and db.settings end
-- Read-only views for the tools panel (Modules/Minimap.lua).
ns.getDb = function() return db end
ns.logDiagnostic = logDiagnostic
ns.getActiveRaid = function() return activeRaid end
ns.groupMembers = groupMembers
ns.getPresenceCount = function()
  local count = 0
  if activeRaid and db and db.presence[activeRaid.id] then
    for _ in pairs(db.presence[activeRaid.id]) do count = count + 1 end
  end
  return count
end
