-- Officer-client housekeeping (9.1): four small jobs an officer's game client does on its own, each ON by
-- default with its own off switch (/guilded officer auto, and Settings for officers):
--   professions  short profession tags in the guild PUBLIC note ("Alch300 Herb300"), kept after any
--                existing text such as a main/alt marker;
--   epgp         the member's "EP,GP" standing in the guild OFFICER note, same rules;
--   promote      a member at the LOWEST rank (found by index, never by name) who is linked to a Discord
--                member of this server (GuildedPromotion.linked from the bot) goes up exactly one rank,
--                once per player, never a demotion;
--   greet        one short guild-chat welcome per player who joins (English or French).
-- Every write goes through the reviewed RosterTools engine (permission checks, fresh roster, audit,
-- verification) and is paced: one change per 12 seconds, only notes that really changed, and a note is
-- never emptied. Nothing runs in combat or for a non-officer.
local _, ns = ...
ns = ns or {}
local module = {}
ns.officerNotes = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local function clock() return GetTime and GetTime() or 0 end
local function epoch() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function bare(name) return ns.normalizeName and ns.normalizeName(name) or name end
local PREFIX = "GuildedGreet"

module.NOTE_MAX = 31
module.INTERVAL = 12 -- seconds between two changes
module.IDLE_INTERVAL = 60 -- seconds between roster refreshes when nothing is left to do
module.KEYS = { "professions", "epgp", "promote", "greet" }
local KEY_SET = {}; for _, key in ipairs(module.KEYS) do KEY_SET[key] = true end

-- ----- settings (per officer client; a missing value means ON) ---------------

local function state()
  local d = db(); if not d then return nil end
  d.officerAuto = type(d.officerAuto) == "table" and d.officerAuto or {}
  local s = d.officerAuto
  s.off = type(s.off) == "table" and s.off or {}
  s.promoted = type(s.promoted) == "table" and s.promoted or {}
  s.greeted = type(s.greeted) == "table" and s.greeted or {}
  s.log = type(s.log) == "table" and s.log or {}
  return s
end
function module.enabled(key)
  local s = state(); if not s then return false end
  return s.off[key] ~= true
end
function module.set(key, on)
  local s = state(); if not s or not KEY_SET[key] then return false end
  s.off[key] = (not on) and true or nil
  return true
end
local function record(kind, name, detail)
  local s = state(); if not s then return end
  s.log[#s.log + 1] = { at = epoch(), kind = kind, name = name, detail = detail }
  while #s.log > 60 do table.remove(s.log, 1) end
  if ns.message and (kind == "promote") then ns.message(string.format(L("Promoted %s: %s"), name, detail or "")) end
end

-- ----- note text -------------------------------------------------------------

local function trim(s) return (tostring(s):gsub("^%s+", ""):gsub("%s+$", "")) end

-- A note split into the words that are not ours (kept as they are) and our own tokens.
local function splitNote(note, isOurs)
  local rest, ours = {}, {}
  for word in trim(note or ""):gmatch("%S+") do
    if isOurs(word) then ours[#ours + 1] = word else rest[#rest + 1] = word end
  end
  return table.concat(rest, " "), table.concat(ours, " ")
end

-- Public note: "<existing text> <tag>", the tag shortened until it fits; nil when nothing should change.
function module.publicNote(current, skills)
  local professions = ns.rosterProfessions
  if not professions then return nil end
  current = current or ""
  local rest, oldTag = splitNote(current, function(word)
    return professions.noteIsWritable(word) and word:find("%d") ~= nil
  end)
  local room = module.NOTE_MAX - (rest ~= "" and (#rest + 1) or 0)
  if room < 4 then return nil end
  local tag = professions.tag(skills, room)
  if tag == "" or tag == oldTag then return nil end
  local new = rest ~= "" and (rest .. " " .. tag) or tag
  if #new > module.NOTE_MAX or new == current then return nil end
  return new
end

-- Officer note: "<existing text> EP,GP".
function module.officerNote(current, ep, gp)
  current = current or ""
  if type(ep) ~= "number" or type(gp) ~= "number" then return nil end
  ep, gp = math.floor(ep), math.floor(gp)
  local rest, oldToken = splitNote(current, function(word) return word:match("^%-?%d+,%d+$") ~= nil end)
  local token = ep .. "," .. gp
  if token == oldToken then return nil end
  if oldToken == "" and ep == 0 and gp == 0 then return nil end
  local new = rest ~= "" and (rest .. " " .. token) or token
  if #new > module.NOTE_MAX or new == current then return nil end
  return new
end

-- The member's standing: the addon's own ledger first, then the bot's standings file.
function module.standing(key)
  local d = db()
  local account = d and type(d.epgp) == "table" and d.epgp[key]
  if type(account) == "table" and type(account.ep) == "number" and type(account.gp) == "number" then return account.ep, account.gp end
  local players = type(GuildedStandings) == "table" and GuildedStandings.players
  if type(players) == "table" then
    for _, row in ipairs(players) do
      if bare(row.name) == key and type(row.ep) == "number" and type(row.gp) == "number" then return row.ep, row.gp end
    end
  end
end

-- ----- promotion -------------------------------------------------------------

local function linkedSet()
  local out, data = {}, _G.GuildedPromotion
  if type(data) ~= "table" then return out end
  for _, list in ipairs({ data.linked, data.ready }) do
    if type(list) == "table" then
      for _, name in ipairs(list) do if type(name) == "string" then out[bare(name) or name] = true end end
    end
  end
  return out
end

-- ----- the work list ---------------------------------------------------------

-- Everything this officer client could change right now: { { key, name, action, value, kind }, ... }.
function module.candidates(snapshot)
  local out = {}
  local linked = module.enabled("promote") and linkedSet() or {}
  local s = state()
  local keys = {}
  for key in pairs(snapshot.rows) do keys[#keys + 1] = key end
  table.sort(keys)
  local lowest = snapshot.ranks - 1
  for _, key in ipairs(keys) do
    local row = snapshot.rows[key]
    if row.key ~= snapshot.actor.key and row.rank > snapshot.actor.rank then
      -- Promotion first: the lowest rank by index, linked, one step, once per player.
      if module.enabled("promote") and lowest >= 2 and row.rank == lowest and linked[key] and not (s and s.promoted[key]) then
        out[#out + 1] = { key = key, name = row.name, action = "promote", value = "", kind = "promote", detail = row.rankName }
      end
      if module.enabled("professions") and row.public ~= nil and ns.rosterProfessions then
        local skills = ns.rosterProfessions.skillsFor(row.name)
        local new = #skills > 0 and module.publicNote(row.public, skills) or nil
        if new then out[#out + 1] = { key = key, name = row.name, action = "public", value = new, kind = "professions" } end
      end
      if module.enabled("epgp") and row.officer ~= nil then
        local ep, gp = module.standing(key)
        local new = ep and module.officerNote(row.officer, ep, gp) or nil
        if new then out[#out + 1] = { key = key, name = row.name, action = "officer", value = new, kind = "epgp" } end
      end
    end
  end
  return out
end

local tried = {} -- "key|action|value" -> attempts this session (a rejected write is not retried forever)
local function attemptKey(c) return c.key .. "|" .. c.action .. "|" .. c.value end

-- Sends one change through the RosterTools engine. Returns true when the game was asked.
function module.apply(c)
  local tools = ns.rosterTools
  if not tools then return false end
  tried[attemptKey(c)] = (tried[attemptKey(c)] or 0) + 1
  if c.name:find("[\t\r\n]") or c.value:find("[\t\r\n]") then return false end
  local plan = tools.preview("character\taction\tvalue\n" .. c.name .. "\t" .. c.action .. "\t" .. c.value)
  if not plan then return false end
  plan.auto = true
  if plan.blocked or not tools.confirm(plan.phrase) then tools.cancel(); return false end
  local ok = tools.step()
  if not ok then return false end
  if c.kind == "promote" then
    local s = state(); if s then s.promoted[c.key] = epoch() end
    record("promote", c.name, string.format(L("rank %s to the next rank up (linked to Discord)"), tostring(c.detail or "?")))
  else
    record(c.kind, c.name, c.value)
  end
  return true
end

local lastRequest, nextAt = -1000, 0
function module.tick()
  local tools = ns.rosterTools
  if not tools or not ns.isOfficer or not ns.isOfficer() or not tools.authorized() then return false end
  if not (module.enabled("professions") or module.enabled("epgp") or module.enabled("promote")) then return false end
  if tools.plan and tools.plan.pending then return false end
  -- A plan an officer is reviewing by hand is never replaced.
  if tools.plan and not tools.plan.auto and clock() - tools.plan.at < 120 then return false end
  if clock() < nextAt then return false end
  if clock() - tools.refreshedAt > 25 or tools.refreshedScope ~= tools.context() then
    if clock() - lastRequest >= module.INTERVAL then lastRequest = clock(); tools.requestRoster() end
    return false
  end
  local snapshot = tools.snapshot(); if not snapshot then return false end
  for _, c in ipairs(module.candidates(snapshot)) do
    if (tried[attemptKey(c)] or 0) < 2 and not (tools.isBlocked and tools.isBlocked(c.action)) then
      nextAt = clock() + module.INTERVAL
      return module.apply(c)
    end
  end
  -- Nothing left: look again after a quiet minute.
  nextAt = clock() + module.IDLE_INTERVAL
  return false
end

-- ----- greeting --------------------------------------------------------------

local GREETING = {
  en = "Welcome to the guild, %s! Glad to have you. Ask anyone if you need a hand.",
  fr = "Bienvenue dans la guilde, %s ! Content de t'avoir avec nous. N'h\195\169site pas \195\160 demander de l'aide.",
}
function module.greetingText(name)
  local d = db()
  local lang = d and d.officerAuto and d.officerAuto.lang
  if lang ~= "en" and lang ~= "fr" then lang = ns.language and ns.language() or "en" end
  local display = ns.util and ns.util.displayName and ns.util.displayName(name) or name
  return string.format(GREETING[lang] or GREETING.en, display)
end

local function joinPattern()
  local template = type(ERR_GUILD_JOIN_S) == "string" and ERR_GUILD_JOIN_S or "%s has joined the guild."
  local escaped = string.gsub(template, "([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
  return "^" .. (string.gsub(escaped, "%%s", "(.+)")) .. "$"
end

local greetedNow = {} -- this session, in case SavedVariables are unavailable
local function greetKey(name) return bare(name) or name end
function module.greeted(name)
  local s = state()
  local key = greetKey(name)
  return greetedNow[key] == true or (s and s.greeted[key] ~= nil) or false
end
local function markGreeted(name)
  local s, key = state(), greetKey(name)
  greetedNow[key] = true
  if s then
    s.greeted[key] = epoch()
    local count, oldest, oldestKey = 0, nil, nil
    for k, at in pairs(s.greeted) do count = count + 1; if not oldest or at < oldest then oldest, oldestKey = at, k end end
    if count > 400 and oldestKey then s.greeted[oldestKey] = nil end
  end
end

-- The game sometimes refuses the welcome line (taint log of 10 November 2026: "An action was blocked because of
-- taint from Guilded" at this send, twice, after members joined), while the milestone lines, sent the same way but
-- only out of combat, do go out. So the welcome waits while chat is locked (combat, or the game's chat lockdown),
-- and a refused line is tried again a few times instead of being lost. Nothing is remembered between sessions.
module.GREET_RETRY_SECONDS = 20
module.GREET_MAX_TRIES = 6
local function chatLocked()
  if ns.compat and ns.compat.inCombat and ns.compat.inCombat() then return true end
  if type(InCombatLockdown) == "function" then
    local ok, value = pcall(InCombatLockdown)
    if ok and value == true then return true end
  end
  local lockdown = C_ChatInfo and C_ChatInfo.InChatMessagingLockdown
  if type(lockdown) == "function" then
    local ok, value = pcall(lockdown)
    if ok and value == true then return true end
  end
  return false
end
local lastGuildSend
-- True when the line was handed to the game (which may still refuse it: see onBlocked).
local function sendGuild(item)
  local send = C_ChatInfo and C_ChatInfo.SendChatMessage or SendChatMessage
  if type(send) ~= "function" or chatLocked() then return false end
  lastGuildSend = { at = clock(), item = item }
  local ok, err = pcall(send, item.text, "GUILD")
  return ok and err ~= false
end
local function greetLater(item)
  item.tries = (item.tries or 0) + 1
  if item.tries > module.GREET_MAX_TRIES or not (C_Timer and C_Timer.After) then return false end
  C_Timer.After(module.GREET_RETRY_SECONDS, function()
    if module.enabled("greet") and not sendGuild(item) then greetLater(item) end
  end)
  return true
end
-- Core calls this on ADDON_ACTION_BLOCKED/FORBIDDEN naming Guilded. Returns true when it was the welcome line.
function module.onBlocked()
  local last, at = lastGuildSend, clock()
  if not last or at - last.at > 2 or at < last.at then return false end
  lastGuildSend = nil
  greetLater(last.item)
  return true
end

-- One officer welcomes: each waits a few seconds, and whoever goes first tells the others.
function module.onJoined(name)
  if not module.enabled("greet") or not (ns.isOfficer and ns.isOfficer()) then return false end
  if ns.playerName and bare(name) == ns.playerName() then return false end
  if module.greeted(name) then return false end
  local function go()
    if module.greeted(name) or not module.enabled("greet") then return end
    markGreeted(name)
    if ns.comm and IsInGuild and IsInGuild() then ns.comm.send(PREFIX, "GREETED|1|" .. name, "GUILD") end
    local item = { text = module.greetingText(name) }
    if not sendGuild(item) then greetLater(item) end
  end
  local wait = 3 + (math.random and math.random() * 5 or 0)
  if C_Timer and C_Timer.After then C_Timer.After(wait, go) else go() end
  return true
end
function module.onSystemMessage(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return end
  local name = string.match(text, joinPattern())
  if name then return module.onJoined(name) end
end
function module.onAddonMessage(text, sender)
  local name = string.match(text or "", "^GREETED|1|(.+)$")
  if name and #name <= 80 and ns.isOfficerName and ns.isOfficerName(bare(sender)) then greetedNow[greetKey(name)] = true end
end

-- ----- commands --------------------------------------------------------------

local LABELS = {
  professions = "Professions in public notes", epgp = "EP/GP in officer notes",
  promote = "Promote linked Initiates to Member", greet = "Greet new guild members",
}
module.LABELS = LABELS
function module.status()
  if not ns.message then return end
  for _, key in ipairs(module.KEYS) do
    ns.message(string.format("%s: %s", L(LABELS[key]), module.enabled(key) and L("on") or L("off")))
  end
end
function module.command(args)
  args = type(args) == "table" and args or {}
  -- args[1] is "officer", args[2] is "auto".
  local which, mode = string.lower(args[3] or ""), string.lower(args[4] or "")
  if which == "lang" then
    local s = state()
    if s and (mode == "en" or mode == "fr") then s.lang = mode; ns.message(L("The welcome message language is set.")) else ns.message("/guilded officer auto lang en|fr") end
    return
  end
  if which == "" or which == "status" then module.status(); return end
  local keys = { which }
  if which == "all" then keys = module.KEYS end
  if (mode ~= "on" and mode ~= "off") or (which ~= "all" and not KEY_SET[which]) then
    ns.message("/guilded officer auto status | professions|epgp|promote|greet|all on|off | lang en|fr")
    return
  end
  for _, key in ipairs(keys) do module.set(key, mode == "on") end
  module.status()
end

-- ----- events ----------------------------------------------------------------

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "CHAT_MSG_SYSTEM", "CHAT_MSG_ADDON" }) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event, a, b, c, d)
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then if ns.comm and ns.comm.register then ns.comm.register(PREFIX) end
    elseif event == "CHAT_MSG_SYSTEM" then module.onSystemMessage(a)
    elseif event == "CHAT_MSG_ADDON" and ns.comm and ns.comm.accept(a, b, c, d, PREFIX) and c == "GUILD" then module.onAddonMessage(b, d) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "officernotes: " .. tostring(err)) end
end)
local elapsedTotal = 0
frame:SetScript("OnUpdate", function(_, elapsed)
  elapsedTotal = elapsedTotal + (elapsed or 0.25)
  if elapsedTotal < 2 then return end
  elapsedTotal = 0
  local ok, err = pcall(module.tick)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "officernotes: " .. tostring(err)) end
end)

ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded officer auto status | professions|epgp|promote|greet|all on|off | lang en|fr - what this officer client does on its own" })
