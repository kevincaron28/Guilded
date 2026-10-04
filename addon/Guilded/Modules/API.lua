-- GuildedAPI: a small READ-ONLY public API for other addons and
-- WeakAuras (version 1).
--
--   local api = _G.GuildedAPI
--   api.GetAPIVersion()          -> 1
--   api.GetAddonVersion()        -> "6.0.0"
--   api.IsReady()                -> true once saved data is loaded
--   api.GetStanding(name)        -> { ep, gp, pr } from the Discord standings, or nil
--   api.GetStandingsUpdatedAt()  -> ISO time string or nil
--   api.GetReadiness(name)       -> { status, itemLevel, findings = { { code, severity, message } }, source, updatedAt } or nil
--   api.GetAttunements(name)     -> { { name, completed } } (possibly empty)
--   api.GetRosterNames()         -> sorted list of guild member names (not raid pugs or past members)
--   api.GetActiveRaid()          -> { title, startedAt } or nil
--
-- Deliberately read-only: there is no function that awards EP/GP, changes
-- settings or sends messages, because writes would skip the permission
-- checks, the ledger and the sync rules that Guilded itself follows.
-- Every call returns NEW tables (safe to keep or change), never touches the
-- game (no scans, no messages), and returns nil instead of raising.
local addonName, ns = ...
ns = ns or {}

local API_VERSION = 1

local function safe(fn)
  return function(...)
    local ok, a = pcall(fn, ...)
    if ok then return a end
    return nil
  end
end

local function db()
  return ns.getDb and ns.getDb()
end

local function key(name)
  return ns.normalizeName and ns.normalizeName(name)
end

local api = {}

api.GetAPIVersion = function() return API_VERSION end

api.GetAddonVersion = safe(function()
  return ns.compat and ns.compat.addonVersion() or "0"
end)

api.IsReady = function() return db() ~= nil end

api.GetStanding = safe(function(name)
  local row = ns.getStanding and ns.getStanding(name)
  if not row then return nil end
  return { ep = row.ep, gp = row.gp, pr = row.pr }
end)

api.GetStandingsUpdatedAt = safe(function()
  return ns.getStandingsUpdatedAt and ns.getStandingsUpdatedAt()
end)

api.GetReadiness = safe(function(name)
  local d, who = db(), key(name)
  if not d or not who then return nil end
  local own = d.readiness and d.readiness[who]
  if own then
    local findings = {}
    for _, finding in ipairs(own.findings or {}) do
      table.insert(findings, { code = finding.code, severity = finding.severity, message = finding.message })
    end
    return { status = own.status, itemLevel = own.itemLevel, findings = findings, source = "self", updatedAt = own.inspectedAt }
  end
  local peer = d.peerRoster and d.peerRoster[who]
  if peer then
    return { status = peer.status, findings = {}, source = "peer", updatedAt = peer.updatedAt }
  end
  return nil
end)

api.GetAttunements = safe(function(name)
  local d, who = db(), key(name)
  local list = {}
  if not d or not who then return list end
  for attunement, entry in pairs(d.attunements and d.attunements[who] or {}) do
    table.insert(list, { name = attunement, completed = entry.completed ~= false })
  end
  table.sort(list, function(a, b) return a.name < b.name end)
  return list
end)

api.GetRosterNames = safe(function()
  local d = db()
  local names = {}
  if not d then return names end
  for name, entry in pairs(d.roster or {}) do
    if type(entry) == "table" and entry.inGuild ~= false then table.insert(names, name) end
  end
  table.sort(names)
  return names
end)

api.GetActiveRaid = safe(function()
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  if not raid then return nil end
  return { title = raid.title, startedAt = raid.startedAt }
end)

-- Freeze the table so another addon cannot replace a function by accident.
_G.GuildedAPI = setmetatable({}, {
  __index = api,
  __newindex = function() end,
  __metatable = false
})
ns.api = api
