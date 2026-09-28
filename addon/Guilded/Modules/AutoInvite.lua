-- Auto-invite by whisper: a player whispers the phrase (default "ginv") to an
-- officer who has it switched on, and gets a guild invite. For recruiting
-- without typing invites by hand. Officers only, off by default.
--
--   /guilded autoinvite on [phrase]   start (phrase default "ginv")
--   /guilded autoinvite off | status
--
-- Safety: only an officer who can invite, never in combat, players already
-- in the guild are skipped, each name is invited at most once per hour and
-- at most 15 invites go out per hour. The last invites are kept for
-- /guilded autoinvite status. Whispers the game hides (secret) are ignored.
local addonName, ns = ...
ns = ns or {}

local DEFAULT_PHRASE = "ginv"
local PER_NAME_SECONDS = 3600
local MAX_PER_HOUR = 15

local module = {}
ns.autoInvite = module

local sentAt = {}      -- name -> time of the last invite
local hourly = {}      -- times of invites in the last hour
local inCombat = false

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.autoInvite = db.autoInvite or { enabled = false, phrase = DEFAULT_PHRASE, log = {} }
  return db.autoInvite
end

local function clock()
  return time and time() or 0
end

local function normalizePhrase(text)
  return string.lower((string.gsub(text or "", "^%s*(.-)%s*$", "%1")))
end

local function canInvite()
  if CanGuildInvite then return CanGuildInvite() and true or false end
  return true
end

-- Someone the guild roster lists now (a pug you raided with, or a member who left, can
-- still be invited).
local function alreadyInGuild(name)
  if ns.isGuildMember then return ns.isGuildMember(name) end
  local db = ns.getDb and ns.getDb()
  return db and db.roster and db.roster[name] ~= nil
end

local function record(auto, name, ok)
  table.insert(auto.log, { at = ns.now and ns.now() or "", name = name, ok = ok })
  while #auto.log > 20 do table.remove(auto.log, 1) end
end

local function invite(name)
  if C_GuildInfo and C_GuildInfo.Invite then return pcall(C_GuildInfo.Invite, name) end
  if GuildInvite then return pcall(GuildInvite, name) end
  return false, "no invite function"
end

-- Called for every whisper. Returns true when an invite was sent.
function module.onWhisper(text, sender)
  local auto = state()
  if not auto or not auto.enabled then return false end
  if ns.isSecret and (ns.isSecret(text) or ns.isSecret(sender)) then return false end
  if normalizePhrase(text) ~= normalizePhrase(auto.phrase) then return false end
  if inCombat or not canInvite() or not (ns.isOfficer and ns.isOfficer()) then return false end
  local name = ns.normalizeName and ns.normalizeName(sender)
  if not name or alreadyInGuild(name) then return false end
  local now = clock()
  if sentAt[name] and now - sentAt[name] < PER_NAME_SECONDS then return false end
  local recent = {}
  for _, at in ipairs(hourly) do if now - at < 3600 then table.insert(recent, at) end end
  hourly = recent
  if #hourly >= MAX_PER_HOUR then return false end
  local ok = invite(sender)
  sentAt[name] = now
  table.insert(hourly, now)
  record(auto, name, ok and true or false)
  if ns.message then ns.message(ok and ("Invited " .. name .. " to the guild (they whispered " .. auto.phrase .. ").") or ("Could not invite " .. name .. ".")) end
  return ok and true or false
end

local frame = CreateFrame("Frame")
if ns.compat and ns.compat.registerEvent then
  ns.compat.registerEvent(frame, "CHAT_MSG_WHISPER")
  ns.compat.registerEvent(frame, "PLAYER_REGEN_DISABLED")
  ns.compat.registerEvent(frame, "PLAYER_REGEN_ENABLED")
else
  pcall(frame.RegisterEvent, frame, "CHAT_MSG_WHISPER")
end
frame:SetScript("OnEvent", function(_, event, text, sender)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("autoinvite") then return end
    if event == "PLAYER_REGEN_DISABLED" then inCombat = true
    elseif event == "PLAYER_REGEN_ENABLED" then inCombat = false
    elseif event == "CHAT_MSG_WHISPER" then module.onWhisper(text, sender) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "autoinvite: " .. tostring(err)) end
end)

-- ---------------------------------------------------------------------
-- /guilded invite raid | missing: invite everyone signed up for the next raid
-- (the Discord signups the companion wrote into Standings.lua).
-- ---------------------------------------------------------------------

local INVITE_SPACING_SECONDS = 0.6

local function partyInvite(name)
  if C_PartyInfo and C_PartyInfo.InviteUnit then return pcall(C_PartyInfo.InviteUnit, name) end
  if InviteUnit then return pcall(InviteUnit, name) end
  return false, "no invite function"
end

local function nextRaid()
  local raid = GuildedNextRaid
  if type(raid) ~= "table" or type(raid.players) ~= "table" then return nil end
  return raid
end

-- Who signed up for the next raid and is not in your group yet.
function module.missingFromGroup()
  local raid = nextRaid()
  if not raid then return nil end
  local inGroup = {}
  for _, name in ipairs(ns.groupMembers and ns.groupMembers() or {}) do inGroup[name] = true end
  local missing = {}
  for _, player in ipairs(raid.players) do
    local name = ns.normalizeName and ns.normalizeName(player.name)
    if name and not inGroup[name] then table.insert(missing, name) end
  end
  return missing, raid
end

local function inviteRaid()
  local missing, raid = module.missingFromGroup()
  if not raid then
    ns.message("No raid roster yet. It comes from Discord signups through the companion (and needs a raid created in the next day and a half).")
    return
  end
  if inCombat then ns.message("Not while you are in combat.") return end
  if #missing == 0 then ns.message("Everyone signed up for " .. tostring(raid.title) .. " is already in your group.") return end
  ns.message(string.format("Inviting %d of %d signed up for %s: %s", #missing, #raid.players, tostring(raid.title), table.concat(missing, ", ")))
  local failed = {}
  for index, name in ipairs(missing) do
    local function go()
      local ok = partyInvite(name)
      if not ok then table.insert(failed, name) end
      if index == #missing and #failed > 0 then
        ns.message("The game would not invite: " .. table.concat(failed, ", ") .. ". Invite them by hand.")
      end
    end
    if C_Timer and C_Timer.After and index > 1 then C_Timer.After((index - 1) * INVITE_SPACING_SECONDS, go) else go() end
  end
  ns.message("Invites sent. If the group turns into more than 5, convert it to a raid (right-click yourself in the portrait menu).")
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["invite"] = function(args)
  if ns.moduleActive and not ns.moduleActive("autoinvite") then return end
  if not (ns.isOfficer and ns.isOfficer()) then ns.message("Only officers can invite the raid.") return end
  local action = string.lower(args[1] or "raid")
  if action == "missing" then
    local missing, raid = module.missingFromGroup()
    if not raid then ns.message("No raid roster yet (see /guilded invite raid).") return end
    ns.message(#missing == 0 and ("Everyone signed up for " .. tostring(raid.title) .. " is in your group.")
      or (#missing .. " signed up for " .. tostring(raid.title) .. " but not in your group: " .. table.concat(missing, ", ")))
  elseif action == "raid" then inviteRaid()
  else ns.message("/guilded invite raid | missing") end
end
ns.commandHandlers["autoinvite"] = function(args)
  if ns.moduleActive and not ns.moduleActive("autoinvite") then return end
  local auto = state()
  if not auto then return end
  if not (ns.isOfficer and ns.isOfficer()) then ns.message("Only officers can use auto-invite.") return end
  local action = string.lower(args[1] or "status")
  if action == "on" then
    local phrase = table.concat(args, " ", 2)
    if phrase ~= "" then auto.phrase = phrase end
    auto.enabled = true
    ns.message("Auto-invite is on: whisper \"" .. auto.phrase .. "\" to you to be invited. Turn it off with /guilded autoinvite off.")
  elseif action == "off" then
    auto.enabled = false
    ns.message("Auto-invite is off.")
  else
    ns.message(string.format("Auto-invite is %s, phrase \"%s\". %d recent invite(s).", auto.enabled and "on" or "off", auto.phrase, #auto.log))
    for i = math.max(1, #auto.log - 4), #auto.log do
      local entry = auto.log[i]
      ns.message(string.format("  %s %s%s", entry.at, entry.name, entry.ok and "" or " (failed)"))
    end
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded autoinvite on [phrase] | off | status - invite players who whisper you the phrase" })
table.insert(ns.commandHelp, { officer = true, text = "/guilded invite raid | missing - invite everyone signed up for the next raid on Discord" })
