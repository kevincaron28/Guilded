-- Local source history only: never touches GuildedDB.loot, scoring, sync or ownership.
local addonName, ns = ...
ns = ns or {}
local module, pending = {}, nil
ns.lootHistoryImport = module
local function L(s) return ns.L and ns.L(s) or s end
local function safe(s) return tostring(s or ""):gsub("|", "||"):gsub("[\r\n\t]", " ") end
local function valid(s, limit) return type(s) == "string" and #s <= limit and not s:find("[%z\1-\8\11\12\14-\31\127]") end
local function identity(s, limit) return valid(s, limit) and s ~= "" and not s:find("[|\r\n\t]") end
local function hash(s) return valid(s, 64) and #s == 64 and s:match("^[a-f0-9]+$") end
local function sum(bytes)
  local h = 0; for i = 1, #bytes do h = (h * 31 + bytes:byte(i)) % 16777213 end
  return string.format("%06x", h)
end
local function scope(a)
  if not ns.rosterTools or not ns.rosterTools.authorized() then return false end
  local key, guild, realm, edition = ns.rosterTools.context()
  return key and a.guild == guild and a.edition == edition and a.realm:gsub("[%s%-]", ""):lower() == realm:gsub("[%s%-]", ""):lower()
end
local fields = { "sourceCharacter", "character", "itemId", "itemString", "at", "precision", "timezone", "response", "offspec", "instance", "boss" }
local function packed(parts)
  local out = {}; for _, part in ipairs(parts) do part = tostring(part); out[#out + 1] = #part .. ":" .. part end
  return table.concat(out)
end
local function fingerprint(row)
  local parts = {}; for _, key in ipairs(fields) do parts[#parts + 1] = tostring(row[key]) end
  return packed(parts)
end
local function keyFor(a, row)
  if row.sourceId ~= "" then return packed({ a.source, "id", row.sourceCharacter, row.sourceId }) end
  return packed({ a.source, "row", a.sourceHash, row.row })
end
local function validDate(row)
  local y, m, d = row.at:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)")
  y, m, d = tonumber(y), tonumber(m), tonumber(d)
  if not y or y < 2004 or y > 2100 or not m or m < 1 or m > 12 or not d then return false end
  local days = {31, (y % 4 == 0 and (y % 100 ~= 0 or y % 400 == 0)) and 29 or 28,31,30,31,30,31,31,30,31,30,31}
  if d < 1 or d > days[m] then return false end
  if row.precision == "day" then return #row.at == 10 and row.timezone == "unknown" end
  local h, min = row.at:match("^%d%d%d%d%-%d%d%-%d%dT(%d%d):(%d%d)")
  if not h or tonumber(h) > 23 or tonumber(min) > 59 then return false end
  if row.precision == "minute" then return #row.at == 16 and row.timezone == "unknown" end
  local sec = row.at:match("T%d%d:%d%d:(%d%d)")
  if row.precision ~= "second" or not sec or tonumber(sec) > 59 then return false end
  return (row.timezone == "unknown" and #row.at == 19) or (row.timezone == "UTC" and #row.at == 24 and row.at:sub(20) == ".000Z")
end
local function validate(a)
  if type(a) ~= "table" or a.format ~= 1 or not identity(a.guild, 120) or not identity(a.realm, 120)
    or not identity(a.edition, 40) or not hash(a.sourceHash) or (a.source ~= "rclootcouncil" and a.source ~= "gargul")
    or type(a.allowUnidentified) ~= "boolean" or type(a.entries) ~= "table" then return false end
  local count = 0
  for k in pairs(a.entries) do
    if type(k) ~= "number" or k ~= math.floor(k) or k < 1 or k > 5000 then return false end
    count = count + 1
  end
  if count == 0 or count ~= #a.entries then return false end
  local allowed = { row = true, sourceId = true }; for _, f in ipairs(fields) do allowed[f] = true end
  local rowNumbers = {}
  for _, row in ipairs(a.entries) do
    if type(row) ~= "table" then return false end
    for k in pairs(row) do if not allowed[k] then return false end end
    if not identity(row.sourceCharacter, 160) or not identity(row.character, 160) or not row.character:match("^[^%s%-]+%-.+$")
      or not valid(row.sourceId, 160) or (row.sourceId == "" and not a.allowUnidentified)
      or type(row.row) ~= "number" or row.row ~= math.floor(row.row) or row.row < 1 or row.row > 5001 or rowNumbers[row.row]
      or type(row.itemId) ~= "number" or row.itemId ~= math.floor(row.itemId) or row.itemId < 1 or row.itemId > 2147483647 then return false end
    rowNumbers[row.row] = true
    for _, f in ipairs({ "itemString", "response", "instance", "boss" }) do if not valid(row[f], 4096) then return false end end
    if not valid(row.at, 24) or not valid(row.precision, 6) or not valid(row.timezone, 7) or not validDate(row) then return false end
    if row.offspec ~= true and row.offspec ~= false and row.offspec ~= "unknown" then return false end
  end
  return true
end
local function plan(a, history)
  local existing, added, duplicate, uncertain = {}, {}, 0, 0
  for _, row in ipairs(history.rows) do
    existing[row.key] = fingerprint(row)
  end
  for _, row in ipairs(a.entries) do
    local key, fact = keyFor(a, row), fingerprint(row)
    if existing[key] then
      if existing[key] ~= fact then return nil, L("A source award conflicts with stored history. Nothing was changed.") end
      duplicate = duplicate + 1
    else
      if row.sourceId == "" then uncertain = uncertain + 1 end
      existing[key] = fact
      local copy = { key = key, source = a.source, sourceHash = a.sourceHash, sourceId = row.sourceId, sourceRow = row.row }
      for _, f in ipairs(fields) do copy[f] = row[f] end
      added[#added + 1] = copy
    end
  end
  if #history.rows + #added > 10000 then return nil, L("History is full (10,000 awards). Back up SavedVariables before managing this archive.") end
  local rows = {}; for _, row in ipairs(history.rows) do rows[#rows + 1] = row end
  for _, row in ipairs(added) do rows[#rows + 1] = row end
  if #ns.backup.encode(rows) > 2000000 then return nil, L("History exceeds the 2 MB storage limit. Nothing was changed.") end
  return { rows = rows, added = added, duplicate = duplicate, uncertain = uncertain }
end
function module.preview(code)
  pending = nil
  if type(code) ~= "string" or #code > 400000 or not ns.backup or not ns.util then return nil, L("Use a GLH1 loot archive from the companion.") end
  local checksum, encoded = code:match("^%s*GLH1:([a-f0-9]+):([A-Za-z0-9+/=]+)%s*$")
  if not checksum then return nil, L("Use a GLH1 loot archive from the companion.") end
  local ok, bytes = pcall(ns.util.base64Decode, encoded)
  if not ok or type(bytes) ~= "string" or #bytes > 290000 or sum(bytes) ~= checksum then return nil, L("Loot archive checksum mismatch.") end
  local parsed, a = pcall(ns.backup.decode, bytes)
  if not parsed or not validate(a) then return nil, L("Unsupported loot archive structure.") end
  if not scope(a) then return nil, L("Current officer access and matching guild, realm and edition are required.") end
  local store = ns.rosterTools.store(); if not store then return nil, L("Local audit storage is unavailable.") end
  local history = store.lootHistory or { revision = 0, rows = {} }
  local result, err = plan(a, history); if not result then return nil, err end
  pending = { archive = a, revision = history.revision, result = result }
  return result
end
function module.summary()
  if not pending or not scope(pending.archive) then return L("Preview a matching loot archive first.") end
  local a, result = pending.archive, pending.result
  local lines = { L("Loot history preview - no awards or points changed"), safe(a.guild .. " / " .. a.realm .. " / " .. a.edition),
    safe(a.source), string.format(L("New: %d; already stored: %d; without stable IDs: %d."), #result.added, result.duplicate, result.uncertain),
    L("Dates without a timezone remain source-local. Awards without stable IDs can overlap other exports."),
    L("Review the mappings below, then use /guilded import history confirm and type IMPORT."),
    L("Cancel with /guilded import history cancel. Undo the last import with /guilded import history undo.") }
  for _, row in ipairs(a.entries) do lines[#lines + 1] = safe(row.sourceCharacter .. " -> " .. row.character .. " | " .. row.at .. " (" .. row.timezone .. ") | item " .. row.itemId .. " | " .. row.response) end
  return table.concat(lines, "\n")
end
function module.confirm(word)
  if word ~= "IMPORT" or not pending then return false, L("Preview and type IMPORT to confirm.") end
  local a = pending.archive
  if not validate(a) or not scope(a) then pending = nil; return false, L("Current officer access and matching guild, realm and edition are required.") end
  local store = ns.rosterTools.store(); if not store then return false, L("Local audit storage is unavailable.") end
  local history = store.lootHistory or { revision = 0, rows = {} }
  if history.revision ~= pending.revision then pending = nil; return false, L("History changed. Preview the archive again.") end
  local result, err = plan(a, history); if not result then pending = nil; return false, err end
  if #result.added == 0 then pending = nil; return true, L("All awards are already stored. Nothing was changed.") end
  local keys = {}
  for _, row in ipairs(result.added) do
    row.importedAt = ns.now and ns.now() or tostring(time()); row.importedBy = ns.playerName and ns.playerName() or ""
    keys[row.key] = true
  end
  if #ns.backup.encode(result.rows) > 2000000 then pending = nil; return false, L("History exceeds the 2 MB storage limit. Nothing was changed.") end
  -- One final assignment; no partial mutation if validation/capacity checks fail.
  store.lootHistory = { revision = history.revision + 1, rows = result.rows, undoKeys = keys }
  pending = nil
  return true, string.format(L("Stored %d historical awards locally. No points or live awards changed."), #result.added)
end
function module.cancel() pending = nil end
function module.undo(word)
  if word ~= "UNDO IMPORT" or not ns.rosterTools or not ns.rosterTools.authorized() then return false, L("Type UNDO IMPORT to remove the last imported batch.") end
  local store = ns.rosterTools.store(); local history = store and store.lootHistory
  if not history or not history.undoKeys then return false, L("No imported batch is available to undo.") end
  local rows = {}; for _, row in ipairs(history.rows) do if not history.undoKeys[row.key] then rows[#rows + 1] = row end end
  store.lootHistory = { revision = history.revision + 1, rows = rows }; pending = nil
  return true, L("Last imported batch removed. Earlier history is unchanged.")
end
function module.history(query)
  if not ns.rosterTools or not ns.rosterTools.authorized() then return L("Only officers can do that.") end
  local store = ns.rosterTools.store(); local history = store and store.lootHistory
  if not history or #history.rows == 0 then return L("No imported loot history in this guild.") end
  query = type(query) == "string" and query:lower() or ""
  local lines, shown = { L("Imported loot history - source records, not Guilded points") }, 0
  for i = #history.rows, 1, -1 do
    local row = history.rows[i]
    if query == "" or (row.character .. " " .. row.sourceCharacter .. " " .. row.itemId .. " " .. row.response .. " " .. row.boss):lower():find(query, 1, true) then
      shown = shown + 1
      if shown <= 200 then lines[#lines + 1] = safe(row.character .. " | item " .. row.itemId .. " | " .. row.at .. " (" .. row.timezone .. ") | " .. row.source .. " | " .. row.response .. " | " .. row.boss) end
    end
  end
  if shown > 200 then lines[#lines + 1] = L("Showing the first 200 matches. Narrow the search.") end
  if shown == 0 then lines[#lines + 1] = L("Nothing recorded yet.") end
  return table.concat(lines, "\n")
end
function module.command(args)
  local action = string.lower(args[2] or "")
  if action == "cancel" then module.cancel(); ns.message(L("Loot history preview cancelled."))
  elseif action == "show" then ns.showCopyText(module.history(table.concat(args, " ", 3)), L("Imported loot history"))
  elseif action == "confirm" or action == "undo" then
    local undo = action == "undo"
    ns.showPasteBox(L("Confirm loot history change"), undo and L("Type UNDO IMPORT to remove the last imported batch.") or L("Review the preview first. Type IMPORT to store these source records locally."), undo and module.undo or module.confirm)
  else
    module.cancel()
    ns.showPasteBox(L("Preview loot history"), L("Paste the GLH1 archive saved by the companion. This step only previews it."), function(code)
      local result, err = module.preview(code); if not result then return false, err end
      ns.showCopyText(module.summary(), L("Loot history preview"))
      return true, L("Preview ready. Use /guilded import history confirm to continue.")
    end, { buttonText = L("Preview") })
  end
end
