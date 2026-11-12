-- Recruiting helpers for officers: a prospect list.
--
--   /guilded recruit add <name> [note]          a prospect you talked to
--   /guilded recruit <name> contacted|invited|declined|joined [note]
--   /guilded recruit remove <name> | list [status] | copy
--
-- The prospect list stays on this PC (notes can be private). Someone on it who joins the guild
-- is marked "joined" by itself. 9.2 removed the automatic welcome whisper (a chat line sent from a
-- timer, which the game blocks) and its /guilded welcome command; a saved db.welcome stays unread.
local addonName, ns = ...
ns = ns or {}

local STATUSES = { prospect = true, contacted = true, invited = true, joined = true, declined = true }
local MAX_RECRUITS = 300

local recruit = {}
ns.recruit = recruit

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return time and time() or 0 end
local function key(name) return name and string.lower(name) or nil end

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.recruits = db.recruits or { list = {} }
  return db
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
-- Join detection (marks a prospect "joined")
-- ---------------------------------------------------------------------

-- "%s has joined the guild." in the client's language, as a pattern.
local function joinPattern()
  local template = type(ERR_GUILD_JOIN_S) == "string" and ERR_GUILD_JOIN_S or "%s has joined the guild."
  local escaped = string.gsub(template, "([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
  return "^" .. (string.gsub(escaped, "%%s", "(.+)")) .. "$"
end

function recruit.onSystemMessage(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return end
  local name = string.match(text, joinPattern())
  if name then recruit.noteJoined(name) end
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

ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded recruit add <name> [note] | list | copy - officers' prospect list" })

local frame = CreateFrame("Frame")
frame:RegisterEvent("CHAT_MSG_SYSTEM")
frame:SetScript("OnEvent", function(_, event, a)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("recruit") then return end
    if event == "CHAT_MSG_SYSTEM" then recruit.onSystemMessage(a) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "recruit: " .. tostring(err)) end
end)
