-- Backup and restore of this guild's saved data as one copyable string.
--
--   /guilded backup         shows a box with the code (Ctrl+C to copy it somewhere safe)
--   /guilded restore        opens a box: paste a code, press Restore (twice: it shows
--                      what the backup holds first, then replaces your data)
--   /guilded restore undo   puts back what was there before the last restore
--
-- The code is "QGBKP1:<checksum>:<base64>". The payload is our own small
-- format read by a plain parser (never loadstring), so pasting a code can't
-- run anything. It holds the raids, EPGP ledger, roster, attendance, loot
-- and settings for THIS guild; scratch data (diagnostics, journal, peer
-- digests, exports, Discord standings) is left out. A backup from a
-- different guild is refused.
local addonName, ns = ...
ns = ns or {}

local FORMAT = "QGBKP1"
local MAX_DEPTH = 30
local MAX_CHARS = 4000000

-- Fields that are not part of a backup (scratch or per-machine data), and
-- fields that always stay in place.
-- Also left out: data that rebuilds itself (recipes are re-read and re-shared, the calendar
-- and consumable scans are redone, open loot sessions are minutes long), which keeps codes
-- much smaller: a very long code is slow to paste into the game's edit box.
local SKIP = {
  diagnostics = true, peerRoster = true, events = true, exports = true, standings = true, items = true,
  calendarCheck = true, character = true, preRestore = true, recipeBook = true, calendarEvents = true,
  consumeScan = true, lootRules = true, biddingSession = true, councilSession = true
}
-- The copy kept for /guilded restore undo is a whole second set of data in the saved file,
-- so it is dropped after this long (or at once with /guilded restore forget).
local UNDO_KEEP_SECONDS = 7 * 86400
local KEEP = { version = true, guildKey = true, otherGuilds = true }

local module = {}
ns.backup = module

-- ---------------------------------------------------------------------
-- base64 (RFC 4648)
-- ---------------------------------------------------------------------

local b64encode, b64decode = ns.util.base64Encode, ns.util.base64Decode
module.b64encode, module.b64decode = b64encode, b64decode

-- ---------------------------------------------------------------------
-- Serializer / parser for plain data (strings, numbers, booleans, tables)
--   value := "text" | number | true | false | { key:value, ... }
--   key   := "text" | #number
-- ---------------------------------------------------------------------

local function quote(text)
  return '"' .. (string.gsub(text, '[\\"\n\r]', function(c)
    if c == "\n" then return "\\n" elseif c == "\r" then return "\\r" end
    return "\\" .. c
  end)) .. '"'
end

local function number(n)
  if n ~= n or n == math.huge or n == -math.huge then return "0" end
  if n == math.floor(n) and math.abs(n) < 1e15 then return string.format("%.0f", n) end
  return string.format("%.14g", n)
end

local function keyOrder(a, b)
  local ta, tb = type(a), type(b)
  if ta ~= tb then return ta < tb end
  return a < b
end

local function serialize(value, out, depth)
  local kind = type(value)
  if kind == "string" then out[#out + 1] = quote(value)
  elseif kind == "number" then out[#out + 1] = number(value)
  elseif kind == "boolean" then out[#out + 1] = value and "true" or "false"
  elseif kind == "table" then
    if depth > MAX_DEPTH then out[#out + 1] = "{}" return end
    local keys = {}
    for key in pairs(value) do
      local t = type(key)
      if t == "string" or t == "number" then keys[#keys + 1] = key end
    end
    table.sort(keys, keyOrder)
    out[#out + 1] = "{"
    for i, key in ipairs(keys) do
      local item = value[key]
      local itemKind = type(item)
      if itemKind == "string" or itemKind == "number" or itemKind == "boolean" or itemKind == "table" then
        if i > 1 then out[#out + 1] = "," end
        out[#out + 1] = (type(key) == "number") and ("#" .. number(key)) or quote(key)
        out[#out + 1] = ":"
        serialize(item, out, depth + 1)
      end
    end
    out[#out + 1] = "}"
  end
end

local function encode(value)
  local out = {}
  serialize(value, out, 0)
  return table.concat(out)
end
module.encode = encode

-- Reads the format above. Errors are raised as strings; callers use pcall.
local function decode(text)
  local pos, nodes = 1, 0
  local function fail(what) error(what .. " at position " .. pos, 0) end
  local function skip()
    local _, e = string.find(text, "^%s*", pos)
    pos = e + 1
  end
  local function readString()
    pos = pos + 1 -- opening quote
    local parts = {}
    while true do
      local s = string.find(text, '["\\]', pos)
      if not s then fail("unterminated text") end
      parts[#parts + 1] = string.sub(text, pos, s - 1)
      local c = string.sub(text, s, s)
      if c == '"' then pos = s + 1 break end
      local n = string.sub(text, s + 1, s + 1)
      parts[#parts + 1] = (n == "n" and "\n") or (n == "r" and "\r") or n
      pos = s + 2
    end
    return table.concat(parts)
  end
  local readValue
  local function readTable(depth)
    if depth > MAX_DEPTH then fail("too deeply nested") end
    pos = pos + 1 -- {
    local result = {}
    skip()
    if string.sub(text, pos, pos) == "}" then pos = pos + 1 return result end
    while true do
      skip()
      local key
      local c = string.sub(text, pos, pos)
      if c == '"' then key = readString()
      elseif c == "#" then
        local num = string.match(text, "^#(-?[%d%.eE+-]+)", pos)
        if not num then fail("bad key") end
        pos = pos + 1 + #num
        key = tonumber(num)
        if not key then fail("bad key") end
      else fail("expected a key") end
      skip()
      if string.sub(text, pos, pos) ~= ":" then fail("expected :") end
      pos = pos + 1
      result[key] = readValue(depth + 1)
      skip()
      local d = string.sub(text, pos, pos)
      pos = pos + 1
      if d == "}" then return result end
      if d ~= "," then fail("expected , or }") end
    end
  end
  readValue = function(depth)
    nodes = nodes + 1
    if nodes > 500000 then fail("too much data") end
    skip()
    local c = string.sub(text, pos, pos)
    if c == '"' then return readString()
    elseif c == "{" then return readTable(depth)
    elseif string.sub(text, pos, pos + 3) == "true" then pos = pos + 4 return true
    elseif string.sub(text, pos, pos + 4) == "false" then pos = pos + 5 return false end
    local num = string.match(text, "^-?[%d%.eE+-]+", pos)
    if not num then fail("unexpected data") end
    pos = pos + #num
    local value = tonumber(num)
    if not value then fail("bad number") end
    return value
  end
  local value = readValue(0)
  skip()
  if pos <= #text then fail("extra data") end
  return value
end
module.decode = decode

-- ---------------------------------------------------------------------
-- The backup code
-- ---------------------------------------------------------------------

local function checksum(text)
  local h = 5381
  for i = 1, #text do h = (h * 33 + string.byte(text, i)) % 4294967296 end
  -- Hex by hand: string.format("%x") is picky about large numbers on some Lua builds.
  local hex = ""
  for _ = 1, 8 do
    local digit = h % 16
    hex = string.sub("0123456789abcdef", digit + 1, digit + 1) .. hex
    h = math.floor(h / 16)
  end
  return hex
end

local function activeDb()
  return ns.getDb and ns.getDb()
end

function module.build()
  local db = activeDb()
  if not db then return nil, "Saved data is not loaded yet." end
  local data = {}
  for field, value in pairs(db) do
    if not KEEP[field] and not SKIP[field] then data[field] = value end
  end
  local payload = encode({ v = 1, guildKey = db.guildKey or "", at = ns.now and ns.now() or "", by = ns.playerName and ns.playerName() or "", data = data })
  return FORMAT .. ":" .. checksum(payload) .. ":" .. b64encode(payload)
end

-- Reads and checks a code without changing anything.
function module.inspect(code)
  local db = activeDb()
  if type(code) ~= "string" then return nil, "Paste the backup code first." end
  code = string.gsub(code, "%s", "")
  if #code > MAX_CHARS then return nil, "That is too large to be a backup." end
  local sum, body = string.match(code, "^" .. FORMAT .. ":(%x+):(.+)$")
  if not sum then return nil, "That is not a Guilded backup code (it should start with " .. FORMAT .. ":)." end
  local payload = b64decode(body)
  if not payload then return nil, "The backup code is damaged (bad characters). Copy the whole code again." end
  if checksum(payload) ~= sum then return nil, "The backup code is damaged (checksum does not match). Copy the whole code again." end
  local ok, parsed = pcall(decode, payload)
  if not ok or type(parsed) ~= "table" or type(parsed.data) ~= "table" then return nil, "The backup could not be read: " .. tostring(parsed) end
  if db and db.guildKey and parsed.guildKey and parsed.guildKey ~= "" and parsed.guildKey ~= db.guildKey then
    return nil, "This backup is from guild " .. parsed.guildKey .. ", but your saved data belongs to " .. db.guildKey .. ". Nothing was changed."
  end
  local data = parsed.data
  local count = 0
  for _ in pairs(data.raids or {}) do count = count + 1 end
  local ledger = 0
  for _, account in pairs(data.epgp or {}) do
    if type(account) == "table" then for _ in pairs(account.ledger or {}) do ledger = ledger + 1 end end
  end
  local members = 0
  for _ in pairs(data.roster or {}) do members = members + 1 end
  return { parsed = parsed, raids = count, ledger = ledger, members = members }
end

-- Replaces the guild's saved data with the backup. The data that was there
-- is kept once, so /guilded restore undo can put it back.
function module.restore(code)
  local info, err = module.inspect(code)
  if not info then return nil, err end
  local db = activeDb()
  local before = {}
  for field, value in pairs(db) do
    if not KEEP[field] and not SKIP[field] then before[field] = value end
  end
  for field in pairs(before) do db[field] = nil end
  for field, value in pairs(info.parsed.data) do db[field] = value end
  db.preRestore = { at = ns.now and ns.now() or "", data = before }
  if ns.ensureDb then ns.ensureDb() end
  return info
end

function module.undo()
  local db = activeDb()
  local saved = db and db.preRestore
  if not saved or type(saved.data) ~= "table" then return nil, "There is nothing to undo." end
  local current = {}
  for field, value in pairs(db) do
    if not KEEP[field] and not SKIP[field] then current[field] = value end
  end
  for field in pairs(current) do db[field] = nil end
  for field, value in pairs(saved.data) do db[field] = value end
  db.preRestore = nil
  if ns.ensureDb then ns.ensureDb() end
  return true
end

-- ---------------------------------------------------------------------
-- Boxes and commands
-- ---------------------------------------------------------------------

local frame
local previewed

local function ensureFrame()
  if frame then return frame end
  frame = CreateFrame("Frame", "GuildedBackupFrame", UIParent)
  frame:SetSize(600, 190)
  frame:SetPoint("CENTER")
  frame:SetFrameStrata("DIALOG")
  frame:EnableMouse(true)
  local background = frame:CreateTexture(nil, "BACKGROUND")
  background:SetAllPoints()
  background:SetColorTexture(0, 0, 0, 0.9)
  frame.title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  frame.title:SetPoint("TOP", 0, -10)
  local box = CreateFrame("EditBox", nil, frame)
  box:SetMultiLine(false)
  box:SetMaxLetters(0)
  box:SetSize(570, 26)
  box:SetPoint("CENTER", 0, 5)
  box:SetAutoFocus(true)
  box:SetFontObject(ChatFontNormal or GameFontNormal)
  box:SetScript("OnEscapePressed", function() frame:Hide() end)
  frame.box = box
  local close = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
  close:SetSize(90, 22)
  close:SetPoint("BOTTOMRIGHT", -12, 10)
  close:SetText("Close")
  close:SetScript("OnClick", function() frame:Hide() end)
  local restore = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
  restore:SetSize(120, 22)
  restore:SetPoint("BOTTOMLEFT", 12, 10)
  restore:SetText("Restore")
  restore:SetScript("OnClick", function()
    local code = frame.box:GetText() or ""
    local info, err = module.inspect(code)
    if not info then ns.message(err) return end
    if previewed ~= #code then
      previewed = #code
      ns.message(string.format("Backup from %s by %s: %d raid(s), %d ledger entries, %d known members. Press Restore again to replace your saved data (undo: /guilded restore undo).",
        info.parsed.at ~= "" and info.parsed.at or "?", info.parsed.by ~= "" and info.parsed.by or "?", info.raids, info.ledger, info.members))
      return
    end
    previewed = nil
    local done, problem = module.restore(code)
    if done then
      ns.message("Backup restored. /reload now so everything uses it. The old data is kept for 7 days for /guilded restore undo (/guilded restore forget removes it now).")
      frame:Hide()
    else
      ns.message(problem)
    end
  end)
  frame.restore = restore
  return frame
end

local function openBox(title, text, showRestore)
  local f = ensureFrame()
  f.title:SetText(title)
  f.box:SetText(text or "")
  if showRestore then f.restore:Show() else f.restore:Hide() end
  previewed = nil
  f:Show()
  f.box:SetFocus()
  if text and text ~= "" then f.box:HighlightText() end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["backup"] = function()
  if ns.moduleActive and not ns.moduleActive("backup") then return end
  local code, err = module.build()
  if not code then ns.message(err) return end
  ns.message(string.format("Backup code: %d characters. Copy it from the box (Ctrl+C) and keep it somewhere safe.%s", #code,
    #code > 200000 and " It is large; paste it into a text file, not a chat window." or ""))
  ns.lastBackupCode = code
  openBox("Guilded backup - copy this (Ctrl+C)", code, false)
end
-- Drops the undo copy once it is older than UNDO_KEEP_SECONDS. Returns true if it did.
function module.expireUndo()
  local db = activeDb()
  local saved = db and db.preRestore
  if type(saved) ~= "table" then return false end
  local at = ns.util.isoEpoch(saved.at)
  if at and ns.util.serverTime() - at < UNDO_KEEP_SECONDS then return false end
  db.preRestore = nil
  return true
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
  local ok, err = pcall(module.expireUndo)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "backup: " .. tostring(err)) end
end)

ns.commandHandlers["restore"] = function(args)
  if ns.moduleActive and not ns.moduleActive("backup") then return end
  if string.lower(args[1] or "") == "forget" then
    local db = activeDb()
    if db and db.preRestore then
      db.preRestore = nil
      ns.message("The copy kept for /guilded restore undo was removed.")
    else
      ns.message("There is no undo copy to remove.")
    end
    return
  end
  if string.lower(args[1] or "") == "undo" then
    local ok, err = module.undo()
    ns.message(ok and "Put back what was there before the last restore. /reload now." or err)
    return
  end
  openBox("Guilded restore - paste your backup code, then press Restore", "", true)
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded backup | restore [undo|forget] - copy this guild's saved data as one code / put it back")
