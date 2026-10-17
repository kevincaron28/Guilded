-- Local-only core configuration. Kept separate from companion/bridge snapshots.
-- One officer maintains this copy; backup/restore transfers a snapshot, never live sync.
local _, ns = ...
local localGuild = {}
ns.localGuild = localGuild
local function L(text) return ns.L and ns.L(text) or text end
local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return end
  db.localGuild = db.localGuild or { cores = {}, nextId = 0, audit = {} }
  return db.localGuild
end
local function allowed()
  if not (ns.isOfficer and ns.isOfficer()) then ns.message(L("Only a guild officer can edit local cores.")); return false end
  if not (ns.isInGameOnly and ns.isInGameOnly()) then ns.message(L("Choose In-game only in Guilded setup to edit local cores.")); return false end
  if ns.getActiveRaid and ns.getActiveRaid() then ns.message(L("Finish the active raid before changing local cores.")); return false end
  return state() ~= nil
end
local function audit(action, core, player)
  local s = state()
  s.audit[#s.audit + 1] = { at = ns.now(), by = ns.playerName(), action = action, core = core.id, player = player }
  while #s.audit > 100 do table.remove(s.audit, 1) end
  if ns.onLootChange then pcall(ns.onLootChange) end
end
function localGuild.rules()
  local s = state()
  return s and { default = "EPGP", minimumBid = 0, values = {}, cores = s.cores, localOnly = true }
end
function localGuild.find(value)
  local s = state()
  for _, core in ipairs(s and s.cores or {}) do
    if core.id == value or core.name:lower() == tostring(value):lower() then return core end
  end
end
function localGuild.create(name)
  if not allowed() then return false end
  name = type(name) == "string" and name:match("^%s*(.-)%s*$") or ""
  if name == "" or #name > 48 or name:find("[|%c]") or name:lower() == "auto" or name:lower() == "none" or name:lower() == "roster" then
    ns.message(L("Use a core name of 1-48 characters, without chat markup.")); return false
  end
  local s = state()
  if localGuild.find(name) or #s.cores >= 20 then ns.message(L("That core exists, or the limit of 20 cores was reached.")); return false end
  s.nextId = s.nextId + 1
  local core = { id = "local:" .. s.nextId, name = name, mode = "EPGP", pool = false, reserves = 1,
    values = {}, players = {}, roster = {}, localOnly = true }
  s.cores[#s.cores + 1] = core
  ns.getSettings().activeCore = core.id
  audit("CREATE", core); return true
end
function localGuild.configure(id, mode, reserveLimit)
  if not allowed() then return false end
  local core = localGuild.find(id)
  local limit = tonumber(reserveLimit)
  if not core or not ({ EPGP = true, COUNCIL = true, RESERVE = true, PRIORITY = true })[mode]
    or not limit or limit ~= math.floor(limit) or limit < 1 or limit > 10 then return false end
  core.mode, core.reserves = mode, limit
  ns.getSettings().lootMode = nil
  audit("RULES", core); return true
end
function localGuild.member(id, rawName, role, spot)
  if not allowed() then return false end
  local core = localGuild.find(id)
  -- WoW Forever names have a first and a last name ("Highpriest Cheech"); normalizeName keeps
  -- the first, as everywhere else. Chat markup and control characters are still refused.
  if type(rawName) ~= "string" or #rawName > 80 or rawName:find("[|%c]") then return false end
  local name = ns.normalizeName(rawName)
  if not core or not name or name == "" or not ({ TANK = true, HEALER = true, DPS = true })[role]
    or not ({ main = true, bench = true })[spot] then return false end
  for _, row in ipairs(core.roster) do
    if row.name == name then row.role, row.spot = role, spot; audit("MEMBER_UPDATE", core, name); return true end
  end
  if #core.roster >= 80 then return false end
  core.roster[#core.roster + 1] = { name = name, member = name, role = role, spot = spot, backup = false }
  table.sort(core.roster, function(a, b) return a.name < b.name end)
  audit("MEMBER_ADD", core, name); return true
end
function localGuild.remove(id, rawName, confirmed)
  if not allowed() or not confirmed then return false end
  local core, name = localGuild.find(id), ns.normalizeName(rawName)
  if not core then return false end
  for i, row in ipairs(core.roster) do
    if row.name == name then table.remove(core.roster, i); audit("MEMBER_REMOVE", core, name); return true end
  end
  return false
end
function localGuild.describe()
  local core = ns.loot and ns.loot.core()
  if not (core and core.localOnly) then return L("No raid core selected yet: start with step 1 (or /guilded core <name>).") end
  local mains, bench = 0, 0
  for _, row in ipairs(core.roster) do if row.spot == "bench" then bench = bench + 1 else mains = mains + 1 end end
  local label = ns.loot and ns.loot.label and ns.loot.label(core.mode) or core.mode
  local lines = { string.format(L("Selected core: %s. Loot: %s, %d soft reserve(s) each. Raiders: %d main, %d bench."),
    core.name, label, core.reserves or 1, mains, bench) }
  local roleNames = { DPS = "DPS", TANK = "Tank", HEALER = "Healer" }
  for _, row in ipairs(core.roster) do
    lines[#lines + 1] = "  " .. row.name .. " - " .. L(roleNames[row.role] or row.role) .. " - " .. L(row.spot == "bench" and "Bench" or "Main")
  end
  if #core.roster == 0 then lines[#lines + 1] = L("No raiders yet: add them in step 3.") end
  lines[#lines + 1] = L("All raid cores share the guild's EP/GP; a roster does not create separate points.")
  return table.concat(lines, "\n")
end
ns.commandHandlers.localcore = function(args)
  local action = (args[1] or ""):lower()
  local core = ns.loot and ns.loot.core()
  local ok
  if action == "create" then ok = localGuild.create(table.concat(args, " ", 2))
  elseif action == "rules" then ok = localGuild.configure(core and core.id, (args[2] or ""):upper(), args[3] or "1")
  elseif action == "add" then ok = localGuild.member(core and core.id, args[2], (args[3] or "DPS"):upper(), args[4] or "main")
  elseif action == "remove" then ok = localGuild.remove(core and core.id, args[2], args[3] == "confirm")
  else ns.message(localGuild.describe()); ns.message("/guilded localcore create <name> | rules EPGP|COUNCIL|RESERVE|PRIORITY [1-10] | add <player> TANK|HEALER|DPS main|bench | remove <player> confirm"); return end
  ns.message(L(ok and "Local core saved. Use Save now or log out to write SavedVariables." or "Local core unchanged. Check the selected core, values and officer permissions."))
end
ns.commandHelp[#ns.commandHelp + 1] = { officer = true, text = "/guilded localcore - local cores, loot rules and rosters; no Discord required" }
