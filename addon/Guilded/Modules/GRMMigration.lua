-- GRM archive import is local plain data, separate from account uploads/ledger
-- identity. Source notes, ranks and history are not replayed as guild actions.
local addonName, ns = ...
ns = ns or {}
local migration = {}
ns.grmMigration = migration
local function L(s) return ns.L and ns.L(s) or s end
local function count(t) local n = 0; for _ in pairs(t or {}) do n = n + 1 end; return n end
local function validString(s, limit)
  return type(s) == "string" and #s <= limit and not s:find("[%z\1-\8\11\12\14-\31]")
end
local function checksum(bytes)
  local h = 0; for i = 1, #bytes do h = (h * 31 + bytes:byte(i)) % 16777213 end
  return string.format("%06x", h)
end
local function currentScope(archive)
  if type(archive) ~= "table" or type(archive.realm) ~= "string" then return false end
  if not ns.rosterTools or not ns.rosterTools.authorized() then return false end
  local scope, guild, realm, edition = ns.rosterTools.context()
  if not scope or archive.guild ~= guild or archive.edition ~= edition or archive.realm:gsub("[%s%-]", ""):lower() ~= realm:gsub("[%s%-]", ""):lower() then return false end
  if archive.private and not ns.rosterTools.canViewPrivate() then return false end
  return true
end
local function validate(archive)
  if type(archive) ~= "table" or archive.format ~= 1 or type(archive.private) ~= "boolean" then return false end
  for _, key in ipairs({ "guild", "realm", "edition", "sourceGuild", "sourceHash", "importedAt" }) do
    if not validString(archive[key], 200) or archive[key] == "" then return false end
  end
  if not archive.sourceHash:match("^[a-f0-9]+$") or #archive.sourceHash ~= 64 then return false end
  local nodes = 0
  local function walk(value, depth)
    nodes = nodes + 1; if nodes > 150000 or depth > 18 then return false end
    if type(value) == "string" then return validString(value, 16000) end
    if type(value) == "boolean" then return true end
    if type(value) == "number" then return value == value and math.abs(value) < 1e15 end
    if type(value) ~= "table" then return false end
    for key, child in pairs(value) do
      if not archive.private and (key == "officerNote" or key == "customNote") then return false end
      if (type(key) ~= "number" and not validString(key, 200)) or not walk(child, depth + 1) then return false end
    end
    return true
  end
  for _, key in ipairs({ "members", "former", "groups", "logs" }) do
    if type(archive[key]) ~= "table" or count(archive[key]) > (key == "logs" and 10000 or 2000) then return false end
  end
  if count(archive.members) == 0 or not walk(archive, 0) then return false end
  -- Private source fields and logs require the explicit private-history option.
  if not archive.private then
    if next(archive.logs) then return false end
    for _, list in ipairs({ archive.members, archive.former }) do
      for _, row in pairs(list) do if type(row) ~= "table" or row.officerNote or row.customNote then return false end end
    end
  end
  for _, list in ipairs({ archive.members, archive.former }) do
    for key, row in pairs(list) do
      if type(row) ~= "table" or not validString(row.name, 160) or row.name ~= key then return false end
    end
  end
  return true
end
function migration.preview(code)
  migration.pending = nil
  if type(code) ~= "string" or #code > 2700000 or not ns.backup then return nil, "Invalid or oversized GRM archive." end
  local sum, encoded = code:match("^%s*GGRM1:([a-f0-9]+):([A-Za-z0-9+/=]+)%s*$")
  if not sum then return nil, "Use a GGRM1 archive produced by the offline converter." end
  local ok, bytes = pcall(ns.util.base64Decode, encoded)
  if not ok or type(bytes) ~= "string" or #bytes > 2000000 or checksum(bytes) ~= sum then return nil, "GRM archive checksum mismatch." end
  local parsed, archive = pcall(ns.backup.decode, bytes)
  if not parsed or not validate(archive) then return nil, "Unsupported GRM archive structure." end
  if not currentScope(archive) then return nil, "Archive guild, edition or private-note permission does not match." end
  local store = ns.rosterTools.store(); if not store then return nil, "Local audit storage is unavailable." end
  if store.grm and store.grm.sourceHash == archive.sourceHash and store.grm.private == archive.private then return nil, "This source archive is already imported." end
  migration.pending = archive
  return archive
end
function migration.summary(archive)
  archive = archive or migration.pending
  if not archive or not currentScope(archive) then return L("Preview a matching GRM archive first.") end
  return table.concat({ L("GRM archive preview - no guild changes"), archive.guild .. " / " .. archive.realm .. " / " .. archive.edition,
    L("Current members") .. ": " .. count(archive.members), L("Former members") .. ": " .. count(archive.former),
    L("History entries") .. ": " .. count(archive.logs), L("Alt groups") .. ": " .. count(archive.groups),
    L("Private history") .. ": " .. L(archive.private and "On" or "Off"),
    L("Omitted source fields/logs") .. ": " .. tostring(archive.omittedFields or 0) .. " / " .. tostring(archive.omittedLogs or 0),
    L("Keeps source history locally. Does not alter guild notes, ranks, points or Discord links.") }, "\n")
end
function migration.import(confirmation)
  local archive = migration.pending
  if confirmation ~= "IMPORT" or not archive or not currentScope(archive) then return false, "Preview and type IMPORT to confirm." end
  local store = ns.rosterTools.store(); if not store then return false, "Local audit storage is unavailable." end
  if store.grm and store.grm.sourceHash == archive.sourceHash and store.grm.private == archive.private then return false, "This source archive is already imported." end
  store.grmPrevious = store.grm; store.grm = archive
  store.migrations = store.migrations or {}
  store.migrations[#store.migrations + 1] = { action = "import", sourceHash = archive.sourceHash, private = archive.private, at = time(), members = count(archive.members), former = count(archive.former) }
  while #store.migrations > 20 do table.remove(store.migrations, 1) end
  migration.pending = nil
  return true
end
function migration.undo(confirmation)
  local store = ns.rosterTools and ns.rosterTools.store()
  if confirmation ~= "UNDO IMPORT" or not store or not store.grm or not currentScope(store.grm) or (store.grmPrevious and not currentScope(store.grmPrevious)) then return false end
  store.migrations = store.migrations or {}
  store.migrations[#store.migrations + 1] = { action = "undo", sourceHash = store.grm.sourceHash, at = time() }
  while #store.migrations > 20 do table.remove(store.migrations, 1) end
  store.grm, store.grmPrevious = store.grmPrevious, nil
  migration.pending = nil; return true
end
-- Render source facts as text, never replay log templates or evaluate source Lua.
local function flatten(value, lines, path, depth)
  if #lines >= 500 then return end
  if type(value) ~= "table" then lines[#lines + 1] = path .. ": " .. tostring(value):gsub("|", "||"); return end
  if depth > 8 then lines[#lines + 1] = path .. ": [...]"; return end
  local keys = {}; for key in pairs(value) do keys[#keys + 1] = key end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  for _, key in ipairs(keys) do flatten(value[key], lines, path .. "/" .. tostring(key):gsub("|", "||"), depth + 1) end
end
function migration.history(query)
  local store = ns.rosterTools and ns.rosterTools.store()
  local archive = store and store.grm
  if not archive or not currentScope(archive) then return L("No accessible GRM archive in this guild.") end
  if type(query) ~= "string" or #query < 2 or #query > 160 then return L("Enter at least two characters to search archived names or history.") end
  local needle, lines = query:lower(), { L("Imported GRM source history; not Guilded attendance or ownership.") }
  for _, kind in ipairs({ "members", "former" }) do
    for name, record in pairs(archive[kind]) do if name:lower():find(needle, 1, true) then flatten(record, lines, kind .. "/" .. name, 0) end end
  end
  for index, entry in pairs(archive.logs) do
    if type(entry) == "table" and type(entry[2]) == "string" and entry[2]:lower():find(needle, 1, true) then flatten(entry, lines, "log/" .. tostring(index), 0) end
  end
  for index, group in pairs(archive.groups) do
    local flat = {}; flatten(group, flat, "group/" .. tostring(index), 0)
    if table.concat(flat, "\n"):lower():find(needle, 1, true) then
      for _, line in ipairs(flat) do if #lines < 500 then lines[#lines + 1] = line end end
    end
  end
  if #lines >= 500 then lines[#lines + 1] = L("Showing the first 500 lines. Narrow the search.") end
  return table.concat(lines, "\n")
end
function migration.export()
  local store = ns.rosterTools and ns.rosterTools.store()
  local archive = store and store.grm
  if not archive or not currentScope(archive) then return nil end
  local bytes = ns.backup.encode(archive)
  return "GGRM1:" .. checksum(bytes) .. ":" .. ns.util.base64Encode(bytes)
end
