-- Copied from addon/Guilded/Util.lua by scripts/build-dungeons-addon.mjs. Edit the original, then run npm run dungeons:sync.
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

-- The companion (Windows app that sends your data to Discord), in the same three steps everywhere
-- members look: Home, /guilded companion, the login reminder and the "runs waiting" notice.
-- Zero setup since 9.1.0: it finds WoW and the Discord server by itself; signing in is optional.
util.COMPANION_PAGE = "https://guildedwow.com/companion/"
util.COMPANION_DOWNLOAD = "https://guildedwow.com/downloads/Guilded.Companion.Setup.exe"
function util.companionSteps()
  local function L(text) return ns.L and ns.L(text) or text end
  return {
    L("Sync with Discord in 3 steps (Windows only):"),
    L("1) Download it: copy the link, or search \"Guild Sync Companion\" in the Microsoft Store."),
    L("2) Run the installer. It finds WoW and your guild's Discord server by itself."),
    L("3) Keep it open (it starts with Windows). Signing in with Discord is optional."),
  }
end
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

-- Guilded supports WoW Forever only. Any other client is "unknown": nothing edition-specific runs,
-- and the bot refuses its uploads. Old saved data may still carry other edition names.
function util.gameEdition()
  return util.clientInterface() == 16001 and "forever" or "unknown"
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

-- (9.0) The key under which `map` holds this character: the exact key, or, while saved data from
-- an 8.4 companion or guildmate still uses first names, the one key that is the same character
-- (util.sameCharacter). Like the bot's transitional rule, a first name counts only when it is not
-- shared: two matching keys, or two known full names for that first name, mean no match.
function util.findCharacterKey(map, name)
  if type(map) ~= "table" or type(name) ~= "string" then return nil end
  if map[name] ~= nil then return name end
  if not util.isForever() then return nil end
  local found
  for key in pairs(map) do
    if type(key) == "string" and util.sameCharacter(key, name) then
      if found then return nil end
      found = key
    end
  end
  if not found then return nil end
  if #util.fullNamesFor(util.firstName(found:find(" ", 1, true) and found or name)) > 1 then return nil end
  return found
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

-- Invites. On WoW Forever the invite API (GuildInvite, C_GuildInfo.Invite, InviteUnit) is refused to addon code
-- even from a click ("Guilded has been blocked from an action only available to the Blizzard UI"). A secure
-- button running the macro "/ginvite First Last" is refused as well: the owner's taint log of 10 November 2026
-- shows "An action was blocked because of taint from (null) - Invite()" through RunMacroText, with no addon
-- taint at all. A line the addon puts in the chat box is refused too, even after the player types in it ("blocked
-- because of taint from Guilded - Invite()": the chat box's text counts as the addon's; owner tests, same day).
-- Only a line the player typed or pasted is accepted. So the Invite button shows "/ginvite First Last" (guild)
-- or "/invite First Last" (party) selected in Guilded's copy box: Ctrl+C, then paste it in chat and press Enter.
-- util.inviteMacro builds that line; util.inviteButton makes the button (a plain button: no secure frame).
-- Never write to the game's chat box here (ChatFrame_OpenChat, SetText, Insert).

function util.inviteMacro(kind, name)
  if type(name) ~= "string" or isSecret(name) then return nil end
  name = name:match("^%s*(.-)%s*$")
  if name == "" or #name > 80 or name:find("[|%c]") then return nil end
  return (kind == "party" and "/invite " or "/ginvite ") .. name
end

-- kind: "guild" or "party". The returned button has button.setInvite(name), button.inviteName() (the name it
-- invites right now) and button.inviteLine() (the chat line). A click shows the line in the copy box and says to
-- copy and paste it (or, without a copy box, which line to type), then runs onClick(name, shown).
function util.inviteButton(parent, kind, text, width, height, onClick)
  local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  if width and button.SetWidth then button:SetWidth(width) end
  if height and button.SetHeight then button:SetHeight(height) end
  if button.SetText then button:SetText(text) end
  local line, target
  function button.inviteName() return target end
  function button.inviteLine() return line end
  function button.setInvite(name)
    -- Forever names are "First Last" (no realm); the roster may append "-Realm", which /ginvite does not need.
    local bare = type(name) == "string" and util.isForever() and util.bareName(name) or name
    line = util.inviteMacro(kind, bare)
    target = line and bare or nil
  end
  local function tr(textKey) return ns.L and ns.L(textKey) or textKey end
  button:SetScript("OnClick", function()
    if not line then return end
    local shown = type(ns.showCopyText) == "function" and (pcall(ns.showCopyText, line, tr("Copy with Ctrl+C, then paste in chat"))) or false
    if ns.message then
      ns.message(string.format(shown and tr("Copy %s (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter.") or tr("Type %s to invite them."), line))
    end
    if onClick then onClick(target, shown) end
  end)
  return button
end

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

-- (9.1.7) One budget for EVERY prefix and channel. Each prefix keeps its own bucket, but about twenty
-- prefixes at a login together sent far more than the server lets one player send: it refused the excess
-- and printed "The number of messages that can be sent is limited" into the chat (owner report, 13 November
-- 2026). The budget lives in a global so Guilded and Guilded Dungeons, which each load this file, share it.
-- The rate adapts (AIMD): it starts at RATE_MAX (4 messages a second) and each real refusal cuts it by 40%
-- (4 becomes 2.4, floor RATE_MIN 1.5); after 30 quiet seconds it recovers 0.5 messages a second per quiet minute
-- (so one spurious refusal costs about three minutes of reduced speed). The real server limit is
-- unknown, so the start value is a guess that is allowed to learn. The game prints one refusal line per
-- refused send: only the FIRST of a burst counts as a strike (none while a back-off is running), and both
-- addons see the same line, so the shared back-off window also de-duplicates them.
local GLOBAL_BURST, RATE_MAX, RATE_MIN = 8, 4, 1.5
local RESUME_TOKENS = 2            -- after a back-off sending resumes gently, not with a full burst
local HIGH_RESERVE = 2             -- tokens only high-value traffic may use
local LOW_VALUE_RESERVE = 3        -- low-value traffic may only use tokens above this many
local LOW_VALUE_MAX_QUEUED = 3     -- a stale position or presence note is replaced, not queued behind itself
local BACKOFF_FIRST, BACKOFF_MAX, BACKOFF_FORGET = 2, 60, 30
-- Positions and "free to group" notes are the first traffic to wait or be dropped.
local LOW_VALUE = { GuildedMap = true, GuildedLayer = true }
-- Call for help and dungeon run receipts (plus any message queued "interactive") may use the reserved tokens.
local HIGH_VALUE = { GuildedSOS = true, GuildedDgn = true }
local function globalBudget()
  local g = _G.GuildedCommBudget
  if type(g) ~= "table" then
    g = { tokens = GLOBAL_BURST, at = nil, rate = RATE_MAX, strikes = 0, throttles = 0, refusals = 0, lastStrike = -1000, backoffUntil = 0 }
    _G.GuildedCommBudget = g
  end
  return g
end

local function nowSeconds()
  local ok, value = pcall(GetTime)
  if ok and type(value) == "number" then return value end
  return time()
end

local function rawSend(prefix, text, channel, target, chat)
  if chat then
    local ok, result = pcall(function()
      if C_ChatInfo and C_ChatInfo.SendChatMessage then return C_ChatInfo.SendChatMessage(text, channel, nil, target) end
      if SendChatMessage then return SendChatMessage(text, channel, nil, target) end
      return false
    end)
    if not ok or result == false then return "refused" end
    return "sent"
  end
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
    b = { tokens = BURST, at = t, queue = {}, results = { sent = 0, refused = 0, error = 0, throttled = 0, oversized = 0, overflow = 0, abandoned = 0, cancelled = 0, dropped = 0 } }
    buckets[prefix] = b
  end
  b.tokens = math.min(BURST, b.tokens + math.max(0, t - b.at) * PER_SECOND)
  b.at = t
  return b
end

local function removeItem(b, index) return table.remove(b.queue, index) end

local function inCombatNow()
  return (type(InCombatLockdown) == "function" and InCombatLockdown() == true)
    or (type(UnitAffectingCombat) == "function" and UnitAffectingCombat("player") == true)
end

-- The game (or the server through the game) said "slow down". Only the first refusal of a burst is a strike
-- (the game prints one line per refused send, and both addons hear it): while a back-off runs further
-- reports are only counted. A strike silences everything for a growing, jittered while, lowers the rate,
-- empties the budget (sending resumes with RESUME_TOKENS, see globalWait) and drops what is cheap to lose.
-- Returns the seconds of back-off now running.
function comm.noteThrottle()
  local g, t = globalBudget(), nowSeconds()
  g.refusals = (g.refusals or 0) + 1
  if t < (g.backoffUntil or 0) then return g.backoffUntil - t end
  g.throttles = (g.throttles or 0) + 1
  -- The quiet window counts from the END of the previous back-off (it may be 60 s long): a throttle that
  -- persists keeps escalating to BACKOFF_MAX instead of starting over at strike 1.
  if t - math.max(g.lastStrike or -1000, g.backoffUntil or -1000) > BACKOFF_FORGET then g.strikes = 0 end
  g.strikes = math.min((g.strikes or 0) + 1, 8)
  g.lastStrike = t
  g.rate = math.max(RATE_MIN, (g.rate or RATE_MAX) * 0.6)
  local seconds = math.min(BACKOFF_MAX, BACKOFF_FIRST * 2 ^ (g.strikes - 1))
  seconds = seconds * (1 + 0.5 * math.random())
  g.backoffUntil = t + seconds
  g.resume = true
  g.tokens = 0
  g.at = g.backoffUntil
  for prefix, other in pairs(buckets) do
    if LOW_VALUE[prefix] then
      while other.queue[1] do removeItem(other, 1); other.results.dropped = other.results.dropped + 1 end
    end
  end
  if g.strikes == 1 then diag("SEND", string.format("the game throttled sending; everything waits %.0f seconds", seconds)) end
  return seconds
end

-- The throttle line is recognised with the game's own global string, so every language works. If this
-- client's string or event differs from what is matched here, nothing is counted from the chat line and the
-- protection that remains is the budget itself plus the throttled result of SendAddonMessage (codes 3 and 8,
-- rawSend), which calls noteThrottle on its own.
function comm.onSystemMessage(text)
  local known = _G.ERR_CHAT_THROTTLED
  if type(known) ~= "string" or known == "" or type(text) ~= "string" or isSecret(text) then return false end
  if text ~= known then return false end
  comm.noteThrottle()
  return true
end
do
  local ok, frame = pcall(CreateFrame, "Frame")
  if ok and type(frame) == "table" and frame.RegisterEvent and frame.SetScript then
    pcall(frame.RegisterEvent, frame, "CHAT_MSG_SYSTEM")
    frame:SetScript("OnEvent", function(_, _, text) pcall(comm.onSystemMessage, text) end)
  end
end

-- Seconds until the global budget could allow one more message (0 = now), for this lane. Refills only after
-- the back-off check; the first refill after a back-off starts from RESUME_TOKENS.
local function globalWait(item, prefix)
  local g, t = globalBudget(), nowSeconds()
  if (g.backoffUntil or 0) > t then return g.backoffUntil - t end
  if g.resume then
    g.resume = false
    g.tokens, g.at = RESUME_TOKENS, t
  end
  g.at = g.at or t
  local dt = math.max(0, t - g.at)
  g.rate = g.rate or RATE_MAX
  if t - (g.lastStrike or -1000) > 30 and g.rate < RATE_MAX then g.rate = math.min(RATE_MAX, g.rate + 0.5 * dt / 60) end
  g.tokens = math.min(GLOBAL_BURST, g.tokens + dt * g.rate)
  g.at = t
  local need = 1 + HIGH_RESERVE
  if item.interactive or HIGH_VALUE[prefix] then need = 1
  elseif LOW_VALUE[prefix] then need = 1 + LOW_VALUE_RESERVE end
  if g.tokens >= need then return 0 end
  return (need - g.tokens) / g.rate
end

local pump
local function schedule(prefix, b)
  if b.scheduled or not (C_Timer and C_Timer.After) then return end
  b.scheduled = true
  local delay = math.max(1 / PER_SECOND, (b.retryAt or 0) - b.at)
  -- A wait caused by the shared budget is usually shorter than the per-prefix second.
  if b.sharedWait then delay = math.max(0.25, (b.retryAt or 0) - b.at); b.sharedWait = nil end
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
    -- The shared budget: wait for it (and any back-off) for the lane about to send, so an interactive
    -- message does not wait behind a bulk head of the queue.
    local wait = globalWait(item, prefix)
    if LOW_VALUE[prefix] and inCombatNow() then wait = math.max(wait, 2) end
    if wait > 0 then
      b.retryAt = b.at + math.max(0.25, wait)
      b.sharedWait = true
      break
    end
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
      removeItem(b, index)
      b.results.cancelled = b.results.cancelled + 1
    else
      local status, code = rawSend(prefix, item.text, item.channel, item.target, item.chat)
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
        comm.noteThrottle()
        b.retryAt = b.at + math.max(1, (globalBudget().backoffUntil or 0) - b.at)
        item.tries = (item.tries or 0) + 1
        if item.tries >= MAX_TRIES then
          removeItem(b, index)
          b.results.abandoned = b.results.abandoned + 1
          -- (9.3) The sender may want to offer the data again later instead of losing it silently.
          if type(item.onAbandon) == "function" then pcall(item.onAbandon) end
          diag("SEND", prefix .. ": gave up on a message after " .. MAX_TRIES .. " throttled tries")
        end
        break
      end
      removeItem(b, index)
      b.interactiveBurst = item.interactive and ((b.interactiveBurst or 0) + 1) or 0
      b.tokens = b.tokens - 1
      local g = globalBudget()
      g.tokens = math.max(0, g.tokens - 1)
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
function comm.send(prefix, text, channel, target, guard, priority, onAbandon)
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
  local item = { text = text, channel = channel, target = target, guard = guard,
    onAbandon = onAbandon, interactive = priority == "interactive", retryLockdown = hold or priority == "retry-lockdown", holdInInstance = hold }
  -- A position or presence note is only worth sending fresh: the oldest waiting one gives way.
  if LOW_VALUE[prefix] then
    while #b.queue >= LOW_VALUE_MAX_QUEUED do
      removeItem(b, 1)
      b.results.dropped = b.results.dropped + 1
    end
  end
  table.insert(b.queue, item)
  pump(prefix)
  return true
end

-- A SendChatMessage line (raid or party text, whispers) that spends the same global budget. It is sent at
-- once, inside the click that asked for it, or not at all: a line delayed by a queue would leave a timer,
-- which the game may refuse outside a hardware event, and a ready check or bid arriving seconds late is
-- worse than none. Returns true when it went out; false (with one short local note) when the budget or a
-- back-off says wait.
--
-- RESULT lines (auction winner or "no bids", council close, bid and reserve acknowledgements) pass
-- opts.result = true: they matter and are often raised by a timer or a whisper, not a click. They use the
-- reserve like SOS and receipts, and when even that is unavailable (budget empty, a back-off running) they
-- wait in a short bounded list and go out in order as soon as the budget allows, for at most RESULT_RETRY_SECONDS
-- (the list holds RESULT_RETRY_MAX lines; the oldest goes first, the newest is refused when full). Only after
-- that is a line dropped, with one local note. Convenience lines (ready check post, roll announce) are never
-- queued: immediate-or-drop. Every chat line, result or convenience, is "interactive" for the budget, so all
-- of them may use the tokens kept back from bulk sync; the difference is only that a result line waits.
local RESULT_RETRY_MAX, RESULT_RETRY_SECONDS = 12, 120
local resultQueue, resultScheduled = {}, false
local function noteChatDropped()
  if ns.message and ns.L then pcall(ns.message, ns.L("Too many messages just now: wait a moment and try again.")) end
end
local function pumpResults()
  resultScheduled = false
  while resultQueue[1] do
    local item = resultQueue[1]
    if nowSeconds() > item.deadline then
      table.remove(resultQueue, 1)
      noteChatDropped()
    else
      local wait = globalWait({ interactive = true }, "chat")
      if wait > 0 then
        if C_Timer and C_Timer.After then
          resultScheduled = true
          C_Timer.After(math.max(0.5, wait + 0.05), pumpResults)
        end
        return
      end
      local g = globalBudget()
      g.tokens = math.max(0, g.tokens - 1)
      table.remove(resultQueue, 1)
      rawSend("chat", item.text, item.channel, item.target, true)
    end
  end
end

function comm.chat(text, channel, target, opts)
  if not channel then return false end
  text = tostring(text)
  local result = type(opts) == "table" and opts.result or opts == true
  -- A waiting result line keeps its place: a newer one never jumps ahead of it.
  local wait = (result and resultQueue[1]) and 1 or globalWait({ interactive = true }, "chat")
  if wait > 0 then
    if result and C_Timer and C_Timer.After and #resultQueue < RESULT_RETRY_MAX then
      resultQueue[#resultQueue + 1] = { text = text, channel = channel, target = target, deadline = nowSeconds() + RESULT_RETRY_SECONDS }
      if not resultScheduled then
        resultScheduled = true
        C_Timer.After(0.5, pumpResults)
      end
      return true
    end
    noteChatDropped()
    return false
  end
  local g = globalBudget()
  g.tokens = math.max(0, g.tokens - 1)
  return rawSend("chat", text, channel, target, true) == "sent"
end

-- Result lines still waiting to go out (tests and /guilded sync stats).
function comm.resultsWaiting() return #resultQueue end

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
    dropped = b and b.results.dropped or 0,
    queued = b and #b.queue or 0, lastResult = b and b.lastResult or nil,
    lastCode = b and b.lastCode or nil
  }
end

-- Back-off state for tests and /guilded sync stats: throttle reports seen and seconds left to wait.
function comm.budget()
  local g = globalBudget()
  return { throttles = g.throttles or 0, refusals = g.refusals or 0, rate = g.rate or RATE_MAX, strikes = g.strikes or 0, waiting = math.max(0, (g.backoffUntil or 0) - nowSeconds()) }
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

-- ---------------------------------------------------------------------
-- Professions have ONE identity in every game language (owner report, 9 November 2026: "Cooking" and
-- "Cuisine" showed as two professions). The key is the English name, from the skill line id when the
-- game gives it, else from any client's localized name. Same table as the bot's
-- src/services/profession-names.ts (tests/lua/profession-names.test.ts keeps them equal). Accented
-- names are escapes because the validator rejects non-ASCII.
-- ---------------------------------------------------------------------
local SKILL_LINES = { [171] = "Alchemy", [164] = "Blacksmithing", [333] = "Enchanting", [202] = "Engineering", [182] = "Herbalism", [773] = "Inscription", [755] = "Jewelcrafting", [165] = "Leatherworking", [186] = "Mining", [393] = "Skinning", [197] = "Tailoring", [185] = "Cooking", [129] = "First Aid", [356] = "Fishing", [794] = "Archaeology" }
local NAMES = {
  ["Alchemy"] = "Alchemy", ["Alchimie"] = "Alchemy", ["Alquimia"] = "Alchemy", ["Alchimia"] = "Alchemy", ["\208\144\208\187\209\133\208\184\208\188\208\184\209\143"] = "Alchemy",
  ["Blacksmithing"] = "Blacksmithing", ["Forge"] = "Blacksmithing", ["Schmiedekunst"] = "Blacksmithing", ["Herrer\195\173a"] = "Blacksmithing", ["Ferraria"] = "Blacksmithing", ["Forgiatura"] = "Blacksmithing", ["\208\154\209\131\208\183\208\189\208\181\209\135\208\189\208\190\208\181 \208\180\208\181\208\187\208\190"] = "Blacksmithing",
  ["Enchanting"] = "Enchanting", ["Enchantement"] = "Enchanting", ["Verzauberkunst"] = "Enchanting", ["Encantamiento"] = "Enchanting", ["Encantamento"] = "Enchanting", ["Incantamento"] = "Enchanting", ["\208\157\208\176\208\187\208\190\208\182\208\181\208\189\208\184\208\181 \209\135\208\176\209\128"] = "Enchanting",
  ["Engineering"] = "Engineering", ["Ing\195\169nierie"] = "Engineering", ["Ingenieurskunst"] = "Engineering", ["Ingenier\195\173a"] = "Engineering", ["Engenharia"] = "Engineering", ["Ingegneria"] = "Engineering", ["\208\152\208\189\208\182\208\181\208\189\208\181\209\128\208\189\208\190\208\181 \208\180\208\181\208\187\208\190"] = "Engineering",
  ["Herbalism"] = "Herbalism", ["Herboristerie"] = "Herbalism", ["Kr\195\164uterkunde"] = "Herbalism", ["Herborister\195\173a"] = "Herbalism", ["Herborismo"] = "Herbalism", ["Erboristeria"] = "Herbalism", ["\208\162\209\128\208\176\208\178\208\189\208\184\209\135\208\181\209\129\209\130\208\178\208\190"] = "Herbalism",
  ["Inscription"] = "Inscription", ["Calligraphie"] = "Inscription", ["Inschriftenkunde"] = "Inscription", ["Inscripci\195\179n"] = "Inscription", ["Escrivania"] = "Inscription", ["Runografia"] = "Inscription", ["\208\157\208\176\209\135\208\181\209\128\209\130\208\176\208\189\208\184\208\181"] = "Inscription",
  ["Jewelcrafting"] = "Jewelcrafting", ["Joaillerie"] = "Jewelcrafting", ["Juwelenschleifen"] = "Jewelcrafting", ["Joyer\195\173a"] = "Jewelcrafting", ["Joalheria"] = "Jewelcrafting", ["Oreficeria"] = "Jewelcrafting", ["\208\174\208\178\208\181\208\187\208\184\209\128\208\189\208\190\208\181 \208\180\208\181\208\187\208\190"] = "Jewelcrafting",
  ["Leatherworking"] = "Leatherworking", ["Travail du cuir"] = "Leatherworking", ["Lederverarbeitung"] = "Leatherworking", ["Peleter\195\173a"] = "Leatherworking", ["Couraria"] = "Leatherworking", ["Conciatura"] = "Leatherworking", ["\208\154\208\190\208\182\208\181\208\178\208\189\208\184\209\135\208\181\209\129\209\130\208\178\208\190"] = "Leatherworking",
  ["Mining"] = "Mining", ["Minage"] = "Mining", ["Bergbau"] = "Mining", ["Miner\195\173a"] = "Mining", ["Minera\195\167\195\163o"] = "Mining", ["Estrazione"] = "Mining", ["\208\147\208\190\209\128\208\189\208\190\208\181 \208\180\208\181\208\187\208\190"] = "Mining",
  ["Skinning"] = "Skinning", ["D\195\169pe\195\167age"] = "Skinning", ["K\195\188rschnerei"] = "Skinning", ["Desuello"] = "Skinning", ["Desollar"] = "Skinning", ["Esfolamento"] = "Skinning", ["Scuoiatura"] = "Skinning", ["\208\161\208\189\209\143\209\130\208\184\208\181 \209\136\208\186\209\131\209\128"] = "Skinning",
  ["Tailoring"] = "Tailoring", ["Couture"] = "Tailoring", ["Schneiderei"] = "Tailoring", ["Sastrer\195\173a"] = "Tailoring", ["Alfaiataria"] = "Tailoring", ["Sartoria"] = "Tailoring", ["\208\159\208\190\209\128\209\130\208\189\209\143\208\182\208\189\208\190\208\181 \208\180\208\181\208\187\208\190"] = "Tailoring",
  ["Cooking"] = "Cooking", ["Cuisine"] = "Cooking", ["Kochkunst"] = "Cooking", ["Cocina"] = "Cooking", ["Culin\195\161ria"] = "Cooking", ["Cucina"] = "Cooking", ["\208\154\209\131\208\187\208\184\208\189\208\176\209\128\208\184\209\143"] = "Cooking",
  ["First Aid"] = "First Aid", ["Premiers soins"] = "First Aid", ["Secourisme"] = "First Aid", ["Erste Hilfe"] = "First Aid", ["Primeros auxilios"] = "First Aid", ["Primeiros Socorros"] = "First Aid", ["Primo Soccorso"] = "First Aid", ["\208\159\208\181\209\128\208\178\208\176\209\143 \208\191\208\190\208\188\208\190\209\137\209\140"] = "First Aid",
  ["Fishing"] = "Fishing", ["P\195\170che"] = "Fishing", ["Angeln"] = "Fishing", ["Pesca"] = "Fishing", ["\208\160\209\139\208\177\208\189\208\176\209\143 \208\187\208\190\208\178\208\187\209\143"] = "Fishing",
  ["Archaeology"] = "Archaeology", ["Arch\195\169ologie"] = "Archaeology", ["Arch\195\164ologie"] = "Archaeology", ["Arqueolog\195\173a"] = "Archaeology", ["Arqueologia"] = "Archaeology", ["Archeologia"] = "Archaeology", ["\208\144\209\128\209\133\208\181\208\190\208\187\208\190\208\179\208\184\209\143"] = "Archaeology",
}

local function trimText(text)
  return (string.gsub(string.gsub(text, "^%s+", ""), "%s+$", ""))
end
local LOWER_NAMES = {}
for name, canonical in pairs(NAMES) do LOWER_NAMES[string.lower(name)] = canonical end

-- The canonical (English) profession for a skill line id or a name in any client language; nil when unknown.
function util.professionKey(name, skillLine)
  local byLine = SKILL_LINES[tonumber(skillLine) or -1]
  if byLine then return byLine end
  if type(name) ~= "string" or isSecret(name) then return nil end
  local text = trimText(name)
  return NAMES[text] or LOWER_NAMES[string.lower(text)]
end
-- The name to store and send: canonical when known, else the name as it was (trimmed).
function util.professionName(name, skillLine)
  local key = util.professionKey(name, skillLine)
  if key then return key end
  if type(name) ~= "string" or isSecret(name) then return nil end
  return trimText(name)
end
-- The profession shown in the player's language (Locale.lua translates the canonical English names).
function util.professionLabel(name)
  local key = util.professionKey(name) or name
  if type(key) ~= "string" then return key end
  return ns.L and ns.L(key) or key
end
-- "Cuisine:300,Cooking:150,Fishing:75" (the digest format) -> "Cooking:300,Fishing:75": canonical names, the
-- highest skill when one profession appears twice, first-seen order kept.
function util.professionSkillText(text)
  if type(text) ~= "string" or text == "" then return text end
  local order, best = {}, {}
  for name, skill in string.gmatch(text, "([^:,]+):(%d+)") do
    local key = util.professionName(name)
    local value = tonumber(skill) or 0
    if best[key] == nil then order[#order + 1] = key end
    if best[key] == nil or value > best[key] then best[key] = value end
  end
  local parts = {}
  for _, key in ipairs(order) do parts[#parts + 1] = key .. ":" .. tostring(best[key]) end
  return table.concat(parts, ",")
end
-- Renames the keys of { [profession] = value } to canonical names; when two collapse, merge(old, new) picks.
function util.professionKeyedTable(source, merge)
  if type(source) ~= "table" then return source end
  local out, changed = {}, false
  for name, value in pairs(source) do
    local key = type(name) == "string" and util.professionName(name) or name
    if key ~= name then changed = true end
    if out[key] ~= nil and merge then out[key] = merge(out[key], value) else out[key] = value end
  end
  if not changed then return source end
  return out
end
-- (9.0.10) Saved data from before the canonical names: the same profession was kept under every client language's
-- name ("Cooking" and "Cuisine"). Rewrites the recipe book and the guildmates' digests in place.
local function newerRecipes(a, b)
  if type(a) ~= "table" then return b end
  if type(b) ~= "table" then return a end
  if (tonumber(b.v) or 0) > (tonumber(a.v) or 0) then return b end
  return a
end
function util.normalizeProfessionData(db)
  if type(db) ~= "table" then return false end
  local changed = false
  local book = db.recipeBook
  if type(book) == "table" then
    if type(book.people) == "table" then
      for player, professions in pairs(book.people) do
        local fixed = util.professionKeyedTable(professions, newerRecipes)
        if fixed ~= professions then book.people[player] = fixed; changed = true end
      end
    end
    if type(book.cooldowns) == "table" then
      for player, list in pairs(book.cooldowns) do
        if type(list) == "table" then
          for _, cooldown in ipairs(list) do
            if type(cooldown) == "table" and type(cooldown.prof) == "string" then
              local key = util.professionName(cooldown.prof)
              if key ~= cooldown.prof then cooldown.prof = key; changed = true end
            end
          end
        end
      end
    end
  end
  if type(db.peerRoster) == "table" then
    for _, peer in pairs(db.peerRoster) do
      if type(peer) == "table" and type(peer.professions) == "string" then
        local fixed = util.professionSkillText(peer.professions)
        if fixed ~= peer.professions then peer.professions = fixed; changed = true end
      end
    end
  end
  return changed
end
