-- Shared helpers (ns.util) and the paced addon-message queue (ns.comm), used by Core and
-- every module. Loaded first (see Guilded.toc); whatever it needs from Core (names,
-- diagnostics) is looked up when called, so it works before Core has run.
local addonName, ns = ...
ns = ns or {}

local MAX_ADDON_MESSAGE = 255

local function isSecret(value)
  return issecretvalue ~= nil and issecretvalue(value) == true
end

local function normalizeName(name)
  if ns.normalizeName then return ns.normalizeName(name) end
  if type(name) ~= "string" or isSecret(name) then return nil end
  return string.match(name, "^([^%-%s]+)") or name
end

local function playerName()
  if ns.playerName then return ns.playerName() end
  return UnitName and UnitName("player") or "Unknown"
end

local function diag(kind, detail)
  if ns.logDiagnostic then pcall(ns.logDiagnostic, kind, detail) end
end

-- ---------------------------------------------------------------------
-- Small helpers every module shares (ns.util), so each rule lives once.
-- ---------------------------------------------------------------------
local util = ns.util or {}
ns.util = util

-- Same spelling rule as the bot's item keys: lower case, separators and control characters
-- become spaces, runs of spaces collapse.
function util.itemKey(name)
  if type(name) ~= "string" then return nil end
  local key = string.lower(name)
  key = string.gsub(key, "[|;~:,%c]", " ")
  key = string.gsub(key, "%s+", " ")
  key = string.gsub(key, "^ ", "")
  key = string.gsub(key, " $", "")
  if key == "" then return nil end
  return key
end

-- Days since 1970-01-01 of a civil date (no time zone in it).
function util.daysFromCivil(y, m, d)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local mp = (m + 9) % 12
  local doy = math.floor((153 * mp + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
end

-- "2026-10-01T23:00:00Z" (fractions allowed) -> seconds since 1970 (UTC), or nil.
function util.isoEpoch(text)
  local y, m, d, hh, mm, ss = string.match(tostring(text or ""), "^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
  if not y then return nil end
  return util.daysFromCivil(tonumber(y), tonumber(m), tonumber(d)) * 86400 + tonumber(hh) * 3600 + tonumber(mm) * 60 + tonumber(ss)
end

function util.serverTime()
  if GetServerTime then
    local ok, value = pcall(GetServerTime)
    if ok and type(value) == "number" and not isSecret(value) then return value end
  end
  return time()
end

-- Shared data (standings, module switches, ...) is replaced by a "newer" copy. A clock
-- far in the future would pin one copy for good, so anything more than 10 minutes ahead
-- of the server clock is refused. Accepts ISO text or epoch seconds.
local FUTURE_SLACK_SECONDS = 600
function util.tooFarAhead(stamp)
  if type(stamp) == "string" then
    -- A later year is refused before any arithmetic (Lua builds with 32-bit integers would
    -- overflow on far-future seconds).
    local year = tonumber(string.match(stamp, "^(%d+)-"))
    local ok, parts = pcall(date, "!*t", util.serverTime())
    local nowYear = ok and type(parts) == "table" and parts.year or nil
    if year and nowYear and year > nowYear + 1 then return true end
  end
  local seconds = type(stamp) == "number" and stamp or util.isoEpoch(stamp)
  if not seconds then return false end
  return seconds > util.serverTime() + FUTURE_SLACK_SECONDS
end

-- The group chat channel right now, or nil when alone.
function util.groupChannel()
  if IsInRaid and IsInRaid() then return "RAID" end
  if IsInGroup and IsInGroup() then return "PARTY" end
  return nil
end

-- True when `name` is in your raid or party right now (whispered bids and answers only
-- count from the group, never from anyone who happens to whisper a number).
function util.inMyGroup(name)
  name = normalizeName(name)
  if not name then return false end
  if name == playerName() then return true end
  local units = {}
  if IsInRaid and IsInRaid() then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do units[#units + 1] = "raid" .. i end
  elseif IsInGroup and IsInGroup() then
    for i = 1, 4 do units[#units + 1] = "party" .. i end
  end
  for _, unit in ipairs(units) do
    local ok, unitName = pcall(UnitName, unit)
    if ok and not isSecret(unitName) and normalizeName(unitName) == name then return true end
  end
  return false
end

-- Plain base64 (RFC 4648), so a pasted string survives chat, edit boxes and Discord.
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_INDEX = {}
for i = 1, #B64 do B64_INDEX[string.sub(B64, i, i)] = i - 1 end

function util.base64Encode(data)
  local out = {}
  for i = 1, #data, 3 do
    local a, b, c = string.byte(data, i, i + 2)
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local c1, c2, c3, c4 = math.floor(n / 262144) % 64, math.floor(n / 4096) % 64, math.floor(n / 64) % 64, n % 64
    out[#out + 1] = string.sub(B64, c1 + 1, c1 + 1) .. string.sub(B64, c2 + 1, c2 + 1)
      .. (b and string.sub(B64, c3 + 1, c3 + 1) or "=") .. (c and string.sub(B64, c4 + 1, c4 + 1) or "=")
  end
  return table.concat(out)
end

function util.base64Decode(text)
  text = string.gsub(text, "%s", "")
  if #text % 4 ~= 0 or string.find(text, "[^A-Za-z0-9+/=]") then return nil end
  local out = {}
  for i = 1, #text, 4 do
    local a, b = B64_INDEX[string.sub(text, i, i)], B64_INDEX[string.sub(text, i + 1, i + 1)]
    local c3, c4 = string.sub(text, i + 2, i + 2), string.sub(text, i + 3, i + 3)
    if not a or not b then return nil end
    local c, d = B64_INDEX[c3] or 0, B64_INDEX[c4] or 0
    local n = a * 262144 + b * 4096 + c * 64 + d
    out[#out + 1] = string.char(math.floor(n / 65536) % 256)
    if c3 ~= "=" then out[#out + 1] = string.char(math.floor(n / 256) % 256) end
    if c4 ~= "=" then out[#out + 1] = string.char(n % 256) end
  end
  return table.concat(out)
end

-- Cuts text to at most `limit` bytes without splitting a UTF-8 character in two.
function util.truncate(text, limit)
  if #text <= limit then return text end
  local cut = string.sub(text, 1, limit)
  -- Walk back over a trailing character that lost some of its bytes.
  local i = #cut
  while i > 0 and i > #cut - 4 do
    local byte = string.byte(cut, i)
    if byte < 128 then break end
    if byte >= 192 then
      local need = byte >= 240 and 4 or byte >= 224 and 3 or 2
      if #cut - i + 1 < need then cut = string.sub(cut, 1, i - 1) end
      break
    end
    i = i - 1
  end
  return cut
end

-- ---------------------------------------------------------------------
-- Outgoing addon messages (ns.comm). The server lets each prefix send a
-- burst of about ten messages, then about one a second; anything faster is
-- dropped without a word. Every module sends through this one paced queue
-- per prefix, which also retries a message the game says was throttled.
-- ---------------------------------------------------------------------
local comm = ns.comm or {}
ns.comm = comm
local BURST, PER_SECOND, MAX_TRIES = 8, 1, 5
-- SendAddonMessage result codes (Enum.SendAddonMessageResult) that mean "try again".
local THROTTLED = { [3] = true, [8] = true }
local buckets = {}

local function nowSeconds()
  local ok, value = pcall(GetTime)
  if ok and type(value) == "number" then return value end
  return time()
end

local function rawSend(prefix, text, channel, target)
  local ok, result = pcall(function()
    if C_ChatInfo and C_ChatInfo.SendAddonMessage then return C_ChatInfo.SendAddonMessage(prefix, text, channel, target) end
    if SendAddonMessage then return SendAddonMessage(prefix, text, channel, target) end
    return false
  end)
  if not ok then return "error" end
  if type(result) == "number" then
    if result == 0 then return "sent" end
    return THROTTLED[result] and "throttled" or "refused"
  end
  if result == false then return "refused" end
  return "sent"
end

local function bucket(prefix)
  local b = buckets[prefix]
  local t = nowSeconds()
  if not b then
    b = { tokens = BURST, at = t, queue = {} }
    buckets[prefix] = b
  end
  b.tokens = math.min(BURST, b.tokens + math.max(0, t - b.at) * PER_SECOND)
  b.at = t
  return b
end

local pump
local function schedule(prefix, b)
  if b.scheduled or not (C_Timer and C_Timer.After) then return end
  b.scheduled = true
  C_Timer.After(1 / PER_SECOND, function() b.scheduled = false; pump(prefix) end)
end

pump = function(prefix)
  local b = bucket(prefix)
  while b.queue[1] and b.tokens >= 1 do
    local item = b.queue[1]
    local status = rawSend(prefix, item.text, item.channel, item.target)
    if status == "throttled" then
      b.tokens = 0
      item.tries = (item.tries or 0) + 1
      if item.tries >= MAX_TRIES then
        table.remove(b.queue, 1)
        diag("SEND", prefix .. ": gave up on a message after " .. MAX_TRIES .. " throttled tries")
      end
      break
    end
    table.remove(b.queue, 1)
    b.tokens = b.tokens - 1
  end
  if b.queue[1] then schedule(prefix, b) end
end

-- Queues one message; it goes out at once when the prefix has room. Returns false when
-- there is nowhere to send it (no channel).
function comm.send(prefix, text, channel, target)
  if not channel then return false end
  text = tostring(text)
  if #text > MAX_ADDON_MESSAGE then
    diag("SEND", string.format("%s: a %d-byte message was cut to %d", prefix, #text, MAX_ADDON_MESSAGE))
    text = util.truncate(text, MAX_ADDON_MESSAGE)
  end
  local b = bucket(prefix)
  table.insert(b.queue, { text = text, channel = channel, target = target })
  pump(prefix)
  return true
end

-- Messages still waiting for a prefix (0 when everything went out).
function comm.pending(prefix)
  local b = buckets[prefix]
  return b and #b.queue or 0
end

-- Registers an addon message prefix with whichever API this client has.
function comm.register(prefix)
  pcall(function()
    if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then C_ChatInfo.RegisterAddonMessagePrefix(prefix)
    elseif RegisterAddonMessagePrefix then RegisterAddonMessagePrefix(prefix) end
  end)
end

