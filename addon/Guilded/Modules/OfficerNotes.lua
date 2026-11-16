-- Officer-client settings. Since 16 November 2026 this module no longer does anything on a timer: the switch it
-- keeps ("promote", /guilded officer auto promote on|off and the officer checkbox in Settings) controls the small
-- "N ready to promote" alert and the one-click promotion in Modules/Promotion.lua, which follows the Discord
-- bot's rule (GuildedPromotion.ready) and never promotes the Alt rank. The switch is ON by default; its saved key
-- (db.officerAuto.off.promote) is unchanged, so an officer who turned the old automatic promoter off keeps it off.
-- 9.2 removed the other three jobs of this module: the profession tags in public guild notes, the EP/GP
-- standing in officer notes (WoW Forever refuses guild-note edits from addons, #618) and the automatic guild
-- welcome (a chat line sent from a timer, blocked in the 10 November taint log). Their saved keys
-- (db.officerAuto.off.professions/epgp/greet, .greeted, .lang) stay in old saved files and are ignored.
-- Every write still goes through the reviewed RosterTools engine (permission checks, fresh roster, audit,
-- verification), one click per promotion. Nothing runs in combat or for a non-officer.
local _, ns = ...
ns = ns or {}
local module = {}
ns.officerNotes = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local function epoch() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end

module.KEYS = { "promote" }
local KEY_SET = {}; for _, key in ipairs(module.KEYS) do KEY_SET[key] = true end

-- ----- settings (per officer client; a missing value means ON) ---------------

local function state()
  local d = db(); if not d then return nil end
  d.officerAuto = type(d.officerAuto) == "table" and d.officerAuto or {}
  local s = d.officerAuto
  s.off = type(s.off) == "table" and s.off or {}
  s.promoted = type(s.promoted) == "table" and s.promoted or {}
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
  if ns.promotion and ns.promotion.updateAlert then pcall(ns.promotion.updateAlert) end
  return true
end

-- Called by the promotion panel once the roster VERIFIED a promotion (never at send time): a refused or unverified
-- attempt is therefore never remembered as done and can be tried again.
function module.markPromoted(key, name, beforeRank)
  local s = state(); if not s or not key then return end
  s.promoted[key] = epoch()
  s.log[#s.log + 1] = { at = epoch(), kind = "promote", name = name, detail = tostring(beforeRank or "?") }
  while #s.log > 60 do table.remove(s.log, 1) end
  if ns.message then ns.message(string.format(L("Promoted %s: %s"), tostring(name), L("rank up by one (ready by the bot's rule)"))) end
end

-- ----- commands --------------------------------------------------------------

local LABELS = {
  promote = "Show a ready-to-promote alert (one click each)",
}
module.LABELS = LABELS
function module.status()
  if not ns.message then return end
  for _, key in ipairs(module.KEYS) do
    ns.message(string.format("%s: %s", L(LABELS[key]), module.enabled(key) and L("on") or L("off")))
  end
end
-- Switches removed in 9.2 (they only wrote guild notes or sent the automatic welcome).
local REMOVED = { professions = true, epgp = true, greet = true, lang = true }
function module.command(args)
  args = type(args) == "table" and args or {}
  -- args[1] is "officer", args[2] is "auto".
  local which, mode = string.lower(args[3] or ""), string.lower(args[4] or "")
  if REMOVED[which] then
    ns.message(string.format(L("/guilded %s was removed in 9.2: %s"), "officer auto " .. which, L("WoW does not let addons write guild notes or send the automatic welcome.")))
    return
  end
  if which == "" or which == "status" then module.status(); return end
  local keys = { which }
  if which == "all" then keys = module.KEYS end
  if (mode ~= "on" and mode ~= "off") or (which ~= "all" and not KEY_SET[which]) then
    ns.message("/guilded officer auto status | promote on|off")
    return
  end
  for _, key in ipairs(keys) do module.set(key, mode == "on") end
  module.status()
end

ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded officer auto status | promote on|off - the ready-to-promote alert for this officer" })
