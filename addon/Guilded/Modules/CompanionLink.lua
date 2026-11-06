-- "Get the companion" (8.5.0 E4). Addons cannot open web pages, so the window shows the links in
-- a box to copy, and a gentle reminder (at most once a week, on by default) goes to members who
-- do not seem to have their own companion running.
--
--   /guilded companion          show the links
--   /guilded companion off|on   turn the weekly reminder off or on
--
-- "Does not have a companion" means: the officer bridge listed this character in
-- `needsCompanion` (names the officer's companion saw without a recent upload), or this
-- computer has never had a companion file (no GuildedStandings.updatedAt).
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.companionLink = module

module.SHORT = "https://guilded.kcaron.top/companion/"
module.DIRECT = "https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe"
local WEEK = 7 * 24 * 3600

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return time and time() or 0 end

function module.enabled()
  local s = ns.getSettings and ns.getSettings()
  return not (s and s.companionReminder == false)
end

function module.setEnabled(on)
  local s = ns.getSettings and ns.getSettings()
  if s then s.companionReminder = on and true or false end
end

-- True when this player seems to lack a companion of their own.
function module.needed()
  local d = ns.getDb and ns.getDb()
  local snapshot = d and d.officerBridge and d.officerBridge.snapshot
  local me = ns.playerName and ns.playerName()
  local list = type(snapshot) == "table" and snapshot.needsCompanion
  if type(list) == "table" and me then
    for _, name in ipairs(list) do
      if ns.normalizeName and ns.normalizeName(name) == ns.normalizeName(me) or name == me then return true end
    end
  end
  return not (type(GuildedStandings) == "table" and type(GuildedStandings.updatedAt) == "string")
end

function module.text()
  return L("Guilded companion (Windows): sends your data to Discord and brings standings, raids and signups into the game.")
end

-- Says the reminder in chat when it is due. Returns true when it spoke.
function module.remind(force)
  local d = ns.getDb and ns.getDb()
  if not d then return false end
  if not force then
    if not module.enabled() or not module.needed() then return false end
    if ns.isInGameOnly and ns.isInGameOnly() then return false end
    if clock() - (tonumber(d.companionRemindedAt) or 0) < WEEK then return false end
  end
  d.companionRemindedAt = clock()
  ns.message(module.text() .. " " .. module.SHORT)
  ns.message(L("Open Guilded > Home to copy the link. Turn this reminder off: /guilded companion off"))
  return true
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["companion"] = function(args)
  local action = string.lower(args and args[1] or "")
  if action == "off" then module.setEnabled(false); ns.message(L("Companion reminder off."))
  elseif action == "on" then module.setEnabled(true); ns.message(L("Companion reminder on (at most once a week)."))
  else
    ns.message(module.text())
    ns.message(module.SHORT)
    ns.message(module.DIRECT)
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded companion [on|off] - the Windows companion link and its weekly reminder")

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:SetScript("OnEvent", function()
  -- Let the login chatter and the digest settle first.
  if C_Timer and C_Timer.After then
    C_Timer.After(20, function() pcall(module.remind) end)
  end
end)
