-- Officer ledger sync for guilds that use Guilded without Discord (opt-in).
--
-- Every EP/GP entry has a permanent id "<author>-<server time>-<sequence>" and is never edited:
-- a void only marks it. So officers' ledgers merge without conflicts: the guild's ledger is
-- everyone's entries together, and a voided mark wins. Officers who turn this on
-- (/guilded ledgersync on, in-game-only mode) compare what they have and send each other only
-- what is missing:
--
--   SUM|1|<count>|<hash>                            all my entries in two numbers (GUILD)
--   AUTH|1|<part>|<parts>|<author>=<count>.<hash>;...   per author, to an officer whose SUM differs
--   DAYS|1|<author>|<part>|<parts>|<day>=<count>.<hash>;...   per day for one author that differs
--   GET|1|<author>|<day>                            send me your entries of that day
--   E|1|<id>|<player>|<ep>|<gp>|<core>|<type>|<voided 0/1>|<reason>   one entry
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

local started = false
local cache, cacheAt = nil, 0
local lastSum, lastSumAt = nil, 0
local answeredAt = {}
local assemblies = {}
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

-- Collects multi-part lists; returns the whole list once every part has arrived.
local function assemble(key, part, parts, text)
  part, parts = tonumber(part), tonumber(parts)
  if not part or not parts or parts < 1 or parts > 60 or part < 1 or part > parts then return nil end
  local a = assemblies[key]
  if not a or a.parts ~= parts or clock() - a.at > ASSEMBLY_SECONDS then a = { parts = parts, got = 0, items = {}, at = clock() }; assemblies[key] = a end
  if a[part] then return nil end
  a[part] = true
  a.got = a.got + 1
  for k, v in pairs(parseList(text)) do a.items[k] = v end
  if a.got < a.parts then return nil end
  assemblies[key] = nil
  return a.items
end

local function sendSum(force)
  if not active() then return end
  local ix = index()
  local sum = ix.count .. "|" .. ix.hash
  if not force and sum == lastSum and clock() - lastSumAt < SUM_ANYWAY then return end
  lastSum, lastSumAt = sum, clock()
  send("SUM|1|" .. sum, "GUILD")
end

local function sendEntry(id, target)
  local found = index().byId[id]
  if not found then return end
  local e = found.entry
  local reason = string.gsub(tostring(e.reason or ""), "[|%c]", " ")
  local head = table.concat({ "E", "1", e.id, found.name, tostring(e.epAmount or 0), tostring(e.gpAmount or 0), e.coreId or "", tostring(e.type or "ADJUSTMENT"), e.voided and "1" or "0" }, "|") .. "|"
  send(head .. ns.util.truncate(reason, math.max(0, 250 - #head)), "WHISPER", target)
end

local function sendDay(author, day, target)
  local a = index().authors[author]
  local bucket = a and a.days[day]
  for _, id in ipairs(bucket and bucket.ids or {}) do sendEntry(id, target) end
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

-- An officer whose SUM differs from ours: tell them what we have per author.
local function answerSum(sender, count, hash)
  local ix = index()
  if tonumber(count) == ix.count and tonumber(hash) == ix.hash then return end
  if answeredAt[sender] and clock() - answeredAt[sender] < ANSWER_COOLDOWN then return end
  answeredAt[sender] = clock()
  local items = {}
  for author, a in pairs(ix.authors) do items[#items + 1] = author .. "=" .. a.count .. "." .. a.hash end
  table.sort(items)
  sendList("AUTH|1|", items, sender)
  lastExchange = clock()
end

-- Their per-author totals against ours: send our days for every author that differs.
local function compareAuthors(theirs, sender)
  local ix = index()
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
  if kind == "SUM" and channel == "GUILD" then
    local count, hash = string.match(text, "^SUM|1|(%d+)|(%d+)$")
    if count then answerSum(rawSender, count, hash) end
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
  end
end

local function tick()
  if active() then sendSum(false) end
  after(SUM_EVERY, tick)
end

ns.ledgerSync = {
  active = active,
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
    sendSum(true)
    ns.message(L("Ledger sync: asked online officers to compare ledgers."))
    return
  end
  local ix = index()
  local peers = 0
  for _, found in pairs(ix.byId) do if found.entry.fromPeer then peers = peers + 1 end end
  ns.message(string.format(L("Ledger sync is %s: %d entries here, %d of them from other officers."), active() and L("on") or L("off"), ix.count, peers))
  if lastExchange then ns.message(string.format(L("Last exchange %d min ago."), math.floor((clock() - lastExchange) / 60))) end
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
      if prefix ~= PREFIX then return end
      if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or #tostring(text) > 255 then return end
      onMessage(text, channel, sender)
    end
  end)
  if not okay and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Ledger sync: " .. tostring(err)) end
end)
