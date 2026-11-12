-- Officer-client housekeeping. Since 9.2 one small job an officer's game client does on its own, ON by
-- default with its own off switch (/guilded officer auto, and Settings for officers):
--   promote      a member at the LOWEST rank (found by index, never by name) who is linked to a Discord
--                member of this server (GuildedPromotion.linked from the bot) goes up exactly one rank,
--                once per player, never a demotion.
-- 9.2 removed the other three jobs of this module: the profession tags in public guild notes, the EP/GP
-- standing in officer notes (WoW Forever refuses guild-note edits from addons, #618) and the automatic guild
-- welcome (a chat line sent from a timer, blocked in the 10 November taint log). Their saved keys
-- (db.officerAuto.off.professions/epgp/greet, .greeted, .lang) stay in old saved files and are ignored.
-- Every write goes through the reviewed RosterTools engine (permission checks, fresh roster, audit,
-- verification) and is paced: one change per 12 seconds. Nothing runs in combat or for a non-officer.
local _, ns = ...
ns = ns or {}
local module = {}
ns.officerNotes = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local function clock() return GetTime and GetTime() or 0 end
local function epoch() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function bare(name) return ns.normalizeName and ns.normalizeName(name) or name end

module.INTERVAL = 12 -- seconds between two changes
module.IDLE_INTERVAL = 60 -- seconds between roster refreshes when nothing is left to do
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
  return true
end
local function record(kind, name, detail)
  local s = state(); if not s then return end
  s.log[#s.log + 1] = { at = epoch(), kind = kind, name = name, detail = detail }
  while #s.log > 60 do table.remove(s.log, 1) end
  if ns.message and (kind == "promote") then ns.message(string.format(L("Promoted %s: %s"), name, detail or "")) end
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
  if not module.enabled("promote") then return out end
  local linked = linkedSet()
  local s = state()
  local keys = {}
  for key in pairs(snapshot.rows) do keys[#keys + 1] = key end
  table.sort(keys)
  local lowest = snapshot.ranks - 1
  for _, key in ipairs(keys) do
    local row = snapshot.rows[key]
    if row.key ~= snapshot.actor.key and row.rank > snapshot.actor.rank then
      -- The lowest rank by index, linked, one step, once per player.
      if lowest >= 2 and row.rank == lowest and linked[key] and not (s and s.promoted[key]) then
        out[#out + 1] = { key = key, name = row.name, action = "promote", value = "", kind = "promote", detail = row.rankName }
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
  local s = state(); if s then s.promoted[c.key] = epoch() end
  record("promote", c.name, string.format(L("rank %s to the next rank up (linked to Discord)"), tostring(c.detail or "?")))
  return true
end

local lastRequest, nextAt = -1000, 0
function module.tick()
  local tools = ns.rosterTools
  if not tools or not ns.isOfficer or not ns.isOfficer() or not tools.authorized() then return false end
  if not module.enabled("promote") then return false end
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

-- ----- commands --------------------------------------------------------------

local LABELS = {
  promote = "Promote linked Initiates to Member",
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

-- ----- events ----------------------------------------------------------------

local frame = CreateFrame("Frame")
local elapsedTotal = 0
frame:SetScript("OnUpdate", function(_, elapsed)
  elapsedTotal = elapsedTotal + (elapsed or 0.25)
  if elapsedTotal < 2 then return end
  elapsedTotal = 0
  local ok, err = pcall(module.tick)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "officernotes: " .. tostring(err)) end
end)

ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded officer auto status | promote on|off - what this officer client does on its own" })
