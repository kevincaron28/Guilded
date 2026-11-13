-- Guilded Dungeons: the standalone dungeon addon (7.0). The files in Shared/ are copied from
-- Guilded by scripts/build-dungeons-addon.mjs; this file gives them the few things Guilded's
-- Core.lua normally provides, with this addon's own SavedVariables (GuildedDungeonsDB).
--
-- When Guilded is installed too, Guilded records the run: every shared module checks
-- ns.moduleActive first, and that answers false here, so this addon stays silent.
local _, ns = ...
ns = ns or {}
ns.standalone = true

local function addonLoaded(name)
  if C_AddOns and C_AddOns.IsAddOnLoaded then
    local ok, loaded = pcall(C_AddOns.IsAddOnLoaded, name)
    if ok then return loaded == true or loaded == 1 end
  end
  if IsAddOnLoaded then
    local ok, loaded = pcall(IsAddOnLoaded, name)
    if ok then return loaded == true or loaded == 1 end
  end
  return false
end

local guildedSeen = false
function ns.guildedPresent()
  if not guildedSeen then guildedSeen = addonLoaded("Guilded") end
  return guildedSeen
end
function ns.moduleActive() return not ns.guildedPresent() end

function ns.getDb()
  GuildedDungeonsDB = type(GuildedDungeonsDB) == "table" and GuildedDungeonsDB or {}
  local db = GuildedDungeonsDB
  db.settings = type(db.settings) == "table" and db.settings or {}
  db.character = type(db.character) == "table" and db.character or {}
  return db
end
function ns.getSettings() return ns.getDb().settings end

function ns.isSecret(value)
  return issecretvalue ~= nil and issecretvalue(value) == true
end

-- Same spellings as Guilded (Core.lua), so both addons agree on run ids and player names.
function ns.playerName()
  if ns.util and ns.util.unitKey then return ns.util.unitKey("player") or "Unknown" end
  local name = UnitName and UnitName("player")
  if type(name) == "string" and not ns.isSecret(name) then name = string.match(name, "^([^%-%s]+)") or name end
  return name or "Unknown"
end

function ns.normalizeName(name)
  if ns.util and ns.util.characterKey then return ns.util.characterKey(name) end
  if type(name) ~= "string" or ns.isSecret(name) then return nil end
  name = string.match(name, "^%s*(.-)%s*$")
  name = string.match(name, "^([^%-%s]+)") or name
  if name == "" then return nil end
  return string.upper(string.sub(name, 1, 1)) .. string.lower(string.sub(name, 2))
end

function ns.message(text)
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cffd4af37[Guilded Dungeons]|r " .. tostring(text)) end
end

-- No guild officers here: start/complete/abandon follow the group leader (or solo play).
function ns.isOfficer() return false end

-- Who may send guild sync messages (Transport.lua's "guild" and "officer" policies). Guilded's
-- Core.lua answers these from its saved roster and officer settings; this addon keeps neither, so
-- it reads the game's guild roster. Without them every guild message was refused: a guildmate's
-- "my bot has your run" (ACK) and an officer's replay request never arrived, and the same runs
-- were replayed at every login.
-- (9.3) One scan builds a name -> rank map that every check then reads (a guild message used to rescan the whole roster per
-- chunk); GUILD_ROSTER_UPDATE (Dungeon.lua calls ns.invalidateRoster) drops it. A roster that is not loaded yet (nothing in it, right
-- after login) is never cached, and ns.rosterReady() says so, so a guild message is held back instead of refused.
local rosterMap
function ns.invalidateRoster() rosterMap = nil end
function ns.rosterReady()
  if not GetNumGuildMembers then return true end
  local ok, count = pcall(GetNumGuildMembers)
  return ok and type(count) == "number" and count > 0
end
local function rosterRank(name)
  name = ns.normalizeName(name)
  if not name or not GetNumGuildMembers or not GetGuildRosterInfo then return nil end
  if not rosterMap then
    local ok, count = pcall(GetNumGuildMembers)
    if not ok or type(count) ~= "number" or count < 1 then return nil end
    local map = {}
    for i = 1, count do
      local read, rosterName, _, rankIndex = pcall(GetGuildRosterInfo, i)
      if read and not ns.isSecret(rosterName) then
        local key = ns.normalizeName(rosterName)
        if key then map[key] = type(rankIndex) == "number" and rankIndex or 99 end
      end
    end
    rosterMap = map
  end
  return rosterMap[name]
end
function ns.isGuildMember(name) return rosterRank(name) ~= nil end
-- The guild master and the rank below: Guilded's default officer ranks (this addon has no setting).
function ns.isOfficerName(name)
  local rank = rosterRank(name)
  return rank ~= nil and rank <= 1
end

function ns.logDiagnostic(kind, detail)
  local db = ns.getDb()
  db.diagnostics = type(db.diagnostics) == "table" and db.diagnostics or {}
  table.insert(db.diagnostics, { kind = kind, detail = tostring(detail), at = time and time() or 0 })
  while #db.diagnostics > 25 do table.remove(db.diagnostics, 1) end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
