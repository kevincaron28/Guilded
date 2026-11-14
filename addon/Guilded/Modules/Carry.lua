-- Records carried for players near you (9.3.2, docs/plans/ADDON_ONLY_REACH_2026-11-14.md).
--
-- A player with only the addon (no companion on that PC) cannot reach the bot. Anyone near them whose PC runs the companion can: this
-- module lets the two meet and hand records over, with no Discord account and nothing to set up.
--
--   * A carrier (an addon on a PC whose companion says it carries records: GuildedCompanionFeatures["carry-records"]) announces itself
--     with a short "HI" on guild chat, on the group, and on one temporary shared channel per faction. The channel carries only these
--     announcements: records and receipts go by whisper, never on the channel.
--   * An addon that has records of its own (today: its outside-guild duels) whispers them to a carrier it heard, a few at a time, in
--     small chunks, never in combat or inside an instance, always through the shared paced queue (ns.comm). Carriers in the player's
--     guild or group are preferred over strangers, and only a few carriers are used per session.
--   * The carrier stores what it received (<DB>.carry.records, only for the sender's own character: the whisper sender is the author)
--     and its companion uploads them. The bot's receipts come back to this PC in Carry.lua (written by the companion); the carrier
--     tells the author by whisper and the author stops carrying that record.
--
-- Off with /guilded carry off (or /gdungeons carry off); an officer can switch it off for the whole guild (/guilded carry guild off).
-- Everything is stored in the saved variables the addon already has, so a /reload or a crash loses nothing.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedCry"
local CHANNEL_PREFIX = "GuildedCarry"
local MAX_RECORDS, MAX_PER_AUTHOR, MAX_RECORD_BYTES, KEEP_DAYS = 200, 40, 2048, 30
local CHUNK, MAX_CHUNKS = 150, 14
local SESSION_PER_CARRIER, PAUSE_SECONDS, SESSION_CARRIERS = 8, 600, 4
local STALE_SECONDS, MAX_FAILURES, MAX_CARRIERS = 1200, 2, 40
local ANNOUNCE_SECONDS, ANNOUNCE_MIN_GAP, FEATURES_FRESH = 600, 300, 7 * 86400
local HI_GAP = 300
local PER_SENDER_PER_HOUR, SENDER_ASSEMBLIES, MAX_ASSEMBLIES, ASSEMBLY_SECONDS = 20, 3, 30, 120
local DONE_KEEP, SENT_KEEP, OWN_CACHE_SECONDS = 400, 200, 60
local JOIN_RETRY = { 30, 120, 600, 1800 }

local carry = { carriers = {}, assemblies = {}, received = {}, hiAt = {}, channelId = 0, channelName = nil, whispered = {}, offered = {}, joinTries = 0,
  lastAnnounce = 0, stats = { stored = 0, offered = 0, receipts = 0 } }
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
-- The full "First Last" name without a "-Realm" suffix: the spelling a whisper is sent to and a record is filed under.
local function bare(name)
  if type(name) ~= "string" then return nil end
  return string.match(name, "^([^%-]+)") or name
end

local function store()
  -- Guilded Dungeons next to Guilded stays silent: it never even creates its table.
  if ns.moduleActive and not ns.moduleActive("carry") then return nil end
  local root = ns.getDb and ns.getDb()
  if not root then return nil end
  local s = root.carry
  if type(s) ~= "table" then s = {}; root.carry = s end
  s.records = type(s.records) == "table" and s.records or {}
  s.done = type(s.done) == "table" and s.done or {}
  s.sentTo = type(s.sentTo) == "table" and s.sentTo or {}
  return s
end

local function guildOff()
  local s = store()
  return s and type(s.guild) == "table" and s.guild.off == true or false
end

function carry.enabled()
  local s = store()
  if not s or s.off == true or guildOff() then return false end
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
local function after(seconds, fn) if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) end end

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

-- What a stranger needs to count an outside duel and nothing more: the two names, classes and levels, when, how it ended and which side
-- reported it. The opponent's guild text and the zone stay on this PC.
local DUEL_FIELDS = { "winner", "loser", "winnerRealm", "loserRealm", "winnerClass", "loserClass", "winnerLevel", "loserLevel", "at", "durationSec", "reason", "side" }

-- This player's own records waiting for a carrier: the outside duels that are not acknowledged yet (cached for a minute: it is read on every
-- announcement heard).
function carry.collectOwn(fresh)
  local s = store()
  local root = ns.getDb and ns.getDb()
  local list = root and root.duels and root.duels.external
  if not s or type(list) ~= "table" then return {} end
  local cache = carry.ownCache
  if not fresh and cache and now() - cache.at <= OWN_CACHE_SECONDS and cache.done == s.doneCount then return cache.list end
  local out = {}
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
  carry.ownCache = { at = now(), list = out, done = s.doneCount }
  return out
end

local function markDone(s, id)
  s.done[id] = s.done[id] or now()
  s.doneCount = (s.doneCount or 0) + 1
  carry.ownCache = nil
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

local function expireCarriers()
  local t, n, oldest, oldestAt = now(), 0, nil, math.huge
  for name, entry in pairs(carry.carriers) do
    if t - entry.at > STALE_SECONDS * 2 then carry.carriers[name] = nil
    else
      n = n + 1
      if entry.at < oldestAt then oldest, oldestAt = name, entry.at end
    end
  end
  return n, oldest
end

-- `near`: the announcement came through the guild or the group, not the shared channel.
local function noteCarrier(sender, near)
  sender = bare(sender)
  if not sender or secret(sender) or sameName(sender, me()) then return nil end
  local entry = carry.carriers[sender]
  if not entry then
    local n, oldest = expireCarriers()
    if n >= MAX_CARRIERS and oldest then carry.carriers[oldest] = nil end
    entry = { at = 0, fails = 0, sent = 0, pauseUntil = 0, name = sender, near = false }
    carry.carriers[sender] = entry
  end
  entry.at = now()
  if near then entry.near = true end
  if entry.fails >= MAX_FAILURES and now() - (entry.lastFail or 0) > STALE_SECONDS then entry.fails = 0 end
  return entry
end

local function send(text, channel, target)
  if not ns.comm or not ns.comm.send then return false end
  return ns.comm.send(PREFIX, text, channel, target, quiet, "hold-in-instance")
end

local function anyNearCarrier()
  for _, entry in pairs(carry.carriers) do if entry.near and carrierUsable(entry) then return true end end
  return false
end

-- Hands this player's waiting records to one carrier, a few at a time (the rest on the next announcement). Carriers in the guild or group
-- come first; strangers only when none is near; only a few different carriers per session.
function carry.offerTo(entry)
  if not carry.enabled() or carry.companionHere() or not carrierUsable(entry) or not quiet() then return 0 end
  if now() < entry.pauseUntil then return 0 end
  if not entry.near and anyNearCarrier() then return 0 end
  if not carry.offered[entry.name] then
    local n = 0
    for _ in pairs(carry.offered) do n = n + 1 end
    if n >= SESSION_CARRIERS then return 0 end
  end
  local records = carry.collectOwn()
  if #records == 0 then return 0 end
  local s = store()
  local sent = 0
  for _, record in ipairs(records) do
    local id = record.kind .. ":" .. record.key
    if entry.sent >= SESSION_PER_CARRIER then entry.pauseUntil = now() + PAUSE_SECONDS; entry.sent = 0; break end
    local body = carry.encode(record.data)
    local parts = {}
    for i = 1, #body, CHUNK do parts[#parts + 1] = string.sub(body, i, i + CHUNK - 1) end
    if #parts >= 1 and #parts <= MAX_CHUNKS then
      for i, part in ipairs(parts) do
        send(string.format("R|%s|%s|%d/%d|%s", record.kind, record.key, i, #parts, part), "WHISPER", entry.name)
      end
      -- Kept in the saved variables: a receipt can arrive after this player's /reload.
      if s then s.sentTo[id] = { name = entry.name, at = now() } end
      carry.whispered[entry.name] = now()
      carry.offered[entry.name] = true
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

-- Keeps the store bounded without letting one player push everyone else out: each author keeps at most MAX_PER_AUTHOR records (its oldest
-- go first); when the whole store is over its limit, the author with the most records loses the oldest of them.
local function prune(s)
  local cutoff = now() - KEEP_DAYS * 86400
  local per, total = {}, 0
  for id, record in pairs(s.records) do
    if type(record) ~= "table" or (tonumber(record.got) or 0) < cutoff then s.records[id] = nil
    else
      local author = record.author or "?"
      per[author] = per[author] or {}
      table.insert(per[author], { id = id, got = tonumber(record.got) or 0 })
      total = total + 1
    end
  end
  for _, list in pairs(per) do table.sort(list, function(a, b) return a.got < b.got end) end
  for _, list in pairs(per) do
    while #list > MAX_PER_AUTHOR do s.records[table.remove(list, 1).id] = nil; total = total - 1 end
  end
  while total > MAX_RECORDS do
    local worst
    for _, list in pairs(per) do if #list > 0 and (not worst or #list > #worst) then worst = list end end
    if not worst then break end
    s.records[table.remove(worst, 1).id] = nil
    total = total - 1
  end
  local done, dn = {}, 0
  for id, at in pairs(s.done) do dn = dn + 1; done[#done + 1] = { id = id, at = tonumber(at) or 0 } end
  if dn > DONE_KEEP then
    table.sort(done, function(a, b) return a.at < b.at end)
    for i = 1, dn - DONE_KEEP do s.done[done[i].id] = nil end
  end
  local sentList, sn = {}, 0
  for id, entry in pairs(s.sentTo) do
    if type(entry) ~= "table" or (tonumber(entry.at) or 0) < cutoff then s.sentTo[id] = nil
    else sn = sn + 1; sentList[#sentList + 1] = { id = id, at = tonumber(entry.at) or 0 } end
  end
  if sn > SENT_KEEP then
    table.sort(sentList, function(a, b) return a.at < b.at end)
    for i = 1, sn - SENT_KEEP do s.sentTo[sentList[i].id] = nil end
  end
end

local function assemblyCounts(sender)
  local total, mine = 0, 0
  for slot, assembly in pairs(carry.assemblies) do
    total = total + 1
    if assembly.sender == sender then mine = mine + 1 end
  end
  return total, mine
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
    -- A sender has a few records in flight at once and the whole PC a few more, so one sender cannot fill every slot.
    if total > 1 then
      local all, mine = assemblyCounts(sender)
      if mine >= SENDER_ASSEMBLIES or all >= MAX_ASSEMBLIES then return end
    end
    local hour = carry.received[sender]
    if not hour or now() - hour.at > 3600 then hour = { at = now(), n = 0 }; carry.received[sender] = hour end
    if hour.n >= PER_SENDER_PER_HOUR then return end
    hour.n = hour.n + 1
    assembly = { parts = {}, total = total, at = now(), sender = sender }
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
  s.records[id] = { kind = kind, key = key, author = author, from = author, data = data, at = tonumber(data.at) or now(), got = now() }
  carry.stats.stored = carry.stats.stored + 1
  prune(s)
  if ns.syncNow and ns.syncNow.mark then pcall(ns.syncNow.mark) end
end

-- A carrier's word that a record reached the bot: only from a name this PC handed the record to (remembered across a /reload).
local function onReceiptFrom(sender, id)
  local s = store()
  if not s or type(id) ~= "string" or #id > 150 then return end
  local expected = s.sentTo[id]
  if type(expected) ~= "table" or not sameName(expected.name, sender) then return end
  markDone(s, id)
  s.sentTo[id] = nil
  carry.stats.receipts = carry.stats.receipts + 1
  prune(s)
end

-- An officer's guild-wide switch, said once in guild chat and again at login (like the milestone announcements).
local function onGuildSwitch(sender, off, at)
  local s = store()
  at = tonumber(at)
  if not s or not at then return end
  if not (ns.isOfficerName and ns.isOfficerName(sender)) then return end
  if ns.util and ns.util.tooFarAhead and ns.util.tooFarAhead(at) then return end
  if type(s.guild) == "table" and (tonumber(s.guild.at) or 0) >= at then return end
  s.guild = { off = off == "1", at = at, by = bare(sender) }
  if off == "1" then carry.leaveChannel() end
end

local NEAR = { GUILD = true, PARTY = true, RAID = true, INSTANCE_CHAT = true }

local function onAddonMessage(prefix, text, channel, sender)
  if prefix ~= PREFIX or secret(text) or secret(sender) or secret(channel) then return end
  if type(text) ~= "string" or type(sender) ~= "string" or #text > 255 or sameName(sender, me()) then return end
  local s = store()
  if not s then return end
  local tag = string.sub(text, 1, 2)
  if tag == "GO" then
    local off, at = string.match(text, "^GOFF|(%d)|(%d+)$")
    if off and channel == "GUILD" then onGuildSwitch(sender, off, at) end
    return
  end
  if not carry.enabled() then return end
  local who = bare(sender)
  if tag == "HI" then
    -- A carrier says it is here (guild, group or the shared channel): at most one announcement per sender every few minutes is looked at.
    if channel ~= "WHISPER" and string.match(text, "^HI|%d+$") then
      local last = carry.hiAt[who]
      if last and now() - last < HI_GAP then return end
      carry.hiAt[who] = now()
      local entry = noteCarrier(who, NEAR[channel] == true)
      if entry then carry.offerTo(entry) end
    end
  elseif channel == "WHISPER" then
    local kind, key, index, total, part = string.match(text, "^R|(%a+)|([^|]+)|(%d+)/(%d+)|(.*)$")
    if kind then onRecordPart(who, kind, key, tonumber(index), tonumber(total), part); return end
    local id = string.match(text, "^K|([^|]+)$")
    if id then onReceiptFrom(who, id) end
  end
end

-- ---- receipts (written by the companion) -----------------------------------------------------------------------------------------------

-- Reads Carry.lua: records the bot holds are no longer carried, here or for the player who whispered them. The global is only replaced when
-- the game loads the file, so this is cheap to repeat; it runs at login and on every tick.
function carry.applyReceipts()
  local s = store()
  if not s or type(GuildedCarryReceipts) ~= "table" then return 0 end
  local n = 0
  for _, id in ipairs(GuildedCarryReceipts) do
    if type(id) == "string" and #id <= 150 and not s.done[id] then
      markDone(s, id)
      s.sentTo[id] = nil
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
    elseif type(id) == "string" and s.records[id] then
      s.records[id] = nil
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

-- The channel's number now (the game renumbers channels when the player joins or leaves others), 0 when we are not in it.
local function channelNow()
  if not carry.channelName then return 0 end
  local ok, number = pcall(GetChannelName, carry.channelName)
  local id = ok and tonumber(number) or 0
  carry.channelId = id or 0
  return carry.channelId
end

function carry.announce(force)
  if not carry.enabled() or not carry.companionHere() or not quiet() then return end
  if not force and now() - carry.lastAnnounce < ANNOUNCE_MIN_GAP then return end
  carry.lastAnnounce = now()
  local text = "HI|1"
  if IsInGuild and IsInGuild() then send(text, "GUILD") end
  local group = groupChannel()
  if group then send(text, group) end
  local id = channelNow()
  if id > 0 then send(text, "CHANNEL", id) end
end

local function faction()
  local ok, name = pcall(UnitFactionGroup, "player")
  if ok and type(name) == "string" and name ~= "" and not secret(name) then return string.sub(name, 1, 1) end
  return "N"
end

-- Joins the shared channel: never in combat or inside an instance (it waits and tries again), and when the game gives no channel number
-- the join is tried again a few times with a growing pause before the feature settles for guild and group.
function carry.joinChannel()
  if not carry.enabled() or carry.channelJoining then return end
  if channelNow() > 0 then return end
  if not quiet() then after(30, function() carry.joinChannel() end); return end
  local name = CHANNEL_PREFIX .. faction()
  carry.channelName = name
  local ok = pcall(function()
    if JoinTemporaryChannel then return JoinTemporaryChannel(name) end
    if JoinChannelByName then return JoinChannelByName(name) end
    error("no join function")
  end)
  carry.channelJoining = true
  after(4, function()
    carry.channelJoining = false
    if channelNow() > 0 then carry.channelFailed = nil; carry.joinTries = 0; carry.announce(true); return end
    carry.channelFailed = true
    if ok == false then return end -- this client has no join function: nothing to retry
    carry.joinTries = carry.joinTries + 1
    local wait = JOIN_RETRY[carry.joinTries]
    if wait then after(wait, function() carry.joinChannel() end) end
  end)
end

function carry.leaveChannel()
  if not carry.channelName then carry.channelId = 0; return end
  if not quiet() then after(30, function() if not carry.enabled() then carry.leaveChannel() end end); return end
  pcall(function() if LeaveChannelByName then LeaveChannelByName(carry.channelName) end end)
  carry.channelId = 0
end

-- The game's own lines about our channel and our whispers are not for the player: the "joined" and "left" notices of the shared channel and the
-- "no player named" answer to a whisper this module just sent (which also counts against that carrier).
local function installFilters()
  if carry.filtersInstalled or not ChatFrame_AddMessageEventFilter then return end
  carry.filtersInstalled = true
  local function ours(...)
    local channelName = select(4, ...)
    return type(channelName) == "string" and not secret(channelName) and string.find(channelName, CHANNEL_PREFIX, 1, true) ~= nil
  end
  pcall(ChatFrame_AddMessageEventFilter, "CHAT_MSG_CHANNEL_NOTICE", function(_, _, ...) return ours(...) end)
  pcall(ChatFrame_AddMessageEventFilter, "CHAT_MSG_CHANNEL_NOTICE_USER", function(_, _, ...) return ours(...) end)
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
  if guildOff() then return L("Carrying records is turned off for the whole guild by an officer.") end
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

local function setGuildOff(off)
  local s = store()
  if not s or not (ns.isOfficer and ns.isOfficer()) then return false end
  s.guild = { off = off and true or false, at = now(), by = me() }
  if IsInGuild and IsInGuild() then ns.comm.send(PREFIX, string.format("GOFF|%d|%d", off and 1 or 0, s.guild.at), "GUILD") end
  if off then carry.leaveChannel() else carry.joinChannel() end
  return true
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
  elseif choice == "guild" then
    local want = string.lower((args and args[2]) or "")
    if want ~= "on" and want ~= "off" then ns.message("/guilded carry guild on | off"); return end
    if setGuildOff(want == "off") then
      ns.message(want == "off" and L("Carrying records is turned off for the whole guild by an officer.") or L("Carrying records is allowed for the guild again."))
    else ns.message(L("Officer or guild-master rank is required for this command.")) end
    return
  end
  ns.message(carry.statusLine())
  ns.message(string.format(L("Carriers heard: %d. Shared channel: %s. Type /guilded carry off to stop."), carry.carrierCount(),
    carry.channelId > 0 and L("carry channel joined") or (carry.channelFailed and L("carry channel not available, using guild and group") or L("carry channel not joined"))))
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded carry [on | off | guild on | guild off] - records carried for and by players near you")

-- ---- events and timers --------------------------------------------------------------------------------------------------------------------------

local function expire()
  local t = now()
  for slot, assembly in pairs(carry.assemblies) do if t - assembly.at > ASSEMBLY_SECONDS then carry.assemblies[slot] = nil end end
  for name, at in pairs(carry.whispered) do if t - at > 7200 then carry.whispered[name] = nil end end
  for name, entry in pairs(carry.received) do if t - entry.at > 3600 then carry.received[name] = nil end end
  for name, at in pairs(carry.hiAt) do if t - at > HI_GAP * 2 then carry.hiAt[name] = nil end end
  expireCarriers()
end
carry.expire = expire

-- Said once, the first time carrying is active (it is on by default).
local function firstNotice()
  local s = store()
  if not s or s.noticed then return end
  s.noticed = now()
  if ns.message then ns.message(L("Guilded now hands your duel results to a nearby player's companion, and does the same for other players, so they reach Discord without a companion of your own. Type /guilded carry off to stop.")) end
end

local function startup()
  if not carry.enabled() then return end
  installFilters()
  carry.applyReceipts()
  firstNotice()
  -- The channel is joined last, well after the player's own channels, so nothing the player set up moves.
  after(25, function() if carry.enabled() then carry.joinChannel() end end)
  after(40, function() carry.announce(true) end)
  -- An officer's guild-wide switch is repeated at login so members who were offline get it too.
  after(45, function()
    local s = store()
    if s and type(s.guild) == "table" and s.guild.off and ns.isOfficer and ns.isOfficer() and IsInGuild and IsInGuild() then
      ns.comm.send(PREFIX, string.format("GOFF|1|%d", s.guild.at), "GUILD")
    end
  end)
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
    if not pendingAnnounce then
      pendingAnnounce = true
      after(6, function() pendingAnnounce = false; carry.announce() end)
    end
  end
end

if CreateFrame then
  local frame = CreateFrame("Frame")
  for _, event in ipairs({ "PLAYER_LOGIN", "GROUP_ROSTER_UPDATE", "CHAT_MSG_ADDON" }) do
    if compat and compat.registerEvent then compat.registerEvent(frame, event) else frame:RegisterEvent(event) end
  end
  frame:SetScript("OnEvent", function(...)
    local ok, err = pcall(onEvent, ...)
    if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded carry: " .. tostring(err)) end
  end)
end

if C_Timer and C_Timer.NewTicker then
  C_Timer.NewTicker(ANNOUNCE_SECONDS, function()
    if carry.enabled() then
      pcall(carry.applyReceipts); pcall(carry.announce, true); pcall(expire); pcall(carry.offerAll)
      if carry.channelId > 0 and channelNow() == 0 then carry.joinChannel() end
    end
  end)
end
