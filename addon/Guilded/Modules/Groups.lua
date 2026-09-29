-- In-game group board: post a group to the guild without Discord, and get an alert when a
-- guildmate posts one you could join (the Discord group finder's alerts, in game).
--
--   /guilded lfg post <what you are doing>   e.g. "Deadmines need tank and healer" or "BRD 55-60"
--   /guilded lfg close                       your group is full or cancelled
--   /guilded lfg                             the open groups
--   /guilded lfg alerts <kinds> [roles]      e.g. "dungeon,leveling tank,healer"; "off" to stop
--
-- Kinds: dungeon, leveling, pvp, world, other (the first word of the post can set it, e.g.
-- "pvp WSG premade"; a dungeon name means dungeon). Levels: "55-60" / "60" / "55+" in the text,
-- or the dungeon's usual range. Roles needed: tank / heal / dps words in the text.
-- An alert needs: the kind is one of yours, your level is in the range, and (dungeons) one of
-- your roles is needed. Groups close by themselves after 30 minutes.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedLFG"
local OPEN_SECONDS = 30 * 60
local MAX_TITLE = 120

local groups = { open = {} }
ns.groups = groups

local KINDS = { dungeon = true, leveling = true, pvp = true, world = true, other = true }
local KIND_WORDS = { dungeon = "dungeon", donjon = "dungeon", leveling = "leveling", level = "leveling", xp = "leveling", pvp = "pvp", bg = "pvp", world = "world", monde = "world", other = "other" }
local ROLES = { tank = "TANK", heal = "HEALER", healer = "HEALER", dps = "DPS" }

local function active() return not ns.moduleActive or ns.moduleActive("groups") end
local function L(text) return ns.L and ns.L(text) or text end
local function now() return ns.util.serverTime() end

local function settings()
  local s = ns.getSettings and ns.getSettings()
  if not s then return nil end
  s.lfgAlerts = s.lfgAlerts or { kinds = {}, roles = {} }
  return s
end

-- ---------------------------------------------------------------------
-- Reading a post
-- ---------------------------------------------------------------------

-- Roles a post asks for: TANK, HEALER, DPS (none = anyone).
function groups.rolesFrom(text)
  local lower = " " .. string.lower(text or "") .. " "
  local roles = {}
  if string.find(lower, "[^%a]tanks?[^%a]") then table.insert(roles, "TANK") end
  if string.find(lower, "[^%a]heals?[^%a]") or string.find(lower, "[^%a]healers?[^%a]") or string.find(lower, "soigneur") or string.find(lower, "[^%a]soins?[^%a]") then table.insert(roles, "HEALER") end
  if string.find(lower, "[^%a]dps[^%a]") then table.insert(roles, "DPS") end
  return roles
end

-- A level range typed in the post ("55-60", "58+", "lvl 60", "niveau 60"), or nil. Times are
-- not levels: "20-22h", "8-10pm" and "9pm" are skipped.
function groups.levelsFrom(text)
  text = string.lower(text or "")
  local function level(n) n = tonumber(n); return n and n >= 1 and n <= 80 and n or nil end
  for a, b, after in string.gmatch(text, "(%d%d?)%s*%-%s*(%d%d?)(%a*)") do
    if after == "" or after == "lvl" or after == "niv" then
      a, b = level(a), level(b)
      if a and b then return math.min(a, b), math.max(a, b) end
    end
  end
  local plus = level(string.match(text, "(%d%d?)%+"))
  if plus then return plus, 80 end
  local single = level(string.match(text, "lvl%s*(%d%d?)") or string.match(text, "level%s*(%d%d?)") or string.match(text, "niveau%s*(%d%d?)") or string.match(text, "niv%s*(%d%d?)"))
  if single then return single, single end
  return nil
end

-- The dungeon a post names (Scores.lua's list), its level range guessed from its highest level.
local function dungeonIn(text)
  if not (ns.scores and ns.scores.DUNGEONS) then return nil end
  local lower = string.lower(text or "")
  for _, dungeon in ipairs(ns.scores.DUNGEONS) do
    for _, fragment in ipairs(dungeon.match) do
      if string.find(lower, fragment, 1, true) then return dungeon end
    end
    if string.find(" " .. lower .. " ", "[^%a]" .. dungeon.key .. "[^%a]") then return dungeon end
  end
  return nil
end

-- kind, minLevel, maxLevel, roles from what the leader typed.
function groups.parse(text)
  local first = string.lower(string.match(text or "", "^%s*(%S+)") or "")
  local dungeon = dungeonIn(text)
  local kind = KIND_WORDS[first] or (dungeon and "dungeon") or "other"
  local minLevel, maxLevel = groups.levelsFrom(text)
  if not minLevel and dungeon and (kind == "dungeon" or kind == "leveling") then
    -- Most dungeons are run from about 8 levels under their top level.
    minLevel, maxLevel = math.max(1, dungeon.max - 8), dungeon.max
  end
  return kind, minLevel, maxLevel, groups.rolesFrom(text)
end

-- Would this group alert you? (Same rules as the Discord group alerts.)
function groups.fits(group, alerts, myLevel)
  if not alerts or not alerts.kinds or not alerts.kinds[group.kind] then return false end
  if group.leader == (ns.playerName and ns.playerName()) then return false end
  if group.minLevel and myLevel and (myLevel < group.minLevel or myLevel > (group.maxLevel or 80)) then return false end
  if group.kind == "dungeon" and #group.roles > 0 and next(alerts.roles or {}) then
    for _, role in ipairs(group.roles) do if alerts.roles[role] then return true end end
    return false
  end
  return true
end

-- ---------------------------------------------------------------------
-- Messages: O|id|kind|min|max|roles|title (open) and X|id (closed); sent by the leader.
-- The id is a number; together with the sender it names one group.
-- The title is the last field and takes the rest of the line: anything new needs a new kind.
-- ---------------------------------------------------------------------

local function send(text)
  if not (IsInGuild and IsInGuild()) then return false end
  return ns.comm.send(PREFIX, text, "GUILD")
end

local function clean(text)
  return (string.gsub(string.sub(text or "", 1, MAX_TITLE), "[|\n\r]", " "))
end

local function alert(group)
  local levels = group.minLevel and (group.minLevel == group.maxLevel and tostring(group.minLevel) or string.format("%d-%d", group.minLevel, group.maxLevel)) or ""
  local score = ns.scores and ns.scores.scoreOf and ns.scores.scoreOf(group.leader)
  local text = string.format(L("%s is looking for a group: %s%s. Whisper them to join."), group.leader, group.title,
    levels ~= "" and (" (" .. levels .. ")") or "")
  ns.message(text .. (score and string.format(" [%s %d]", L("score"), score) or ""))
  if RaidNotice_AddMessage and RaidWarningFrame and ChatTypeInfo then
    pcall(RaidNotice_AddMessage, RaidWarningFrame, text, ChatTypeInfo["GUILD"] or { r = 0.25, g = 1, b = 0.25 })
  end
  if PlaySound and SOUNDKIT and SOUNDKIT.READY_CHECK then pcall(PlaySound, SOUNDKIT.READY_CHECK) end
end

function groups.receive(text, sender)
  local leader = ns.normalizeName and ns.normalizeName(sender)
  if not leader then return end
  local kind, id = string.match(text, "^(%u)|(%d+)")
  if kind == "X" then
    groups.open[leader .. ":" .. tostring(id)] = nil
    if ns.onGroupsChange then pcall(ns.onGroupsChange) end
    return
  end
  if kind ~= "O" then return end
  local groupKind, minLevel, maxLevel, roles, title = string.match(text, "^O|%d+|(%a+)|(%d*)|(%d*)|([%u,]*)|(.*)$")
  if not groupKind or not KINDS[groupKind] then return end
  local list = {}
  for role in string.gmatch(roles, "%u+") do if role == "TANK" or role == "HEALER" or role == "DPS" then table.insert(list, role) end end
  local group = {
    id = id, leader = leader, kind = groupKind, minLevel = tonumber(minLevel), maxLevel = tonumber(maxLevel),
    roles = list, title = clean(title), at = now()
  }
  local key = leader .. ":" .. id
  local isNew = not groups.open[key]
  groups.open[key] = group
  local s = settings()
  local level = UnitLevel and UnitLevel("player") or nil
  if isNew and leader ~= (ns.playerName and ns.playerName()) and s and groups.fits(group, s.lfgAlerts, level) then alert(group) end
  if ns.onGroupsChange then pcall(ns.onGroupsChange) end
end

local function prune()
  local cutoff = now() - OPEN_SECONDS
  for key, group in pairs(groups.open) do
    if group.at < cutoff then groups.open[key] = nil end
  end
end

-- Open groups, newest first.
function groups.list()
  prune()
  local rows = {}
  for _, group in pairs(groups.open) do table.insert(rows, group) end
  table.sort(rows, function(a, b) return a.at > b.at end)
  return rows
end

function groups.post(text)
  text = clean(text)
  if string.len(string.gsub(text, "%s", "")) < 3 then ns.message(L("Say what the group is for: /guilded lfg post Deadmines need healer")); return end
  local me = ns.playerName and ns.playerName()
  for key, group in pairs(groups.open) do if group.leader == me then groups.open[key] = nil; send("X|" .. group.id) end end
  local kind, minLevel, maxLevel, roles = groups.parse(text)
  local id = tostring(now() % 1000000)
  local message = string.format("O|%s|%s|%s|%s|%s|%s", id, kind, minLevel or "", maxLevel or "", table.concat(roles, ","), text)
  if not send(message) then ns.message(L("You need to be in a guild to post a group.")); return end
  groups.receive(message, me)
  ns.message(string.format(L("Posted to the guild: %s. /guilded lfg close when you are full."), text))
end

function groups.close()
  local me = ns.playerName and ns.playerName()
  local closed = false
  for key, group in pairs(groups.open) do
    if group.leader == me then groups.open[key] = nil; send("X|" .. group.id); closed = true end
  end
  ns.message(closed and L("Your group is closed.") or L("You have no open group."))
  if ns.onGroupsChange then pcall(ns.onGroupsChange) end
end

function groups.listText()
  local rows = groups.list()
  if #rows == 0 then return L("No open groups in the guild right now.") end
  local out = {}
  for _, group in ipairs(rows) do
    local levels = group.minLevel and string.format(" (%d-%d)", group.minLevel, group.maxLevel or group.minLevel) or ""
    local score = ns.scores and ns.scores.scoreOf and ns.scores.scoreOf(group.leader)
    table.insert(out, string.format("%s%s: %s%s", group.leader, score and string.format(" [%d]", score) or "", group.title, levels))
  end
  return table.concat(out, "\n")
end

-- "/guilded lfg alerts dungeon,pvp tank,healer" | "off"
function groups.setAlerts(kindsText, rolesText)
  local s = settings()
  if not s then return end
  if not kindsText or string.lower(kindsText) == "off" then
    s.lfgAlerts = { kinds = {}, roles = {} }
    ns.message(L("Group alerts are off."))
    return
  end
  local kinds, roles = {}, {}
  for word in string.gmatch(string.lower(kindsText), "[^,%s]+") do
    local kind = KIND_WORDS[word] or (KINDS[word] and word)
    if kind then kinds[kind] = true end
  end
  for word in string.gmatch(string.lower(rolesText or ""), "[^,%s]+") do
    local role = ROLES[word] or ROLES[string.gsub(word, "s$", "")]
    if role then roles[role] = true end
  end
  if not next(kinds) then ns.message(L("Kinds: dungeon, leveling, pvp, world, other. Example: /guilded lfg alerts dungeon,pvp tank,healer")); return end
  s.lfgAlerts = { kinds = kinds, roles = roles }
  local k, r = {}, {}
  for kind in pairs(kinds) do table.insert(k, kind) end
  for role in pairs(roles) do table.insert(r, string.lower(role)) end
  table.sort(k); table.sort(r)
  ns.message(string.format(L("Group alerts on for: %s (roles: %s)."), table.concat(k, ", "), #r > 0 and table.concat(r, ", ") or L("any")))
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["lfg"] = function(args)
  local action = string.lower(args[1] or "")
  if action == "post" then groups.post(table.concat(args, " ", 2))
  elseif action == "close" then groups.close()
  elseif action == "alerts" then groups.setAlerts(args[2], args[3])
  else
    for line in string.gmatch(groups.listText(), "[^\n]+") do ns.message(line) end
    ns.message(L("/guilded lfg post <what> | close | alerts <kinds> [roles]"))
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded lfg - post a group to the guild, see open groups, get alerts for groups you fit")

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("PLAYER_LOGIN")
register("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then ns.comm.register(PREFIX); return end
    local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
    if ns.isSecret and (ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender)) then return end
    if prefix ~= PREFIX or channel ~= "GUILD" or not active() then return end
    -- Your own posts come back from the server too; they are already on the board.
    if ns.normalizeName and ns.normalizeName(sender) == (ns.playerName and ns.playerName()) then return end
    groups.receive(text, sender)
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "groups: " .. tostring(err)) end
end)
