-- Guilded Dungeons: slash command and login. /gdungeons (or /gdg) status | results | start |
-- complete | abandon | check | score | lang. The Guilded companion reads GuildedDungeonsDB and,
-- once paired with a personal code from guildedwow.com/me/, sends finished runs to the public
-- leaderboards.
local _, ns = ...

local DUNGEON_ACTIONS = { status = true, results = true, start = true, complete = true, abandon = true, check = true, carry = true }

local function words(text)
  local list = {}
  for word in string.gmatch(text or "", "%S+") do list[#list + 1] = word end
  return list
end

function ns.slash(text)
  if ns.guildedPresent() then
    ns.message(ns.L("Guilded is installed, so it records your dungeon runs: use /guilded dungeon. Guilded Dungeons stays quiet."))
    return
  end
  local args = words(text)
  local action = string.lower(args[1] or "status")
  if not args[1] and ns.dungeonScorePanel and ns.dungeonScorePanel.openOrSay then
    ns.dungeonScorePanel.openOrSay("run") -- /gdg alone opens the window (or says why not)
  elseif DUNGEON_ACTIONS[action] then
    ns.commandHandlers["dungeon"](args)
  elseif action == "score" and not args[2] and ns.dungeonScorePanel then
    ns.dungeonScorePanel.open("season")
  elseif action == "companion" then
    -- The three steps to get runs to Discord (the standalone addon has no Home page to show them).
    for _, line in ipairs(ns.util.companionSteps()) do ns.message(line) end
    ns.message(ns.util.COMPANION_PAGE)
    ns.message(ns.util.COMPANION_DOWNLOAD)
  elseif (action == "score" or action == "lang" or action == "cards") and ns.commandHandlers[action] then
    table.remove(args, 1)
    ns.commandHandlers[action](args)
  else
    ns.message(ns.L("Commands: /gdungeons status | results | start | complete | abandon | check | score | companion | lang en|fr|auto"))
  end
end

SLASH_GUILDEDDUNGEONS1 = "/gdungeons"
SLASH_GUILDEDDUNGEONS2 = "/gdg"
-- Never assign the SlashCmdList global itself (not even `SlashCmdList = SlashCmdList or {}`): that taints it, and
-- every Blizzard slash command typed afterwards (/ginvite, ...) is blocked as "only available to the Blizzard UI".
SlashCmdList["GUILDEDDUNGEONS"] = function(text) ns.slash(text) end

-- The guild key, spelled exactly like full Guilded's saved guild key (addon/Guilded/Core.lua
-- currentGuildKey: "<guild name>-<home realm>", Forever realms without spaces). The companion matches a
-- standalone-only PC to its Discord server from this. Plain reads only: no protected calls.
local function compactRealm(realm) return (string.gsub(realm, "%s+", "")) end
function ns.currentGuildKey()
  if not (IsInGuild and IsInGuild()) then return nil end
  local guildName = GetGuildInfo and GetGuildInfo("player")
  if type(guildName) ~= "string" or guildName == "" or ns.isSecret(guildName) then return nil end
  local realm = (ns.compat and ns.compat.identity().realm) or (GetRealmName and GetRealmName()) or ""
  local home
  if ns.util.isForever() and GetGuildInfo then
    local ok, _, _, _, value = pcall(GetGuildInfo, "player")
    if ok and type(value) == "string" and value ~= "" and not ns.isSecret(value) then home = value end
  end
  if ns.util.isForever() then return guildName .. "-" .. compactRealm(home or realm), home ~= nil end
  return guildName .. "-" .. (home or realm), home ~= nil
end

local MAX_CHARACTERS = 50
-- Forever: the guild's home realm may arrive after the guild name. Until it does (or this wait is over: on the guild's own
-- realm segment it never comes) no key is stored, so a character on another segment never saves a wrong one.
-- Same wait as Core.lua (the Lua test harness sets GUILDED_TEST_HOME_WAIT).
local HOME_WAIT_SECONDS = rawget(_G, "GUILDED_TEST_HOME_WAIT") or 20
local homeWaitStart, homeWaitOver
local function clock() return (GetServerTime and GetServerTime()) or time() end

-- Everything the companion needs about whose runs these are: the guild key and edition, and every
-- character of this account that logged in with this addon (name, realm, class, level, guild key).
-- guildKey "" on a character means "no guild"; the root key is cleared then. A guildless alt logging in last never
-- leaves another character's guild on the file. Old files without these fields load as before.
local function noteIdentity()
  if ns.guildedPresent() then return end
  local db = ns.getDb()
  local character = db.character
  if type(character) ~= "table" or not character.name or character.name == "Unknown" then return end
  local inGuild = IsInGuild and IsInGuild() or false
  local key, homeKnown = ns.currentGuildKey()
  if inGuild and not key then return end -- the guild is not loaded yet: try again later
  if key and ns.util.isForever() and not homeKnown and db.guildKey ~= key and not homeWaitOver then
    homeWaitStart = homeWaitStart or clock()
    if clock() - homeWaitStart < HOME_WAIT_SECONDS then return end
    homeWaitOver = true
  end
  if key then
    db.guildKey = key
    db.guildEdition = ns.util.gameEdition()
  elseif not inGuild then
    db.guildKey = nil
  end
  db.myCharacters = type(db.myCharacters) == "table" and db.myCharacters or {}
  local id = ns.util.characterKey(character.name, character.realm)
  db.myCharacters[id] = {
    name = character.name, displayName = character.displayName, realm = character.realm,
    class = character.class, level = character.level, guildKey = key or "",
    gameEdition = character.gameEdition, interface = character.interface,
    capturedAt = time and time() or 0,
  }
  local count, oldest, oldestAt = 0, nil, nil
  for name, entry in pairs(db.myCharacters) do
    count = count + 1
    if not oldestAt or (entry.capturedAt or 0) < oldestAt then oldest, oldestAt = name, entry.capturedAt or 0 end
  end
  if count > MAX_CHARACTERS and oldest and oldest ~= id then db.myCharacters[oldest] = nil end
end
ns.noteIdentity = noteIdentity

-- The guild is only known once the client has loaded it: try again a few times after login, and on guild changes.
-- One set of retries at a time: a burst of PLAYER_GUILD_UPDATE events adds no timers.
local GUILD_RETRY_SECONDS = { 2, 5, 15, 25 }
local retrying = false
local function noteIdentitySoon()
  local function try()
    local ok, err = pcall(noteIdentity)
    if not ok then ns.logDiagnostic("LUA_ERROR", "identity: " .. tostring(err)) end
  end
  try()
  if retrying then return end
  if C_Timer and C_Timer.After then
    retrying = true
    for index, delay in ipairs(GUILD_RETRY_SECONDS) do
      C_Timer.After(delay, function()
        try()
        if index == #GUILD_RETRY_SECONDS then retrying = false end
      end)
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_GUILD_UPDATE")
frame:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_GUILD_UPDATE" then
    if not ns.guildedPresent() and ns.getDb().character.name then noteIdentitySoon() end
    return
  end
  local ok, err = pcall(function()
    local db = ns.getDb()
    db.addonVersion = ns.compat.addonVersion()
    if ns.guildedPresent() then return end
    -- Who this SavedVariables file belongs to, for the companion's personal upload.
    local identity = ns.compat.identity()
    local class = UnitClass and select(2, UnitClass("player")) or nil
    db.character = { name = ns.util.bareName(ns.playerName()), displayName = ns.util.unitDisplayName("player"), realm = identity.realm, class = class, level = UnitLevel and UnitLevel("player") or nil, spec = db.character.spec }
    db.character.gameEdition = ns.util.gameEdition()
    db.character.interface = ns.util.clientInterface()
    -- One account SavedVariables file can be used by many alts. Never show the
    -- last synced character's public score as the newly logged-in character's.
    local board = GuildedDungeonsPublicScore
    db.dungeonBoard = nil
    if type(board) == "table" and type(board.character) == "string" and type(board.realm) == "string"
      and ns.normalizeName(board.character) == ns.playerName()
      and string.lower(board.realm) == string.lower(identity.realm or "") then db.dungeonBoard = board end
    noteIdentitySoon()
    if ns.dungeonScorePanel then ns.dungeonScorePanel.refreshVisible() end
  end)
  if not ok then ns.logDiagnostic("LUA_ERROR", "login: " .. tostring(err)) end
end)
