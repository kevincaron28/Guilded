-- Imports from other loot tools, for guilds moving to Guilded or using both:
--
--   /guilded import softres   paste a softres.it export: it becomes Guilded's soft-reserve list
--                             (you become its keeper; shared with the guild like any list)
--   /guilded import tmb       paste That's My BiS priorities: item tooltips show them
--   /guilded import tmb clear forget the That's My BiS priorities
--   /guilded tmb <item link>  who has the item on their list, in order
--
-- Accepted: softres.it's CSV export (header with ItemId, Name; Class, Note, Plus are read when
-- present) and its "Gargul export" string; a priority CSV of "itemID,player1,player2,..." lines
-- (That's My BiS, DFT-style sheets; an optional "Group:" prefix is ignored); and That's My BiS's
-- compressed Gargul download. The compressed formats need a game client that can unpack them
-- (C_EncodingUtil); elsewhere paste the CSV. Text is only read, never run.
local addonName, ns = ...
ns = ns or {}

local MAX_LINES = 5000
local MAX_PER_ITEM = 40

local imports = {}
ns.lootImports = imports

local function L(text) return ns.L and ns.L(text) or text end
local function trim(text) return (string.gsub(text or "", "^%s*(.-)%s*$", "%1")) end
-- Names travel in the shared lists' "name=ids;..." messages, so their separators are dropped.
local function player(name)
  name = trim(string.gsub(name or "", "[|;=,:%c]", ""))
  if name == "" then return nil end
  return ns.normalizeName and ns.normalizeName(name) or name
end

-- One CSV line into fields; quoted fields may hold commas and doubled quotes.
function imports.splitCsv(line)
  local fields, field, quoted, i = {}, "", false, 1
  while i <= #line do
    local c = string.sub(line, i, i)
    if quoted then
      if c == '"' and string.sub(line, i + 1, i + 1) == '"' then field = field .. '"'; i = i + 1
      elseif c == '"' then quoted = false
      else field = field .. c end
    elseif c == '"' then quoted = true
    elseif c == "," then table.insert(fields, field); field = ""
    else field = field .. c end
    i = i + 1
  end
  table.insert(fields, field)
  return fields
end

local function lines(text)
  local out = {}
  for line in string.gmatch((string.gsub(text or "", "\r", "")), "[^\n]+") do
    if trim(line) ~= "" then table.insert(out, line) end
    if #out >= MAX_LINES then break end
  end
  return out
end

-- The game's own unpacking (base64 -> zlib -> JSON); nil where the client cannot.
function imports.unpack(text)
  local E = C_EncodingUtil
  if not (E and E.DecodeBase64 and E.DecompressString and E.DeserializeJSON) then return nil, "unsupported" end
  local ok, raw = pcall(E.DecodeBase64, trim(text))
  if not ok or not raw then return nil, "base64" end
  local method = Enum and Enum.CompressionMethod and Enum.CompressionMethod.Zlib
  local unpacked
  ok, unpacked = pcall(E.DecompressString, raw, method)
  if not ok or type(unpacked) ~= "string" then return nil, "zlib" end
  local data
  ok, data = pcall(E.DeserializeJSON, unpacked)
  if not ok or type(data) ~= "table" then return nil, "json" end
  return data
end

local function looksPacked(text)
  local t = trim(text)
  return #t > 20 and not string.find(t, "[,\n]") and string.find(t, "^[%w%+/=]+$") ~= nil
end

-- softres.it -> { [player] = { itemIds } }, item names, count of rows read.
function imports.parseSoftRes(text)
  local map, rows = {}, 0
  local function add(name, id)
    name, id = player(name), tonumber(id)
    if not (name and id and id > 0) then return end
    map[name] = map[name] or {}
    table.insert(map[name], id)
    rows = rows + 1
  end
  if looksPacked(text) then
    local data, problem = imports.unpack(text)
    if not data then return nil, problem end
    for _, entry in pairs(type(data.softreserves) == "table" and data.softreserves or {}) do
      for _, item in pairs(type(entry.items) == "table" and entry.items or {}) do add(entry.name, type(item) == "table" and item.id or item) end
    end
    return map, rows
  end
  local all = lines(text)
  if #all < 2 then return nil, "empty" end
  local columns = {}
  for index, name in ipairs(imports.splitCsv(all[1])) do columns[string.lower(trim(name))] = index end
  if not (columns.itemid and columns.name) then return nil, "header" end
  for i = 2, #all do
    local fields = imports.splitCsv(all[i])
    add(fields[columns.name], fields[columns.itemid])
  end
  return map, rows
end

-- Priorities -> { [itemId] = { players in order } }.
function imports.parseTmb(text)
  local items, count = {}, 0
  local function put(id, list)
    id = tonumber(id)
    if not (id and id > 0 and #list > 0) then return end
    items[id] = list
    count = count + 1
  end
  if looksPacked(text) then
    local data, problem = imports.unpack(text)
    if not data then return nil, problem end
    -- wishlists[itemId] = { "name|order|...", ... }: the name first, the order the first number after it.
    for id, entries in pairs(type(data.wishlists) == "table" and data.wishlists or {}) do
      local ranked = {}
      for _, entry in pairs(type(entries) == "table" and entries or {}) do
        local parts = {}
        for part in string.gmatch(tostring(entry) .. "|", "([^|]*)|") do table.insert(parts, part) end
        local name = player(parts[1])
        local order = tonumber(parts[2]) or tonumber(parts[3]) or 99
        if name then table.insert(ranked, { name = name, order = order }) end
      end
      table.sort(ranked, function(a, b) if a.order == b.order then return a.name < b.name end return a.order < b.order end)
      local list = {}
      for i = 1, math.min(MAX_PER_ITEM, #ranked) do table.insert(list, ranked[i].name) end
      put(id, list)
    end
    return items, count
  end
  for _, line in ipairs(lines(text)) do
    line = string.gsub(line, "^[^,:]+:", "") -- "Group:" prefix
    local fields = imports.splitCsv(line)
    local list = {}
    for i = 2, math.min(#fields, MAX_PER_ITEM + 1) do
      local name = player(fields[i])
      if name then table.insert(list, name) end
    end
    put(fields[1], list)
  end
  return items, count
end

local PROBLEMS = {
  unsupported = "This game client cannot unpack that export. Paste the CSV export instead.",
  base64 = "That text is not a complete export. Copy it again, all of it.",
  zlib = "That export could not be unpacked. Copy it again, all of it.",
  json = "That export could not be read. Copy it again, all of it.",
  empty = "Nothing to import: paste the export first.",
  header = "The first line must be the CSV header (with ItemId and Name)."
}
local function problemText(code) return L(PROBLEMS[code] or "Could not read that text.") end

-- ---------------------------------------------------------------------
-- That's My BiS priorities: stored per guild, shown on tooltips.
-- ---------------------------------------------------------------------

local function tmbState()
  local db = ns.getDb and ns.getDb()
  return db
end

function imports.importTmb(text)
  local items, count = imports.parseTmb(text)
  if not items then return false, problemText(count) end
  if count == 0 then return false, L("No item priorities found in that text.") end
  local db = tmbState()
  if not db then return false, L("Could not read that text.") end
  db.tmb = { at = ns.now and ns.now() or "", by = ns.playerName and ns.playerName() or "", items = items }
  return true, string.format(L("Imported That's My BiS priorities for %d item(s). Item tooltips show them."), count)
end

function imports.tmbList(id)
  local db = tmbState()
  return db and db.tmb and db.tmb.items and db.tmb.items[tonumber(id) or -1] or nil
end

function imports.tooltipLines(id)
  if ns.moduleActive and not ns.moduleActive("imports") then return {} end
  local list = imports.tmbList(id)
  if not list or #list == 0 then return {} end
  local parts = {}
  for i = 1, math.min(5, #list) do table.insert(parts, i .. ". " .. list[i]) end
  return { L("That's My BiS") .. ": " .. table.concat(parts, ", ") .. (#list > 5 and (" +" .. (#list - 5)) or "") }
end

function imports.importSoftRes(text)
  local map, rows = imports.parseSoftRes(text)
  if not map then return false, problemText(rows) end
  if not (ns.reserve and ns.reserve.importEntries) then return false, L("Soft reserves are switched off.") end
  local players, items = ns.reserve.importEntries(map, L("softres.it import"))
  if not players then return false, items end
  return true, string.format(L("Imported %d reserve(s) for %d player(s). The list is open and shared with the guild; lock it when the raid starts."), items, players)
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["import"] = function(args)
  if ns.moduleActive and not ns.moduleActive("imports") then return end
  local what = string.lower(args[1] or "")
  if not (ns.isOfficer and ns.isOfficer()) then ns.message(L("Only officers can do that.")) return end
  if what == "softres" then
    if ns.moduleActive and not ns.moduleActive("reserve") then ns.message(L("Soft reserves are switched off.")) return end
    ns.showPasteBox(L("Import softres.it"), L("On softres.it, open the raid and copy the CSV export (or the Gargul export) and paste it here. It replaces the current soft-reserve list."), imports.importSoftRes)
  elseif what == "tmb" and string.lower(args[2] or "") == "clear" then
    local db = tmbState()
    if db then db.tmb = nil end
    ns.message(L("That's My BiS priorities cleared."))
  elseif what == "tmb" then
    ns.showPasteBox(L("Import That's My BiS"), L("Paste the That's My BiS export for Gargul, or lines of itemID,player1,player2 in priority order."), imports.importTmb)
  else
    ns.message("/guilded import softres | tmb | tmb clear")
  end
end
ns.commandHandlers["tmb"] = function(args)
  if ns.moduleActive and not ns.moduleActive("imports") then return end
  local id = ns.reserve and ns.reserve.itemId and ns.reserve.itemId(table.concat(args, " "))
  local list = id and imports.tmbList(id)
  ns.message(list and (L("That's My BiS") .. ": " .. table.concat(list, ", ")) or L("No That's My BiS priority for that item. /guilded tmb <item link>"))
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded import softres | tmb - import a softres.it list or That's My BiS priorities" })
table.insert(ns.commandHelp, "/guilded tmb <item link> - That's My BiS priority for an item")
