-- Officer ledger sync for guilds that use Guilded without Discord (opt-in).
--
-- Every EP/GP entry has a permanent id "<author>-<server time>-<sequence>" and is never edited:
-- a void only marks it. So officers' ledgers merge without conflicts: the guild's ledger is
-- everyone's entries together, and a voided mark wins. Officers who turn this on
-- (/guilded ledgersync on, in-game-only mode) compare what they have and send each other only
-- what is missing:
--
--   SUM|1|<count>|<hash>                            all my entries in two numbers (GUILD, and
--                                                   WHISPER to officers heard this session)
--   AUTH|1|<part>|<parts>|<author>=<count>.<hash>;...   per author, to an officer whose SUM differs
--   DAYS|1|<author>|<part>|<parts>|<day>=<count>.<hash>;...   per day for one author that differs
--   GET|1|<author>|<day>                            send me your entries of that day
--   E|1|<id>|<player>|<ep>|<gp>|<core>|<type>|<voided 0/1>|<reason>   one entry
--   CAP|1|Z1                                        I can unpack batches (WHISPER, before AUTH/DAYS)
--   Z|1|<author>|<day>|<part>|<parts>|<chunk>       a day's entries in one batch, to a Z1 officer:
--                                                   the E fields one per line, zlib, base64
--
-- A client whose game cannot pack text (no C_EncodingUtil) never says CAP, so it only ever gets
-- E messages; older clients ignore CAP.
--
-- Only officers' messages count, only in this guild, only while this client is in in-game-only
-- mode with sync on. Nothing is deleted. An entry that arrives twice is ignored; a received
-- entry counts like one made here (standings, publishing, backups). Only its author can void it.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedLedger"
-- A prime small enough that every step stays exact in 32-bit integer Lua builds too
-- (h * 31 + 255 and the sum of two hashes stay below 2^31).
local MODULUS = 16777213
local MAX_AMOUNT = 100000
local MAX_RECEIVED = 20000
local SUM_EVERY = 300          -- check for local changes this often (seconds)
local SUM_ANYWAY = 900         -- and say SUM at least this often while online
local ANSWER_COOLDOWN = 60     -- one AUTH per officer per minute
local ASSEMBLY_SECONDS = 120
local BATCH_CHUNK = 200
local BATCH_PARTS = 60
local BATCH_TEXT = 400000
local BATCH_LINES = 5000

local started = false
local cache, cacheAt = nil, 0
local lastSum, lastSumAt = nil, 0
local answered = {}
local assemblies = {}
-- The officers who spoke to us this session, by name, with the sender text to whisper back to.
-- A guild-channel SUM does not always arrive (seen in game on 16 October: one officer's GUILD
-- addon messages never reached the other, while its whispers did), so SUM also goes by whisper.
local MAX_DIRECT = 5
local partners = {}
-- Officers who said CAP|1|Z1 this session.
local capable = {}
local received, receivedFrom, noticeScheduled = 0, {}, false
local lastExchange = nil

local function L(text) return ns.L and ns.L(text) or text end
local function db() return ns.getDb and ns.getDb() end
local function clock() return ns.util.serverTime() end
local function after(seconds, fn) if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) end end

local function settings()
  local d = db()
  if not d then return nil end
  d.settings = d.settings or {}
  return d.settings
end

local function enabled()
  local s = settings()
  return s and s.ledgerSync == true or false
end

-- When each officer with sync on was last heard from (kept across reloads, newest 20), so the
-- status can say whether sync is really happening: it needs two such officers online together.
local SEEN_LIMIT = 20
local function heard(sender)
  local s = settings()
  if not s or not sender then return end
  s.ledgerSyncSeen = type(s.ledgerSyncSeen) == "table" and s.ledgerSyncSeen or {}
  local seen = s.ledgerSyncSeen
  seen[sender] = clock()
  local names = {}
  for name in pairs(seen) do names[#names + 1] = name end
  if #names <= SEEN_LIMIT then return end
  table.sort(names, function(a, b) return seen[a] > seen[b] end)
  for i = SEEN_LIMIT + 1, #names do seen[names[i]] = nil end
end

local function ago(seconds)
  seconds = math.max(0, seconds)
  if seconds < 3600 then return string.format(L("%d min"), math.floor(seconds / 60)) end
  if seconds < 172800 then return string.format(L("%d h"), math.floor(seconds / 3600)) end
  return string.format(L("%d d"), math.floor(seconds / 86400))
end

-- Sync runs only for an officer, in this guild, in in-game-only mode, with sync on.
local function active()
  return enabled() and ns.isInGameOnly and ns.isInGameOnly() and ns.isOfficer and ns.isOfficer()
    and IsInGuild and IsInGuild() and true or false
end

local function hashText(text)
  local h = 0
  for i = 1, #text do h = (h * 31 + string.byte(text, i)) % MODULUS end
  return h
end

local function parseId(id)
  local author, at, seq = string.match(tostring(id or ""), "^([^%-|;:=,]+)%-(%d+)%-(%d+)$")
  if not author then return nil end
  return author, tonumber(at), tonumber(seq)
end

-- Remembered per entry table (not saved): an entry changes only when it is voided.
local hashes = setmetatable({}, { __mode = "k" })
local function entryHash(entry)
  local voided = entry.voided and "1" or "0"
  local known = hashes[entry]
  if known and known.voided == voided then return known.h end
  local h = hashText(table.concat({ entry.id, tostring(entry.epAmount or 0), tostring(entry.gpAmount or 0), entry.coreId or "", voided }, "|"))
  hashes[entry] = { voided = voided, h = h }
  return h
end

-- Adds (sign 1) or takes out (sign -1) one entry's hash in the totals, its author and its day.
local function tally(out, entry, h, sign)
  local author, at = parseId(entry.id)
  out.count, out.hash = out.count + sign, (out.hash + sign * h) % MODULUS
  local a = out.authors[author] or { count = 0, hash = 0, days = {} }
  out.authors[author] = a
  a.count, a.hash = a.count + sign, (a.hash + sign * h) % MODULUS
  local day = math.floor(at / 86400)
  local bucket = a.days[day] or { count = 0, hash = 0, ids = {} }
  a.days[day] = bucket
  bucket.count, bucket.hash = bucket.count + sign, (bucket.hash + sign * h) % MODULUS
  if sign > 0 then bucket.ids[#bucket.ids + 1] = entry.id end
end

-- { byId = { id = { name, entry } }, count, hash, authors = { author = { count, hash, days = { day = { count, hash, ids } } } } }
local function index()
  if cache and clock() - cacheAt < 10 then return cache end
  local out = { byId = {}, count = 0, hash = 0, authors = {} }
  local d = db()
  for name, account in pairs(d and d.epgp or {}) do
    for _, entry in ipairs(account.ledger or {}) do
      if parseId(entry.id) and not out.byId[entry.id] then
        out.byId[entry.id] = { name = name, entry = entry }
        tally(out, entry, entryHash(entry), 1)
      end
    end
  end
  cache, cacheAt = out, clock()
  return out
end

local function send(text, channel, target) ns.comm.send(PREFIX, text, channel, target) end

-- Sends "<key>=<count>.<hash>" items in as few messages as fit, each "<head><part>|<parts>|<items>".
local function sendList(head, items, target)
  local chunks, current = {}, ""
  for _, item in ipairs(items) do
    if current ~= "" and #head + 12 + #current + 1 + #item > 250 then chunks[#chunks + 1] = current; current = "" end
    current = current == "" and item or (current .. ";" .. item)
  end
  chunks[#chunks + 1] = current
  for part, chunk in ipairs(chunks) do send(head .. part .. "|" .. #chunks .. "|" .. chunk, "WHISPER", target) end
end

local function parseList(text)
  local list = {}
  for key, count, hash in string.gmatch(text or "", "([^;=]+)=(%d+)%.(%d+)") do list[key] = { count = tonumber(count), hash = tonumber(hash) } end
  return list
end

-- Collects multi-part lists; returns the whole list once every part has arrived (with `raw`,
-- the parts' text joined in order instead).
local function assemble(key, part, parts, text, raw)
  part, parts = tonumber(part), tonumber(parts)
  if not part or not parts or parts < 1 or parts > BATCH_PARTS or part < 1 or part > parts then return nil end
  local a = assemblies[key]
  if not a or a.parts ~= parts or clock() - a.at > ASSEMBLY_SECONDS then a = { parts = parts, got = 0, items = {}, chunks = {}, at = clock() }; assemblies[key] = a end
  if a[part] then return nil end
  a[part] = true
  a.got = a.got + 1
  if raw then a.chunks[part] = text else for k, v in pairs(parseList(text)) do a.items[k] = v end end
  if a.got < a.parts then return nil end
  assemblies[key] = nil
  return raw and table.concat(a.chunks) or a.items
end

-- The game's text packing (C_EncodingUtil), or nil where this client has none.
local function packer()
  local E = C_EncodingUtil
  if not (E and E.CompressString and E.DecompressString and E.EncodeBase64 and E.DecodeBase64) then return nil end
  return E, Enum and Enum.CompressionMethod and Enum.CompressionMethod.Zlib
end

local function announceCapability(target)
  if packer() then send("CAP|1|Z1", "WHISPER", target) end
end

local function sendSum(force)
  if not active() then return end
  local ix = index()
  local sum = ix.count .. "|" .. ix.hash
  if not force and sum == lastSum and clock() - lastSumAt < SUM_ANYWAY then return end
  lastSum, lastSumAt = sum, clock()
  send("SUM|1|" .. sum, "GUILD")
  local names = {}
  for name in pairs(partners) do names[#names + 1] = name end
  table.sort(names, function(a, b) return partners[a].at > partners[b].at end)
  for i = 1, math.min(#names, MAX_DIRECT) do send("SUM|1|" .. sum, "WHISPER", partners[names[i]].address) end
end

local function entryMessage(id)
  local found = index().byId[id]
  if not found then return nil end
  local e = found.entry
  local reason = string.gsub(tostring(e.reason or ""), "[|%c]", " ")
  local head = table.concat({ "E", "1", e.id, found.name, tostring(e.epAmount or 0), tostring(e.gpAmount or 0), e.coreId or "", tostring(e.type or "ADJUSTMENT"), e.voided and "1" or "0" }, "|") .. "|"
  return head .. ns.util.truncate(reason, math.max(0, 250 - #head))
end

local function sendEntry(id, target)
  local message = entryMessage(id)
  if message then send(message, "WHISPER", target) end
end

-- A day of entries as one compressed batch, to an officer who said Z1. False when it cannot go
-- that way (then each entry goes as its own E message).
local function sendBatch(author, day, ids, target)
  local E, method = packer()
  local who = ns.normalizeName(target)
  if not (E and who and capable[who]) then return false end
  local lines = {}
  for _, id in ipairs(ids) do
    local message = entryMessage(id)
    if message then lines[#lines + 1] = string.sub(message, 5) end
  end
  local ok, packed = pcall(E.CompressString, table.concat(lines, "\n"), method)
  if not ok or type(packed) ~= "string" then return false end
  local encoded
  ok, encoded = pcall(E.EncodeBase64, packed)
  if not ok or type(encoded) ~= "string" then return false end
  local parts = math.ceil(#encoded / BATCH_CHUNK)
  local head = "Z|1|" .. author .. "|" .. day .. "|"
  if parts < 1 or parts > BATCH_PARTS or #head + 6 + BATCH_CHUNK > 255 then return false end
  for part = 1, parts do
    send(head .. part .. "|" .. parts .. "|" .. string.sub(encoded, (part - 1) * BATCH_CHUNK + 1, part * BATCH_CHUNK), "WHISPER", target)
  end
  return true
end

local function sendDay(author, day, target)
  local a = index().authors[author]
  local bucket = a and a.days[day]
  local ids = bucket and bucket.ids or {}
  if #ids > 1 and sendBatch(author, day, ids, target) then return end
  for _, id in ipairs(ids) do sendEntry(id, target) end
end

local function sendDays(author, target)
  local a = index().authors[author]
  local items = {}
  for day, bucket in pairs(a and a.days or {}) do items[#items + 1] = day .. "=" .. bucket.count .. "." .. bucket.hash end
  table.sort(items)
  sendList("DAYS|1|" .. author .. "|", items, target)
end

local function noticeLater()
  if noticeScheduled then return end
  noticeScheduled = true
  local function notice()
    noticeScheduled = false
    if received == 0 then return end
    local names = {}
    for name in pairs(receivedFrom) do names[#names + 1] = name end
    table.sort(names)
    ns.message(string.format(L("Ledger sync: %d EP/GP entries received from %s."), received, table.concat(names, ", ")))
    received, receivedFrom = 0, {}
    if ns.onLootChange then pcall(ns.onLootChange) end
  end
  if C_Timer and C_Timer.After then C_Timer.After(5, notice) else notice() end
end

local totalReceived = 0
local function receiveEntry(fields, sender)
  local id, player, ep, gp, core, kind, voided, reason = unpack(fields)
  local author, at = parseId(id)
  local name = ns.normalizeName(player)
  ep, gp = tonumber(ep), tonumber(gp)
  if not author or not name or not ep or not gp or (ep == 0 and gp == 0) then return end
  if ep ~= math.floor(ep) or gp ~= math.floor(gp) or (voided ~= "0" and voided ~= "1") then return end
  if math.abs(ep) > MAX_AMOUNT or math.abs(gp) > MAX_AMOUNT or ns.util.tooFarAhead(at) then return end
  local d = db()
  if not d then return end
  d.epgp = d.epgp or {}
  local coreId = core ~= "" and core or nil
  local known = index().byId[id]
  if known then
    -- The same entry: only a void can be news. The author voided it on their PC.
    local entry = known.entry
    if voided == "1" and not entry.voided then
      local before = entryHash(entry)
      entry.wasCounted = not entry.pending
      entry.voided, entry.voidedBy, entry.pending = ns.now and ns.now() or date("!%Y-%m-%dT%H:%M:%SZ"), author, nil
      if not entry.coreId then
        local balance = d.epgp[known.name]
        balance.ep = (balance.ep or 0) - (entry.epAmount or 0)
        balance.gp = (balance.gp or 0) - (entry.gpAmount or 0)
      end
      if cache then
        tally(cache, entry, before, -1)
        local bucket = cache.authors[author].days[math.floor(at / 86400)]
        for i = #bucket.ids, 1, -1 do if bucket.ids[i] == id then table.remove(bucket.ids, i) end end
        tally(cache, entry, entryHash(entry), 1)
      end
      received, receivedFrom[sender] = received + 1, true
      noticeLater()
    end
    return
  end
  if totalReceived >= MAX_RECEIVED then return end
  totalReceived = totalReceived + 1
  d.epgp[name] = d.epgp[name] or { ep = 0, gp = 0, ledger = {} }
  local balance = d.epgp[name]
  balance.ledger = balance.ledger or {}
  local isVoided = voided == "1"
  local entry = {
    id = id, pending = not isVoided or nil, coreId = coreId, epAmount = ep, gpAmount = gp, type = kind ~= "" and kind or "ADJUSTMENT",
    reason = reason ~= "" and reason or "Ledger sync", at = date("!%Y-%m-%dT%H:%M:%SZ", at), by = author, fromPeer = sender,
    voided = isVoided and date("!%Y-%m-%dT%H:%M:%SZ", at) or nil, voidedBy = isVoided and author or nil, wasCounted = isVoided and false or nil
  }
  table.insert(balance.ledger, entry)
  if not isVoided and not coreId then
    balance.ep = (balance.ep or 0) + ep
    balance.gp = (balance.gp or 0) + gp
  end
  if cache then
    cache.byId[id] = { name = name, entry = entry }
    tally(cache, entry, entryHash(entry), 1)
  end
  if ns.syncNow and ns.syncNow.mark then ns.syncNow.mark() end
  received, receivedFrom[sender] = received + 1, true
  noticeLater()
end

-- A whole Z batch: each line is one entry's E fields, checked exactly like an E message.
local function receiveBatch(encoded, sender)
  local E, method = packer()
  if not E then return end
  local ok, packed = pcall(E.DecodeBase64, encoded)
  if not ok or type(packed) ~= "string" then return end
  local text
  ok, text = pcall(E.DecompressString, packed, method)
  if not ok or type(text) ~= "string" or #text > BATCH_TEXT then return end
  local lines = 0
  for line in string.gmatch(text, "[^\n]+") do
    lines = lines + 1
    if lines > BATCH_LINES then return end
    local fields = {}
    for field in string.gmatch(line .. "|", "([^|]*)|") do fields[#fields + 1] = field end
    if #fields >= 8 then receiveEntry(fields, sender) end
  end
end

-- An officer whose SUM differs from ours: tell them what we have per author.
local function answerSum(sender, count, hash)
  local ix = index()
  if tonumber(count) == ix.count and tonumber(hash) == ix.hash then return end
  -- The same SUM again (it comes by guild and by whisper) waits; a changed ledger is news.
  local theirs = count .. "|" .. hash
  local last = answered[sender]
  if last and last.sum == theirs and clock() - last.at < ANSWER_COOLDOWN then return end
  answered[sender] = { at = clock(), sum = theirs }
  local items = {}
  for author, a in pairs(ix.authors) do items[#items + 1] = author .. "=" .. a.count .. "." .. a.hash end
  table.sort(items)
  announceCapability(sender)
  sendList("AUTH|1|", items, sender)
  lastExchange = clock()
end

-- Their per-author totals against ours: send our days for every author that differs.
local function compareAuthors(theirs, sender)
  local ix = index()
  announceCapability(sender)
  for author, a in pairs(ix.authors) do
    local t = theirs[author]
    if not t or t.count ~= a.count or t.hash ~= a.hash then sendDays(author, sender) end
  end
  for author in pairs(theirs) do
    -- They have entries from an author we have none of: an empty day list asks for all of them.
    if not ix.authors[author] then send("DAYS|1|" .. author .. "|1|1|", "WHISPER", sender) end
  end
  lastExchange = clock()
end

-- Their days for one author against ours: ask for theirs, send ours, where they differ.
local function compareDays(author, theirs, sender)
  local a = index().authors[author]
  local mine = a and a.days or {}
  for day, t in pairs(theirs) do
    local m = mine[tonumber(day)]
    if not m or m.count ~= t.count or m.hash ~= t.hash then send("GET|1|" .. author .. "|" .. day, "WHISPER", sender) end
  end
  for day, m in pairs(mine) do
    local t = theirs[tostring(day)]
    if not t or t.count ~= m.count or t.hash ~= m.hash then sendDay(author, day, sender) end
  end
  lastExchange = clock()
end

local function onMessage(text, channel, rawSender)
  if not active() then return end
  local sender = ns.normalizeName(rawSender)
  if not sender or sender == ns.playerName() or not ns.isOfficerName(sender) then return end
  if channel ~= "GUILD" and channel ~= "WHISPER" then return end
  local kind = string.match(text, "^(%u+)|1|")
  if kind then
    heard(sender)
    partners[sender] = { at = clock(), address = rawSender }
  end
  if kind == "SUM" then
    local count, hash = string.match(text, "^SUM|1|(%d+)|(%d+)$")
    if count then
      -- Whether this officer's ledger matched ours when last compared (status and Home).
      local s, ix = settings(), index()
      if s then
        s.ledgerSyncMatch = type(s.ledgerSyncMatch) == "table" and s.ledgerSyncMatch or {}
        s.ledgerSyncMatch[sender] = tonumber(count) == ix.count and tonumber(hash) == ix.hash
      end
      answerSum(rawSender, count, hash)
    end
  elseif kind == "AUTH" and channel == "WHISPER" then
    local part, parts, list = string.match(text, "^AUTH|1|(%d+)|(%d+)|(.*)$")
    local whole = part and assemble("A:" .. sender, part, parts, list)
    if whole then compareAuthors(whole, rawSender) end
  elseif kind == "DAYS" and channel == "WHISPER" then
    local author, part, parts, list = string.match(text, "^DAYS|1|([^|]+)|(%d+)|(%d+)|(.*)$")
    local whole = author and assemble("D:" .. sender .. ":" .. author, part, parts, list)
    if whole then compareDays(author, whole, rawSender) end
  elseif kind == "GET" and channel == "WHISPER" then
    local author, day = string.match(text, "^GET|1|([^|]+)|(%d+)$")
    if author then sendDay(author, tonumber(day), rawSender) end
  elseif kind == "E" and channel == "WHISPER" then
    local fields = {}
    for field in string.gmatch(string.sub(text, 5) .. "|", "([^|]*)|") do fields[#fields + 1] = field end
    if #fields >= 8 then receiveEntry(fields, sender) end
  elseif kind == "CAP" then
    local list = string.match(text, "^CAP|1|(.*)$") or ""
    capable[sender] = string.find("," .. list .. ",", ",Z1,", 1, true) and true or nil
  elseif kind == "Z" and channel == "WHISPER" then
    local author, day, part, parts, chunk = string.match(text, "^Z|1|([^|]+)|(%d+)|(%d+)|(%d+)|(.*)$")
    local whole = author and assemble("Z:" .. sender .. ":" .. author .. ":" .. day, part, parts, chunk, true)
    if whole then receiveBatch(whole, sender) end
  end
end

local function tick()
  if active() then sendSum(false) end
  after(SUM_EVERY, tick)
end

-- Officers whose ledger differed from ours at the last comparison (Home shows them).
local function waiting()
  local s = settings()
  local out = {}
  for name, matched in pairs(s and type(s.ledgerSyncMatch) == "table" and s.ledgerSyncMatch or {}) do
    if matched == false then out[#out + 1] = name end
  end
  table.sort(out)
  return out
end

ns.ledgerSync = {
  active = active,
  waiting = waiting,
  summary = function() local ix = index(); return ix.count, ix.hash end,
  sendSum = sendSum
}

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["ledgersync"] = function(args)
  local action = string.lower(args[1] or "status")
  if action == "on" or action == "off" then
    if not (ns.isOfficer and ns.isOfficer()) then ns.message(L("Only an officer can change ledger sync.")); return end
    if action == "on" and not (ns.isInGameOnly and ns.isInGameOnly()) then
      ns.message(L("Ledger sync is for in-game-only guilds. Choose In-game only with /guilded setup first.")); return
    end
    local s = settings()
    if not s then return end
    s.ledgerSync = action == "on"
    if action == "on" then
      ns.message(L("Ledger sync is on. Officers who turn it on share EP/GP entries in game; nothing is deleted."))
      sendSum(true)
    else
      ns.message(L("Ledger sync is off. Entries already received stay."))
    end
    return
  end
  if action == "now" then
    if not active() then ns.message(L("Ledger sync is off. An officer turns it on with /guilded ledgersync on.")); return end
    cache = nil -- Include awards/voids made since the last cached summary.
    sendSum(true)
    ns.message(L("Ledger sync: asked online officers to compare ledgers."))
    return
  end
  local ix = index()
  local peers = 0
  for _, found in pairs(ix.byId) do if found.entry.fromPeer then peers = peers + 1 end end
  ns.message(string.format(L("Ledger sync is %s: %d entries here, %d of them from other officers."), active() and L("on") or L("off"), ix.count, peers))
  if lastExchange then ns.message(string.format(L("Last exchange %d min ago."), math.floor((clock() - lastExchange) / 60))) end
  local s = settings()
  local seen = s and type(s.ledgerSyncSeen) == "table" and s.ledgerSyncSeen or {}
  local names = {}
  for name in pairs(seen) do names[#names + 1] = name end
  table.sort(names, function(a, b) return seen[a] > seen[b] end)
  if #names == 0 then
    ns.message(L("No other officer with ledger sync on has been seen yet. Sync needs two officers online at the same time."))
    return
  end
  local match = s and type(s.ledgerSyncMatch) == "table" and s.ledgerSyncMatch or {}
  for i = 1, math.min(#names, 5) do
    local state = match[names[i]] == true and L(" Ledgers matched.") or match[names[i]] == false and L(" Ledgers differed: entries merge while you are both online.") or ""
    ns.message(string.format(L("%s: last heard %s ago."), names[i], ago(clock() - seen[names[i]])) .. state)
  end
  if clock() - seen[names[1]] > 7 * 86400 then
    ns.message(L("Over a week without another officer: entries sync only when two officers with sync on are online together."))
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded ledgersync on | off | now | status - in-game-only guilds: officers share EP/GP entries with each other" })

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, ...)
  local eventArgs = { ... }
  local okay, err = pcall(function()
    if event == "PLAYER_ENTERING_WORLD" then
      if started then return end
      started = true
      ns.comm.register(PREFIX)
      -- After the guild roster (officer ranks) is known; spread out so officers do not all speak at once.
      after(40 + math.random() * 20, function() sendSum(true) end)
      after(SUM_EVERY, tick)
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = unpack(eventArgs)
      if not ns.comm.accept(prefix, text, channel, sender, PREFIX) then return end
      if prefix ~= PREFIX then return end
      if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or #tostring(text) > 255 then return end
      onMessage(text, channel, sender)
    end
  end)
  if not okay and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Ledger sync: " .. tostring(err)) end
end)
