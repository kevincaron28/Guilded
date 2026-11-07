-- Catch-up between guildmates (9.0, store and forward; docs/ADDON_ONLY_SYNC.md).
--
-- A dungeon run done while nobody with a companion was online, or a guildmate's professions
-- heard only by someone without a companion, used to wait until the author met a companion
-- user. Now any two Guilded addons online together compare what they hold from the last 14
-- days and fill each other's gaps, so the data reaches the bot through whoever overlaps next.
--
-- Two kinds of items, each summed up in a "digest" (count and a 24-bit hash sum):
--   R  finished dungeon runs (key: the run id)               - Dungeon.lua's saved runs
--   P  guildmates' digests (level, class, race, professions) - Core.lua's peerRoster
--      (key: the name, the level and the professions' date, so a newer digest is a new item)
--
-- Messages (prefix GuildedCatch, GUILD only, through ns.comm's "hold-in-instance" lane):
--   DIG|1|<carrier 0/1>|R:<count>:<hash>|P:<count>:<hash>   on login, and /guilded sync peers
--   HAVE|<kind>|<for>|<count>:<hash>|<part>|<parts>|<key>[*],...   one guildmate answers a DIG
--        whose digest differs: the keys it holds ("*" = its bot already has that run)
--   WANT|<kind>|<holder>|<key>,...           the asker requests what it lacks from that holder
--   RUN|<id>|<reporter>|<part>|<parts>|<chunk>   a run, in Dungeon.lua's summary format
--   PEER|<name>|<seenAt>|<class>,<race>,<level>,<spec>|<professionsAt>|<professions>
--   (9.1) two more kinds, summed up as C:<count>:<hash> and A:<count>:<hash> after P in the DIG:
--   C  guildmates' recipe lists, one item per player, profession and the author's stamp (45 days)
--   A  guildmates' attunements, one item per player, attunement and date (45 days)
--   RCP|<name>|<profession>|<stamp>|<part>|<parts>|<keys>   a recipe list (item ids, minus a spell id for enchants)
--   ATT|<name>|<key>|<0/1>|<date>                           an attunement the player reported about themselves
--
-- Bounded: one answer per DIG (a companion user answers a member first and the other way
-- round, everyone else stays quiet once someone answered), at most 8 HAVE parts, 40 wanted keys,
-- 8 items sent per WANT and 8 pushed per round. Every item is checked like a first-hand one:
-- a run only from someone who was in it (named as its reporter), a digest only about a guild
-- member, never a /guilded verify code, never newer than first-hand data, never from the future.
-- Older addons ignore the unknown prefix.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedCatch"
local PROTOCOL = 1
local WINDOW_SECONDS = 14 * 86400
local START_DELAY_SECONDS = 40
local DIGEST_EVERY_SECONDS = 5 * 60
local ANSWER_EVERY_SECONDS = 10 * 60
local MAX_PARTS, MAX_WANT, MAX_SEND, MAX_PUSH = 8, 40, 8, 8
-- (9.1) Recipes and attunements keep for 45 days (they change slowly); a recipe list is big, so
-- only a few travel per round, and none with more than 400 recipes.
local LONG_WINDOW_SECONDS = 45 * 86400
local KIND_SEND = { R = 8, P = 8, C = 2, A = 8 }
local MAX_RECIPE_KEYS, MAX_RECIPE_PARTS = 400, 20
local KINDS = { "R", "P", "C", "A" }
local ISO_PATTERN = "^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%dZ$"
local function isoAt(epoch) return date("!%Y-%m-%dT%H:%M:%SZ", epoch) end
local MODULUS = 16777213 -- 24 bits: hashes and sums stay exact in the 32-bit test harness
local ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"

local catchUp = { pending = {}, quiet = {}, answered = {}, incoming = {}, served = {}, lastDigestAt = nil,
  stats = { relayedIn = 0, relayedOut = 0, rounds = 0 } }
ns.catchUp = catchUp
catchUp.PROTOCOL = PROTOCOL

local function L(text) return ns.L and ns.L(text) or text end
local function now() return (GetServerTime and GetServerTime()) or time() end
local function me() return ns.playerName and ns.playerName() or nil end
local function isCarrier() return ns.relay and ns.relay.isCarrier and ns.relay.isCarrier() or false end
local function guildKey() return ns.currentGuildKey and ns.currentGuildKey() or nil end

local function hashText(text)
  local h = 7
  for i = 1, #text do h = (h * 31 + string.byte(text, i)) % MODULUS end
  return h
end
catchUp.hashText = hashText

-- Four characters from ALPHABET (64^4 > 2^24).
local function keyOf(h)
  local out = {}
  for _ = 1, 4 do
    local digit = h % 64
    table.insert(out, 1, string.sub(ALPHABET, digit + 1, digit + 1))
    h = (h - digit) / 64
  end
  return table.concat(out)
end
catchUp.keyOf = keyOf

local function clean(text, max)
  return string.sub((string.gsub(tostring(text or ""), "[|,%c]", " ")), 1, max or 40)
end

-- ---------------------------------------------------------------------
-- What this client holds
-- ---------------------------------------------------------------------

local function runReporter(run)
  local mine = me()
  if mine and run.players[mine] then return mine end
  local best
  for name in pairs(run.reporters or {}) do
    if run.players[name] and (not best or name < best) then best = name end
  end
  return best
end

-- items[key] = { kind, id, item, synced }; plus count and hash for the digest.
function catchUp.collect(kind)
  local items, count, sum = {}, 0, 0
  local cutoff = now() - WINDOW_SECONDS
  if kind == "R" then
    for id, run in pairs(ns.dungeon and ns.dungeon.savedRuns and ns.dungeon.savedRuns() or {}) do
      if type(run) == "table" and type(run.players) == "table" and run.endedAt and run.endedAt >= cutoff
        and (run.state == "COMPLETED" or run.state == "ABANDONED") and runReporter(run) then
        local h = hashText(tostring(id))
        local key = keyOf(h)
        if not items[key] then
          items[key] = { kind = "R", id = id, item = run, synced = run.synced == true }
          count = count + 1
          sum = (sum + h) % MODULUS
        end
      end
    end
  elseif kind == "P" then
    local d = ns.getDb and ns.getDb()
    local mine = me()
    for name, entry in pairs(d and d.peerRoster or {}) do
      if type(entry) == "table" and type(entry.identity) == "table" and entry.identity.class and name ~= mine
        and tonumber(entry.seenAt) and entry.seenAt >= cutoff then
        local h = hashText(name .. "|" .. tostring(entry.identity.level or 0) .. "|" .. tostring(entry.professionsAt or 0))
        local key = keyOf(h)
        if not items[key] then
          items[key] = { kind = "P", id = name, item = entry }
          count = count + 1
          sum = (sum + h) % MODULUS
        end
      end
    end
  elseif kind == "C" then
    local b = ns.recipes and ns.recipes.book and ns.recipes.book()
    local mine, floor = me(), now() - LONG_WINDOW_SECONDS
    for name, professions in pairs(b and b.people or {}) do
      if name ~= mine and type(professions) == "table" then
        for profession, entry in pairs(professions) do
          if type(profession) == "string" and #profession <= 40 and not string.find(profession, "[|,%c]")
            and type(entry) == "table" and tonumber(entry.v) and entry.v >= floor and type(entry.keys) == "table"
            and #entry.keys > 0 and #entry.keys <= MAX_RECIPE_KEYS then
            local h = hashText(name .. "|" .. profession .. "|" .. tostring(math.floor(entry.v)))
            local key = keyOf(h)
            if not items[key] then
              items[key] = { kind = "C", id = name, profession = profession, item = entry }
              count = count + 1
              sum = (sum + h) % MODULUS
            end
          end
        end
      end
    end
  elseif kind == "A" then
    local d = ns.getDb and ns.getDb()
    local mine, floor = me(), isoAt(now() - LONG_WINDOW_SECONDS)
    for name, list in pairs(d and d.attunements or {}) do
      if name ~= mine and type(list) == "table" then
        for attKey, entry in pairs(list) do
          if type(attKey) == "string" and #attKey <= 60 and not string.find(attKey, "[|%c]") and type(entry) == "table"
            and type(entry.at) == "string" and string.match(entry.at, ISO_PATTERN) and entry.at >= floor then
            local h = hashText(name .. "|" .. attKey .. "|" .. (entry.completed and "1" or "0") .. "|" .. entry.at)
            local key = keyOf(h)
            if not items[key] then
              items[key] = { kind = "A", id = name, attunement = attKey, item = entry }
              count = count + 1
              sum = (sum + h) % MODULUS
            end
          end
        end
      end
    end
  end
  return items, count, sum
end

local function digestOf(kind)
  local _, count, sum = catchUp.collect(kind)
  return count .. ":" .. sum, count
end
catchUp.digestOf = digestOf

-- ---------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------

local function send(text)
  if not (IsInGuild and IsInGuild()) then return false end
  local key = guildKey()
  return ns.comm.send(PREFIX, text, "GUILD", nil, function() return guildKey() == key end, "hold-in-instance")
end

function catchUp.sendDigest(force)
  if not force and catchUp.lastDigestAt and now() - catchUp.lastDigestAt < DIGEST_EVERY_SECONDS then return false end
  catchUp.lastDigestAt = now()
  local runs, peers, recipes, attunements = digestOf("R"), digestOf("P"), digestOf("C"), digestOf("A")
  return send(string.format("DIG|%d|%d|R:%s|P:%s|C:%s|A:%s", PROTOCOL, isCarrier() and 1 or 0, runs, peers, recipes, attunements))
end

local function sendHave(kind, asker)
  local items = catchUp.collect(kind)
  local digest = digestOf(kind)
  local keys = {}
  for key, entry in pairs(items) do table.insert(keys, entry.synced and (key .. "*") or key) end
  table.sort(keys)
  local header = string.format("HAVE|%s|%s|%s|", kind, asker, digest)
  -- Room for "<part>|<parts>|" (at most "8|8|").
  local room = 255 - #header - 4
  local parts, current = {}, {}
  local length = 0
  for _, key in ipairs(keys) do
    if length + #key + 1 > room then
      table.insert(parts, table.concat(current, ","))
      current, length = {}, 0
      if #parts >= MAX_PARTS then break end
    end
    table.insert(current, key)
    length = length + #key + 1
  end
  if #current > 0 and #parts < MAX_PARTS then table.insert(parts, table.concat(current, ",")) end
  if #parts == 0 then parts = { "" } end
  for index, list in ipairs(parts) do send(header .. index .. "|" .. #parts .. "|" .. list) end
end

local function forwardRun(id, run)
  local reporter = runReporter(run)
  if not reporter or not (ns.dungeon and ns.dungeon.serialize) then return false end
  local ok, summary = pcall(ns.dungeon.serialize, run)
  if not ok or type(summary) ~= "string" or summary == "" then return false end
  local header = string.format("RUN|%s|%s|", tostring(id), reporter)
  local size = 255 - #header - 6
  if size < 40 then return false end
  local total = math.ceil(#summary / size)
  if total > 20 then return false end
  for part = 1, total do
    send(header .. part .. "|" .. total .. "|" .. string.sub(summary, (part - 1) * size + 1, part * size))
  end
  return true
end

local function forwardPeer(name, entry)
  local identity = entry.identity
  local professions = string.sub((string.gsub(tostring(entry.professions or ""), "[|%c]", "")), 1, 255)
  local line = string.format("PEER|%s|%d|%s,%s,%d,%s|%d|", name, math.floor(tonumber(entry.seenAt) or 0),
    clean(identity.class, 20), clean(identity.race, 30), math.floor(tonumber(identity.level) or 0), clean(identity.spec, 40),
    math.floor(tonumber(entry.professionsAt) or 0))
  -- Whole "Profession:skill" pairs only.
  while #line + #professions > 255 and professions ~= "" do
    professions = string.match(professions, "^(.*),[^,]*$") or ""
  end
  return send(line .. professions)
end

local function forwardRecipes(name, profession, entry)
  local keys = {}
  for _, key in ipairs(entry.keys) do
    if math.type and math.type(key) == "float" then key = math.floor(key) end
    table.insert(keys, tostring(key))
  end
  local list = table.concat(keys, ",")
  local header = string.format("RCP|%s|%s|%d|", name, profession, math.floor(tonumber(entry.v) or 0))
  local size = 255 - #header - 6
  if size < 40 then return false end
  local total = math.max(1, math.ceil(#list / size))
  if total > MAX_RECIPE_PARTS then return false end
  for part = 1, total do
    send(header .. part .. "|" .. total .. "|" .. string.sub(list, (part - 1) * size + 1, part * size))
  end
  return true
end

local function forwardAttunement(name, attKey, entry)
  return send(string.format("ATT|%s|%s|%d|%s", name, attKey, entry.completed and 1 or 0, entry.at))
end

local function forward(entry)
  local done
  if entry.kind == "R" then done = forwardRun(entry.id, entry.item)
  elseif entry.kind == "C" then done = forwardRecipes(entry.id, entry.profession, entry.item)
  elseif entry.kind == "A" then done = forwardAttunement(entry.id, entry.attunement, entry.item)
  else done = forwardPeer(entry.id, entry.item) end
  if done then catchUp.stats.relayedOut = catchUp.stats.relayedOut + 1 end
  return done
end

-- ---------------------------------------------------------------------
-- Receiving
-- ---------------------------------------------------------------------

local function after(seconds, fn)
  if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) else fn() end
end

local function onDigest(text, sender)
  local protocol, carrier, runs, peers = string.match(text, "^DIG|(%d+)|([01])|R:(%d+:%d+)|P:(%d+:%d+)")
  if not protocol then return end
  -- (9.1) C and A are optional: an older addon's DIG simply lacks them and is not asked about them.
  local theirs = { R = runs, P = peers, C = string.match(text, "|C:(%d+:%d+)"), A = string.match(text, "|A:(%d+:%d+)") }
  for _, kind in ipairs(KINDS) do
    local mine, count = digestOf(kind)
    local slot = kind .. "|" .. sender
    if theirs[kind] and count > 0 and mine ~= theirs[kind] and not catchUp.pending[slot]
      and (not catchUp.answered[slot] or now() - catchUp.answered[slot] >= ANSWER_EVERY_SECONDS) then
      catchUp.pending[slot] = true
      catchUp.quiet[slot] = nil
      -- A companion user answers a member first (the member's data reaches the bot); a member
      -- answers a companion user first (the companion user learns what only members hold).
      local first = (carrier == "1") ~= isCarrier()
      local delay = (first and 1 or 6) + math.random() * 4
      after(delay, function()
        catchUp.pending[slot] = nil
        if catchUp.quiet[slot] then return end
        catchUp.answered[slot] = now()
        sendHave(kind, sender)
      end)
    end
  end
end

local function reconcile(kind, holder, list)
  local theirs = {}
  for key in string.gmatch(list, "[^,]+") do
    local bare, mark = string.match(key, "^([%w%-_][%w%-_][%w%-_][%w%-_])(%*?)$")
    if bare then theirs[bare] = mark == "*" end
  end
  local mine = catchUp.collect(kind)
  local wanted, extra = {}, {}
  for key, synced in pairs(theirs) do
    local held = mine[key]
    if not held then
      if #wanted < MAX_WANT then table.insert(wanted, key) end
    elseif synced and kind == "R" and not held.item.synced and not held.item.syncedVia then
      -- Their bot already stored it: stop replaying it, and let it age out like a synced run.
      held.item.syncedVia = holder
      held.item.syncedViaAt = now()
    end
  end
  for key, entry in pairs(mine) do
    if theirs[key] == nil then table.insert(extra, entry) end
  end
  table.sort(wanted)
  local header = string.format("WANT|%s|%s|", kind, holder)
  while #wanted > 0 and #header + #table.concat(wanted, ",") > 255 do table.remove(wanted) end
  if #wanted > 0 then send(header .. table.concat(wanted, ",")) end
  -- Push what they lack, newest first: everyone online stores it, their companion carries it.
  table.sort(extra, function(a, b)
    local at = function(e)
      if e.kind == "R" then return tonumber(e.item.endedAt) or 0 end
      if e.kind == "C" then return tonumber(e.item.v) or 0 end
      if e.kind == "A" then return tonumber(string.gsub(tostring(e.item.at or ""), "%D", "")) or 0 end
      return tonumber(e.item.seenAt) or 0
    end
    return at(a) > at(b)
  end)
  for index = 1, math.min(math.min(MAX_PUSH, KIND_SEND[kind] or MAX_PUSH), #extra) do forward(extra[index]) end
  catchUp.stats.rounds = catchUp.stats.rounds + 1
  local saved = catchUp.saved()
  if saved then
    saved.lastCatchUpAt = now()
    saved.lastCatchUpWith = holder
  end
end

local function onHave(text, sender)
  local kind, asker, digest, part, total, list = string.match(text, "^HAVE|([RPCA])|([^|]+)|(%d+:%d+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not kind or not part or not total or total < 1 or total > MAX_PARTS or part < 1 or part > total then return end
  asker = ns.normalizeName(asker)
  local slot = kind .. "|" .. tostring(asker)
  -- Someone already answered this guildmate: stay quiet.
  catchUp.quiet[slot] = true
  if asker ~= me() then return end
  local bufferKey = kind .. "|" .. sender
  local buffer = catchUp.incoming[bufferKey]
  if not buffer or buffer.total ~= total or now() - buffer.at > 60 then
    buffer = { total = total, parts = {}, count = 0, at = now() }
    catchUp.incoming[bufferKey] = buffer
  end
  if not buffer.parts[part] then buffer.parts[part] = list; buffer.count = buffer.count + 1 end
  if buffer.count < buffer.total then return end
  catchUp.incoming[bufferKey] = nil
  -- One reconciliation per kind per round: a second answer to the same DIG adds nothing.
  if catchUp.reconciled and catchUp.reconciled[kind] and now() - catchUp.reconciled[kind] < 60 then return end
  catchUp.reconciled = catchUp.reconciled or {}
  catchUp.reconciled[kind] = now()
  -- The same digest means the same items (the answer crossed one of our own changes).
  if digest == digestOf(kind) then return end
  reconcile(kind, sender, table.concat(buffer.parts, ","))
end

local function onWant(text, sender)
  local kind, holder, list = string.match(text, "^WANT|([RPCA])|([^|]+)|(.+)$")
  if not kind or ns.normalizeName(holder) ~= me() then return end
  local slot = kind .. "|" .. sender
  if catchUp.served[slot] and now() - catchUp.served[slot] < 30 then return end
  catchUp.served[slot] = now()
  local mine = catchUp.collect(kind)
  local sent = 0
  for key in string.gmatch(list, "[^,]+") do
    if sent >= (KIND_SEND[kind] or MAX_SEND) then break end
    local entry = mine[key]
    if entry and forward(entry) then sent = sent + 1 end
  end
end

local function stored()
  catchUp.stats.relayedIn = catchUp.stats.relayedIn + 1
end

local function onRun(text, sender)
  local id, reporter, part, total, chunk = string.match(text, "^RUN|([^|]+)|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not id or #id > 120 or not part or not total or total < 1 or total > 20 or part < 1 or part > total then return end
  local count, fromSender = 0, 0
  for key, buffer in pairs(catchUp.incoming) do
    if buffer.run then
      if now() - buffer.at > 60 then catchUp.incoming[key] = nil
      else
        count = count + 1
        if buffer.sender == sender then fromSender = fromSender + 1 end
      end
    end
  end
  local key = "RUN|" .. sender .. "|" .. id
  local buffer = catchUp.incoming[key]
  if buffer and buffer.total ~= total then catchUp.incoming[key] = nil; return end
  if not buffer and (count >= 32 or fromSender >= 8) then return end
  buffer = buffer or { run = true, sender = sender, reporter = reporter, total = total, parts = {}, count = 0, at = now() }
  catchUp.incoming[key] = buffer
  if not buffer.parts[part] then buffer.parts[part] = chunk; buffer.count = buffer.count + 1 end
  if buffer.count < buffer.total then return end
  catchUp.incoming[key] = nil
  if not (ns.dungeon and ns.dungeon.deserialize and ns.dungeon.storeForwarded) then return end
  local ok, run = pcall(ns.dungeon.deserialize, id, table.concat(buffer.parts))
  if not ok or type(run) ~= "table" then return end
  reporter = ns.normalizeName(reporter)
  -- Checked like a first-hand summary: its reporter was in the run, nothing from the future,
  -- nothing older than the catch-up window.
  if not reporter or not run.players or not run.players[reporter] then return end
  if not run.endedAt or run.endedAt < now() - WINDOW_SECONDS or ns.util.tooFarAhead(run.endedAt) or ns.util.tooFarAhead(run.startedAt or 0) then return end
  if ns.dungeon.storeForwarded(run, reporter, sender) then stored() end
end

local function onPeer(text, sender)
  local name, seenAt, class, race, level, spec, professionsAt, professions =
    string.match(text, "^PEER|([^|]+)|(%d+)|([^,|]*),([^,|]*),(%d*),([^|]*)|(%d+)|(.*)$")
  if not name then return end
  name = ns.normalizeName(name)
  seenAt, level, professionsAt = tonumber(seenAt), tonumber(level) or 0, tonumber(professionsAt) or 0
  if not name or name == me() or not seenAt or not string.match(class, "^%u+$") or #class > 20 then return end
  -- Only about guild members, only recent, never from the future.
  if not (ns.isGuildMember and ns.isGuildMember(name)) then return end
  if seenAt < now() - WINDOW_SECONDS or ns.util.tooFarAhead(seenAt) then return end
  local d = ns.getDb and ns.getDb()
  if not d then return end
  d.peerRoster = d.peerRoster or {}
  local previous = d.peerRoster[name]
  if previous and (tonumber(previous.seenAt) or 0) >= seenAt then return end
  local kept = {}
  for profession, skill in string.gmatch(professions or "", "([^:,]+):(%d+)") do
    if #kept < 10 and #profession <= 40 and #skill <= 4 then table.insert(kept, profession .. ":" .. skill) end
  end
  local profText, profAt = table.concat(kept, ","), professionsAt > 0 and professionsAt or nil
  -- Professions never go back to an older list.
  if previous and previous.professionsAt and (not profAt or previous.professionsAt > profAt) then
    profText, profAt = previous.professions, previous.professionsAt
  end
  d.peerRoster[name] = {
    status = "UNKNOWN", missing = 0, minDurability = 100, flags = "",
    professions = profText, professionsComplete = profAt ~= nil, professionsAt = profAt,
    identity = { class = class, race = string.match(race or "", "^%a+$") and string.sub(race, 1, 30) or "",
      level = (level >= 0 and level <= 100) and level or 0, spec = string.sub(spec or "", 1, 40) },
    -- A verify code is only ever kept from the character's own digest.
    verify = previous and not previous.forwarded and previous.verify or nil,
    updatedAt = seenAt, seenAt = seenAt, reportedBy = name,
    forwarded = true, via = sender
  }
  stored()
  if ns.onPeerReadiness then pcall(ns.onPeerReadiness, name) end
end

-- (9.1) A guildmate's recipe list, forwarded: kept like the author's own broadcast (Recipes.lua)
-- would be, marked forwarded, never over a newer or equal list the author reported themselves.
local function onRecipes(text, sender)
  local name, profession, stamp, part, total, chunk = string.match(text, "^RCP|([^|]+)|([^|]+)|(%d+)|(%d+)|(%d+)|(.*)$")
  part, total, stamp = tonumber(part), tonumber(total), tonumber(stamp)
  if not name or not stamp or not part or not total or total < 1 or total > MAX_RECIPE_PARTS or part < 1 or part > total then return end
  if #profession > 40 or string.find(profession, "[,%c]") or not string.match(chunk, "^[%-%d,]*$") then return end
  name = ns.normalizeName(name)
  if not name or name == me() or not (ns.isGuildMember and ns.isGuildMember(name)) then return end
  if stamp < now() - LONG_WINDOW_SECONDS or ns.util.tooFarAhead(stamp) then return end
  local count, fromSender = 0, 0
  for key, buffer in pairs(catchUp.incoming) do
    if buffer.rcp then
      if now() - buffer.at > 60 then catchUp.incoming[key] = nil
      else
        count = count + 1
        if buffer.sender == sender then fromSender = fromSender + 1 end
      end
    end
  end
  local key = "RCP|" .. sender .. "|" .. name .. "|" .. profession .. "|" .. stamp
  local buffer = catchUp.incoming[key]
  if buffer and buffer.total ~= total then catchUp.incoming[key] = nil; return end
  if not buffer and (count >= 16 or fromSender >= 4) then return end
  buffer = buffer or { rcp = true, sender = sender, total = total, parts = {}, count = 0, at = now() }
  catchUp.incoming[key] = buffer
  if not buffer.parts[part] then buffer.parts[part] = chunk; buffer.count = buffer.count + 1 end
  if buffer.count < buffer.total then return end
  catchUp.incoming[key] = nil
  local keys = {}
  for item in string.gmatch(table.concat(buffer.parts, ""), "-?%d+") do
    local number = tonumber(item)
    if number and number ~= 0 then table.insert(keys, number) end
    if #keys > MAX_RECIPE_KEYS then return end
  end
  if #keys == 0 then return end
  local b = ns.recipes and ns.recipes.book and ns.recipes.book()
  if not b then return end
  b.people[name] = b.people[name] or {}
  local current = b.people[name][profession]
  -- Their own report (or any list at least as new) wins; a list someone saved by looking is replaced by a newer one.
  if current and current.v >= stamp then return end
  b.people[name][profession] = { v = stamp, keys = keys, forwarded = true, via = sender }
  if ns.recipes.nameFor then for _, itemKey in ipairs(keys) do pcall(ns.recipes.nameFor, itemKey) end end
  if ns.onRecipesChange then pcall(ns.onRecipesChange) end
  stored()
end

-- (9.1) An attunement a guildmate reported about themselves, forwarded.
local function onAttunement(text, sender)
  local name, attKey, flag, at = string.match(text, "^ATT|([^|]+)|([^|]+)|([01])|(%S+)$")
  if not name or #attKey > 60 or not string.match(at, ISO_PATTERN) then return end
  name = ns.normalizeName(name)
  if not name or name == me() or not (ns.isGuildMember and ns.isGuildMember(name)) then return end
  if at < isoAt(now() - LONG_WINDOW_SECONDS) or at > isoAt(now() + 600) then return end
  local d = ns.getDb and ns.getDb()
  if not d then return end
  attKey = ns.canonicalKey and ns.canonicalKey(attKey) or attKey
  d.attunements = d.attunements or {}
  d.attunements[name] = d.attunements[name] or {}
  local current = d.attunements[name][attKey]
  if type(current) == "table" and type(current.at) == "string" and current.at >= at then return end
  d.attunements[name][attKey] = { completed = flag == "1", at = at, by = name, forwarded = true, via = sender }
  stored()
end

function catchUp.handle(text, sender)
  local kind = string.match(text, "^(%u+)|")
  if kind == "DIG" then onDigest(text, sender)
  elseif kind == "HAVE" then onHave(text, sender)
  elseif kind == "WANT" then onWant(text, sender)
  elseif kind == "RUN" then onRun(text, sender)
  elseif kind == "PEER" then onPeer(text, sender)
  elseif kind == "RCP" then onRecipes(text, sender)
  elseif kind == "ATT" then onAttunement(text, sender) end
end

-- ---------------------------------------------------------------------
-- Stats (/guilded sync stats; the companion's support summary reads GuildedDB.syncStats)
-- ---------------------------------------------------------------------

-- Saved totals for this guild, since `since`.
function catchUp.saved()
  local d = ns.getDb and ns.getDb()
  if not d then return nil end
  if type(d.syncStats) ~= "table" then d.syncStats = { since = now() } end
  return d.syncStats
end

local FIELDS = { "sent", "bytes", "received", "receivedBytes", "held", "relayedIn", "relayedOut", "rounds", "acksSent", "acksHeard" }

-- This session's numbers.
function catchUp.session()
  local totals = ns.comm.totals and ns.comm.totals() or {}
  local dungeonStats = ns.dungeon and ns.dungeon.stats or {}
  return { sent = totals.sent or 0, bytes = totals.bytes or 0, received = totals.received or 0,
    receivedBytes = totals.receivedBytes or 0, held = totals.held or 0, queued = totals.queued or 0,
    relayedIn = catchUp.stats.relayedIn, relayedOut = catchUp.stats.relayedOut, rounds = catchUp.stats.rounds,
    acksSent = dungeonStats.acksSent or 0, acksHeard = dungeonStats.acksHeard or 0 }
end

-- Saved totals plus this session (what was already folded in at the last save is not counted twice).
function catchUp.totals()
  local saved, session = catchUp.saved() or {}, catchUp.session()
  local folded = catchUp.folded or {}
  local out = { since = saved.since, lastCatchUpAt = saved.lastCatchUpAt, lastCatchUpWith = saved.lastCatchUpWith }
  for _, field in ipairs(FIELDS) do
    out[field] = (tonumber(saved[field]) or 0) + (session[field] or 0) - (folded[field] or 0)
  end
  return out, session
end

-- Writes the totals into GuildedDB.syncStats (logout and /reload).
function catchUp.fold()
  local saved = catchUp.saved()
  if not saved then return end
  local totals, session = catchUp.totals()
  for _, field in ipairs(FIELDS) do saved[field] = totals[field] end
  catchUp.folded = session
end

local function kb(bytes)
  if bytes < 1024 then return bytes .. " B" end
  return string.format("%.1f KB", bytes / 1024)
end

function catchUp.statsLines()
  local totals, session = catchUp.totals()
  local lines = {
    string.format(L("Guild sync this session: %d messages sent (%s), %d received (%s), %d held in instances."),
      session.sent, kb(session.bytes), session.received, kb(session.receivedBytes), session.held),
    string.format(L("Relayed: %d items received from guildmates, %d passed on; %d dungeon confirmations heard, %d sent."),
      totals.relayedIn, totals.relayedOut, totals.acksHeard, totals.acksSent),
    string.format(L("Since %s: %d messages sent (%s), %d received (%s)."),
      date("%Y-%m-%d", totals.since or now()), totals.sent, kb(totals.bytes), totals.received, kb(totals.receivedBytes))
  }
  if totals.lastCatchUpAt then
    local shown = ns.displayName and ns.displayName(totals.lastCatchUpWith) or totals.lastCatchUpWith or "?"
    local age = ns.relay and ns.relay.ageText and ns.relay.ageText(now() - totals.lastCatchUpAt) or ""
    table.insert(lines, string.format(L("Last catch-up: %s with %s."), age, shown))
  else
    table.insert(lines, L("No catch-up with a guildmate yet."))
  end
  return lines
end

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local started = false
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_ENTERING_WORLD" then
      if started then return end
      started = true
      ns.comm.register(PREFIX)
      after(START_DELAY_SECONDS, function() pcall(catchUp.sendDigest) end)
    elseif event == "PLAYER_LOGOUT" then
      catchUp.fold()
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if not ns.comm.accept(prefix, text, channel, sender, PREFIX, function(author, delivery)
        return delivery == "GUILD" and ns.comm.authorized(author, "guild")
      end) then return end
      sender = ns.normalizeName(sender)
      if not sender or sender == me() then return end
      catchUp.handle(text, sender)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded catch-up: " .. tostring(err)) end
end)
