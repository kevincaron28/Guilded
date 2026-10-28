-- Recruiting helpers for officers: a prospect list and a welcome whisper for new members.
--
--   /guilded recruit add <name> [note]          a prospect you talked to
--   /guilded recruit <name> contacted|invited|declined|joined [note]
--   /guilded recruit remove <name> | list [status] | copy
--   /guilded welcome on [message] | off | status | test
--
-- The prospect list stays on this PC (notes can be private). Someone on it who joins the guild
-- is marked "joined" by itself. The welcome whisper is off until an officer turns it on; when
-- a player joins, one officer with it on whispers them once: the others hear that over the
-- addon channel and stay quiet. {name} and {guild} in the message are filled in.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedRec"
local STATUSES = { prospect = true, contacted = true, invited = true, joined = true, declined = true }
local MAX_RECRUITS = 300
local MAX_WELCOMES_PER_HOUR = 10
local WELCOMED_MEMORY = 600

local recruit = {}
ns.recruit = recruit

local welcomedAt, welcomeTimes = {}, {}

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return time and time() or 0 end
local function key(name) return name and string.lower(name) or nil end

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.recruits = db.recruits or { list = {} }
  db.welcome = db.welcome or { enabled = false }
  return db
end

function recruit.defaultWelcome()
  return L("Welcome to {guild}, {name}! Say hi in guild chat, and ask an officer if you need anything.")
end

-- The welcome text for one player (placeholders filled, kept to one chat line).
function recruit.welcomeText(name, template)
  local guild = GetGuildInfo and GetGuildInfo("player") or ""
  local display = ns.util and ns.util.displayName and ns.util.displayName(name) or name
  local text = string.gsub(template or recruit.defaultWelcome(), "{name}", (string.gsub(display or "", "%%", "%%%%")))
  text = string.gsub(text, "{guild}", (string.gsub(guild or "", "%%", "%%%%")))
  return ns.util and ns.util.truncate and ns.util.truncate(text, 250) or string.sub(text, 1, 250)
end

-- ---------------------------------------------------------------------
-- Prospect list
-- ---------------------------------------------------------------------

function recruit.set(name, status, note)
  local db = state()
  name = ns.normalizeName and ns.normalizeName(name) or name
  if not (db and name) then return nil end
  local list = db.recruits.list
  local entry = list[key(name)]
  if not entry then
    local count = 0
    for _ in pairs(list) do count = count + 1 end
    if count >= MAX_RECRUITS then return nil, L("The prospect list is full; remove old entries first.") end
    entry = { name = name, status = "prospect", at = ns.now and ns.now() or "", by = ns.playerName and ns.playerName() or "" }
    list[key(name)] = entry
  end
  if status then entry.status = status end
  if note and note ~= "" then entry.note = string.sub(note, 1, 200) end
  entry.updated = ns.now and ns.now() or ""
  return entry
end

function recruit.remove(name)
  local db = state()
  local k = key(ns.normalizeName and ns.normalizeName(name) or name)
  if not (db and k and db.recruits.list[k]) then return false end
  db.recruits.list[k] = nil
  return true
end

function recruit.entries(status)
  local db = state()
  local out = {}
  for _, entry in pairs(db and db.recruits.list or {}) do
    if not status or entry.status == status then table.insert(out, entry) end
  end
  table.sort(out, function(a, b) return (a.updated or "") > (b.updated or "") end)
  return out
end

-- Called when someone joins the guild (system message) or is invited by Guilded's auto-invite.
function recruit.noteJoined(name)
  local db = state()
  local entry = db and db.recruits.list[key(ns.normalizeName and ns.normalizeName(name) or name)]
  if entry and entry.status ~= "joined" then entry.status = "joined"; entry.updated = ns.now and ns.now() or "" end
end
function recruit.noteInvited(name)
  local db = state()
  local entry = db and db.recruits.list[key(ns.normalizeName and ns.normalizeName(name) or name)]
  if entry and (entry.status == "prospect" or entry.status == "contacted") then entry.status = "invited"; entry.updated = ns.now and ns.now() or "" end
end

local function line(entry)
  return string.format("%s - %s%s (%s)", entry.name, L(entry.status), entry.note and (": " .. entry.note) or "", entry.updated or entry.at or "")
end

-- ---------------------------------------------------------------------
-- Welcome whisper
-- ---------------------------------------------------------------------

-- "%s has joined the guild." in the client's language, as a pattern.
local function joinPattern()
  local template = type(ERR_GUILD_JOIN_S) == "string" and ERR_GUILD_JOIN_S or "%s has joined the guild."
  local escaped = string.gsub(template, "([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
  return "^" .. (string.gsub(escaped, "%%s", "(.+)")) .. "$"
end

local function recentlyWelcomed(name)
  local at = welcomedAt[key(name)]
  return at and clock() - at < WELCOMED_MEMORY
end

local function withinRate()
  local now, kept = clock(), {}
  for _, at in ipairs(welcomeTimes) do if now - at < 3600 then table.insert(kept, at) end end
  welcomeTimes = kept
  return #welcomeTimes < MAX_WELCOMES_PER_HOUR
end

-- Sends the whisper now (no checks); returns true when the game accepted it.
local function whisper(name, text)
  local target = ns.util and ns.util.address and ns.util.address(name) or name
  local send = C_ChatInfo and C_ChatInfo.SendChatMessage or SendChatMessage
  if not send then return false end
  return pcall(send, text, "WHISPER", nil, target)
end

-- One officer welcomes: each waits a moment, and whoever goes first tells the others.
function recruit.onJoined(name)
  recruit.noteJoined(name)
  local db = state()
  if not (db and db.welcome.enabled) then return false end
  if not (ns.isOfficer and ns.isOfficer()) then return false end
  if ns.playerName and ns.normalizeName and ns.normalizeName(name) == ns.playerName() then return false end
  local function go()
    if recentlyWelcomed(name) or not withinRate() then return end
    welcomedAt[key(name)] = clock()
    table.insert(welcomeTimes, clock())
    if ns.comm and IsInGuild and IsInGuild() then ns.comm.send(PREFIX, "WELCOMED|1|" .. name, "GUILD") end
    whisper(name, recruit.welcomeText(name, db.welcome.text))
  end
  -- A spread of 2 to 6 seconds so two officers rarely send at the same instant.
  local wait = 2 + (math.random and math.random() * 4 or 0)
  if C_Timer and C_Timer.After then C_Timer.After(wait, go) else go() end
  return true
end

function recruit.onSystemMessage(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return end
  local name = string.match(text, joinPattern())
  if name then recruit.onJoined(name) end
end

function recruit.onAddonMessage(text, sender)
  local name = string.match(text or "", "^WELCOMED|1|(.+)$")
  if name and ns.isOfficerName and ns.isOfficerName(ns.normalizeName(sender)) then welcomedAt[key(name)] = clock() end
end

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

local function needOfficer()
  if ns.isOfficer and ns.isOfficer() then return true end
  ns.message(L("Only officers can do that."))
  return false
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["recruit"] = function(args)
  if ns.moduleActive and not ns.moduleActive("recruit") then return end
  if not needOfficer() then return end
  local first = string.lower(args[1] or "list")
  if first == "add" and args[2] then
    local entry, problem = recruit.set(args[2], nil, table.concat(args, " ", 3))
    ns.message(entry and (L("Prospect saved: ") .. line(entry)) or problem or L("Could not save that prospect."))
  elseif first == "remove" and args[2] then
    ns.message(recruit.remove(args[2]) and L("Removed from the prospect list.") or L("Not on the prospect list."))
  elseif first == "copy" then
    local lines = {}
    for _, entry in ipairs(recruit.entries()) do table.insert(lines, line(entry)) end
    if ns.showCopyText then ns.showCopyText(table.concat(lines, "\n"), L("Guilded - prospects")) end
  elseif first == "list" then
    local status = args[2] and string.lower(args[2]) or nil
    local entries = recruit.entries(STATUSES[status or ""] and status or nil)
    if #entries == 0 then ns.message(L("No prospects yet. /guilded recruit add <name> [note]")) return end
    for i = 1, math.min(25, #entries) do ns.message(line(entries[i])) end
  elseif args[2] and STATUSES[string.lower(args[2])] then
    local entry = recruit.set(args[1], string.lower(args[2]), table.concat(args, " ", 3))
    ns.message(entry and line(entry) or L("Could not save that prospect."))
  else
    ns.message("/guilded recruit add <name> [note] | <name> contacted|invited|declined|joined [note] | remove <name> | list [status] | copy")
  end
end

ns.commandHandlers["welcome"] = function(args)
  if ns.moduleActive and not ns.moduleActive("recruit") then return end
  local db = state()
  if not (db and needOfficer()) then return end
  local action = string.lower(args[1] or "status")
  if action == "on" then
    local text = table.concat(args, " ", 2)
    if text ~= "" then db.welcome.text = string.sub(text, 1, 250) end
    db.welcome.enabled, db.welcome.by = true, ns.playerName and ns.playerName() or nil
    ns.message(L("Welcome whisper on. New members get: ") .. recruit.welcomeText(L("NewMember"), db.welcome.text))
  elseif action == "off" then
    db.welcome.enabled = false
    ns.message(L("Welcome whisper off."))
  elseif action == "test" then
    ns.message(recruit.welcomeText(ns.playerName and ns.playerName() or "", db.welcome.text))
  else
    ns.message(string.format(L("Welcome whisper is %s: %s"), db.welcome.enabled and L("on") or L("off"), recruit.welcomeText(L("NewMember"), db.welcome.text)))
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded recruit add <name> [note] | list | copy - officers' prospect list" })
table.insert(ns.commandHelp, { officer = true, text = "/guilded welcome on [message] | off | test - whisper new guild members once (one officer sends it)" })

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_SYSTEM")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, a, b, c, d)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("recruit") then return end
    if event == "PLAYER_LOGIN" then ns.comm.register(PREFIX)
    elseif event == "CHAT_MSG_SYSTEM" then recruit.onSystemMessage(a)
    elseif event == "CHAT_MSG_ADDON" and ns.comm.accept(a, b, c, d, PREFIX) and c == "GUILD" then recruit.onAddonMessage(b, d) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "recruit: " .. tostring(err)) end
end)
