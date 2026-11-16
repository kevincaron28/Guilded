-- Secret achievements recorded in the addon (owner request, 16 Nov 2026). The first: killed by the Son of Arugal.
--
-- A secret is a milestone of kind "secret" (ref "secret:<key>"), so it reaches the bot through the existing milestone upload and
-- the bot's catalogue row (services/achievements-catalogue.ts, `secretRef` = the key) turns it into the achievement. Nothing
-- new is sent. The bot hides the achievement everywhere until it is earned.
--
-- Adding another "killed by" secret is ONE line in KILLED_BY below ({ [npc id] = key }), its name in NAMES (and Locale.lua for
-- French), plus its catalogue row on the bot.
--
-- How a kill is seen: COMBAT_LOG_EVENT_UNFILTERED is not available to addons (Core.lua explains why Guilded never registers it), so
-- there is no UNIT_DIED to read. Instead, while the player is in combat, a light read-only poll looks at the units the client already
-- exposes (target, focus, mouseover, name plates) and remembers hostile ones whose target is the player ("attacker sightings",
-- by creature id parsed from the GUID). When PLAYER_DEAD fires, a sighting of a listed creature in the last few seconds is the
-- killer. Nothing protected is called, hidden (secret) values are ignored, and every call is pcall-wrapped.
local _, ns = ...
local sa = {}
ns.secretAchievements = sa

-- creature id -> secret key (the bot's `secretRef`). 2529 = Son of Arugal (wowclassicdb.com/npc/2529), the elite worgen of Silverpine Forest.
local KILLED_BY = { [2529] = "killed-arugal" }
sa.killedBy = KILLED_BY
-- key -> the name said in chat and in the local notice (English; Locale.lua has the French).
local NAMES = { ["killed-arugal"] = "Silverpine Welcome Committee" }
local WINDOW = 10        -- seconds a sighting stays good for
local POLL = 0.4         -- seconds between polls while in combat
local MAX_SIGHTINGS = 12
local UNITS = { "target", "focus", "mouseover" }
for i = 1, 20 do UNITS[#UNITS + 1] = "nameplate" .. i end

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("milestones") end
local function now() local ok, v = pcall(GetTime); return ok and tonumber(v) or (time and time()) or 0 end

-- The creature id of a GUID like "Creature-0-3-0-0-2529-0000123456", or nil (players, pets, items, malformed or hidden values).
function sa.npcId(guid)
  if type(guid) ~= "string" or (ns.isSecret and ns.isSecret(guid)) then return nil end
  local kind, rest = guid:match("^(%a+)%-(.+)$")
  if kind ~= "Creature" and kind ~= "Vehicle" then return nil end
  local parts = {}
  for piece in rest:gmatch("[^%-]+") do parts[#parts + 1] = piece end
  -- Creature-<type>-<server>-<instance>-<zone>-<npc id>-<spawn uid>: after the kind, the npc id is the fifth field.
  return tonumber(parts[5])
end

local sightings = {}
-- Remembers that this creature is attacking the player right now. Returns its npc id when it is one we watch.
function sa.noteAttacker(guid, at)
  local npc = sa.npcId(guid)
  if not npc then return nil end
  at = at or now()
  sightings[npc] = at
  local n = 0
  for id, t in pairs(sightings) do
    if at - t > WINDOW then sightings[id] = nil else n = n + 1 end
  end
  if n > MAX_SIGHTINGS then sightings = { [npc] = at } end
  return KILLED_BY[npc] and npc or nil
end

local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, v = pcall(fn, ...)
  if not ok or (ns.isSecret and ns.isSecret(v)) then return nil end
  return v
end

-- One read-only pass over the visible units: any hostile creature targeting the player is a sighting.
function sa.scan()
  for _, unit in ipairs(UNITS) do
    if call(UnitExists, unit) == true and call(UnitCanAttack, "player", unit) == true and call(UnitIsUnit, unit .. "target", "player") == true then
      sa.noteAttacker(call(UnitGUID, unit))
    end
  end
end

-- Records the secret once per character (Milestones.reach is once-only) and tells the player locally; the guild-chat line follows
-- the normal milestone switches (/guilded announce secret off).
function sa.reach(key)
  local ms = ns.milestones
  if not active() or not ms or not ms.reach or not NAMES[key] then return false end
  local name = L(NAMES[key])
  local ref = "secret:" .. key
  if not ms.reach(ref, ref, { kind = "secret", value = 1, label = name }) then return false end
  if ns.message then ns.message(string.format(L("Secret achievement unlocked: %s!"), name)) end
  return true
end

-- The player died: unlock the secret of any listed creature seen attacking in the last WINDOW seconds. Returns the keys unlocked.
function sa.onDeath(at)
  at = at or now()
  local unlocked = {}
  for npc, key in pairs(KILLED_BY) do
    local seen = sightings[npc]
    if seen and at - seen <= WINDOW and sa.reach(key) then unlocked[#unlocked + 1] = key end
  end
  sightings = {}
  return unlocked
end

local frame = CreateFrame("Frame")
pcall(frame.RegisterEvent, frame, "PLAYER_DEAD")
local elapsed = 0
frame:SetScript("OnUpdate", function(_, dt)
  elapsed = elapsed + (tonumber(dt) or 0)
  if elapsed < POLL then return end
  elapsed = 0
  pcall(function()
    if active() and call(UnitAffectingCombat, "player") == true then sa.scan() end
  end)
end)
frame:SetScript("OnEvent", function(_, event)
  local ok, err = pcall(function()
    if not active() then return end
    if event == "PLAYER_DEAD" then sa.scan(); sa.onDeath() end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "secretAchievements: " .. tostring(err)) end
end)
