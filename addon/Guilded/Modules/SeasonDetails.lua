-- Optional personal season detail relay. Independent of OfficerBridge and
-- the legacy season leaderboard protocol: never broadcast whole guild histories.
local addonName, ns = ...
local detail = {}
ns.seasonDetails = detail
local PREFIX, CHUNK, MAX_PARTS = "GuildedRating", 180, 128
local TRANSFER_TIMEOUT = MAX_PARTS + 30 -- Queue sends about one packet per second.
local pending, serial, lastRequest = nil, 0, -100
local retryScheduled, attempts = false, {}
local lastResponse, served = -100, {}
local function clock() return GetTime() end
local function encode(value)
  return (string.gsub(tostring(value or ""), "[%%;\r\n|]", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function decode(value)
  return (string.gsub(value, "%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end
local function boardAt(index)
  local db = ns.getDb and ns.getDb()
  local board = db and db.dungeonBoard
  return board, board and (index == 1 and board or (board.history or {})[index - 1])
end
function detail.profile(season, name)
  for _, profile in ipairs(season.profiles or {}) do
    if ns.normalizeName(profile.name) == name then return profile end
    -- Only frozen legacy seasons may share an account's result with its alts.
    for _, character in ipairs(season.status == "ENDED" and profile.characters or {}) do
      if ns.normalizeName(character) == name then return profile end
    end
  end
  if season.detailsAvailable then return { name = name, points = 0, details = {} } end
end
function detail.get(index, name)
  local board, season = boardAt(index)
  if not season then return nil end
  if season.detailsAvailable ~= nil then
    return { available = season.detailsAvailable, version = season.ratingVersion, provisional = season.provisionalTargets, profile = detail.profile(season, name), catalog = season.catalog or {} }
  end
  local db = ns.getDb()
  local cache = db.dungeonScoreDetails
  if cache and cache.stamp == board.updatedAt and cache.player == name then return cache.seasons[index] end
  return nil
end
function detail.request(index)
  if not ns.scores.isMember(ns.playerName()) then return end
  local board, season = boardAt(index)
  if not board or not season or not board.updatedAt or season.detailsAvailable or detail.get(index, ns.playerName()) then return end
  local key = board.updatedAt .. ":" .. index
  if (attempts[key] or 0) >= 3 then return end
  if not retryScheduled and C_Timer and C_Timer.After then
    retryScheduled = true
    C_Timer.After(16, function()
      retryScheduled = false
      if ns.dungeonScorePanel and ns.dungeonScorePanel.refreshVisible then ns.dungeonScorePanel.refreshVisible() end
    end)
  end
  if clock() - lastRequest < 15 then return end
  if pending and pending.index == index and pending.stamp == board.updatedAt
    and pending.count > 0 and clock() - pending.at <= TRANSFER_TIMEOUT then return end
  for old in pairs(attempts) do if string.sub(old, 1, #board.updatedAt) ~= board.updatedAt then attempts[old] = nil end end
  attempts[key] = (attempts[key] or 0) + 1
  serial = serial + 1
  pending = { nonce = tostring(serial) .. "-" .. tostring(math.floor(clock())), index = index, stamp = board.updatedAt, at = clock(), parts = {}, count = 0 }
  lastRequest = clock()
  ns.comm.send(PREFIX, "Q|" .. board.updatedAt .. "|" .. index .. "|" .. pending.nonce, "GUILD")
end
local function respond(text, sender, replyTo)
  if not ns.isOfficer() or clock() - lastResponse < 2 or (served[sender] and clock() - served[sender] < 15) then return end
  if ns.comm.pending(PREFIX) > 0 then return end
  local stamp, index, nonce = string.match(text, "^Q|([^|]+)|(%d+)|([%d%-]+)$")
  index = tonumber(index)
  if not stamp or #stamp > 40 or not index or index < 1 or index > 11 or #nonce > 40 then return end
  local board, season = boardAt(index)
  if not board or board.updatedAt ~= stamp or not season or season.detailsAvailable == nil then return end
  local profile = detail.profile(season, sender)
  local lines = { table.concat({ "S", encode(season.id), season.ratingVersion or 0,
    profile and profile.points or 0, season.detailsAvailable and "1" or "0", season.provisionalTargets and "1" or "0" }, ";") }
  if season.detailsAvailable then
    if #(season.catalog or {}) > 100 or #(profile.details or {}) > 100 then return end
    for _, d in ipairs(season.catalog or {}) do
      lines[#lines + 1] = table.concat({ "C", d.instanceId, encode(d.name), d.targetSec or 0, d.dungeonKey or tostring(d.instanceId), d.minLevel or 0, d.maxLevel or 0 }, ";")
    end
    for _, d in ipairs(profile.details or {}) do
      lines[#lines + 1] = table.concat({ "R", d.instanceId, encode(d.name), d.points, d.speedBonus,
        d.durationSec, d.targetSec or 0, encode(d.runRef), encode(d.unrankedReason), d.dungeonKey or tostring(d.instanceId) }, ";")
      for _, b in ipairs(d.bosses or {}) do
        lines[#lines + 1] = table.concat({ "B", d.instanceId, b.id, encode(b.name), b.durationSec, encode(b.runRef), d.dungeonKey or tostring(d.instanceId) }, ";")
      end
    end
  end
  local payload = table.concat(lines, "\n")
  local count = math.ceil(#payload / CHUNK)
  if count > MAX_PARTS then return end
  lastResponse, served[sender] = clock(), clock()
  for name, at in pairs(served) do if clock() - at > 60 then served[name] = nil end end
  for part = 1, count do
    ns.comm.send(PREFIX, "D|" .. nonce .. "|" .. part .. "|" .. count .. "|" .. string.sub(payload, (part - 1) * CHUNK + 1, part * CHUNK), "WHISPER", replyTo)
  end
end
local function number(value, min, max)
  local n = tonumber(value)
  if not n or n ~= math.floor(n) or n < min or n > max then return nil end
  return n
end
local function validKey(key, id)
  if key == tostring(id) then return true end
  return id == 189 and (key == "189:graveyard" or key == "189:library" or key == "189:armory" or key == "189:cathedral")
end
local function parse(payload)
  local result = { catalog = {}, profile = { name = ns.playerName(), details = {} } }
  local catalogIds, runIds, sum, header = {}, {}, 0, false
  for line in string.gmatch(payload .. "\n", "([^\n]*)\n") do
    local fields = {}
    for field in string.gmatch(line .. ";", "([^;]*);") do fields[#fields + 1] = field end
    if fields[1] == "S" and not header and (#fields == 5 or #fields == 6) then
      result.version = number(fields[3], 0, 3)
      result.profile.points = number(fields[4], 0, 40000)
      if not result.version or not result.profile.points or (fields[5] ~= "0" and fields[5] ~= "1") then return end
      if fields[6] and fields[6] ~= "0" and fields[6] ~= "1" then return end
      result.provisional = fields[6] == "1"
      result.available, result.id, header = fields[5] == "1", decode(fields[2]), true
      if result.available and result.version == 0 then return end
    elseif header and result.available and fields[1] == "C" and (#fields == 4 or #fields == 7) then
      local id, target = number(fields[2], 1, 1000000), number(fields[4], 0, 14400)
      local key = fields[5] or tostring(id)
      local low, high = number(fields[6] or "0", 0, 100), number(fields[7] or "0", 0, 100)
      if not id or not validKey(key, id) or not low or not high or low > high or not target or catalogIds[key] or #result.catalog >= 100 or #fields[3] > 400 then return end
      catalogIds[key] = true
      result.catalog[#result.catalog + 1] = { dungeonKey = key, minLevel = low > 0 and low or nil, maxLevel = high > 0 and high or nil, instanceId = id, name = decode(fields[3]), targetSec = target > 0 and target or nil }
    elseif header and result.available and fields[1] == "R" and (#fields == 8 or #fields == 9 or #fields == 10) then
      local id, points, bonus = number(fields[2], 1, 1000000), number(fields[4], 0, 400), number(fields[5], 0, 20)
      local seconds, target = number(fields[6], 1, 14400), number(fields[7], 0, 14400)
      local key = fields[10] or tostring(id)
      if not id or not validKey(key, id) or not points or not bonus or not seconds or not target or runIds[key] or not catalogIds[key]
        or #result.profile.details >= 100 or #fields[3] > 400 or #fields[8] > 400 then return end
      local expected = target > 0 and math.floor(20 * math.max(0, math.min(1, (target - seconds) / (0.3 * target))) + 0.5) or 0
      local reason = fields[9] and decode(fields[9]) or ""
      local reasons = { ["Level range not configured"]=true, ["Different difficulty"]=true, ["Party levels unknown"]=true,
        ["Overlevel carry"]=true, ["Below level range"]=true, ["Target not calibrated"]=true, ["Dungeon route unknown"]=true }
      if result.version == 3 then
        local rating = target > 0 and math.max(50, math.min(400, math.floor(200 * target / seconds + 0.5))) or 0
        if reason ~= "" and not reasons[reason] then return end
        if bonus ~= 0 or points ~= (reason ~= "" and 0 or rating) then return end
      elseif reason ~= "" or points ~= 100 + bonus or bonus ~= expected or (result.version == 1 and (bonus ~= 0 or target ~= 0)) then return end
      runIds[key], sum = true, sum + points
      result.profile.details[#result.profile.details + 1] = { dungeonKey = key, instanceId = id, name = decode(fields[3]), points = points,
        speedBonus = bonus, durationSec = seconds, targetSec = target > 0 and target or nil, runRef = decode(fields[8]),
        unrankedReason = reason ~= "" and reason or nil, bosses = {} }
    elseif header and result.available and result.version == 3 and fields[1] == "B" and (#fields == 6 or #fields == 7) then
      local id, bossId, seconds = number(fields[2], 1, 1000000), number(fields[3], 1, 1000000), number(fields[5], 1, 14400)
      if not id or not bossId or not seconds or #fields[4] > 400 or #fields[6] > 400 then return end
      local key = fields[7] or tostring(id)
      if not validKey(key, id) then return end
      local owner
      for _, d in ipairs(result.profile.details) do if (d.dungeonKey or tostring(d.instanceId)) == key then owner = d end end
      if not owner or #owner.bosses >= 100 then return end
      for _, b in ipairs(owner.bosses) do if b.id == bossId then return end end
      owner.bosses[#owner.bosses + 1] = { id = bossId, name = decode(fields[4]), durationSec = seconds, runRef = decode(fields[6]) }
    else return end
  end
  if not header or (result.available and sum ~= result.profile.points) then return end
  return result
end
detail.parse = parse
local function receive(text, sender)
  if not pending or clock() - pending.at > TRANSFER_TIMEOUT or not ns.isOfficerName(sender) then return end
  local nonce, part, total, payload = string.match(text, "^D|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if nonce ~= pending.nonce or not part or not total or total < 1 or total > MAX_PARTS or part < 1 or part > total or #payload > CHUNK then return end
  if pending.sender and (pending.sender ~= sender or pending.total ~= total) then return end
  pending.sender, pending.total = sender, total
  if not pending.parts[part] then pending.parts[part] = payload; pending.count = pending.count + 1 end
  if pending.count ~= total then return end
  local result = parse(table.concat(pending.parts))
  local board = boardAt(pending.index)
  if result and board and board.updatedAt == pending.stamp then
    local db, name = ns.getDb(), ns.playerName()
    if not db.dungeonScoreDetails or db.dungeonScoreDetails.stamp ~= pending.stamp or db.dungeonScoreDetails.player ~= name then
      db.dungeonScoreDetails = { stamp = pending.stamp, player = name, seasons = {} }
    end
    db.dungeonScoreDetails.seasons[pending.index] = result
    if ns.dungeonScorePanel and ns.dungeonScorePanel.refreshVisible then ns.dungeonScorePanel.refreshVisible() end
  end
  pending = nil
end
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN"); frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  if event == "PLAYER_LOGIN" then ns.comm.register(PREFIX); return end
  if prefix ~= PREFIX or type(text) ~= "string" or ns.isSecret(text) or ns.isSecret(sender) then return end
  if ns.moduleActive and not ns.moduleActive("scores") then return end
  local replyTo = sender -- Preserve the client's routable name/server suffix.
  sender = ns.normalizeName(sender)
  if not ns.scores.isMember(sender) or sender == ns.playerName() then return end
  local ok, err = pcall(function()
    if channel == "GUILD" then respond(text, sender, replyTo)
    elseif channel == "WHISPER" then receive(text, sender) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "season details: " .. tostring(err)) end
end)
