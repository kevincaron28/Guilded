-- Shared helpers (ns.util) and the paced addon-message queue (ns.comm), used by Core and
-- every module. Loaded first (see Guilded.toc); whatever it needs from Core (names,
-- diagnostics) is looked up when called, so it works before Core has run.
local addonName, ns = ...
ns = ns or {}

local MAX_ADDON_MESSAGE = 255

local function isSecret(value)
  return issecretvalue ~= nil and issecretvalue(value) == true
end

local function normalizeName(name)
  if ns.normalizeName then return ns.normalizeName(name) end
  if type(name) ~= "string" or isSecret(name) then return nil end
  return string.match(name, "^([^%-%s]+)") or name
end

local function playerName()
  if ns.playerName then return ns.playerName() end
  return UnitName and UnitName("player") or "Unknown"
end

local function diag(kind, detail)
  if ns.logDiagnostic then pcall(ns.logDiagnostic, kind, detail) end
end

-- ---------------------------------------------------------------------
-- Small helpers every module shares (ns.util), so each rule lives once.
-- ---------------------------------------------------------------------
local util = ns.util or {}
ns.util = util
-- Dungeon roles have one canonical spelling; old snapshots/native APIs use DAMAGER.
function util.dungeonRole(value)
  if type(value) ~= "string" or isSecret(value) then return nil end
  local role = string.upper((string.gsub(value, "^%s*(.-)%s*$", "%1")))
  if role == "DAMAGER" or role == "DPS" then return "DPS" end
  if role == "TANK" or role == "HEALER" then return role end
  return nil
end

-- Forever's second UnitName result is a surname, not a realm. Since 8.5 Forever keys are the
-- full "First Last" (see util.characterKey); never treat the surname as a realm.
function util.isForever()
  if not GetBuildInfo then return false end
  local ok, _, _, _, interface = pcall(GetBuildInfo)
  return ok and not isSecret(interface) and interface == 16001
end

function util.clientInterface()
  if not GetBuildInfo then return nil end
  local ok, _, _, _, api = pcall(GetBuildInfo)
  if ok and not isSecret(api) and type(api) == "number" then return api end
end

function util.gameEdition()
  local api = util.clientInterface()
  if not api then return "unknown" end
  if api == 16001 then return "forever" end
  if api >= 11500 and api < 11600 then return "classic-era" end
  if api >= 20500 and api < 20600 then return "classic-tbc" end
  if api >= 50500 and api < 50600 then return "classic-mists" end
  if api >= 120000 and api < 130000 then return "retail" end
  return "unknown"
end

-- Blizzard characters are identified by name AND realm; Forever characters by "First Last"
-- (its second UnitName value is a surname, and its realm labels are unreliable).
function util.realmKey(realm)
  if type(realm) ~= "string" or isSecret(realm) then return "" end
  return (realm:gsub("%s+", ""))
end

function util.localRealm()
  local fn = GetNormalizedRealmName or GetRealmName
  if fn then
    local ok, realm = pcall(fn)
    if ok then return util.realmKey(realm) end
  end
  return ""
end

-- WoW Forever characters have a first AND a last name, and one player's alts often share the
-- first name ("Lebowski Holyroller", "Lebowski Greenleaf"). Since 8.5 a Forever key is the full
-- "First Last" (each word capitalized); before, it was the first word only, so such alts shared
-- one ledger account, roster row and Discord character. A first name alone (old saved data, an
-- older guildmate's addon, a bot row from before the fix, a typed command) resolves to the full
-- name only when exactly one known character has that first name; otherwise it stays as is and
-- Modules/ForeverNames.lua lists it for an officer.
local function capitalized(word)
  return word:sub(1, 1):upper() .. word:sub(2):lower()
end

local fullNames, fullNamesSeeded = {}, false -- lower(first) -> { [full] = true }
local seedFullNames
function util.learnFullName(full)
  if type(full) ~= "string" or isSecret(full) then return end
  local first = full:match("^(%S+) %S+$")
  if not first then return end
  seedFullNames()
  local key = first:lower()
  fullNames[key] = fullNames[key] or {}
  fullNames[key][full] = true
end

-- Full names this PC already knows from saved data (roster, guildmates heard, own characters).
seedFullNames = function()
  local db = ns.getDb and ns.getDb()
  if type(db) ~= "table" or fullNamesSeeded == db then return end
  -- Another guild's saved data (or the first call): its own names only.
  fullNames, fullNamesSeeded = {}, db
  for _, tableName in ipairs({ "roster", "peerRoster", "myCharacters", "displayNames" }) do
    for key, value in pairs(type(db[tableName]) == "table" and db[tableName] or {}) do
      if type(key) == "string" then util.learnFullName(util.characterKey(key)) end
      if type(value) == "string" then util.learnFullName(util.characterKey(value))
      elseif type(value) == "table" and type(value.displayName) == "string" then util.learnFullName(util.characterKey(value.displayName)) end
    end
  end
end
-- After a guild switch or in tests: forget and re-read.
function util.resetFullNames() fullNames, fullNamesSeeded = {}, false end

-- The one full name known for a first name, or nil (none, or several: ambiguous).
function util.fullNameFor(first)
  if type(first) ~= "string" then return nil end
  seedFullNames()
  local found
  for full in pairs(fullNames[first:lower()] or {}) do
    if found then return nil end
    found = full
  end
  return found
end
-- Every known full name sharing this first name (for the officer's list of ambiguous keys).
function util.fullNamesFor(first)
  seedFullNames()
  local list = {}
  for full in pairs(fullNames[(first or ""):lower()] or {}) do table.insert(list, full) end
  table.sort(list)
  return list
end

function util.characterKey(name, realm)
  if type(name) ~= "string" or isSecret(name) then return nil end
  if isSecret(realm) then return nil end
  name = name:match("^%s*(.-)%s*$")
  -- Missing build information is the old client/test contract: first names only.
  if util.isForever() then
    local base = name:match("^([^%-]+)%-") or name
    local first, last = base:match("^(%S+)%s+(%S+)")
    first = first or base:match("^(%S+)")
    if not first or first == "" then return nil end
    first = capitalized(first)
    if last then
      local full = first .. " " .. capitalized(last)
      util.learnFullName(full)
      return full
    end
    return util.fullNameFor(first) or first
  end
  local first, suffix = name:match("^([^%-%s]+)%-(.+)$")
  first = first or name:match("^([^%-%s]+)")
  if not first or first == "" then return nil end
  first = capitalized(first)
  if not util.clientInterface() then return first end
  realm = util.realmKey(suffix or (realm ~= "" and realm) or util.localRealm())
  return realm ~= "" and (first .. "-" .. realm:lower()) or first
end

-- Saved data from before 8.5 keyed Forever characters by first name. After each roster load
-- (the roster lists every guild member's full name, so "only one Lebowski" is a fact and not a
-- guess from partial data), a first-name key moves to the one full name known for it. Descriptive tables
-- (roster, digests heard, recipes...) merge into an existing full-name entry, newest first.
-- Accounting tables (EP/GP, reserves) never merge: if both keys exist, or several characters
-- share the first name, the old key stays untouched and is listed for an officer
-- (db.nameMigration.flagged, /guilded names). Nothing is ever deleted without a new home.
local NAME_TABLES = {
  { path = { "roster" } }, { path = { "peerRoster" } }, { path = { "readiness" } },
  { path = { "displayNames" } }, { path = { "myCharacters" } }, { path = { "attunements" } },
  { path = { "crafterSeen" } }, { path = { "recipeBook", "people" } }, { path = { "recipeBook", "cooldowns" } },
  { path = { "recipeBook", "cooldownAt" } }, { path = { "scores", "bests" } }, { path = { "scores", "board" } },
  { path = { "relay", "carriers" } }, { path = { "settings", "officers" } },
  { path = { "epgp" }, accounting = true }, { path = { "reserves", "entries" }, accounting = true },
  { path = { "reserves", "plus" }, accounting = true }
}

local function tableAt(db, path)
  local node = db
  for _, step in ipairs(path) do
    if type(node) ~= "table" then return nil end
    node = node[step]
  end
  return type(node) == "table" and node or nil
end

function util.migrateForeverNames(db)
  if not util.isForever() or type(db) ~= "table" then return { moved = 0, flagged = 0 } end
  db.nameMigration = type(db.nameMigration) == "table" and db.nameMigration or {}
  local state = db.nameMigration
  state.flagged = type(state.flagged) == "table" and state.flagged or {}
  local moved, flagged = 0, 0
  for _, spec in ipairs(NAME_TABLES) do
    local where = table.concat(spec.path, ".")
    local entries = tableAt(db, spec.path)
    local keys = {}
    for key in pairs(entries or {}) do
      if type(key) == "string" and not key:find(" ", 1, true) and not key:find("-", 1, true) then table.insert(keys, key) end
    end
    table.sort(keys)
    for _, key in ipairs(keys) do
      local flagKey = where .. ":" .. key
      local full = util.fullNameFor(key)
      local value = entries[key]
      if full and entries[full] == nil then
        entries[full], entries[key] = value, nil
        state.flagged[flagKey] = nil
        moved = moved + 1
      elseif full and not spec.accounting and type(value) == "table" and type(entries[full]) == "table" then
        for field, old in pairs(value) do
          local current = entries[full][field]
          -- The roster scan just created the full-name row: the old row knows the real first sighting.
          if current == nil or ((field == "firstSeen" or field == "joinedAt") and type(old) == "string"
            and type(current) == "string" and old < current) then entries[full][field] = old end
        end
        entries[key] = nil
        state.flagged[flagKey] = nil
        moved = moved + 1
      elseif full and not spec.accounting and type(value) ~= "table" then
        entries[key] = nil -- a string/flag already present under the full name
        moved = moved + 1
      elseif full or #util.fullNamesFor(key) > 1 then
        local candidates = full and { full } or util.fullNamesFor(key)
        if not state.flagged[flagKey] then flagged = flagged + 1 end
        state.flagged[flagKey] = { table = where, key = key, candidates = candidates,
          reason = full and "both" or "shared first name" }
      end
    end
  end
  return { moved = moved, flagged = flagged }
end

-- Lines for /guilded names: first-name keys an officer must sort out by hand.
function util.nameMigrationLines(db)
  local lines = {}
  for _, entry in pairs(type(db) == "table" and type(db.nameMigration) == "table" and db.nameMigration.flagged or {}) do
    if type(entry) == "table" then
      table.insert(lines, string.format("%s %s -> %s (%s)", tostring(entry.table), tostring(entry.key),
        table.concat(type(entry.candidates) == "table" and entry.candidates or {}, " / "), tostring(entry.reason)))
    end
  end
  table.sort(lines)
  return lines
end

-- The first name of a key ("Lebowski" for "Lebowski Holyroller"); the key itself elsewhere.
function util.firstName(key)
  if type(key) ~= "string" then return nil end
  return key:match("^(%S+) ") or key
end

-- Two names are the same character: equal keys, or (an older addon or saved row that knew only
-- the first name) one is a bare first name and the other a full name starting with it.
function util.sameCharacter(a, b)
  local ka, kb = util.characterKey(a or ""), util.characterKey(b or "")
  if not ka or not kb then return false end
  if ka == kb then return true end
  if not util.isForever() then return false end
  local short, long = ka, kb
  if ka:find(" ", 1, true) then short, long = kb, ka end
  return not short:find(" ", 1, true) and long:find(" ", 1, true) ~= nil and util.firstName(long) == short
end

function util.unitKey(unit)
  local fn = (not util.isForever() and UnitFullName) or UnitName
  if not fn then return nil end
  local ok, first, second = pcall(fn, unit)
  if not ok then return nil end
  if util.isForever() then
    -- Forever's second UnitName value is the surname, not a realm.
    if type(first) == "string" and not isSecret(first) and not first:find(" ", 1, true)
      and type(second) == "string" and not isSecret(second) and second:match("^%S+$") then
      return util.characterKey(first .. " " .. second)
    end
    return util.characterKey(first)
  end
  return util.characterKey(first, second)
end

-- A name without its realm. On Forever that keeps "First Last".
function util.bareName(name)
  if type(name) ~= "string" or isSecret(name) then return nil end
  if util.isForever() then return (name:match("^([^%-]+)") or name):match("^%s*(.-)%s*$") end
  return name:match("^([^%-%s]+)") or name
end

local function safeName(value)
  if type(value) ~= "string" or isSecret(value) or #value > 80 or value:find("[|%c]") then return nil end
  value = value:match("^%s*(.-)%s*$")
  return value ~= "" and value or nil
end

function util.rememberDisplayName(raw)
  if not util.isForever() then return end
  raw = safeName(raw)
  if not raw or not raw:find(" ", 1, true) then return end
  local key = normalizeName(raw)
  local db = ns.getDb and ns.getDb()
  if key and db then
    db.displayNames = db.displayNames or {}
    db.displayNames[key] = raw
  end
end

function util.unitDisplayName(unit)
  if not UnitName then return nil end
  local ok, first, second = pcall(UnitName, unit)
  if not ok then return nil end
  first, second = safeName(first), safeName(second)
  if not first then return nil end
  if not util.isForever() then return util.bareName(first) end
  local full
  if GetUnitName then
    local fullOk, value = pcall(GetUnitName, unit, true)
    if fullOk then full = safeName(value) end
  end
  -- The observed Forever API returns "First Last". Never append a realm
  -- on Retail/Classic, or invent a surname when the client withholds it.
  if not full or not full:find(" ", 1, true) then
    full = first:find(" ", 1, true) and first or (second and (first .. " " .. second) or first)
  end
  util.rememberDisplayName(full)
  return full
end

function util.displayName(name)
  if not util.isForever() then return util.bareName(name) end
  local db = ns.getDb and ns.getDb()
  local key = normalizeName(name)
  return (db and db.displayNames and key and safeName(db.displayNames[key])) or name
end
ns.displayName = util.displayName

-- Same spelling rule as the bot's item keys: lower case, separators and control characters
-- become spaces, runs of spaces collapse.
function util.itemKey(name)
  if type(name) ~= "string" then return nil end
  local key = string.lower(name)
  key = string.gsub(key, "[|;~:,%c]", " ")
  key = string.gsub(key, "%s+", " ")
  key = string.gsub(key, "^ ", "")
  key = string.gsub(key, " $", "")
  if key == "" then return nil end
  return key
end

-- Days since 1970-01-01 of a civil date (no time zone in it).
function util.daysFromCivil(y, m, d)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local mp = (m + 9) % 12
  local doy = math.floor((153 * mp + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
end

-- "2026-10-01T23:00:00Z" (fractions allowed) -> seconds since 1970 (UTC), or nil.
function util.isoEpoch(text)
  local y, m, d, hh, mm, ss = string.match(tostring(text or ""), "^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
  if not y then return nil end
  return util.daysFromCivil(tonumber(y), tonumber(m), tonumber(d)) * 86400 + tonumber(hh) * 3600 + tonumber(mm) * 60 + tonumber(ss)
end

-- A bot timestamp (ISO UTC, or seconds) in the player's own time, short: "today 11:56",
-- "yesterday 21:03" or "14/10 21:03". Shown instead of "2026-10-16T15:56:40.149Z".
function util.whenText(stamp)
  local seconds = type(stamp) == "number" and stamp or util.isoEpoch(stamp)
  if not seconds then return nil end
  local L = ns.L or function(text) return text end
  local now = util.serverTime()
  local day, clock = date("%Y-%m-%d", seconds), date("%H:%M", seconds)
  if day == date("%Y-%m-%d", now) then return string.format(L("today %s"), clock) end
  if day == date("%Y-%m-%d", now - 86400) then return string.format(L("yesterday %s"), clock) end
  return date("%d/%m", seconds) .. " " .. clock
end

-- Opens one of the game's own windows (dungeon finder, calendar, guild) the way the game does, so
-- Escape and the other windows treat it normally. A plain frame:Show() bypasses the game's window
-- manager: Escape then opened the Game Menu and left the window open (seen on WoW Forever).
local escapeNames = {}
function util.showWindow(frame)
  if not frame then return end
  local name = frame.GetName and frame:GetName()
  if name and UIPanelWindows and UIPanelWindows[name] and ShowUIPanel then
    ShowUIPanel(frame)
    return
  end
  frame:Show()
  if name and UISpecialFrames and not escapeNames[name] then
    escapeNames[name] = true
    local listed = false
    for _, existing in ipairs(UISpecialFrames) do if existing == name then listed = true break end end
    if not listed then table.insert(UISpecialFrames, name) end
  end
end

-- Closes such a window the same way.
function util.hideWindow(frame)
  if not frame then return end
  local name = frame.GetName and frame:GetName()
  if name and UIPanelWindows and UIPanelWindows[name] and HideUIPanel then HideUIPanel(frame) else frame:Hide() end
end

-- Combat lockdown: the game refuses Show/Hide/SetParent/SetPoint on protected frames (and on
-- anything anchored to or parented under one, like our panel inside the guild window) while
-- the player is in combat, and logs ADDON_ACTION_BLOCKED. util.afterCombat(key, fn) runs fn
-- now out of combat; in combat it queues fn (one slot per key, the latest wins) for
-- PLAYER_REGEN_ENABLED and tells the player once. Returns true when it deferred.
local pendingAfterCombat, pendingOrder, combatNoticeShown, combatWatcher = {}, {}, false, nil
function util.inCombat()
  if type(InCombatLockdown) ~= "function" then return false end
  local ok, value = pcall(InCombatLockdown)
  return ok and value == true
end
local function runAfterCombat()
  local order = pendingOrder
  local actions = pendingAfterCombat
  pendingOrder, pendingAfterCombat = {}, {}
  for _, key in ipairs(order) do
    local fn = actions[key]
    if fn then
      local ok, err = pcall(fn)
      if not ok then diag("LUA_ERROR", "after combat " .. tostring(key) .. ": " .. tostring(err)) end
    end
  end
end
function util.afterCombat(key, fn, quiet)
  if not util.inCombat() then fn() return false end
  if pendingAfterCombat[key] == nil then pendingOrder[#pendingOrder + 1] = key end
  pendingAfterCombat[key] = fn
  if not combatWatcher and CreateFrame then
    combatWatcher = CreateFrame("Frame")
    combatWatcher:RegisterEvent("PLAYER_REGEN_ENABLED")
    combatWatcher:SetScript("OnEvent", function() runAfterCombat() end)
  end
  if not combatNoticeShown and not quiet and ns.message then
    combatNoticeShown = true
    pcall(ns.message, ns.L and ns.L("Guilded will finish this after combat.") or "Guilded will finish this after combat.")
  end
  return true
end
-- For tests: whether anything is waiting for combat to end.
function util.pendingAfterCombat(key) return pendingAfterCombat[key] ~= nil end

function util.serverTime()
  if GetServerTime then
    local ok, value = pcall(GetServerTime)
    if ok and type(value) == "number" and not isSecret(value) then return value end
  end
  return time()
end

-- Shared data (standings, module switches, ...) is replaced by a "newer" copy. A clock
-- far in the future would pin one copy for good, so anything more than 10 minutes ahead
-- of the server clock is refused. Accepts ISO text or epoch seconds.
local FUTURE_SLACK_SECONDS = 600
function util.tooFarAhead(stamp)
  if type(stamp) == "string" then
    -- A later year is refused before any arithmetic (Lua builds with 32-bit integers would
    -- overflow on far-future seconds).
    local year = tonumber(string.match(stamp, "^(%d+)-"))
    local ok, parts = pcall(date, "!*t", util.serverTime())
    local nowYear = ok and type(parts) == "table" and parts.year or nil
    if year and nowYear and year > nowYear + 1 then return true end
  end
  local seconds = type(stamp) == "number" and stamp or util.isoEpoch(stamp)
  if not seconds then return false end
  return seconds > util.serverTime() + FUTURE_SLACK_SECONDS
end

-- The group chat channel right now, or nil when alone.
function util.groupChannel()
  if IsInRaid and IsInRaid() then return "RAID" end
  if IsInGroup and IsInGroup() then return "PARTY" end
  return nil
end

-- True when `name` is in your raid or party right now (whispered bids and answers only
-- count from the group, never from anyone who happens to whisper a number).
function util.inMyGroup(name)
  name = normalizeName(name)
  if not name then return false end
  if name == playerName() then return true end
  local units = {}
  if IsInRaid and IsInRaid() then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do units[#units + 1] = "raid" .. i end
  elseif IsInGroup and IsInGroup() then
    for i = 1, 4 do units[#units + 1] = "party" .. i end
  end
  for _, unit in ipairs(units) do
    local ok, unitName = pcall(util.unitKey, unit)
    if ok and not isSecret(unitName) and normalizeName(unitName) == name then return true end
  end
  return false
end

-- The sender text the game last gave for each player in a Guilded addon message. A whisper
-- to a name from the roster or the group must use it: on WoW Forever the first name alone
-- is not a player ("No player named 'Naomine'", 16 October).
local addresses = {}
function util.rememberAddress(raw)
  if type(raw) ~= "string" or isSecret(raw) then return end
  local name = normalizeName(raw)
  if name then addresses[name] = raw end
  util.rememberDisplayName(raw)
end
function util.address(name)
  local key = normalizeName(name)
  return key and addresses[key] or name
end
-- Plain base64 (RFC 4648), so a pasted string survives chat, edit boxes and Discord.
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_INDEX = {}
for i = 1, #B64 do B64_INDEX[string.sub(B64, i, i)] = i - 1 end

function util.base64Encode(data)
  local out = {}
  for i = 1, #data, 3 do
    local a, b, c = string.byte(data, i, i + 2)
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local c1, c2, c3, c4 = math.floor(n / 262144) % 64, math.floor(n / 4096) % 64, math.floor(n / 64) % 64, n % 64
    out[#out + 1] = string.sub(B64, c1 + 1, c1 + 1) .. string.sub(B64, c2 + 1, c2 + 1)
      .. (b and string.sub(B64, c3 + 1, c3 + 1) or "=") .. (c and string.sub(B64, c4 + 1, c4 + 1) or "=")
  end
  return table.concat(out)
end

function util.base64Decode(text)
  text = string.gsub(text, "%s", "")
  if #text % 4 ~= 0 or string.find(text, "[^A-Za-z0-9+/=]") then return nil end
  local out = {}
  for i = 1, #text, 4 do
    local a, b = B64_INDEX[string.sub(text, i, i)], B64_INDEX[string.sub(text, i + 1, i + 1)]
    local c3, c4 = string.sub(text, i + 2, i + 2), string.sub(text, i + 3, i + 3)
    if not a or not b then return nil end
    local c, d = B64_INDEX[c3] or 0, B64_INDEX[c4] or 0
    local n = a * 262144 + b * 4096 + c * 64 + d
    out[#out + 1] = string.char(math.floor(n / 65536) % 256)
    if c3 ~= "=" then out[#out + 1] = string.char(math.floor(n / 256) % 256) end
    if c4 ~= "=" then out[#out + 1] = string.char(n % 256) end
  end
  return table.concat(out)
end

-- Cuts text to at most `limit` bytes without splitting a UTF-8 character in two.
function util.truncate(text, limit)
  if #text <= limit then return text end
  local cut = string.sub(text, 1, limit)
  -- Walk back over a trailing character that lost some of its bytes.
  local i = #cut
  while i > 0 and i > #cut - 4 do
    local byte = string.byte(cut, i)
    if byte < 128 then break end
    if byte >= 192 then
      local need = byte >= 240 and 4 or byte >= 224 and 3 or 2
      if #cut - i + 1 < need then cut = string.sub(cut, 1, i - 1) end
      break
    end
    i = i - 1
  end
  return cut
end

-- ---------------------------------------------------------------------
-- Outgoing addon messages (ns.comm). The server lets each prefix send a
-- burst of about ten messages, then about one a second; anything faster is
-- dropped without a word. Every module sends through this one paced queue
-- per prefix, which also retries a message the game says was throttled.
-- ---------------------------------------------------------------------
local comm = ns.comm or {}
ns.comm = comm
local BURST, PER_SECOND, MAX_TRIES = 8, 1, 5
local MAX_QUEUED = 1024
local INTERACTIVE_RESERVE = 16
local LOCKDOWN_RETRY_SECONDS = 5
local INSTANCE_RETRY_SECONDS = 10
-- Inside a 5-player dungeon, raid, battleground, arena or scenario (IsInInstance's type).
local HELD_INSTANCES = { party = true, raid = true, pvp = true, arena = true, scenario = true }
function util.inInstance()
  if type(IsInInstance) ~= "function" then return false end
  local ok, inside, kind = pcall(IsInInstance)
  return ok and inside == true and HELD_INSTANCES[kind or ""] == true
end
-- SendAddonMessage result codes (Enum.SendAddonMessageResult) that mean "try again".
local THROTTLED = { [3] = true, [8] = true }
local buckets = {}

local function nowSeconds()
  local ok, value = pcall(GetTime)
  if ok and type(value) == "number" then return value end
  return time()
end

local function rawSend(prefix, text, channel, target)
  local ok, result = pcall(function()
    if C_ChatInfo and C_ChatInfo.SendAddonMessage then return C_ChatInfo.SendAddonMessage(prefix, text, channel, target) end
    if SendAddonMessage then return SendAddonMessage(prefix, text, channel, target) end
    return false
  end)
  if not ok then return "error" end
  if type(result) == "number" then
    if result == 0 then return "sent", result end
    return THROTTLED[result] and "throttled" or "refused", result
  end
  if result == false then return "refused" end
  return "sent"
end

local function bucket(prefix)
  local b = buckets[prefix]
  local t = nowSeconds()
  if not b then
    b = { tokens = BURST, at = t, queue = {}, results = { sent = 0, refused = 0, error = 0, throttled = 0, oversized = 0, overflow = 0, abandoned = 0, cancelled = 0 } }
    buckets[prefix] = b
  end
  b.tokens = math.min(BURST, b.tokens + math.max(0, t - b.at) * PER_SECOND)
  b.at = t
  return b
end

local pump
local function schedule(prefix, b)
  if b.scheduled or not (C_Timer and C_Timer.After) then return end
  b.scheduled = true
  local delay = math.max(1 / PER_SECOND, (b.retryAt or 0) - b.at)
  C_Timer.After(delay, function() b.scheduled = false; pump(prefix) end)
end

pump = function(prefix)
  local b = bucket(prefix)
  if b.retryAt and b.at < b.retryAt then
    schedule(prefix, b)
    return
  end
  b.retryAt = nil
  while b.queue[1] and b.tokens >= 1 do
    -- Only explicitly independent traffic may bypass bulk transfers. Keep FIFO
    -- inside each lane, with one bulk packet after four interactive packets.
    local index = 1
    if (b.interactiveBurst or 0) < 4 then
      for i, candidate in ipairs(b.queue) do if candidate.interactive then index = i break end end
    else
      for i, candidate in ipairs(b.queue) do if not candidate.interactive then index = i break end end
    end
    local item = b.queue[index]
    if item.holdInInstance and util.inInstance() then
      -- Background sync waits outside; FIFO order and the guard are kept for the retry.
      b.retryAt = b.at + INSTANCE_RETRY_SECONDS
      b.lastResult, b.lastCode = "held", nil
      b.results.held = (b.results.held or 0) + 1
      break
    end
    local allowed = true
    if item.guard then
      local ok, value = pcall(item.guard)
      allowed = ok and value == true
    end
    if not allowed then
      table.remove(b.queue, index)
      b.results.cancelled = b.results.cancelled + 1
    else
      local status, code = rawSend(prefix, item.text, item.channel, item.target)
      -- Lockdown may outlast a combat encounter. Keep ordered, replay-safe data
      -- queued without using its throttle retries or probing on each enqueue.
      if code == 11 and item.retryLockdown then
        b.retryAt = b.at + LOCKDOWN_RETRY_SECONDS
        b.lastResult, b.lastCode = "lockdown", code
        break
      end
      b.results[status] = b.results[status] + 1
      if status == "sent" then b.results.bytes = (b.results.bytes or 0) + #item.text end
      b.lastResult, b.lastCode = status, code
      if status == "throttled" then
        b.tokens = 0
        item.tries = (item.tries or 0) + 1
        if item.tries >= MAX_TRIES then
          table.remove(b.queue, index)
          b.results.abandoned = b.results.abandoned + 1
          diag("SEND", prefix .. ": gave up on a message after " .. MAX_TRIES .. " throttled tries")
        end
        break
      end
      table.remove(b.queue, index)
      b.interactiveBurst = item.interactive and ((b.interactiveBurst or 0) + 1) or 0
      b.tokens = b.tokens - 1
    end
  end
  if b.queue[1] then schedule(prefix, b) end
end

-- Queues one message; it goes out at once when the prefix has room. Returns false when
-- there is nowhere to send it, the payload exceeds the limit, or the queue is full.
-- FIFO within each lane: leave all snapshot headers/chunks/end markers on the
-- default lane. Only independent, latency-sensitive messages opt into interactive.
-- Optional guard is rechecked before every attempt, including throttled retries.
-- "retry-lockdown" uses the bulk FIFO and retains packets through AddOnMessageLockdown.
-- "hold-in-instance" does the same and also waits while the player is inside a dungeon, raid,
-- battleground or arena (guild messages are unreliable there), for background sync only.
-- A false result or error discards the packet without consuming a send token.
function comm.send(prefix, text, channel, target, guard, priority)
  if not channel then return false end
  text = tostring(text)
  local b = bucket(prefix)
  if #text > MAX_ADDON_MESSAGE then
    b.results.oversized = b.results.oversized + 1
    diag("SEND", string.format("%s: rejected a %d-byte message (limit %d)", prefix, #text, MAX_ADDON_MESSAGE))
    return false
  end
  pump(prefix)
  if #b.queue >= (priority == "interactive" and MAX_QUEUED or MAX_QUEUED - INTERACTIVE_RESERVE) then
    b.results.overflow = b.results.overflow + 1
    if b.results.overflow == 1 then diag("SEND", prefix .. ": message queue full; retry sync later") end
    return false
  end
  local hold = priority == "hold-in-instance"
  table.insert(b.queue, { text = text, channel = channel, target = target, guard = guard,
    interactive = priority == "interactive", retryLockdown = hold or priority == "retry-lockdown", holdInInstance = hold })
  pump(prefix)
  return true
end

-- Messages still waiting for a prefix (0 when everything went out).
function comm.pending(prefix)
  local b = buckets[prefix]
  return b and #b.queue or 0
end

-- Client API results, not delivery receipts. No payloads or destinations are retained.
-- Return a copy so diagnostics cannot change the queue or its counters.
function comm.status(prefix)
  local b = buckets[prefix]
  return {
    sent = b and b.results.sent or 0, refused = b and b.results.refused or 0,
    errors = b and b.results.error or 0, throttled = b and b.results.throttled or 0,
    oversized = b and b.results.oversized or 0, overflow = b and b.results.overflow or 0,
    abandoned = b and b.results.abandoned or 0, cancelled = b and b.results.cancelled or 0,
    queued = b and #b.queue or 0, lastResult = b and b.lastResult or nil,
    lastCode = b and b.lastCode or nil
  }
end

-- (9.0) This session's addon traffic, all prefixes together (for /guilded sync stats):
-- messages sent and their bytes, messages held inside instances, and what Transport.lua
-- counted as received from guildmates' Guilded addons.
comm.received = comm.received or { count = 0, bytes = 0 }
function comm.totals()
  local out = { sent = 0, bytes = 0, held = 0, queued = 0, received = comm.received.count, receivedBytes = comm.received.bytes }
  for _, b in pairs(buckets) do
    out.sent = out.sent + (b.results.sent or 0)
    out.bytes = out.bytes + (b.results.bytes or 0)
    out.held = out.held + (b.results.held or 0)
    out.queued = out.queued + #b.queue
  end
  return out
end

-- Registers an addon message prefix with whichever API this client has.
function comm.register(prefix)
  pcall(function()
    if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then C_ChatInfo.RegisterAddonMessagePrefix(prefix)
    elseif RegisterAddonMessagePrefix then RegisterAddonMessagePrefix(prefix) end
  end)
end

