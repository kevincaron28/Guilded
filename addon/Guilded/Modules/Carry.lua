-- Records carried for players near you (9.3.2, docs/plans/ADDON_ONLY_REACH_2026-11-14.md).
--
-- A player with only the addon (no companion on that PC) cannot reach the bot. Anyone near them whose PC runs the companion can: this
-- module lets the two meet and hand records over, with no Discord account and nothing to set up.
--
--   * A carrier (an addon on a PC whose companion says it carries records: GuildedCompanionFeatures["carry-records"]) announces itself
--     with a short "HI" on guild chat, on the group, and on one temporary shared channel per faction. The channel carries only these
--     announcements: records and receipts go by whisper, never on the channel.
--   * An addon that has records of its own (today: its outside-guild duels) whispers them to a carrier it heard, a few at a time, in
--     small chunks, never in combat or inside an instance, always through the shared paced queue (ns.comm).
--   * The carrier stores what it received (<DB>.carry.records, only for the sender's own character: the whisper sender is the author)
--     and its companion uploads them. The bot's receipts come back to this PC in Carry.lua (written by the companion); the carrier
--     tells the author by whisper and the author stops carrying that record.
--
-- Off with /guilded carry off (or /gdungeons carry off): the channel is left and nothing is offered, stored or announced.
-- Everything is stored in the saved variables the addon already has, so a /reload or a crash loses nothing.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedCry"
local CHANNEL_PREFIX = "GuildedCarry"
local MAX_RECORDS, MAX_RECORD_BYTES, KEEP_DAYS = 200, 2048, 30
local CHUNK, MAX_CHUNKS = 150, 14
local SESSION_PER_CARRIER, PAUSE_SECONDS = 8, 600
local STALE_SECONDS, MAX_FAILURES = 1200, 2
local ANNOUNCE_SECONDS, FEATURES_FRESH = 600, 7 * 86400
local PER_SENDER_PER_HOUR, MAX_ASSEMBLIES = 20, 20
local DONE_KEEP = 400

local carry = { carriers = {}, assemblies = {}, sentTo = {}, received = {}, channelId = 0, channelName = nil, whispered = {}, stats = { stored = 0, offered = 0, receipts = 0 } }
ns.carry = carry

local compat = ns.compat
local function L(text) return ns.L and ns.L(text) or text end
local function now() return compat and compat.serverTime and compat.serverTime() or (time and time()) or 0 end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function me() return ns.playerName and ns.playerName() or nil end
local function sameName(a, b)
  if type(a) ~= "string" or type(b) ~= "string" then return false end
  if ns.util and ns.util.sameCharacter then return ns.util.sameCharacter(a, b) end
  return string.lower(a) == string.lower(b)
end
local function bare(name)
  if type(name) ~= "string" then return nil end
  return string.match(name, "^([^%-]+)") or name
end

local function store()
  local root = ns.getDb and ns.getDb()
  if not root then return nil end
  local s = root.carry
  if type(s) ~= "table" then s = {}; root.carry = s end
  s.records = type(s.records) == "table" and s.records or {}
  s.done = type(s.done) == "table" and s.done or {}
  return s
end

function carry.enabled()
  local s = store()
  if not s or s.off == true then return false end
  -- The member's switch for carrying dungeon runs (/guilded dungeon carry off, /gdungeons carry off) turns all carrying off.
  if ns.dungeon and ns.dungeon.carryOn and not ns.dungeon.carryOn() then return false end
  return not ns.moduleActive or ns.moduleActive("carry")
end

-- This PC's companion carries records for players near it (it writes GuildedCompanionFeatures with every update; it goes stale when it stops).
function carry.companionHere()
  local features = type(GuildedCompanionFeatures) == "table" and GuildedCompanionFeatures or nil
  if not features or features["carry-records"] ~= true then return false end
  local at = tonumber(features.at)
  return at ~= nil and now() - at <= FEATURES_FRESH and at <= now() + 86400
end

local function inCombat() return InCombatLockdown and InCombatLockdown() end
local function inInstance()
  if not IsInInstance then return false end
  local ok, inside = pcall(IsInInstance)
  return ok and inside == true
end
local function quiet() return not inCombat() and not inInstance() end

-- A short stable hash (24-bit: the Lua test harness has 32-bit integers, the game has doubles).
local function hash(text)
  local h = 5381
  for i = 1, #text do h = (h * 33 + string.byte(text, i)) % 16777216 end
  return string.format("%06x", h)
end

-- Flat tables of strings, numbers and booleans, one record at a time. Separators in text are escaped, so a record never breaks a frame.
local function esc(text) return (string.gsub(text, "[%%~=|&%c]", function(c) return string.format("%%%02X", string.byte(c)) end)) end
local function unesc(text) return (string.gsub(text, "%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)) end
function carry.encode(data)
  local keys = {}
  for k, v in pairs(data) do
    local t = type(v)
    if type(k) == "string" and (t == "string" or t == "number" or t == "boolean") then keys[#keys + 1] = k end
  end
  table.sort(keys)
  local out = {}
  for _, k in ipairs(keys) do
    local v = data[k]
    local t = type(v)
    local code = t == "string" and "s" .. esc(v) or t == "number" and "n" .. tostring(v) or (v and "b1" or "b0")
    out[#out + 1] = esc(k) .. "=" .. code
  end
  return table.concat(out, "&")
end
function carry.decode(text)
  if type(text) ~= "string" or #text > MAX_RECORD_BYTES * 2 then return nil end
  local data, count = {}, 0
  for pair in string.gmatch(text, "[^&]+") do
    local k, code = string.match(pair, "^([^=]+)=(.*)$")
    if not k or code == "" then return nil end
    local kind, value = string.sub(code, 1, 1), string.sub(code, 2)
    count = count + 1
    if count > 40 then return nil end
    if kind == "s" then data[unesc(k)] = unesc(value)
    elseif kind == "n" then
      local n = tonumber(value)
      if not n or n ~= n then return nil end
      data[unesc(k)] = n
    elseif kind == "b" then data[unesc(k)] = value == "1"
    else return nil end
  end
  return data
end

-- The fields of an outside duel that are about the fight itself (what the bot's global duel schema takes without a check chain).
local DUEL_FIELDS = { "winner", "loser", "winnerRealm", "loserRealm", "winnerClass", "loserClass", "winnerLevel", "loserLevel", "winnerGuild", "loserGuild", "zone", "at", "durationSec", "reason", "side" }

-- This player's own records waiting for a carrier: the outside duels that are not acknowledged yet.
function carry.collectOwn()
  local s = store()
  local root = ns.getDb and ns.getDb()
  local out = {}
  local list = root and root.duels and root.duels.external
  if not s or type(list) ~= "table" then return out end
  for _, row in pairs(list) do
    if type(row) == "table" and type(row.winner) == "string" and type(row.loser) == "string" and tonumber(row.at) then
      local data = {}
      for _, field in ipairs(DUEL_FIELDS) do
        local v = row[field]
        if type(v) == "string" or type(v) == "number" then data[field] = v end
      end
      local key = string.format("%d-%s", tonumber(row.at), hash(row.winner .. "|" .. row.loser))
      if not s.done["externalDuel:" .. key] and #carry.encode(data) <= MAX_RECORD_BYTES then
        out[#out + 1] = { kind = "externalDuel", key = key, author = me(), data = data, at = tonumber(row.at) }
      end
    end
  end
  table.sort(out, function(a, b) return a.at > b.at end)
  return out
end

local function waitingCount()
  if carry.companionHere() then return 0 end
  return #carry.collectOwn()
end

-- ---- carriers ---------------------------------------------------------------------------------------------------------------------

local function carrierUsable(entry)
  return entry and entry.fails < MAX_FAILURES and now() - entry.at <= STALE_SECONDS
end
function carry.carrierCount()
  local n = 0
  for _, entry in pairs(carry.carriers) do if carrierUsable(entry) then n = n + 1 end end
  return n
end

local function noteCarrier(sender)
  if type(sender) ~= "string" or secret(sender) or sameName(sender, me()) then return nil end
  local entry = carry.carriers[sender]
  if not entry then entry = { at = 0, fails = 0, sent = 0, pauseUntil = 0, name = sender }; carry.carriers[sender] = entry end
  entry.at = now()
  if entry.fails >= MAX_FAILURES and now() - (entry.lastFail or 0) > STALE_SECONDS then entry.fails = 0 end
  return entry
end

local function send(text, channel, target)
  if not ns.comm or not ns.comm.send then return false end
  return ns.comm.send(PREFIX, text, channel, target, quiet, "hold-in-instance")
end

-- Hands this player's waiting records to one carrier, a few at a time (the rest on the next announcement).
function carry.offerTo(entry)
  if not carry.enabled() or carry.companionHere() or not carrierUsable(entry) or not quiet() then return 0 end
  if now() < entry.pauseUntil then return 0 end
  local records = carry.collectOwn()
  if #records == 0 then return 0 end
  local sent = 0
  for _, record in ipairs(records) do
    if entry.sent >= SESSION_PER_CARRIER then entry.pauseUntil = now() + PAUSE_SECONDS; entry.sent = 0; break end
    local body = carry.encode(record.data)
    local parts = {}
    for i = 1, #body, CHUNK do parts[#parts + 1] = string.sub(body, i, i + CHUNK - 1) end
    if #parts >= 1 and #parts <= MAX_CHUNKS then
      for i, part in ipairs(parts) do
        send(string.format("R|%s|%s|%d/%d|%s", record.kind, record.key, i, #parts, part), "WHISPER", entry.name)
      end
      carry.sentTo[record.kind .. ":" .. record.key] = entry.name
      carry.whispered[entry.name] = now()
      entry.sent = entry.sent + 1
      sent = sent + 1
      carry.stats.offered = carry.stats.offered + 1
    end
  end
  return sent
end

function carry.offerAll()
  for _, entry in pairs(carry.carriers) do carry.offerTo(entry) end
end

-- ---- receiving ----------------------------------------------------------------------------------------------------------------------

local function validKind(kind) return type(kind) == "string" and string.match(kind, "^%a+$") ~= nil and #kind >= 2 and #kind <= 24 end
local function validKey(key) return type(key) == "string" and #key >= 4 and #key <= 120 and string.match(key, "^[%w%-_:%.]+$") ~= nil end

local function prune(s)
  local cutoff = now() - KEEP_DAYS * 86400
  local count = 0
  for id, record in pairs(s.records) do
    if type(record) ~= "table" or (tonumber(record.got) or 0) < cutoff then s.records[id] = nil else count = count + 1 end
  end
  if count > MAX_RECORDS then
    local list = {}
    for id, record in pairs(s.records) do list[#list + 1] = { id = id, got = tonumber(record.got) or 0 } end
    table.sort(list, function(a, b) return a.got < b.got end)
    for i = 1, count - MAX_RECORDS do s.records[list[i].id] = nil end
  end
  local done, dn = {}, 0
  for id, at in pairs(s.done) do dn = dn + 1; done[#done + 1] = { id = id, at = tonumber(at) or 0 } end
  if dn > DONE_KEEP then
    table.sort(done, function(a, b) return a.at < b.at end)
    for i = 1, dn - DONE_KEEP do s.done[done[i].id] = nil end
  end
end

-- One chunk of a record whispered to this PC. Only a carrier keeps it; the author is the sender (never a name the message claims).
local function onRecordPart(sender, kind, key, index, total, part)
  if not carry.enabled() or not carry.companionHere() then return end
  if not validKind(kind) or not validKey(key) or index < 1 or total < 1 or total > MAX_CHUNKS or index > total or #part > CHUNK + 20 then return end
  local s = store()
  if not s then return end
  local id = kind .. ":" .. key
  if s.records[id] or s.done[id] then return end
  local slot = sender .. "|" .. id
  local assembly = carry.assemblies[slot]
  if not assembly then
    local n = 0
    for _ in pairs(carry.assemblies) do n = n + 1 end
    if n >= MAX_ASSEMBLIES then return end
    local hour = carry.received[sender]
    if not hour or now() - hour.at > 3600 then hour = { at = now(), n = 0 }; carry.received[sender] = hour end
    if hour.n >= PER_SENDER_PER_HOUR then return end
    hour.n = hour.n + 1
    assembly = { parts = {}, total = total, at = now() }
    carry.assemblies[slot] = assembly
  end
  if assembly.total ~= total then carry.assemblies[slot] = nil; return end
  assembly.parts[index] = part
  for i = 1, total do if not assembly.parts[i] then return end end
  carry.assemblies[slot] = nil
  local data = carry.decode(table.concat(assembly.parts))
  if not data then return end
  local author = bare(sender)
  if not author or author == "" then return end
  s.records[id] = { kind = kind, key = key, author = author, from = sender, data = data, at = tonumber(data.at) or now(), got = now() }
  carry.stats.stored = carry.stats.stored + 1
  prune(s)
  if ns.syncNow and ns.syncNow.mark then pcall(ns.syncNow.mark) end
end

-- A carrier's word that a record reached the bot: only from a name this PC handed the record to.
local function onReceiptFrom(sender, id)
  local s = store()
  if not s or type(id) ~= "string" or #id > 150 then return end
  local expected = carry.sentTo[id]
  if not expected or not sameName(expected, sender) then return end
  s.done[id] = now()
  carry.sentTo[id] = nil
  carry.stats.receipts = carry.stats.receipts + 1
  prune(s)
end

local function onAddonMessage(prefix, text, channel, sender)
  if prefix ~= PREFIX or secret(text) or secret(sender) or secret(channel) then return end
  if type(text) ~= "string" or type(sender) ~= "string" or #text > 255 or sameName(sender, me()) then return end
  if not carry.enabled() then return end
  local tag = string.sub(text, 1, 2)
  if tag == "HI" then
    -- A carrier says it is here (guild, group or the shared channel): a short note, never anything to act on but "offer what I have".
    if channel ~= "WHISPER" and string.match(text, "^HI|%d+$") then
      local entry = noteCarrier(sender)
      if entry then carry.offerTo(entry) end
    end
  elseif channel == "WHISPER" then
    local kind, key, index, total, part = string.match(text, "^R|(%a+)|([^|]+)|(%d+)/(%d+)|(.*)$")
    if kind then onRecordPart(sender, kind, key, tonumber(index), tonumber(total), part); return end
    local id = string.match(text, "^K|([^|]+)$")
    if id then onReceiptFrom(sender, id) end
  end
end

-- ---- receipts (written by the companion) -----------------------------------------------------------------------------------------------

-- Reads Carry.lua: records the bot holds are no longer carried, here or for the player who whispered them.
function carry.applyReceipts()
  local s = store()
  if not s or type(GuildedCarryReceipts) ~= "table" then return 0 end
  local n = 0
  for _, id in ipairs(GuildedCarryReceipts) do
    if type(id) == "string" and #id <= 150 then
      s.done[id] = s.done[id] or now()
      local record = s.records[id]
      if record then
        s.records[id] = nil
        n = n + 1
        -- Tell the player it came from, if this PC heard from them lately (they may be offline: the next carrier answers them too).
        if record.from and now() - (tonumber(record.got) or 0) <= 7200 and quiet() then
          carry.whispered[record.from] = now()
          send("K|" .. id, "WHISPER", record.from)
        end
      end
    end
  end
  prune(s)
  return n
end

-- ---- announcing and the shared channel -----------------------------------------------------------------------------------------------

local function groupChannel()
  if IsInRaid and IsInRaid() then return "RAID" end
  if IsInGroup and IsInGroup() then return (IsInGroup(2) and "INSTANCE_CHAT") or "PARTY" end
  return nil
end

function carry.announce()
  if not carry.enabled() or not carry.companionHere() or not quiet() then return end
  local text = "HI|1"
  if IsInGuild and IsInGuild() then send(text, "GUILD") end
  local group = groupChannel()
  if group then send(text, group) end
  if carry.channelId > 0 then send(text, "CHANNEL", carry.channelId) end
end

local function faction()
  local ok, name = pcall(UnitFactionGroup, "player")
  if ok and type(name) == "string" and name ~= "" and not secret(name) then return string.sub(name, 1, 1) end
  return "N"
end

function carry.joinChannel()
  if carry.channelId > 0 or not carry.enabled() then return end
  local name = CHANNEL_PREFIX .. faction()
  carry.channelName = name
  local ok = pcall(function()
    if JoinTemporaryChannel then return JoinTemporaryChannel(name) end
    if JoinChannelByName then return JoinChannelByName(name) end
    error("no join function")
  end)
  if not ok then carry.channelFailed = true; return end
  if C_Timer and C_Timer.After then
    C_Timer.After(4, function()
      local idOk, number = pcall(GetChannelName, name)
      local id = idOk and tonumber(number) or 0
      if id and id > 0 then carry.channelId = id; carry.channelFailed = nil; carry.announce()
      else carry.channelFailed = true end
    end)
  end
end

function carry.leaveChannel()
  if carry.channelName then pcall(function() if LeaveChannelByName then LeaveChannelByName(carry.channelName) end end) end
  carry.channelId = 0
end

-- The game's own lines about our channel and our whispers are not for the player: the "joined" notice of the shared channel and the
-- "no player named" answer to a whisper this module just sent (which also counts against that carrier).
local function installFilters()
  if carry.filtersInstalled or not ChatFrame_AddMessageEventFilter then return end
  carry.filtersInstalled = true
  pcall(ChatFrame_AddMessageEventFilter, "CHAT_MSG_CHANNEL_NOTICE", function(_, _, ...)
    local channelName = select(4, ...)
    if type(channelName) == "string" and not secret(channelName) and string.find(channelName, CHANNEL_PREFIX, 1, true) then return true end
    return false
  end)
  local pattern
  if type(ERR_CHAT_PLAYER_NOT_FOUND_S) == "string" then
    pattern = "^" .. string.gsub(string.gsub(ERR_CHAT_PLAYER_NOT_FOUND_S, "([%^%$%(%)%.%[%]%*%+%-%?])", "%%%1"), "%%%%s", "(.+)") .. "$"
  end
  if pattern then
    pcall(ChatFrame_AddMessageEventFilter, "CHAT_MSG_SYSTEM", function(_, _, text)
      if type(text) ~= "string" or secret(text) then return false end
      local who = string.match(text, pattern)
      if not who then return false end
      for name, at in pairs(carry.whispered) do
        if now() - at <= 5 and sameName(name, who) then
          local entry = carry.carriers[name]
          if entry then entry.fails = entry.fails + 1; entry.lastFail = now() end
          return true
        end
      end
      return false
    end)
  end
end

-- ---- status and commands ------------------------------------------------------------------------------------------------------------------

function carry.statusLine()
  local s = store()
  if not s then return "" end
  if s.off == true then return L("Carrying records is off. Type /guilded carry on to turn it on.") end
  if carry.companionHere() then
    local n = 0
    for _ in pairs(s.records) do n = n + 1 end
    return string.format(L("Your companion carries records for players near you (%d waiting to be sent)."), n)
  end
  local waiting = waitingCount()
  if waiting > 0 then
    if carry.carrierCount() > 0 then return string.format(L("%d records wait for a companion: one is in range and will take them."), waiting) end
    return string.format(L("%d records wait for a companion. No companion heard yet."), waiting)
  end
  if (carry.stats.receipts or 0) > 0 then return L("Your records were uploaded by a companion near you.") end
  return L("Nothing to carry. A player near you with the companion will take your records.")
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["carry"] = function(args)
  local choice = string.lower((args and args[1]) or "")
  local s = store()
  if not s then return end
  if choice == "off" then
    s.off = true
    carry.leaveChannel()
    ns.message(L("Carrying records is off: the shared channel is left and nothing is offered, kept or announced."))
    return
  elseif choice == "on" then
    s.off = nil
    local root = ns.getDb and ns.getDb()
    if root and type(root.dungeon) == "table" then root.dungeon.carryGroupRuns = nil end
    carry.joinChannel()
    ns.message(L("Carrying records is on."))
    return
  end
  ns.message(carry.statusLine())
  ns.message(string.format(L("Carriers heard: %d. Shared channel: %s. Type /guilded carry off to stop."), carry.carrierCount(),
    carry.channelId > 0 and L("carry channel joined") or (carry.channelFailed and L("carry channel not available, using guild and group") or L("carry channel not joined"))))
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded carry [on | off] - records carried for and by players near you")

-- ---- events and timers --------------------------------------------------------------------------------------------------------------------------

local function expire()
  local t = now()
  for slot, assembly in pairs(carry.assemblies) do if t - assembly.at > 120 then carry.assemblies[slot] = nil end end
  for name, at in pairs(carry.whispered) do if t - at > 7200 then carry.whispered[name] = nil end end
end

local function startup()
  if not carry.enabled() then return end
  installFilters()
  carry.applyReceipts()
  -- The channel is joined last, well after the player's own channels, so nothing the player set up moves.
  if C_Timer and C_Timer.After then
    C_Timer.After(25, function() if carry.enabled() then carry.joinChannel() end end)
    C_Timer.After(40, function() carry.announce() end)
  end
end

local pendingAnnounce = false
local function onEvent(_, event, ...)
  if event == "CHAT_MSG_ADDON" then
    local prefix, text, channel, sender = ...
    onAddonMessage(prefix, text, channel, sender)
  elseif event == "PLAYER_LOGIN" then
    if ns.comm and ns.comm.register then ns.comm.register(PREFIX) end
    startup()
  elseif event == "GROUP_ROSTER_UPDATE" then
    if not pendingAnnounce and C_Timer and C_Timer.After then
      pendingAnnounce = true
      C_Timer.After(6, function() pendingAnnounce = false; carry.announce() end)
    end
  elseif event == "PLAYER_ENTERING_WORLD" then
    if carry.channelId > 0 then
      local idOk, number = pcall(GetChannelName, carry.channelName or "")
      carry.channelId = idOk and tonumber(number) or 0
    end
  end
end

if CreateFrame then
  local frame = CreateFrame("Frame")
  for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "GROUP_ROSTER_UPDATE", "CHAT_MSG_ADDON" }) do
    if compat and compat.registerEvent then compat.registerEvent(frame, event) else frame:RegisterEvent(event) end
  end
  frame:SetScript("OnEvent", function(...)
    local ok, err = pcall(onEvent, ...)
    if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded carry: " .. tostring(err)) end
  end)
end

if C_Timer and C_Timer.NewTicker then
  C_Timer.NewTicker(ANNOUNCE_SECONDS, function()
    if carry.enabled() then pcall(carry.announce); pcall(expire); pcall(carry.offerAll) end
  end)
  -- Receipts the companion wrote after this session started are read when the file is next loaded; the ticker only retries offers.
end
