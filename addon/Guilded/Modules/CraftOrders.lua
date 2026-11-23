-- Crafting orders (docs/plans/CRAFTING_ORDERS.md): the guild's craft requests on the Crafting page of the
-- Guilded window. Search an item, press Request; crafters claim and finish in game.
--
--   Discord -> game  The companion writes GuildedOrders (open, claimed, and done in the last day) next to
--                    the standings. A member whose copy came from the companion shares it with the guild
--                    (GuildedOrd addon messages), so members without the companion see the orders too.
--   game -> Discord  Claim, Done and Give back are saved in db.craftOrders.actions and uploaded by your
--                    companion; the bot applies them like the Discord buttons, updates the forum post and
--                    DMs the requester. They are also said on GUILD, so a guildmate's companion carries
--                    them for crafters without one.
--   Requests (9.2)   Search an item on the Crafting page and press Request: it is saved in db.craftOrders.requests,
--                    said once on GUILD (NEW|...: crafters who can make it see it at once) and uploaded by your
--                    companion; the bot creates the Discord request. Guildmates' companions also carry it
--                    (db.craftOrders.heardRequests). Cancel is an action like Claim and Done. The feed's `ref`
--                    ties the in-game row to the real order once Discord has it.
--
-- The page shows the orders whose recipe this character knows (from the profession scan, Recipes.lua),
-- with the reagents and what is in your bags; "Show all" lists the rest. On by default: officers turn
-- it off with /config craft orders in Discord; each member turns off the login line with the Order
-- alerts button or /guilded orders alerts off. Plain Guilded frames only: safe in combat.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedOrd"
local PART = 190
local MAX_PARTS = 80
local MAX_ORDERS = 500
local COOLDOWN = 60
local KEEP = 3 * 86400
local MAX_HEARD = 200

local orders = {}
ns.craftOrders = orders

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function fold(text) return string.lower(tostring(text or "")) end
-- Cut on a UTF-8 character boundary (accented item names), and make free text safe: no control characters or bars.
local function cut(text, max)
  text = tostring(text or "")
  if ns.util and ns.util.truncate then return ns.util.truncate(text, max) end
  return string.sub(text, 1, max)
end
local function cleanText(text, max)
  local plain = (string.gsub(tostring(text or ""), "[|%c]", " "))
  return cut(string.match(plain, "^%s*(.-)%s*$") or "", max)
end
local SETTLE_AFTER = 6 * 3600   -- a request the feed never showed is settled once a feed this much newer still lacks it
local ALERT_GAP = 30            -- seconds between two chat alerts for the same sender
local PER_SENDER = 5            -- heard requests kept per sender

-- A profession as the one English name every client agrees on (Util.lua): a French "Cuisine" is "Cooking".
local function canonProfession(text)
  if type(text) ~= "string" or text == "" then return text end
  return ns.util and ns.util.professionName and ns.util.professionName(text) or text
end

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.craftOrders = type(db.craftOrders) == "table" and db.craftOrders or {}
  local s = db.craftOrders
  s.actions = type(s.actions) == "table" and s.actions or {}
  s.heard = type(s.heard) == "table" and s.heard or {}
  s.requests = type(s.requests) == "table" and s.requests or {}
  s.heardRequests = type(s.heardRequests) == "table" and s.heardRequests or {}
  s.favourites = type(s.favourites) == "table" and s.favourites or {}   -- starred recipes, kept on this PC: { { id, key, name, prof } }
  s.recent = type(s.recent) == "table" and s.recent or {}               -- the last 10 searched or requested, newest first
  s.received = type(s.received) == "table" and s.received or {}   -- [order id] = when the requester pressed Mark received
  return s
end

-- The name this character signs its actions with: the full Forever name when known.
function orders.myName()
  local me = ns.playerName and ns.playerName()
  if not me then return nil end
  return ns.displayName and ns.displayName(me) or me
end

local function isMe(name)
  if type(name) ~= "string" or name == "" then return false end
  local me = ns.playerName and ns.playerName()
  if not me then return false end
  local wanted = fold(name)
  local short = string.match(me, "^([^%-]+)") or me
  return wanted == fold(me) or wanted == fold(short) or wanted == fold(orders.myName())
end

-- ---------------------------------------------------------------------
-- What to show: the companion's copy, or a guildmate's when that one is newer.
-- ---------------------------------------------------------------------
local function fromCompanion()
  local file = rawget(_G, "GuildedOrders")
  if type(file) ~= "table" or type(file.at) ~= "string" then return nil end
  return file
end

function orders.current()
  local file, s = fromCompanion(), state()
  local relayed = s and type(s.relayed) == "table" and type(s.relayed.at) == "string" and s.relayed or nil
  if file and (not relayed or file.at >= relayed.at) then
    return { at = file.at, off = file.off == true, orders = type(file.orders) == "table" and file.orders or {}, source = "companion" }
  end
  if relayed then
    return { at = relayed.at, off = relayed.off == true, orders = relayed.orders or {}, source = "guild", from = relayed.from }
  end
  return nil
end

local function findOrder(id)
  local current = orders.current()
  for _, order in ipairs(current and current.orders or {}) do
    if order.id == id then return order, current end
  end
  return nil, current
end

-- This character's recipes: [key] = profession (Recipes.lua's book, keyed by item id or minus a spell id).
function orders.myRecipes()
  local book = ns.recipes and ns.recipes.book and ns.recipes.book()
  local me = ns.playerName and ns.playerName()
  local known = {}
  for profession, entry in pairs(book and me and book.people[me] or {}) do
    for _, key in ipairs(type(entry) == "table" and entry.keys or {}) do known[key] = profession end
  end
  return known
end

-- A waiting action counts as done once the orders show it (or show the order taken by someone else).
local function reflected(action, order)
  if not order then return true end
  if action.action == "claim" then return order.status ~= "OPEN" end
  if action.action == "done" then return order.status == "DONE" or (order.status == "CLAIMED" and order.character ~= "" and order.character ~= nil and not isMe(order.character)) end
  if action.action == "release" then return order.status ~= "CLAIMED" or not isMe(order.character) end
  if action.action == "cancel" then return order.status ~= "OPEN" and order.status ~= "CLAIMED" end
  return true
end

function orders.prune()
  local s = state()
  if not s then return end
  local current, now = orders.current(), clock()
  for id, action in pairs(s.actions) do
    local order = findOrder(id)
    if type(action) ~= "table" or now - (tonumber(action.at) or 0) > KEEP
      or (current and current.source == "companion" and reflected(action, order))
      or (current and not order and type(action.ordersAt) == "string" and current.at > action.ordersAt) then
      s.actions[id] = nil
    end
  end
  local count = 0
  for key, action in pairs(s.heard) do
    if type(action) ~= "table" or now - (tonumber(action.at) or 0) > KEEP then s.heard[key] = nil else count = count + 1 end
  end
  -- Requests made in game: kept for the companion for three days (the bot keeps the order itself). A request whose
  -- order Discord showed (this player's, by name) and that has left the feed since is finished or cancelled: settled.
  -- One the feed never showed is settled once a feed 6 hours newer than it still lacks it (the upload had its chance).
  local feedRefs = {}
  for _, order in ipairs(current and current.orders or {}) do
    if order.ref and order.ref ~= "" and isMe(order.by) then feedRefs[order.ref] = true end
  end
  local feedAt = current and ns.util and ns.util.isoEpoch and ns.util.isoEpoch(current.at)
  -- Only the companion's own feed proves an upload had its chance; a guildmate's relayed feed may be newer without ever
  -- having heard of this request (and its ORDREFS may not be applied yet), so it settles nothing by absence alone.
  local ownFeed = current and current.source == "companion"
  local feedHasRefs = false
  for _, order in ipairs(current and current.orders or {}) do if order.ref and order.ref ~= "" then feedHasRefs = true; break end end
  for ref, request in pairs(s.requests) do
    if type(request) ~= "table" or now - (tonumber(request.at) or 0) > KEEP then s.requests[ref] = nil
    elseif feedRefs[ref] then
      if not request.seenFeed then request.seenFeed = current.at end
    elseif request.seenFeed and current and current.at >= request.seenFeed and (ownFeed or feedHasRefs) then s.requests[ref] = nil
    elseif ownFeed and feedAt and feedAt > (tonumber(request.at) or 0) + SETTLE_AFTER then s.requests[ref] = nil end
  end
  for id, at in pairs(s.received) do if type(at) ~= "number" or now - at > KEEP then s.received[id] = nil end end
  local heardCount = 0
  for key, request in pairs(s.heardRequests) do
    if type(request) ~= "table" or now - (tonumber(request.at) or 0) > KEEP then s.heardRequests[key] = nil else heardCount = heardCount + 1 end
  end
  while heardCount > 60 do
    local oldestKey, oldestAt
    for key, request in pairs(s.heardRequests) do if not oldestAt or request.at < oldestAt then oldestKey, oldestAt = key, request.at end end
    s.heardRequests[oldestKey] = nil
    heardCount = heardCount - 1
  end
  while count > MAX_HEARD do
    local oldestKey, oldestAt
    for key, action in pairs(s.heard) do if not oldestAt or action.at < oldestAt then oldestKey, oldestAt = key, action.at end end
    s.heard[oldestKey] = nil
    count = count - 1
  end
end

-- The order as this player sees it: their waiting action applied on top of what Discord said.
function orders.view(order)
  local s = state()
  local action = s and s.actions[order.id]
  local status, mine = order.status, isMe(order.character)
  if action then
    if action.action == "claim" then status, mine = "CLAIMED", true
    elseif action.action == "done" then status, mine = "DONE", true
    elseif action.action == "release" then status, mine = "OPEN", false
    elseif action.action == "cancel" then status = "CANCELLED" end
  end
  return { status = status, mine = mine, waiting = action ~= nil }
end

-- An order this player asked for: the requester is this character (a copied ref alone proves nothing).
function orders.isMyRequest(order)
  return isMe(order.by)
end

-- Does a requester name from Discord (order.by) name the sender of a heard request?
local function sameRequester(by, sender)
  local wanted = fold(by)
  if wanted == "" or type(sender) ~= "string" then return false end
  local shown = ns.displayName and ns.displayName(sender) or sender
  return wanted == fold(sender) or wanted == fold(shown) or wanted == fold(string.match(shown, "^(%S+)") or shown)
end

-- Orders for the page: this character's recipes first (orders asked of you on top), then, with `all`, the rest.
function orders.list(all)
  local current = orders.current()
  if not current or current.off then return {} end
  local known, rows = orders.myRecipes(), {}
  for _, order in ipairs(current.orders) do
    local view = orders.view(order)
    local canCraft = order.key and known[order.key] ~= nil or false
    local forMe = isMe(order.asked)
    local open = view.status == "OPEN" or (view.status == "CLAIMED" and view.mine) or (view.status == "DONE" and view.mine and view.waiting)
    if open and (all or canCraft or forMe or view.mine) then
      rows[#rows + 1] = { order = order, view = view, canCraft = canCraft, forMe = forMe }
    end
  end
  table.sort(rows, function(a, b)
    local function rank(row) return (row.view.mine and 0) or (row.forMe and 1) or (row.canCraft and 2) or 3 end
    if rank(a) ~= rank(b) then return rank(a) < rank(b) end
    return (tonumber(a.order.at) or 0) < (tonumber(b.order.at) or 0)
  end)
  return rows
end

-- (9.5.4) How many of an item (by numeric id) you carry: bags, and the bank when the game knows it. GetItemCount was nil for some
-- ids on WoW Forever (the row showed "?/1 Lion Meat"), so a nil answer falls back to counting the bag slots; never nil.
local function bagItemCount(id)
  local container = C_Container
  local slots = (container and container.GetContainerNumSlots) or GetContainerNumSlots
  local itemId = (container and container.GetContainerItemID) or GetContainerItemID
  local info = container and container.GetContainerItemInfo
  if not (slots and itemId) then return 0 end
  local total = 0
  for bag = 0, 4 do
    for slot = 1, (slots(bag) or 0) do
      if itemId(bag, slot) == id then
        local stack = 1
        if info then
          local ok, result = pcall(info, bag, slot)
          if ok and type(result) == "table" then stack = tonumber(result.stackCount) or 1 end
        elseif GetContainerItemInfo then
          local ok, _, count = pcall(GetContainerItemInfo, bag, slot)
          if ok then stack = tonumber(count) or 1 end
        end
        total = total + stack
      end
    end
  end
  return total
end
function orders.haveCount(id)
  id = tonumber(id)
  if not id then return 0 end
  local count
  if GetItemCount then
    local ok, value = pcall(GetItemCount, id, true)
    if ok and type(value) == "number" then count = value end
  end
  if count == nil then count = bagItemCount(id) end
  return count
end

-- Reagents of a recipe you know, times the order's count, with what is in your bags (and bank).
function orders.reagents(order)
  -- (9.5.2) Your own profession scan first, else the reagents shipped with the addon (Data/Reagents.lua).
  local mats = ns.recipes and ns.recipes.matsFor and order.key and ns.recipes.matsFor(order.key)
  if type(mats) ~= "table" then return nil end
  local rows = {}
  for _, mat in ipairs(mats) do
    local need = (tonumber(mat.count) or 1) * math.max(1, tonumber(order.qty) or 1)
    local have = orders.haveCount(mat.id)
    rows[#rows + 1] = { id = mat.id, name = mat.name or ("item " .. tostring(mat.id)), need = need, have = have }
  end
  return rows
end

local function send(text)
  if not (IsInGuild and IsInGuild()) or not ns.comm then return end
  local key = ns.currentGuildKey and ns.currentGuildKey() or nil
  ns.comm.send(PREFIX, text, "GUILD", nil, function() return (ns.currentGuildKey and ns.currentGuildKey() or nil) == key end, "hold-in-instance")
end

local function sayAction(action)
  send(string.format("ACT|%s|%s|%d|%s", action.order, action.action, tonumber(action.at) or 0, (string.gsub(tostring(action.character or ""), "|", ""))))
end

-- Claim, Done or Give back. Returns the saved action, or nil and why.
function orders.act(id, action)
  local order, current = findOrder(id)
  if not order then return nil, L("That order is no longer open.") end
  if current.off then return nil, L("Your officers turned crafting orders off.") end
  local s, me = state(), orders.myName()
  if not s or not me then return nil, L("Guilded is not ready yet.") end
  local view = orders.view(order)
  if action == "claim" then
    if view.status ~= "OPEN" then return nil, L("Someone already took that order.") end
  elseif action == "done" then
    if view.status == "DONE" then return nil, L("That order is already done.") end
    if view.status == "CLAIMED" and not view.mine and order.character and order.character ~= "" then return nil, L("Someone already took that order.") end
  elseif action == "cancel" then
    if not orders.isMyRequest(order) then return nil, L("Only the member who asked can cancel a request.") end
    if view.status ~= "OPEN" and view.status ~= "CLAIMED" then return nil, L("That order is no longer open.") end
  elseif action == "release" then
    if view.status ~= "CLAIMED" or not view.mine then return nil, L("Only the crafter who took an order can give it back.") end
    -- Giving back a claim that never reached Discord: just forget it.
    local waiting = s.actions[id]
    if waiting and waiting.action == "claim" then
      s.actions[id] = nil
      if ns.onOrdersChange then pcall(ns.onOrdersChange) end
      return waiting
    end
  else
    return nil, L("Guilded is not ready yet.")
  end
  local row = { order = id, action = action, character = me, at = clock(), ordersAt = current.at }
  s.actions[id] = row
  sayAction(row)
  if action == "cancel" and order.ref and s.requests[order.ref] then s.requests[order.ref] = nil end   -- cancelled: no longer waiting to be uploaded
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
  return row
end

-- A request that has not reached Discord (as far as this addon knows): taken back, so it is no longer said or uploaded.
-- If Discord got it anyway, its order shows up in the feed and can be cancelled like any other.
function orders.cancelPending(ref)
  local s = state()
  if not (s and type(ref) == "string" and s.requests[ref]) then return false end
  s.requests[ref] = nil
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
  return true
end

-- ---------------------------------------------------------------------
-- Sharing the orders with guildmates and hearing their actions.
-- ---------------------------------------------------------------------
local function encode(value)
  return (string.gsub(tostring(value or ""), "[%%;\r\n|]", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function decode(value)
  return (string.gsub(value, "%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end
local STATUS = { OPEN = "O", CLAIMED = "C", DONE = "D" }
local STATUS_BACK = { O = "OPEN", C = "CLAIMED", D = "DONE" }

-- One line per order: id;key;qty;status;at;mats;item;by;crafter;character;asked;prof;note (notes cut to 80).
function orders.encode(current)
  if current.off then return "X" end
  -- At most MAX_ORDERS and at most MAX_PARTS of text: the newest orders are chosen, and they keep their own order.
  local function lineOf(o)
    return table.concat({ encode(o.id), tonumber(o.key) or 0, tonumber(o.qty) or 1, STATUS[o.status] or "O", tonumber(o.at) or 0, o.mats and 1 or 0,
      encode(o.item), encode(o.by), encode(o.crafter), encode(o.character), encode(o.asked), encode(o.prof), encode(string.sub(tostring(o.note or ""), 1, 80)) }, ";")
  end
  local list = current.orders or {}
  local all, byAge = {}, {}
  for index, o in ipairs(list) do all[index] = lineOf(o); byAge[index] = index end
  table.sort(byAge, function(x, y)
    local ax, ay = tonumber(list[x].at) or 0, tonumber(list[y].at) or 0
    if ax ~= ay then return ax > ay end
    return x < y
  end)
  local chosen, size, count = {}, 0, 0
  for _, index in ipairs(byAge) do
    if count >= MAX_ORDERS or size + #all[index] + 1 > PART * MAX_PARTS then break end
    chosen[index] = true; size = size + #all[index] + 1; count = count + 1
  end
  local lines = {}
  for index = 1, #all do if chosen[index] then lines[#lines + 1] = all[index] end end
  return #lines > 0 and table.concat(lines, "\n") or "E"
end

function orders.decode(text)
  if text == "X" then return { off = true, orders = {} } end
  local result = { orders = {} }
  local bad = 0
  if text == "E" then return result end
  for line in string.gmatch(text .. "\n", "([^\n]*)\n") do
    local id, key, qty, status, at, mats, rest = string.match(line, "^([%w_%-]+);(%-?%d+);(%d+);([OCD]);(%d+);([01]);(.*)$")
    -- A bad line is skipped, never the whole list; the list is capped at MAX_ORDERS.
    if #result.orders >= MAX_ORDERS then break end
    local fields = {}
    if id and #id <= 40 then for field in string.gmatch(rest .. ";", "([^;]*);") do fields[#fields + 1] = decode(field) end end
    if id and #id <= 40 and #fields == 7 then
    key = tonumber(key)
    result.orders[#result.orders + 1] = { id = id, key = key ~= 0 and key or nil, qty = math.max(1, tonumber(qty) or 1), status = STATUS_BACK[status], at = tonumber(at), mats = mats == "1",
      item = string.sub(fields[1], 1, 100), by = string.sub(fields[2], 1, 60), crafter = string.sub(fields[3], 1, 60), character = string.sub(fields[4], 1, 60),
      asked = string.sub(fields[5], 1, 60), prof = canonProfession(string.sub(fields[6], 1, 40)), note = string.sub(fields[7], 1, 80) }
    else bad = bad + 1 end
  end
  -- Text with nothing readable in it is not a list.
  if #result.orders == 0 and bad > 0 then return nil end
  return result
end

local lastShare, heardStamp, heardAt, replyScheduled, incoming = 0, nil, 0, false, nil

function orders.share()
  local current = orders.current()
  if not current or clock() - lastShare < COOLDOWN then return false end
  if heardStamp and heardStamp >= current.at and clock() - heardAt < COOLDOWN then return false end
  local payload = orders.encode(current)
  local total = math.ceil(#payload / PART)
  if total < 1 or total > MAX_PARTS then return false end
  lastShare = clock()
  for part = 1, total do
    send(string.format("ORDERS|%s|%d|%d|%s", current.at, part, total, string.sub(payload, (part - 1) * PART + 1, part * PART)))
  end
  -- The requests' refs ride in a message of their own (the order lines keep the layout older addons decode).
  local line, sentRefs = {}, 0
  local function flush()
    if #line == 0 or sentRefs >= 5 then line = {}; return end
    sentRefs = sentRefs + 1
    send(string.format("ORDREFS|%s|%s", current.at, table.concat(line, ",")))
    line = {}
  end
  for _, o in ipairs(current.orders or {}) do
    if type(o.ref) == "string" and #o.ref >= 6 and #o.ref <= 40 and string.find(o.ref, "^[%w_%-]+$") and string.find(o.id, "^[%w_%-]+$") then
      local pair = o.id .. ":" .. o.ref
      if #table.concat(line, ",") + #pair + 1 > 200 then flush() end
      line[#line + 1] = pair
    end
  end
  flush()
  return true
end

local function scheduleReply()
  if replyScheduled then return end
  replyScheduled = true
  local current = orders.current()
  local quick = (current and current.source == "companion") or (ns.isOfficer and ns.isOfficer())
  local delay = quick and 1 + math.random() * 4 or 6 + math.random() * 9
  local function reply() replyScheduled = false; orders.share() end
  if C_Timer and C_Timer.After then C_Timer.After(delay, reply) else reply() end
end

-- The refs of the shared orders (ORDREFS|stamp|id:ref,...) are put on the orders of that same share.
local function applyRefs(list, map)
  for _, order in ipairs(list or {}) do if map[order.id] then order.ref = map[order.id] end end
end

local function receiveOrders(text, sender)
  local stamp, part, total, payload = string.match(text, "^ORDERS|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not stamp or #stamp > 40 or not part or not total or total < 1 or total > MAX_PARTS or part < 1 or part > total or #payload > PART then return end
  if ns.util and ns.util.tooFarAhead and ns.util.tooFarAhead(stamp) then return end
  if not heardStamp or stamp >= heardStamp or clock() - heardAt >= COOLDOWN then heardStamp, heardAt = stamp, clock() end
  local current = orders.current()
  if current and current.at >= stamp then return end
  if not incoming or incoming.stamp ~= stamp or incoming.sender ~= sender or clock() - incoming.started > 60 then
    incoming = { stamp = stamp, sender = sender, total = total, started = clock(), parts = {}, received = 0 }
  end
  if incoming.total ~= total then return end
  if not incoming.parts[part] then incoming.parts[part] = payload; incoming.received = incoming.received + 1 end
  if incoming.received ~= total then return end
  local whole = table.concat(incoming.parts)
  incoming = nil
  local decoded = orders.decode(whole)
  local s = state()
  if not decoded or not s then return end
  decoded.at, decoded.from = stamp, sender
  s.relayed = decoded
  local waiting = s.refsWaiting
  if type(waiting) == "table" and waiting.stamp == stamp and waiting.sender == sender then applyRefs(decoded.orders, waiting.map) end
  s.refsWaiting = nil
  orders.prune()
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
end

-- ORDREFS|stamp|id:ref,id:ref: put on the orders of that same share, or kept until it arrives.
local function receiveRefs(text, sender)
  local stamp, body = string.match(text, "^ORDREFS|([^|]+)|(.*)$")
  if not stamp or #stamp > 40 or #body > 240 then return end
  local s = state()
  if not s then return end
  local map, count = {}, 0
  for id, ref in string.gmatch(body, "([%w_%-]+):([%w_%-]+)") do
    if #id <= 40 and #ref >= 6 and #ref <= 40 and count < 12 then map[id] = ref; count = count + 1 end
  end
  if count == 0 then return end
  if s.relayed and s.relayed.at == stamp and s.relayed.from == sender then
    applyRefs(s.relayed.orders, map)
  else
    local waiting = s.refsWaiting
    if type(waiting) ~= "table" or waiting.stamp ~= stamp or waiting.sender ~= sender then waiting = { stamp = stamp, sender = sender, map = {} }; s.refsWaiting = waiting end
    for id, ref in pairs(map) do waiting.map[id] = ref end
  end
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
end

-- A guildmate's claim, finish or give-back, as the game reported its sender: kept for this PC's companion to carry.
local function receiveAction(text, sender)
  local id, action, at, character = string.match(text, "^ACT|([%w_%-]+)|(%a+)|(%d+)|(.+)$")
  at = tonumber(at)
  if not id or #id > 40 or not (action == "claim" or action == "done" or action == "release" or action == "cancel") or not at or at > clock() + 600 or clock() - at > KEEP then return end
  if #character > 80 or string.find(character, "[%c|]") then return end
  local s = state()
  if not s then return end
  local key = id .. "@" .. sender
  local old = s.heard[key]
  if old and (tonumber(old.at) or 0) >= at then return end
  s.heard[key] = { order = id, action = action, at = at, character = character, name = sender }
  orders.prune()
end

function orders.request()
  local current = orders.current()
  send("REQ|" .. ((current and current.at) or "0"))
end

-- ---------------------------------------------------------------------
-- Alerts, text for chat, and the page.
-- ---------------------------------------------------------------------
function orders.alertsOn()
  local s = state()
  return not (s and s.alerts == false)
end
function orders.setAlerts(on)
  local s = state()
  if s then s.alerts = on and true or false end
end

-- Once per new order you can make, at login: "2 craft orders you can make...". Off with /guilded orders alerts off.
function orders.loginAlert()
  local s = state()
  if not s then return false end
  local newest, count = tonumber(s.seenAt) or 0, 0
  for _, row in ipairs(orders.list(false)) do
    if row.view.status == "OPEN" and (row.canCraft or row.forMe) then
      count = count + 1
      newest = math.max(newest, tonumber(row.order.at) or 0)
    end
  end
  if count == 0 or newest <= (tonumber(s.seenAt) or 0) then return false end
  s.seenAt = newest
  if not orders.alertsOn() or not ns.message then return false end
  ns.infoMessage(string.format(L("%d craft order(s) from Discord you can make: the Crafting page of the Guilded window (/guilded orders)."), count))
  return true
end

function orders.sourceText(current)
  if not current then return L("No orders from Discord yet. They arrive after your companion syncs, or when a guildmate who has it shares them.") end
  if current.off then return L("Your officers turned crafting orders off (in Discord: /config craft orders).") end
  if current.source == "guild" then return string.format(L("Shared by %s (from Discord)."), ns.displayName and ns.displayName(current.from) or tostring(current.from)) end
  return L("From Discord, through your companion.")
end

local function clip(text, max)
  text = tostring(text or "")
  if #text <= max then return text end
  return string.sub(text, 1, max - 3) .. "..."
end

-- The item's name in its quality colour when the game knows the item.
local function itemText(order)
  local name = tostring(order.item or "?")
  local key = tonumber(order.key)
  if key and key > 0 and GetItemInfo then
    local ok, _, _, quality = pcall(GetItemInfo, key)
    if ok and quality and ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[quality] and ITEM_QUALITY_COLORS[quality].hex then
      return ITEM_QUALITY_COLORS[quality].hex .. name .. "|r"
    end
  end
  return "|cffffd100" .. name .. "|r"
end

function orders.statusText(row)
  local order, view = row.order, row.view
  if view.waiting then
    if view.status == "DONE" then return L("Done by you - goes to Discord with your next sync") end
    if view.status == "CLAIMED" then return L("Yours - goes to Discord with your next sync") end
    return L("Given back - goes to Discord with your next sync")
  end
  if view.status == "CLAIMED" then
    return view.mine and L("Yours") or string.format(L("Taken by %s"), tostring(order.character ~= "" and order.character or order.crafter or "?"))
  end
  if row.forMe then return L("Open - asked of you") end
  return L("Open")
end

function orders.reagentText(order)
  local rows = orders.reagents(order)
  if not rows then
    return order.mats and L("The requester brings the materials.") or L("Reagents: open your profession window once so Guilded can read this recipe.")
  end
  local parts = {}
  for _, mat in ipairs(rows) do
    local enough = mat.have and mat.have >= mat.need
    local colour = mat.have == nil and "|cffffffff" or enough and "|cff20ff20" or "|cffff4040"
    parts[#parts + 1] = string.format("%s%s/%d|r %s", colour, mat.have and tostring(mat.have) or "?", mat.need, clip(mat.name, 28))
  end
  return (order.mats and (L("Requester brings them") .. ": ") or (L("Reagents") .. ": ")) .. table.concat(parts, ", ")
end

-- ---------------------------------------------------------------------
-- Requests made in game (9.2): "item -> who can craft it", a Request button, and the two lists.
-- ---------------------------------------------------------------------
local LEFT_ROWS = 14     -- rows of the recipe list (matches, or Favourites, Recent and the professions)
local LEFT_ROW_H = 22
local LEFT_W = 250
local LIST_W = LEFT_W - 22   -- the rows; the scroll buttons take the strip on the right
local SEARCH_LIMIT = 80      -- recipes a search keeps (the list scrolls)
local DETAIL_W = 292      -- the detail pane (recomputed from the page width in buildCraftingPage; a margin stays for the scroll bar)
local DETAIL_X = LEFT_W + 10
local MAX_REAGENT_ROWS = 8
local MAX_CRAFTER_ROWS = 5
local SHOP_ROWS = 10      -- reagent rows of the shopping list
local LIST_ROWS = 5      -- rows in each of the two lists
local ROW_H = 28
local MINE_ROW_H = 42   -- My requests rows carry a second line with the status chips
local MINE_ROWS = 8
local MAX_PENDING = 5    -- requests of mine waiting for Discord or open there (the bot allows five)
local NEW_COOLDOWN = 20  -- seconds between two requests for the same item

-- "Ann (online), Bo (online), Cy (3d) +2 more", you first, then online, then the most recently seen.
function orders.crafterText(entry)
  local names, shown = {}, 0
  for _, crafter in ipairs(entry.crafters or {}) do
    shown = shown + 1
    if shown <= 3 then
      local label = crafter.me and L("you") or crafter.shown
      local ago = not crafter.me and ns.recipes and ns.recipes.lastSeenText and ns.recipes.lastSeenText(crafter.name, crafter.online, crafter.seenAt)
      names[#names + 1] = ago and (label .. " (" .. ago .. ")") or label
    end
  end
  if shown == 0 then return L("nobody known") end
  return table.concat(names, ", ") .. (shown > 3 and (" +" .. (shown - 3)) or "")
end

-- Rows for "My requests": waiting ones (not on Discord yet), then orders that are mine. Newest first.
function orders.myRequests()
  local s, rows = state(), {}
  if not s then return rows end
  local current = orders.current()
  local made = {}
  for _, order in ipairs(current and not current.off and current.orders or {}) do
    if orders.isMyRequest(order) then
      local view = orders.view(order)
      if (view.status == "OPEN" or view.status == "CLAIMED" or view.status == "DONE") and not s.received[order.id] then
        rows[#rows + 1] = { order = order, view = view, at = tonumber(order.at) or 0 }
      end
    end
    if order.ref and isMe(order.by) then made[order.ref] = true end
  end
  for ref, request in pairs(s.requests) do
    if type(request) == "table" and not made[ref] then
      rows[#rows + 1] = { pending = request, at = tonumber(request.at) or 0 }
    end
  end
  table.sort(rows, function(a, b) return a.at > b.at end)
  return rows
end

-- Requests a guildmate made that are not orders yet (heard on GUILD), for the recipes I can make or that ask me.
function orders.heardForMe()
  local s, rows = state(), {}
  if not s then return rows end
  local current = orders.current()
  local made = {}   -- ref -> requester names of the feed orders carrying it
  for _, order in ipairs(current and current.orders or {}) do
    if order.ref then made[order.ref] = made[order.ref] or {}; table.insert(made[order.ref], order.by) end
  end
  local function onDiscord(request)
    for _, by in ipairs(made[request.ref] or {}) do if sameRequester(by, request.name) then return true end end
    return false
  end
  local known = orders.myRecipes()
  for _, request in pairs(s.heardRequests) do
    if type(request) == "table" and not onDiscord(request) and not (s.requests and s.requests[request.ref]) then
      local canCraft = request.key and known[request.key] ~= nil or false
      if canCraft or isMe(request.asked) then rows[#rows + 1] = { pending = request, canCraft = canCraft, forMe = isMe(request.asked), at = tonumber(request.at) or 0 } end
    end
  end
  table.sort(rows, function(a, b) return a.at > b.at end)
  return rows
end

-- Sends a request. Returns the saved row, or nil and why. `opts`: item, key, prof, qty, note, asked, mats (the requester brings the materials).
function orders.submit(opts)
  local s, me = state(), orders.myName()
  if not (s and me) then return nil, L("Guilded is not ready yet.") end
  orders.prune()   -- finished requests must not count against the limit
  if not (IsInGuild and IsInGuild()) then return nil, L("Join a guild to request a craft.") end
  if ns.util and ns.util.inCombat and ns.util.inCombat() then return nil, L("You can request a craft after combat.") end
  local current = orders.current()
  if current and current.off then return nil, L("Your officers turned crafting orders off.") end
  local item = cleanText(opts.item, 60)
  if #item < 2 then return nil, L("Name the item you want crafted.") end
  local mine = orders.myRequests()
  local open = 0
  for _, row in ipairs(mine) do
    if row.pending or (row.view and row.view.status ~= "DONE") then open = open + 1 end
  end
  if open >= MAX_PENDING then return nil, string.format(L("You already have %d open craft requests."), MAX_PENDING) end
  local now = clock()
  for _, request in pairs(s.requests) do
    if type(request) == "table" and request.item == item and now - (tonumber(request.at) or 0) < NEW_COOLDOWN then
      return nil, L("You just asked for that.")
    end
  end
  local qty = math.max(1, math.min(200, math.floor(tonumber(opts.qty) or 1)))
  -- Two requests in the same second could draw the same random part and one would replace the other: draw again.
  local ref
  repeat ref = string.format("g%x%03x", now, math.random(0, 4095)) until s.requests[ref] == nil
  local row = { ref = ref, item = item, key = tonumber(opts.key), prof = opts.prof and canonProfession(cleanText(opts.prof, 40)) or nil, qty = qty,
    note = opts.note and cleanText(opts.note, 80) or nil, mats = opts.mats == true,
    asked = opts.asked and cleanText(opts.asked, 60) or nil, character = me, at = now }
  for _, field in ipairs({ "prof", "note", "asked" }) do if row[field] == "" then row[field] = nil end end
  s.requests[ref] = row
  orders.sayRequest(row)
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
  return row
end

-- NEW|ref|key|qty|mats|at|prof|asked|item|note. Said once; guildmates who can make it (or are asked) see it at once.
function orders.encodeRequest(row)
  local function field(text, max) return encode(cut(text, max)) end
  local head = { "NEW", row.ref, tonumber(row.key) or 0, tonumber(row.qty) or 1, row.mats and 1 or 0, tonumber(row.at) or 0 }
  local function build(prof, note) return table.concat({ head[1], head[2], head[3], head[4], head[5], head[6], prof, field(row.asked, 40), field(row.item, 50), note }, "|") end
  local text = build(field(row.prof, 24), field(row.note, 40))
  if #text > 250 then text = build("", "") end
  return text
end

function orders.sayRequest(row)
  if ns.util and ns.util.inCombat and ns.util.inCombat() then return end   -- nothing is sent in combat
  send(orders.encodeRequest(row))
end

function orders.decodeRequest(text)
  local ref, key, qty, mats, at, rest = string.match(text, "^NEW|([%w_%-]+)|(%-?%d+)|(%d+)|([01])|(%d+)|(.*)$")
  if not ref or #ref < 6 or #ref > 40 then return nil end
  local fields = {}
  for field in string.gmatch(rest .. "|", "([^|]*)|") do fields[#fields + 1] = decode(field) end
  if #fields ~= 4 or #fields[3] < 2 then return nil end
  key = tonumber(key)
  return { ref = ref, key = key ~= 0 and key or nil, qty = math.max(1, math.min(200, tonumber(qty) or 1)), mats = mats == "1", at = tonumber(at),
    prof = fields[1] ~= "" and fields[1] or nil, asked = fields[2] ~= "" and fields[2] or nil, item = string.sub(fields[3], 1, 100), note = fields[4] ~= "" and fields[4] or nil }
end

local lastAlertAt = {}
local function receiveNew(text, sender)
  local request = orders.decodeRequest(text)
  local s = state()
  if not request or not s or not request.at or clock() - request.at > KEEP then return end
  request.at = math.min(request.at, clock() + 60)          -- a clock far ahead cannot pin a request to the top
  request.item = cleanText(request.item, 60)
  if #request.item < 2 then return end
  request.prof, request.asked, request.note = canonProfession(cleanText(request.prof, 24)), cleanText(request.asked, 60), cleanText(request.note, 40)
  for _, field in ipairs({ "prof", "asked", "note" }) do if request[field] == "" then request[field] = nil end end
  local key = request.ref .. "@" .. sender
  if s.heardRequests[key] then return end             -- asked once, never again
  -- At most five kept per sender: a sender over the limit replaces only its own oldest, never anyone else's.
  local mineKept, oldestKey, oldestAt = 0, nil, nil
  for heardKey, heard in pairs(s.heardRequests) do
    if type(heard) == "table" and heard.name == sender then
      mineKept = mineKept + 1
      if not oldestAt or (tonumber(heard.at) or 0) < oldestAt then oldestKey, oldestAt = heardKey, tonumber(heard.at) or 0 end
    end
  end
  if mineKept >= PER_SENDER and oldestKey then s.heardRequests[oldestKey] = nil end
  request.character, request.name = sender, sender
  s.heardRequests[key] = request
  orders.prune()
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
  local known = orders.myRecipes()
  local forMe = request.asked and isMe(request.asked)
  if orders.alertsOn() and ns.message and ((request.key and known[request.key]) or forMe) and clock() - (lastAlertAt[sender] or -ALERT_GAP) >= ALERT_GAP then
    lastAlertAt[sender] = clock()
    ns.message(string.format(L("%s asks for %dx %s%s. Open Guilded, Crafting."), ns.displayName and ns.displayName(sender) or sender, request.qty, request.item, forMe and (" (" .. L("asked of you") .. ")") or ""))
  end
end

local function chatLines()
  local current = orders.current()
  ns.message(orders.sourceText(current))
  if not current or current.off then return end
  local rows = orders.list(false)
  if #rows == 0 then ns.message(L("No open orders for your recipes. /guilded orders all lists every open order.")) end
  for i = 1, math.min(8, #rows) do
    local row = rows[i]
    ns.message(string.format("  %d. %dx %s - %s (%s)", i, tonumber(row.order.qty) or 1, tostring(row.order.item or "?"), tostring(row.order.by or "?"), orders.statusText(row)))
  end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["orders"] = function(args)
  args = args or {}
  local action = string.lower(args[1] or "")
  if action == "alerts" then
    local on = string.lower(args[2] or "") ~= "off"
    orders.setAlerts(on)
    ns.message(on and L("Craft order alerts at login are on.") or L("Craft order alerts at login are off."))
    return
  end
  if action == "all" then
    local rows = orders.list(true)
    for i = 1, math.min(12, #rows) do
      local row = rows[i]
      ns.message(string.format("  %d. %dx %s - %s (%s)", i, tonumber(row.order.qty) or 1, tostring(row.order.item or "?"), tostring(row.order.by or "?"), orders.statusText(row)))
    end
    if #rows == 0 then ns.message(L("No open orders.")) end
    return
  end
  chatLines()
  if ns.openToolsPage then pcall(ns.openToolsPage, "Crafting") end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded orders [all | alerts on|off] - craft requests you can make; the Crafting page requests one")

-- ---------------------------------------------------------------------
-- The Crafting page. Plain frames only: safe in combat.
-- ---------------------------------------------------------------------
local function setShown(widget, shown) if shown then widget:Show() else widget:Hide() end end

-- Where a request of mine stands, from what this addon knows (no more): 1 sent (not on Discord yet), 2 on Discord,
-- 3 claimed (and by whom), 4 done. Returns the stage and the crafter's name.
function orders.stage(row)
  if row.pending then return 1 end
  local view, order = row.view, row.order
  local who = tostring(order.character ~= "" and order.character or order.crafter ~= "" and order.crafter or "?")
  if view.status == "DONE" then return 4, who end
  if view.status == "CLAIMED" then return 3, who end
  return 2
end

-- How many known guildmates can make the item (the recipes shared with this addon): the honest "seen by" figure.
function orders.crafterCount(key)
  key = tonumber(key)
  if not (key and key ~= 0 and ns.recipes and ns.recipes.crafters) then return 0 end
  return #ns.recipes.crafters(key)
end

-- "[Sent] > [On Discord, 3 can craft] > [Claimed by Eve] > [Done]": passed stages green, the current one gold, the rest grey.
function orders.chipText(row)
  local stage, who = orders.stage(row)
  local key = row.pending and row.pending.key or row.order and row.order.key
  local count = orders.crafterCount(key)
  local labels = {
    L("Sent"),
    count > 0 and string.format(L("On Discord, %d can craft"), count) or L("On Discord"),
    stage >= 3 and string.format(L("Claimed by %s"), who) or L("Claimed"),
    stage >= 4 and string.format(L("Done by %s"), who) or L("Done"),
  }
  local parts = {}
  for i, label in ipairs(labels) do
    local colour = i < stage and "|cff20c020" or i == stage and "|cffffd100" or "|cff707070"
    parts[#parts + 1] = colour .. "[" .. label .. "]|r"
  end
  return table.concat(parts, " |cff707070>|r ")
end

-- The requester got the item: the request leaves My requests here. Nothing goes to Discord for it (the crafter's Done
-- already did, or Cancel is the way to withdraw one nobody made).
function orders.markReceived(id)
  local s = state()
  if not (s and type(id) == "string") then return false end
  s.received[id] = clock()
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
  return true
end

-- Favourites (star) and Recent: stored locally in SavedVariables, never sent anywhere.
local MAX_FAVOURITES, MAX_RECENT = 30, 10
local function entryId(entry)
  if entry.key then return tostring(entry.key) end
  return "n:" .. fold(entry.name)
end
local function plainEntry(entry)
  local prof = entry.prof or entry.profession or (entry.crafters and entry.crafters[1] and entry.crafters[1].profession)
  return { id = entryId(entry), key = tonumber(entry.key), name = cut(entry.name, 60), prof = prof and canonProfession(prof) or nil }
end

function orders.isFavourite(entry)
  local s = state()
  if not (s and entry) then return false end
  local id = entryId(entry)
  for _, fav in ipairs(s.favourites) do if fav.id == id then return true end end
  return false
end

function orders.toggleFavourite(entry)
  local s = state()
  if not (s and entry and entry.name) then return false end
  local id = entryId(entry)
  for i, fav in ipairs(s.favourites) do
    if fav.id == id then table.remove(s.favourites, i); return false end
  end
  if #s.favourites >= MAX_FAVOURITES then table.remove(s.favourites, 1) end
  s.favourites[#s.favourites + 1] = plainEntry(entry)
  return true
end

function orders.favourites()
  local s = state()
  local list = {}
  for _, fav in ipairs(s and s.favourites or {}) do if type(fav) == "table" and type(fav.name) == "string" then list[#list + 1] = fav end end
  return list
end

function orders.addRecent(entry)
  local s = state()
  if not (s and entry and entry.name) then return end
  local id = entryId(entry)
  for i = #s.recent, 1, -1 do if type(s.recent[i]) ~= "table" or s.recent[i].id == id then table.remove(s.recent, i) end end
  table.insert(s.recent, 1, plainEntry(entry))
  while #s.recent > MAX_RECENT do table.remove(s.recent) end
end

-- The recipe's name in this client's language when its id is known (names saved from another client may be French);
-- the stored text otherwise. Keys: item id above 0, a negative spell id for an enchant.
function orders.localName(entry)
  if not entry then return nil end
  local key = tonumber(entry.key)
  local name
  if key and key ~= 0 then
    pcall(function()
      if key > 0 then
        if C_Item and C_Item.GetItemNameByID then name = C_Item.GetItemNameByID(key) end
        if (not name or name == "") and GetItemInfo then name = GetItemInfo(key) end
      else
        if C_Spell and C_Spell.GetSpellName then name = C_Spell.GetSpellName(-key) end
        if (not name or name == "") and GetSpellInfo then name = GetSpellInfo(-key) end
      end
    end)
  end
  if type(name) == "string" and name ~= "" then return name end
  return entry.name
end

function orders.recents()
  local s = state()
  local list = {}
  for _, entry in ipairs(s and s.recent or {}) do if type(entry) == "table" and type(entry.name) == "string" then list[#list + 1] = entry end end
  return list
end

-- The recipe the detail pane shows: every crafter of a known recipe, or just the name (the bot looks the item up).
function orders.detail(sel)
  if not sel then return nil end
  local entry = sel.key and ns.recipes and ns.recipes.entry and ns.recipes.entry(sel.key) or nil
  if entry then
    if entry.name == nil or entry.name == "" then entry.name = sel.name end
    entry.prof = sel.prof
    return entry
  end
  return { key = sel.key, name = sel.name, prof = sel.prof, crafters = {} }
end

local function onlineElsewhere(entry)
  for _, crafter in ipairs(entry.crafters or {}) do if crafter.online and not crafter.me then return true end end
  return false
end

-- Rows of the left list. Searching shows the matches. Otherwise Favourites, Recent, then the professions (a click opens one).
-- `onlineOnly` keeps recipes that a guildmate (not you) who can craft them has online right now.
function orders.requestItems(view)
  local items = {}
  local function recipeItem(entry, known) items[#items + 1] = { kind = "recipe", entry = entry } end
  local filter = view.onlineOnly
  if view.query and #view.query >= 2 then
    for _, entry in ipairs(view.results or {}) do
      if not filter or onlineElsewhere(entry) then recipeItem(entry) end
    end
    return items, "search"
  end
  local function section(label, list)
    local kept = {}
    for _, saved in ipairs(list) do
      local keep = true
      if filter then
        local detail = orders.detail(saved)
        keep = detail and onlineElsewhere(detail)
      end
      if keep then kept[#kept + 1] = saved end
    end
    if #kept == 0 then return end
    items[#items + 1] = { kind = "header", id = label, label = string.format("%s (%d)", L(label), #kept), open = true }
    for _, saved in ipairs(kept) do recipeItem(saved) end
  end
  section("Favourites", orders.favourites())
  section("Recent", orders.recents())
  if not view.browse and ns.recipes and ns.recipes.browse then view.browse = ns.recipes.browse() end
  for _, group in ipairs(view.browse or {}) do
    local entries = {}
    for _, entry in ipairs(group.entries) do
      if not filter or entry.online > 0 then entries[#entries + 1] = entry end
    end
    if #entries > 0 then
      local label = ns.util and ns.util.professionLabel and ns.util.professionLabel(group.profession) or group.profession
      local open = view.expanded[group.profession] == true
      items[#items + 1] = { kind = "header", id = group.profession, label = string.format("%s (%d)", label, #entries), open = open, group = true }
      if open then for _, entry in ipairs(entries) do recipeItem({ key = entry.key, name = entry.name, prof = entry.profession, online = entry.online, crafterCount = entry.crafters }) end end
    end
  end
  return items, "browse"
end

-- Shopping list: the reagents of every order you claimed (and have not finished), summed, with what is in your bags.
-- Orders whose requester brings the materials add nothing. Returns { rows = { { id, name, need, have } }, orders = n, unknown = n }
-- (`unknown` counts claimed orders whose recipe reagents this addon has not read: open the profession window once).
function orders.shoppingList()
  local sums, order, result = {}, {}, { rows = {}, orders = 0, unknown = 0 }
  for _, row in ipairs(orders.list(true)) do
    if row.view.status == "CLAIMED" and row.view.mine and not row.order.mats then
      result.orders = result.orders + 1
      local reagents = orders.reagents(row.order)
      if not reagents then result.unknown = result.unknown + 1 end
      for _, mat in ipairs(reagents or {}) do
        local sum = sums[mat.id]
        if not sum then sum = { id = mat.id, name = mat.name, need = 0, have = mat.have }; sums[mat.id] = sum; order[#order + 1] = sum end
        sum.need = sum.need + mat.need
      end
    end
  end
  table.sort(order, function(a, b)
    local aMissing, bMissing = (a.have or 0) < a.need, (b.have or 0) < b.need
    if aMissing ~= bMissing then return aMissing end
    return tostring(a.name) < tostring(b.name)
  end)
  result.rows = order
  return result
end

-- New open requests you can make, for the number on the Craft for the guild sub-tab.
function orders.craftBadge()
  local n = 0
  for _, row in ipairs(orders.list(false)) do
    if row.view.status == "OPEN" and (row.canCraft or row.forMe) and not orders.isMyRequest(row.order) then n = n + 1 end
  end
  for _ in ipairs(orders.heardForMe()) do n = n + 1 end
  return n
end

orders.SUBTABS = {
  { id = "request", label = "Request" },
  { id = "mine", label = "My requests" },
  { id = "craft", label = "Craft for the guild" },
}

function orders.requestStatusText(row)
  if row.pending then return L("Sent. Discord gets it with the next sync.") end
  local view, order = row.view, row.order
  if view.waiting then return orders.statusText(row) end
  if view.status == "DONE" then return string.format(L("Done by %s. Check your mail."), tostring(order.character ~= "" and order.character or order.crafter or "?")) end
  if view.status == "CLAIMED" then return string.format(L("Taken by %s"), tostring(order.character ~= "" and order.character or order.crafter or "?")) end
  return L("Open")
end

function orders.buildCraftingPage(page, helpers)
  local width = helpers.width or 580
  local newLabel, newButton, newEdit, at = helpers.newLabel, helpers.newButton, helpers.newEdit, helpers.at
  local view = { page = page, width = width, results = {}, all = false, advanced = false, sub = "request", onlineOnly = false, expanded = {}, mats = false }
  orders.ui = view
  view.relayout = helpers.relayout
  DETAIL_W = math.max(240, width - DETAIL_X - 24)

  -- Three sub-tabs (9.4): Request, My requests, Craft for the guild. One shows at a time.
  view.tabs = {}
  for i, key in ipairs(orders.SUBTABS) do
    view.tabs[i] = newButton(page, key.label, 140, function() view.sub = key.id; view.browse = nil; orders.refresh(true) end, 24)
    view.tabs[i].subId = key.id
    view.tabs[i]:SetPoint("TOPLEFT", page, "TOPLEFT", (i - 1) * 144, 0)
  end

  -- Search: one box (type a name, or shift-click an item), results under it.
  view.box = at(newEdit(page, 330), page, 6, -34)
  if helpers.itemBox then helpers.itemBox(view.box) end
  if helpers.placeholder then helpers.placeholder(view.box, "Item or recipe: type a name, or shift-click an item") end
  local function search()
    local text = view.box:GetText() or ""
    view.query = text
    view.offset = 0
    view.results, view.total = {}, 0
    if text ~= "" and ns.recipes and ns.recipes.search then view.results, view.total = ns.recipes.search(text, SEARCH_LIMIT) end
    -- Nobody known for that name yet: it can still be requested by name (the bot looks the item up).
    if #view.results == 0 and #text >= 2 then view.results, view.total = { { name = string.sub(text, 1, 60), crafters = {} } }, 1 end
    -- One match (a shift-clicked item, or a name nobody knows yet): it is already the one picked.
    if #view.results == 1 and #text >= 2 then
      local only = view.results[1]
      view.sel = { key = tonumber(only.key), name = only.name, prof = only.crafters and only.crafters[1] and only.crafters[1].profession }
      view.asked, view.askedShown = nil, nil
    end
    orders.refresh(true)
  end
  view.box:SetScript("OnEnterPressed", function(self) self:ClearFocus(); search() end)
  local typed = view.box:GetScript("OnTextChanged")
  view.box:SetScript("OnTextChanged", function(self, user, ...)
    if type(typed) == "function" then typed(self, user, ...) end
    -- Results follow what is typed or shift-clicked (the game reports a pasted link as not typed by the user).
    if (self:GetText() or "") ~= (view.query or "") then search() end
  end)
  view.searchButton = newButton(page, "Search", 90, search)
  view.searchButton:SetPoint("TOPLEFT", page, "TOPLEFT", 344, -31)
  -- A real tick box (it used to be a button whose text was "[ ]").
  view.onlineButton = CreateFrame("CheckButton", nil, page, "UICheckButtonTemplate")
  view.onlineButton:SetWidth(24); view.onlineButton:SetHeight(24)
  view.onlineButton.label = view.onlineButton:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  view.onlineButton.label:SetPoint("LEFT", view.onlineButton, "RIGHT", 2, 0)
  view.onlineButton.label:SetText(L("Crafter online now"))
  view.onlineButton:SetScript("OnClick", function() view.onlineOnly = not view.onlineOnly; view.browse = nil; view.offset = 0; orders.refresh(true) end)
  if view.onlineButton.SetScript then
    view.onlineButton:SetScript("OnEnter", function(self)
      if not GameTooltip then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(L("Only recipes a guildmate can craft right now."), 1, 1, 1, true)
      GameTooltip:Show()
    end)
    view.onlineButton:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  end
  view.note = newLabel(page, "", "GameFontHighlightSmall")           -- the detail pane's hint when no recipe is picked
  view.note:SetWidth(width - LEFT_W - 16)
  view.leftNote = newLabel(page, "", "GameFontDisableSmall")         -- the list's own message when it is empty
  view.leftNote:SetWidth(LEFT_W - 8)
  view.more = newLabel(page, "", "GameFontDisableSmall")      -- "Showing 15-28 of 120" under a list that scrolls
  view.more:SetWidth(LEFT_W)
  view.offset = 0                                               -- the first list item shown (the list scrolls)
  local function tip(frame, ...)
    local lines = { ... }
    if not frame.SetScript then return end
    local oldEnter, oldLeave = frame.GetScript and frame:GetScript("OnEnter"), frame.GetScript and frame:GetScript("OnLeave")
    frame:SetScript("OnEnter", function(self, ...)
      if type(oldEnter) == "function" then oldEnter(self, ...) end
      if not GameTooltip then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      for i, line in ipairs(lines) do
        local text = type(line) == "function" and line() or line
        if text and text ~= "" then GameTooltip:AddLine(text, i == 1 and 1 or 0.8, i == 1 and 1 or 0.8, i == 1 and 1 or 0.8, true) end
      end
      GameTooltip:Show()
    end)
    frame:SetScript("OnLeave", function(self, ...)
      if type(oldLeave) == "function" then oldLeave(self, ...) end
      if GameTooltip then GameTooltip:Hide() end
    end)
  end
  -- Scroll the list by `steps` items (negative: up). Plain offset arithmetic, no protected calls.
  function view.scrollBy(steps)
    view.offset = math.max(0, (view.offset or 0) + steps)
    orders.refresh(true)
  end
  local function wheel(frame)
    if frame.EnableMouseWheel then frame:EnableMouseWheel(true) end
    frame:SetScript("OnMouseWheel", function(_, delta) view.scrollBy(delta > 0 and -3 or 3) end)
  end
  view.scrollUp = newButton(page, "^", 20, function() view.scrollBy(-LEFT_ROWS + 1) end, 20)
  view.scrollDown = newButton(page, "v", 20, function() view.scrollBy(LEFT_ROWS - 1) end, 20)
  tip(view.scrollUp, function() return L("Previous page of recipes") end)
  tip(view.scrollDown, function() return L("Next page of recipes") end)

  -- The left list: matches, or Favourites, Recent and the professions. A row picks the recipe; its star favourites it.
  view.resultRows = {}
  for i = 1, LEFT_ROWS do
    local frame = CreateFrame("Button", nil, page)
    frame:SetWidth(LIST_W)
    frame:SetHeight(LEFT_ROW_H - 2)
    local row = { frame = frame, index = i }
    row.back = frame:CreateTexture(nil, "BACKGROUND")
    row.back:SetAllPoints(frame)
    row.text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.text:SetPoint("LEFT", frame, "LEFT", 6, 0)
    row.text:SetWidth(LIST_W - 46)
    row.text:SetJustifyH("LEFT")
    -- "Fav" keeps the recipe in Favourites (gold = kept). The whole row picks the recipe.
    row.star = newButton(frame, "Fav", 36, function()
      if row.item and row.item.entry then orders.toggleFavourite(row.item.entry); orders.refresh(true) end
    end, 18)
    row.star:SetPoint("RIGHT", frame, "RIGHT", -2, 0)
    tip(row.star, function() return row.item and row.item.entry and orders.isFavourite(row.item.entry) and L("Remove from Favourites") or L("Add to Favourites") end)
    wheel(frame)
    frame:SetScript("OnClick", function()
      local item = row.item
      if not item then return end
      if item.kind == "header" then
        if item.group then
          view.expanded[item.id] = not view.expanded[item.id]
          if view.expanded[item.id] then view.offset = (view.offset or 0) + row.index - 1 end   -- bring the opened profession to the top
          orders.refresh(true)
        end
      elseif item.entry then
        view.select(item.entry)
      end
    end)
    frame:Hide()
    view.resultRows[i] = row
  end

  -- The detail pane: reagents, crafters, quantity, note, who brings the materials, Request.
  view.dTitle = newLabel(page, "", "GameFontNormalLarge")
  view.dTitle:SetWidth(DETAIL_W)
  view.dStar = newButton(page, "Favourite", 86, function()
    if view.sel then orders.toggleFavourite(view.sel); orders.refresh(true) end
  end, 20)
  tip(view.dStar, function() return view.sel and orders.isFavourite(view.sel) and L("Remove from Favourites") or L("Add to Favourites") end)
  view.dProf = newLabel(page, "", "GameFontDisableSmall")
  view.dProf:SetWidth(DETAIL_W)
  view.dReagentHeader = newLabel(page, "Reagents (have/need)", "GameFontNormalSmall")
  view.dReagents = {}
  for i = 1, MAX_REAGENT_ROWS do
    local frame = CreateFrame("Frame", nil, page)
    frame:SetWidth(DETAIL_W)
    frame:SetHeight(18)
    local row = { frame = frame }
    row.icon = frame:CreateTexture(nil, "ARTWORK")
    row.icon:SetWidth(16); row.icon:SetHeight(16)
    row.icon:SetPoint("LEFT", frame, "LEFT", 0, 0)
    row.text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.text:SetPoint("LEFT", frame, "LEFT", 22, 0)
    row.text:SetWidth(DETAIL_W - 24)
    row.text:SetJustifyH("LEFT")
    frame:Hide()
    view.dReagents[i] = row
  end
  view.dReagentNote = newLabel(page, "", "GameFontDisableSmall")
  view.dReagentNote:SetWidth(DETAIL_W)
  view.dCraftersHeader = newLabel(page, "Crafters", "GameFontNormalSmall")
  view.dCrafters = {}
  for i = 1, MAX_CRAFTER_ROWS do
    local label = newLabel(page, "", "GameFontHighlightSmall")
    label:SetWidth(DETAIL_W)
    view.dCrafters[i] = label
  end
  view.askButton = newButton(page, "Ask: anyone", 190, function()
    local names = {}
    for _, crafter in ipairs(orders.detail(view.sel) and orders.detail(view.sel).crafters or {}) do
      if not crafter.me then names[#names + 1] = crafter end
    end
    local nextIndex = 1
    for i, crafter in ipairs(names) do if view.asked == crafter.name then nextIndex = i + 1 end end
    local chosen = names[nextIndex]
    view.asked, view.askedShown = chosen and chosen.name or nil, chosen and chosen.shown or nil
    orders.refresh(true)
  end, 22)
  view.qtyLabel = newLabel(page, "Quantity", "GameFontNormalSmall")
  view.qtyBox = newEdit(page, 40, true)
  view.qtyBox:SetText("1")
  view.noteLabel = newLabel(page, "Note", "GameFontNormalSmall")
  view.noteBox = newEdit(page, DETAIL_W - 160)
  view.noteBox:SetMaxLetters(60)
  view.matsButton = newButton(page, "Materials: crafter provides", DETAIL_W, function() view.mats = not view.mats; orders.refresh(true) end, 22)
  view.requestButton = newButton(page, "Request", 120, function() view.request() end, 24)
  view.requestWidgets = { view.onlineButton, view.scrollUp, view.scrollDown, view.note, view.leftNote, view.more, view.dTitle, view.dStar, view.dProf, view.dReagentHeader, view.dReagentNote,
    view.dCraftersHeader, view.askButton, view.qtyLabel, view.qtyBox, view.noteLabel, view.noteBox, view.matsButton, view.requestButton }
  for _, label in ipairs(view.dCrafters) do view.requestWidgets[#view.requestWidgets + 1] = label end

  function view.select(entry)
    view.sel = entry and { key = tonumber(entry.key), name = entry.name, prof = entry.prof or entry.profession or (entry.crafters and entry.crafters[1] and entry.crafters[1].profession) } or nil
    view.asked, view.askedShown = nil, nil
    if entry then orders.addRecent(entry) end
    orders.refresh(true)
  end

  function view.request()
    local sel = view.sel
    if not sel then return end
    local detail = orders.detail(sel)
    local asked = nil   -- the asked crafter, by full "First Last" name, only when that one can make this item
    for _, crafter in ipairs(detail.crafters or {}) do
      if view.asked and crafter.name == view.asked then asked = crafter.shown or crafter.name end
    end
    local saved, why = orders.submit({ item = detail.name, key = detail.key, prof = detail.crafters[1] and detail.crafters[1].profession or sel.prof,
      qty = tonumber(view.qtyBox:GetText()) or 1, note = view.noteBox:GetText(), asked = asked, mats = view.mats })
    if not saved then if ns.message then ns.message(why) end return end
    orders.addRecent(sel)
    view.noteBox:SetText("")
    view.qtyBox:SetText("1")
    view.asked, view.askedShown, view.mats = nil, nil, false   -- the options are for that one request
    orders.refresh()
    if ns.message then ns.message(string.format(L("Asked the guild for %dx %s. It is posted on Discord with your next sync."), saved.qty, saved.item)) end
  end

  -- The two lists.
  local function listRow(parent, withTooltip, tall)
    local frame = CreateFrame("Frame", nil, parent)
    frame:SetWidth(width)
    frame:SetHeight(tall and MINE_ROW_H - 2 or ROW_H - 2)
    local row = { frame = frame }
    row.text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.text:SetPoint(tall and "TOPLEFT" or "LEFT", frame, tall and "TOPLEFT" or "LEFT", 4, tall and -5 or 0)
    row.text:SetWidth(width - 190)
    row.text:SetJustifyH("LEFT")
    if tall then
      row.chips = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
      row.chips:SetPoint("TOPLEFT", frame, "TOPLEFT", 4, -21)
      row.chips:SetWidth(width - 8)
      row.chips:SetJustifyH("LEFT")
    end
    row.second = newButton(frame, "Done", 80, nil, 22)
    row.second:SetPoint("RIGHT", frame, "RIGHT", -2, 0)
    row.first = newButton(frame, "Claim", 80, nil, 22)
    row.first:SetPoint("RIGHT", row.second, "LEFT", -4, 0)
    local back = frame:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints(frame)
    if back.SetColorTexture then back:SetColorTexture(1, 1, 1, 0.06) end
    if withTooltip and frame.EnableMouse then
      frame:EnableMouse(true)
      frame:SetScript("OnEnter", function(self)
        if not (GameTooltip and row.order) then return end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(tostring(row.order.item or "?"))
        GameTooltip:AddLine(orders.reagentText(row.order), 1, 1, 1, true)
        if row.order.note and row.order.note ~= "" then GameTooltip:AddLine("\"" .. row.order.note .. "\"", 0.7, 0.7, 0.7, true) end
        GameTooltip:Show()
      end)
      frame:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    end
    frame:Hide()
    return row
  end
  local function act(self)
    if self.action == "received" then
      if orders.markReceived(self.orderId) and ns.message then ns.message(L("Marked as received. It leaves My requests.")) end
      orders.refresh(true)
      return
    end
    if type(self.ref) == "string" then   -- a request that has not reached Discord: taken back
      if orders.cancelPending(self.ref) and ns.message then ns.message(L("Request withdrawn. If Discord already has it, it shows up again here to cancel.")) end
      orders.refresh()
      return
    end
    local saved, why = orders.act(self.orderId, self.action)
    if ns.message then
      if not saved then ns.message(why)
      elseif self.action == "claim" then ns.message(L("Order claimed. Your companion tells Discord with your next sync (or a guildmate's does)."))
      elseif self.action == "done" then ns.message(L("Order marked done. The requester gets a Discord message after your next sync."))
      elseif self.action == "cancel" then ns.message(L("Request cancelled. Discord is told with your next sync."))
      else ns.message(L("Order given back.")) end
    end
    orders.refresh(true)
  end
  view.mineHeader = newLabel(page, "My requests", "GameFontNormal")
  view.mineEmpty = newLabel(page, "", "GameFontDisableSmall")
  view.mineEmpty:SetWidth(width)
  view.mineRows = {}
  for i = 1, MINE_ROWS do
    local row = listRow(page, false, true)
    row.first:SetScript("OnClick", act); row.second:SetScript("OnClick", act)
    view.mineRows[i] = row
  end
  view.forMeHeader = newLabel(page, "Requests for me", "GameFontNormal")
  view.allButton = newButton(page, "Show all open orders", 170, function() view.all = not view.all; orders.refresh(true) end, 22)
  view.forMeEmpty = newLabel(page, "", "GameFontDisableSmall")
  view.forMeEmpty:SetWidth(width)
  view.forMeRows = {}
  for i = 1, LIST_ROWS do
    local row = listRow(page, true)
    row.first:SetScript("OnClick", act); row.second:SetScript("OnClick", act)
    view.forMeRows[i] = row
  end
  view.shopHeader = newLabel(page, "Shopping list", "GameFontNormal")
  view.shopNote = newLabel(page, "", "GameFontDisableSmall")
  view.shopNote:SetWidth(width)
  view.shopRows = {}
  for i = 1, SHOP_ROWS do
    local frame = CreateFrame("Frame", nil, page)
    frame:SetWidth(width)
    frame:SetHeight(18)
    local row = { frame = frame }
    row.icon = frame:CreateTexture(nil, "ARTWORK")
    row.icon:SetWidth(16); row.icon:SetHeight(16)
    row.icon:SetPoint("LEFT", frame, "LEFT", 4, 0)
    row.text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.text:SetPoint("LEFT", frame, "LEFT", 26, 0)
    row.text:SetWidth(width - 30)
    row.text:SetJustifyH("LEFT")
    frame:Hide()
    view.shopRows[i] = row
  end
  view.hint = newLabel(page, "Claim an order, craft it, then press Done. Trade or mail the item to the requester; gold never goes through Guilded.", "GameFontDisableSmall")
  view.hint:SetWidth(width - 12) -- inside the visible page, wrapping

  view.shareButton = newButton(page, "Share my recipes", 150, function() if helpers.run then helpers.run("recipes share") end end, 22)
  view.sourceLabel = newLabel(page, "", "GameFontDisableSmall")
  view.sourceLabel:SetWidth(width - 160)

  -- Advanced: my professions, cooldowns, order alerts (collapsed).
  view.advancedButton = newButton(page, "Advanced", 120, function() view.advanced = not view.advanced; orders.refresh(true) end, 22)
  view.alertsButton = newButton(page, "Order alerts: on", 150, function() orders.setAlerts(not orders.alertsOn()); orders.refresh(true) end, 22)
  view.professions = newLabel(page, "My professions", "GameFontNormal")
  view.mineLabel = newLabel(page, "", "GameFontHighlightSmall")
  view.mineLabel:SetWidth(width)
  view.cooldowns = newLabel(page, "Cooldowns", "GameFontNormal")
  view.cooldownLabel = newLabel(page, "", "GameFontHighlightSmall")
  view.cooldownLabel:SetWidth(width)
  if helpers.ui then helpers.ui.craftMine, helpers.ui.craftCooldowns, helpers.ui.craftHeight = view.mineLabel, view.cooldownLabel, function() return view.height() end end

  function view.height()
    return view.contentHeight or 600
  end

  page:HookScript("OnShow", function() view.browse = nil; orders.refresh(true) end)
  return view
end

local function textHeight(label)
  local height = label and label.GetStringHeight and label:GetStringHeight()
  return type(height) == "number" and height or 16
end

local function place(widget, page, x, y)
  widget:ClearAllPoints()
  widget:SetPoint("TOPLEFT", page, "TOPLEFT", x, y)
end

-- Request sub-tab: search, results, options.
-- The item's icon, when the game knows it (never an error).
local function iconFor(id)
  if not id then return nil end
  local ok, icon = pcall(function()
    if C_Item and C_Item.GetItemIconByID then return C_Item.GetItemIconByID(id) end
    if GetItemIcon then return GetItemIcon(id) end
  end)
  return ok and icon or nil
end

local function crafterLine(crafter)
  local who = crafter.me and L("you") or crafter.shown
  local state
  if crafter.online then state = "|cff20ff20" .. L("online") .. "|r"
  else
    local ago = ns.recipes and ns.recipes.lastSeenText and ns.recipes.lastSeenText(crafter.name, false, crafter.seenAt)
    state = "|cff909090" .. (ago and string.format(L("seen %s ago"), ago) or L("last seen unknown")) .. "|r"
  end
  local prof = crafter.profession and (ns.util and ns.util.professionLabel and ns.util.professionLabel(crafter.profession) or crafter.profession) or nil
  return string.format("%s  %s%s", who, state, prof and ("  |cffaaaaaa" .. prof .. "|r") or "")
end

local function renderDetail(view, page, x, y, off)
  local sel = view.sel
  if not sel then
    view.note:SetText(off and L("Your officers turned crafting orders off (in Discord: /config craft orders).") or L("Pick a recipe on the left, or type what you need above. Favourite keeps it at the top of the list."))
    place(view.note, page, x, y - 4); view.note:Show()
    return y - math.max(18, textHeight(view.note) + 6)
  end
  local detail = orders.detail(sel)
  local qty = math.max(1, math.min(200, math.floor(tonumber(view.qtyBox:GetText()) or 1)))
  view.dTitle:SetText("|cffffd100" .. tostring(orders.localName(detail) or "?") .. "|r")
  place(view.dTitle, page, x, y); view.dTitle:Show()
  -- The title may wrap onto two lines: the lines under it start below its real height.
  y = y - math.max(24, math.min(46, textHeight(view.dTitle) + 6))
  view.dStar:SetText(orders.isFavourite(sel) and ("|cffffd100" .. L("Favourite") .. "|r") or ("|cff909090" .. L("Favourite") .. "|r"))
  place(view.dStar, page, x + DETAIL_W - 86, y + 2); view.dStar:Show()
  local prof = sel.prof and (ns.util and ns.util.professionLabel and ns.util.professionLabel(sel.prof) or sel.prof)
  view.dProf:SetWidth(DETAIL_W - 92)
  view.dProf:SetText(prof or "")
  place(view.dProf, page, x, y); view.dProf:Show()
  y = y - 22
  -- Reagents with what is in your bags.
  view.dReagentHeader:SetText(view.mats and L("Reagents you bring (have/need)") or L("Reagents (have/need)"))
  place(view.dReagentHeader, page, x, y); view.dReagentHeader:Show()
  y = y - 18
  local reagents = orders.reagents({ key = detail.key, qty = qty }) or {}
  for i, row in ipairs(view.dReagents) do
    local mat = reagents[i]
    if mat then
      local enough = mat.have and mat.have >= mat.need
      local colour = mat.have == nil and "|cffffffff" or enough and "|cff20ff20" or "|cffff4040"
      row.text:SetText(string.format("%s%s/%d|r %s", colour, mat.have and tostring(mat.have) or "?", mat.need, clip(mat.name, 34)))
      local icon = iconFor(mat.id)
      if row.icon.SetTexture then row.icon:SetTexture(icon or "Interface\\Icons\\INV_Misc_QuestionMark") end
      place(row.frame, page, x, y); row.frame:Show()
      y = y - 19
    else
      row.frame:Hide()
    end
  end
  if #reagents == 0 then
    view.dReagentNote:SetText(L("Open your profession window once to see the reagents."))
    place(view.dReagentNote, page, x, y); view.dReagentNote:Show()
    y = y - textHeight(view.dReagentNote) - 4
  else view.dReagentNote:Hide() end
  y = y - 4
  -- Crafters: online state, last seen and profession.
  local crafters = detail.crafters or {}
  view.dCraftersHeader:SetText(string.format("%s (%d)", L("Crafters"), #crafters))
  place(view.dCraftersHeader, page, x, y); view.dCraftersHeader:Show()
  y = y - 18
  if #crafters == 0 then
    view.dCrafters[1]:SetText("|cff909090" .. L("nobody known") .. "|r")
    place(view.dCrafters[1], page, x, y); view.dCrafters[1]:Show()
    y = y - 16
  else
    for i, label in ipairs(view.dCrafters) do
      local crafter = crafters[i]
      if crafter then
        label:SetText(crafterLine(crafter))
        place(label, page, x, y); label:Show()
        y = y - 16
      end
    end
    if #crafters > #view.dCrafters then
      -- The last label doubles as the "+N more" line when the list is longer than the pane.
      local label = view.dCrafters[#view.dCrafters]
      label:SetText(string.format(L("%d more crafters"), #crafters - #view.dCrafters + 1))
    end
  end
  y = y - 6
  -- Quantity, note, who brings the materials, ask one crafter, Request.
  place(view.qtyLabel, page, x, y - 5); view.qtyLabel:Show()
  place(view.qtyBox, page, x + 62, y - 1); view.qtyBox:Show()
  place(view.noteLabel, page, x + 112, y - 5); view.noteLabel:Show()
  view.noteBox:SetWidth(math.max(60, DETAIL_W - 160))
  place(view.noteBox, page, x + 150, y - 1); view.noteBox:Show()
  y = y - 30
  view.matsButton:SetText(view.mats and L("Materials: I bring them") or L("Materials: crafter provides"))
  place(view.matsButton, page, x, y); view.matsButton:Show()
  y = y - 28
  view.askButton:SetText(view.askedShown and string.format(L("Ask: %s"), view.askedShown) or L("Ask: anyone"))
  -- Ask shares the row with Request (120 wide, at DETAIL_W - 124): keep a 6 px gap however narrow the pane is.
  view.askButton:SetWidth(math.max(100, math.min(190, DETAIL_W - 124 - 6)))
  place(view.askButton, page, x, y); view.askButton:Show()
  setShown(view.requestButton, not off)
  place(view.requestButton, page, x + DETAIL_W - 124, y - 2)
  y = y - 34
  return y
end

-- Request sub-tab: search, the filter, the recipe list on the left and the detail pane on the right.
local function renderRequest(view, page, y, off)
  setShown(view.box, true); setShown(view.searchButton, true)
  place(view.box, page, 6, y); place(view.searchButton, page, 344, y + 3)
  -- The box and its label end inside the page (the label is as wide as the room that is left).
  local checkX = 436
  place(view.onlineButton, page, checkX, y + 5)
  if view.onlineButton.label.SetWidth then view.onlineButton.label:SetWidth(math.max(60, (view.width or 576) - checkX - 30)) end
  if view.onlineButton.SetChecked then view.onlineButton:SetChecked(view.onlineOnly and true or false) end
  view.onlineButton:Show()
  y = y - 34
  local top = y
  -- Left list.
  local items, mode = orders.requestItems(view)
  local maxOffset = math.max(0, #items - LEFT_ROWS)
  view.offset = math.max(0, math.min(view.offset or 0, maxOffset))
  local listTop = y
  local shown = 0
  for i, row in ipairs(view.resultRows) do
    local item = items[view.offset + i]
    row.item = item
    if item then
      shown = shown + 1
      local selected = view.sel and item.entry and ((view.sel.key and view.sel.key == tonumber(item.entry.key)) or (not view.sel.key and fold(view.sel.name) == fold(item.entry.name)))
      if item.kind == "header" then
        row.text:SetText("|cffffd100" .. (item.group and (item.open and "- " or "+ ") or "") .. item.label .. "|r")
        row.star:Hide()
        if row.back.SetColorTexture then row.back:SetColorTexture(1, 1, 1, 0.12) end
      else
        local entry = item.entry
        local online = entry.online
        if online == nil then
          online = 0
          for _, crafter in ipairs(entry.crafters or {}) do if crafter.online and not crafter.me then online = online + 1 end end
        end
        local count = entry.crafterCount or entry.crafters and #entry.crafters
        local tail = count and (" |cff" .. (online > 0 and "20ff20" or "808080") .. "(" .. online .. ")|r") or ""
        row.text:SetText((selected and "|cffffd100" or "|cffffffff") .. clip(tostring(orders.localName(entry) or "?"), 27) .. "|r" .. tail)
        row.star:SetText(orders.isFavourite(entry) and ("|cffffd100" .. L("Fav") .. "|r") or ("|cff707070" .. L("Fav") .. "|r"))
        row.star:Show()
        if row.back.SetColorTexture then row.back:SetColorTexture(1, 1, 1, selected and 0.18 or 0.04) end
      end
      place(row.frame, page, 0, y)
      row.frame:Show()
      y = y - LEFT_ROW_H
    else
      row.frame:Hide()
    end
  end
  -- Scroll buttons (right of the rows) and the "Showing a-b of n" line appear only when the list is longer than the rows.
  local scrolls = #items > LEFT_ROWS
  setShown(view.scrollUp, scrolls); setShown(view.scrollDown, scrolls)
  if scrolls then
    place(view.scrollUp, page, LIST_W + 2, listTop)
    place(view.scrollDown, page, LIST_W + 2, listTop - (LEFT_ROWS - 1) * LEFT_ROW_H)
  end
  if #items == 0 then
    local message
    if view.onlineOnly then message = L("Nobody who can craft these is online right now.")
    elseif mode == "search" then message = L("Nothing matches. Type at least 2 letters.")
    else message = L("No recipes shared yet. Open a profession window, then Share my recipes.") end
    view.leftNote:SetText(message)
    place(view.leftNote, page, 4, y); view.leftNote:Show()
    y = y - math.max(18, textHeight(view.leftNote) + 6)
  else view.leftNote:Hide() end
  -- "Showing a-b of n": n counts the items the list holds (a search keeps at most SEARCH_LIMIT);
  -- when the search found more than that, it says so. Nothing shown, nothing said.
  local kept = #items
  if shown > 0 and (scrolls or (mode == "search" and (view.total or 0) > kept)) then
    local text = string.format(L("Showing %d-%d of %d. Scroll with the mouse wheel."), view.offset + 1, view.offset + shown, kept)
    if mode == "search" and (view.total or 0) > kept then text = text .. " " .. L("Refine the search for more.") end
    view.more:SetText(text)
    place(view.more, page, 4, y); view.more:Show(); y = y - 16
  else view.more:Hide() end
  local leftBottom = y
  -- Detail pane.
  local detailBottom = renderDetail(view, page, DETAIL_X, top, off)
  return math.min(leftBottom, detailBottom) - 6
end

-- My requests sub-tab.
local function renderMine(view, page, y, off)
  local mine = orders.myRequests()
  view.mineHeader:SetText(string.format("%s (%d)", L("My requests"), #mine))
  view.mineHeader:Show(); place(view.mineHeader, page, 0, y); y = y - 20
  for i, row in ipairs(view.mineRows) do
    local entry = mine[i]
    if entry then
      local qty = entry.pending and entry.pending.qty or entry.order.qty
      local item = entry.pending and entry.pending.item or entry.order.item
      row.order = entry.order
      row.text:SetText(string.format("%dx |cffffd100%s|r", tonumber(qty) or 1, tostring(item or "?")))
      row.chips:SetText(orders.chipText(entry))
      local cancellable = entry.pending or (entry.order and (entry.view.status == "OPEN" or entry.view.status == "CLAIMED") and not entry.view.waiting)
      local received = entry.order and not entry.view.waiting and (entry.view.status == "DONE" or entry.view.status == "CLAIMED")
      row.first.orderId, row.first.action = entry.order and entry.order.id or nil, "received"
      row.first:SetText(L("Mark received")); row.first:SetWidth(110)
      setShown(row.first, received)
      row.second.orderId, row.second.action = entry.order and entry.order.id or nil, "cancel"
      row.second.ref = entry.pending and entry.pending.ref or nil
      row.second:SetText(L("Cancel"))
      setShown(row.second, cancellable)
      place(row.frame, page, 0, y)
      row.frame:Show()
      y = y - MINE_ROW_H
    else
      row.frame:Hide()
    end
  end
  if #mine > MINE_ROWS then view.mineEmpty:SetText(string.format(L("... and %d more."), #mine - MINE_ROWS)) elseif #mine == 0 then view.mineEmpty:SetText(L("No requests of yours.")) else view.mineEmpty:SetText("") end
  -- (9.3.4) An empty list says so on the header's own line (no second line of empty space under it).
  if #mine == 0 then
    place(view.mineEmpty, page, 150, y + 20); view.mineEmpty:SetWidth((view.width or 580) - 160); view.mineEmpty:Show()
  elseif view.mineEmpty:GetText() ~= "" then view.mineEmpty:SetWidth(view.width or 580); place(view.mineEmpty, page, 4, y); view.mineEmpty:Show(); y = y - 18
  else view.mineEmpty:Hide() end
  y = y - 6
  return y
end

-- Craft for the guild sub-tab: orders for my recipes, asked of me, mine in progress, then guildmates' not on Discord yet.
local function renderCraft(view, page, y, off, mine)
  local forMe = off and {} or orders.list(view.all)
  local mineIds = {}
  for _, entry in ipairs(mine) do if entry.order then mineIds[entry.order.id] = true end end
  local rows = {}
  for _, row in ipairs(forMe) do if not mineIds[row.order.id] and not orders.isMyRequest(row.order) then rows[#rows + 1] = row end end
  for _, heard in ipairs(off and {} or orders.heardForMe()) do rows[#rows + 1] = heard end
  view.forMeHeader:SetText(string.format("%s (%d)", L("Requests for me"), #rows))
  view.forMeHeader:Show(); view.allButton:Show(); place(view.forMeHeader, page, 0, y)
  view.allButton:SetText(view.all and L("Show my recipes") or L("Show all open orders"))
  -- Wide enough for the translated text (French "Toutes les commandes ouvertes" was cut off), kept inside the page.
  local allWidth = 170
  local allText = view.allButton.GetFontString and view.allButton:GetFontString()
  local needed = allText and allText.GetStringWidth and allText:GetStringWidth()
  if type(needed) == "number" and needed + 28 > allWidth then allWidth = math.ceil(needed + 28) end
  view.allButton:SetWidth(allWidth)
  place(view.allButton, page, (view.width or 580) - allWidth - 8, y + 4)
  y = y - 22
  for i, row in ipairs(view.forMeRows) do
    local entry = rows[i]
    if entry then
      row.order = entry.order
      if entry.pending then
        local request = entry.pending
        row.text:SetText(string.format("%dx |cffffd100%s|r  |cffaaaaaa%s %s - %s|r", tonumber(request.qty) or 1, tostring(request.item), L("for"), ns.displayName and ns.displayName(request.name) or tostring(request.name), L("not on Discord yet")))
        row.first:Hide(); row.second:Hide()
      else
        local order, view2 = entry.order, entry.view
        local mark = entry.forMe and ("|cff40c0ff" .. L("For you") .. "|r  ") or (not entry.canCraft and ("|cff808080" .. L("Not in your recipes") .. "|r  ")) or ""
        row.text:SetText(string.format("%s%dx %s  |cffaaaaaa%s %s - %s|r", mark, tonumber(order.qty) or 1, itemText(order), L("for"), tostring(order.by or "?"), orders.statusText(entry)))
        row.first.orderId, row.second.orderId = order.id, order.id
        if view2.status == "OPEN" then
          row.first.action, row.second.action = "claim", "done"
          row.first:SetText(L("Claim")); row.second:SetText(L("Done")); row.first:Show(); row.second:Show()
        elseif view2.status == "CLAIMED" and view2.mine then
          row.first.action, row.second.action = "done", "release"
          row.first:SetText(L("Done")); row.second:SetText(L("Give back")); row.first:Show(); row.second:Show()
        else row.first:Hide(); row.second:Hide() end
      end
      place(row.frame, page, 0, y)
      row.frame:Show()
      y = y - ROW_H
    else
      row.frame:Hide()
    end
  end
  if #rows > LIST_ROWS then view.forMeEmpty:SetText(string.format(L("... and %d more."), #rows - LIST_ROWS))
  elseif #rows == 0 then view.forMeEmpty:SetText(off and "" or (view.all and L("No open orders.") or L("No open orders for you."))) else view.forMeEmpty:SetText("") end
  if #rows == 0 and view.forMeEmpty:GetText() ~= "" then
    -- On the header's line, left of the Show all button.
    if view.forMeEmpty.SetWordWrap then view.forMeEmpty:SetWordWrap(false) end
    place(view.forMeEmpty, page, 190, y + 22); view.forMeEmpty:SetWidth(math.max(60, (view.width or 580) - allWidth - 206)); view.forMeEmpty:Show()
  elseif view.forMeEmpty:GetText() ~= "" then view.forMeEmpty:SetWidth(view.width or 580); place(view.forMeEmpty, page, 4, y); view.forMeEmpty:Show(); y = y - 18
  else view.forMeEmpty:Hide() end
  -- Shopping list across the orders you claimed.
  local shop = orders.shoppingList()
  view.shopHeader:SetText(string.format("%s (%d)", L("Shopping list"), #shop.rows))
  view.shopHeader:Show(); place(view.shopHeader, page, 0, y); y = y - 20
  for i, row in ipairs(view.shopRows) do
    local mat = shop.rows[i]
    if mat then
      local enough = mat.have and mat.have >= mat.need
      local colour = mat.have == nil and "|cffffffff" or enough and "|cff20ff20" or "|cffff4040"
      local lack = (mat.have and mat.have < mat.need) and ("  |cffff4040" .. string.format(L("%d to get"), mat.need - mat.have) .. "|r") or ""
      row.text:SetText(string.format("%s%s/%d|r %s%s", colour, mat.have and tostring(mat.have) or "?", mat.need, clip(mat.name, 40), lack))
      local icon = iconFor(mat.id)
      if row.icon.SetTexture then row.icon:SetTexture(icon or "Interface\\Icons\\INV_Misc_QuestionMark") end
      place(row.frame, page, 0, y); row.frame:Show()
      y = y - 19
    else
      row.frame:Hide()
    end
  end
  local note
  if shop.orders == 0 then note = L("Claim an order and its reagents add up here.")
  elseif #shop.rows > SHOP_ROWS then note = string.format(L("... and %d more reagents."), #shop.rows - SHOP_ROWS)
  elseif shop.unknown > 0 then note = string.format(L("%d claimed order(s) have no reagents yet: open that profession window once."), shop.unknown) end
  if note then view.shopNote:SetText(note); place(view.shopNote, page, 4, y); view.shopNote:Show(); y = y - 18 else view.shopNote:Hide() end
  y = y - 6
  view.hint:Show(); place(view.hint, page, 4, y); y = y - math.max(16, textHeight(view.hint) + 4)
  y = y - 8
  return y
end

function orders.render(view)
  if not view then return end
  orders.prune()
  local page, y = view.page, -34
  local current = orders.current()
  local off = current and current.off
  local sub = view.sub
  local mine = orders.myRequests()
  -- Sub-tab bar (the active one in gold, with counts).
  for _, button in ipairs(view.tabs) do
    local label = L(button.subId == "request" and "Request" or button.subId == "mine" and "My requests" or "Craft for the guild")
    if button.subId == "mine" and #mine > 0 then label = label .. " (" .. #mine .. ")" end
    if button.subId == "craft" and not off then
      local badge = orders.craftBadge()
      if badge > 0 then label = label .. " |cff40c0ff(" .. badge .. ")|r" end
    end
    button:SetText(button.subId == sub and ("|cffffd100" .. label .. "|r") or label)
  end
  -- Everything of the other sub-tabs is hidden first.
  for _, widget in ipairs(view.requestWidgets) do widget:Hide() end
  for _, row in ipairs(view.dReagents) do row.frame:Hide() end
  for _, widget in ipairs({ view.box, view.searchButton,
    view.mineHeader, view.mineEmpty, view.forMeHeader, view.forMeEmpty, view.allButton, view.hint, view.shopHeader, view.shopNote }) do widget:Hide() end
  for _, list in ipairs({ view.resultRows, view.mineRows, view.forMeRows, view.shopRows }) do for _, row in ipairs(list) do row.frame:Hide() end end
  if sub == "mine" then y = renderMine(view, page, y, off)
  elseif sub == "craft" then y = renderCraft(view, page, y, off, mine)
  else y = renderRequest(view, page, y, off) end
  -- Share, source, Advanced.
  place(view.shareButton, page, 0, y)
  view.sourceLabel:SetText(orders.sourceText(current))
  place(view.sourceLabel, page, 160, y - 5)
  y = y - 30
  place(view.advancedButton, page, 0, y)
  y = y - 28
  for _, widget in ipairs({ view.alertsButton, view.professions, view.mineLabel, view.cooldowns, view.cooldownLabel }) do setShown(widget, view.advanced) end
  if view.advanced then
    view.alertsButton:SetText(orders.alertsOn() and L("Order alerts: on") or L("Order alerts: off"))
    place(view.alertsButton, page, 0, y); y = y - 30
    place(view.professions, page, 0, y); y = y - 20
    if ns.recipes and ns.recipes.mineText then view.mineLabel:SetText(ns.recipes.mineText()) end
    place(view.mineLabel, page, 0, y); y = y - textHeight(view.mineLabel) - 12
    place(view.cooldowns, page, 0, y); y = y - 20
    local lines = ns.recipes and ns.recipes.cooldownLines and ns.recipes.cooldownLines(false) or {}
    local shown = {}
    for i = 1, math.min(8, #lines) do shown[i] = lines[i] end
    view.cooldownLabel:SetText(#shown > 0 and table.concat(shown, "\n") or ("|cff999999" .. L("No profession cooldowns are known. They are read when you open a profession window.") .. "|r"))
    place(view.cooldownLabel, page, 0, y); y = y - textHeight(view.cooldownLabel) - 8
  end
  view.contentHeight = -y + 12
end

function orders.refresh()
  local view = orders.ui
  if not view or (view.page and view.page.IsShown and not view.page:IsShown()) then return end
  local before = view.contentHeight
  local ok, err = pcall(orders.render, view)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "craft orders: " .. tostring(err)) end
  if view.relayout and view.contentHeight ~= before then pcall(view.relayout) end   -- the page grew or shrank: size the scroll area
end
ns.onOrdersChange = orders.refresh

-- ---------------------------------------------------------------------
-- Events: share at login, answer requests, hear orders and actions.
-- ---------------------------------------------------------------------
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("CHAT_MSG_ADDON")
local started = false
frame:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  local ok, err = pcall(function()
    if event == "PLAYER_ENTERING_WORLD" then
      if ns.comm and ns.comm.register then ns.comm.register(PREFIX) end
      if started then return end
      started = true
      local function later()
        orders.prune()
        local current = orders.current()
        if current and current.source == "companion" then orders.share() end
        orders.request()
        -- Actions still waiting: said again once, for a guildmate's companion to carry.
        local s = state()
        for _, action in pairs(s and s.actions or {}) do sayAction(action) end
        -- Requests not on Discord yet (the feed has no order with their ref): said again once for a guildmate's companion.
        local made = {}
        for _, order in ipairs(current and current.orders or {}) do if order.ref and orders.isMyRequest(order) then made[order.ref] = true end end
        for ref, request in pairs(s and s.requests or {}) do
          if not made[ref] and type(request) == "table" then orders.sayRequest(request) end
        end
        orders.loginAlert()
      end
      if C_Timer and C_Timer.After then C_Timer.After(35, later) end
      return
    end
    if not (ns.comm and ns.comm.accept(prefix, text, channel, sender, PREFIX)) or channel ~= "GUILD" or secret(text) or secret(sender) then return end
    sender = ns.normalizeName and ns.normalizeName(sender) or sender
    if not sender or sender == (ns.playerName and ns.playerName()) or (ns.isGuildMember and not ns.isGuildMember(sender)) then return end
    if string.sub(text, 1, 4) == "REQ|" then
      local current = orders.current()
      if current and current.at > string.sub(text, 5) then scheduleReply() end
    elseif string.sub(text, 1, 4) == "NEW|" then receiveNew(text, sender)
    elseif string.sub(text, 1, 7) == "ORDERS|" then receiveOrders(text, sender)
    elseif string.sub(text, 1, 8) == "ORDREFS|" then receiveRefs(text, sender)
    elseif string.sub(text, 1, 4) == "ACT|" then receiveAction(text, sender) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "craft orders: " .. tostring(err)) end
end)
