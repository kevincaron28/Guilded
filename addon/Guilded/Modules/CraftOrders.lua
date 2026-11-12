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
-- it off with /craft orders-setting in Discord; each member turns off the login line with the Order
-- alerts button or /guilded orders alerts off. Plain Guilded frames only: safe in combat.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedOrd"
local PART = 190
local MAX_PARTS = 40
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

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.craftOrders = type(db.craftOrders) == "table" and db.craftOrders or {}
  local s = db.craftOrders
  s.actions = type(s.actions) == "table" and s.actions or {}
  s.heard = type(s.heard) == "table" and s.heard or {}
  s.requests = type(s.requests) == "table" and s.requests or {}
  s.heardRequests = type(s.heardRequests) == "table" and s.heardRequests or {}
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

-- Reagents of a recipe you know, times the order's count, with what is in your bags (and bank).
function orders.reagents(order)
  local book = ns.recipes and ns.recipes.book and ns.recipes.book()
  local mats = book and order.key and book.mats[order.key]
  if type(mats) ~= "table" then return nil end
  local rows = {}
  for _, mat in ipairs(mats) do
    local need = (tonumber(mat.count) or 1) * math.max(1, tonumber(order.qty) or 1)
    local have = GetItemCount and GetItemCount(mat.id, true) or nil
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
  local lines, size = {}, 0
  for _, o in ipairs(current.orders or {}) do
    local line = table.concat({ encode(o.id), tonumber(o.key) or 0, tonumber(o.qty) or 1, STATUS[o.status] or "O", tonumber(o.at) or 0, o.mats and 1 or 0,
      encode(o.item), encode(o.by), encode(o.crafter), encode(o.character), encode(o.asked), encode(o.prof), encode(string.sub(tostring(o.note or ""), 1, 80)) }, ";")
    if size + #line + 1 > PART * MAX_PARTS then break end
    lines[#lines + 1] = line
    size = size + #line + 1
  end
  return #lines > 0 and table.concat(lines, "\n") or "E"
end

function orders.decode(text)
  if text == "X" then return { off = true, orders = {} } end
  local result = { orders = {} }
  if text == "E" then return result end
  for line in string.gmatch(text .. "\n", "([^\n]*)\n") do
    local id, key, qty, status, at, mats, rest = string.match(line, "^([%w_%-]+);(%-?%d+);(%d+);([OCD]);(%d+);([01]);(.*)$")
    if not id or #id > 40 or #result.orders >= 50 then return nil end
    local fields = {}
    for field in string.gmatch(rest .. ";", "([^;]*);") do fields[#fields + 1] = decode(field) end
    if #fields ~= 7 then return nil end
    key = tonumber(key)
    result.orders[#result.orders + 1] = { id = id, key = key ~= 0 and key or nil, qty = math.max(1, tonumber(qty) or 1), status = STATUS_BACK[status], at = tonumber(at), mats = mats == "1",
      item = string.sub(fields[1], 1, 100), by = string.sub(fields[2], 1, 60), crafter = string.sub(fields[3], 1, 60), character = string.sub(fields[4], 1, 60),
      asked = string.sub(fields[5], 1, 60), prof = string.sub(fields[6], 1, 40), note = string.sub(fields[7], 1, 80) }
  end
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
  ns.message(string.format(L("%d craft order(s) from Discord you can make: the Crafting page of the Guilded window (/guilded orders)."), count))
  return true
end

function orders.sourceText(current)
  if not current then return L("No orders from Discord yet. They arrive after your companion syncs, or when a guildmate who has it shares them.") end
  if current.off then return L("Your officers turned crafting orders off (in Discord: /craft orders-setting).") end
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
local RES_ROWS = 4       -- recipes shown under the search box
local LIST_ROWS = 5      -- rows in each of the two lists
local ROW_H = 28
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
      if view.status == "OPEN" or view.status == "CLAIMED" or view.status == "DONE" then
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

-- Sends a request. Returns the saved row, or nil and why. `opts`: item, key, prof, qty, note, asked.
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
  local ref = string.format("g%x%03x", now, math.random(0, 4095))
  local row = { ref = ref, item = item, key = tonumber(opts.key), prof = opts.prof and cleanText(opts.prof, 40) or nil, qty = qty,
    note = opts.note and cleanText(opts.note, 80) or nil, mats = false,
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
  request.prof, request.asked, request.note = cleanText(request.prof, 24), cleanText(request.asked, 60), cleanText(request.note, 40)
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
  local view = { page = page, width = width, results = {}, all = false, options = false, advanced = false }
  orders.ui = view
  view.relayout = helpers.relayout

  -- Search: one box (type a name, or shift-click an item), results under it.
  view.box = at(newEdit(page, 330), page, 6, 0)
  if helpers.itemBox then helpers.itemBox(view.box) end
  if helpers.placeholder then helpers.placeholder(view.box, "Item or recipe: type a name, or shift-click an item") end
  local function search()
    local text = view.box:GetText() or ""
    view.query = text
    view.results, view.total = {}, 0
    if text ~= "" and ns.recipes and ns.recipes.search then view.results, view.total = ns.recipes.search(text, RES_ROWS) end
    -- Nobody known for that name yet: it can still be requested by name (the bot looks the item up).
    if #view.results == 0 and #text >= 2 then view.results, view.total = { { name = string.sub(text, 1, 60), crafters = {} } }, 1 end
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
  view.searchButton:SetPoint("TOPLEFT", page, "TOPLEFT", 344, 3)
  view.note = newLabel(page, "", "GameFontHighlightSmall")
  view.note:SetWidth(width)
  view.more = newLabel(page, "", "GameFontDisableSmall")
  view.more:SetWidth(width)

  -- Request options (collapsed): ask one crafter, quantity, a note.
  view.optionsButton = newButton(page, "More options", 120, function() view.options = not view.options; orders.refresh(true) end, 22)
  view.askButton = newButton(page, "Ask: anyone", 190, function()
    local names, seen = {}, {}
    for _, entry in ipairs(view.results) do
      for _, crafter in ipairs(entry.crafters or {}) do
        if not crafter.me and not seen[crafter.name] then seen[crafter.name] = true; names[#names + 1] = crafter end
      end
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
  view.noteBox = newEdit(page, 200)
  view.noteBox:SetMaxLetters(60)

  local function request(row)
    if not row then return end
    local asked = nil   -- the asked crafter, by full "First Last" name, only when that one can make this item
    for _, crafter in ipairs(row.entry.crafters or {}) do
      if view.asked and crafter.name == view.asked then asked = crafter.shown or crafter.name end
    end
    local saved, why = orders.submit({ item = row.entry.name, key = row.entry.key, prof = row.entry.crafters and row.entry.crafters[1] and row.entry.crafters[1].profession,
      qty = tonumber(view.qtyBox:GetText()) or 1, note = view.noteBox:GetText(), asked = asked })
    if not saved then if ns.message then ns.message(why) end return end
    view.noteBox:SetText("")
    view.qtyBox:SetText("1")
    view.asked, view.askedShown = nil, nil   -- the options are for that one request
    orders.refresh()
    if ns.message then ns.message(string.format(L("Asked the guild for %dx %s. It is posted on Discord with your next sync."), saved.qty, saved.item)) end
  end

  view.resultRows = {}
  for i = 1, RES_ROWS do
    local frame = CreateFrame("Frame", nil, page)
    frame:SetWidth(width)
    frame:SetHeight(ROW_H - 2)
    local row = { frame = frame }
    row.text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    row.text:SetPoint("LEFT", frame, "LEFT", 4, 0)
    row.text:SetWidth(width - 110)
    row.text:SetJustifyH("LEFT")
    row.button = newButton(frame, "Request", 90, function() request(row) end, 22)
    row.button:SetPoint("RIGHT", frame, "RIGHT", 0, 0)
    frame:Hide()
    view.resultRows[i] = row
  end

  -- The two lists.
  local function listRow(parent, withTooltip)
    local frame = CreateFrame("Frame", nil, parent)
    frame:SetWidth(width)
    frame:SetHeight(ROW_H - 2)
    local row = { frame = frame }
    row.text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.text:SetPoint("LEFT", frame, "LEFT", 4, 0)
    row.text:SetWidth(width - 190)
    row.text:SetJustifyH("LEFT")
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
  for i = 1, LIST_ROWS do
    local row = listRow(page, false)
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
  view.hint = newLabel(page, "Claim an order, craft it, then press Done. Trade or mail the item to the requester; gold never goes through Guilded.", "GameFontDisableSmall")
  view.hint:SetWidth(width)

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

  page:HookScript("OnShow", function() orders.refresh(true) end)
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

function orders.render(view)
  if not view then return end
  orders.prune()
  local page, y = view.page, -34
  local current = orders.current()
  local off = current and current.off
  -- Search results.
  local n = math.min(RES_ROWS, #view.results)
  for i, row in ipairs(view.resultRows) do
    local entry = view.results[i]
    row.entry = entry
    if entry then
      row.text:SetText(string.format("|cffffd100%s|r  |cffaaaaaa->|r  %s", entry.name, orders.crafterText(entry)))
      setShown(row.button, not off)
      place(row.frame, page, 0, y)
      row.frame:Show()
      y = y - ROW_H
    else
      row.frame:Hide()
    end
  end
  if n == 0 then
    view.note:SetText(off and L("Your officers turned crafting orders off (in Discord: /craft orders-setting).") or L("Type what you need above. Results show who can craft it; Request asks the guild."))
    place(view.note, page, 4, y)
    view.note:Show()
    y = y - math.max(18, textHeight(view.note) + 6)
  else
    view.note:Hide()
  end
  local extra = (view.total or n) - n
  if extra > 0 then
    view.more:SetText(string.format(L("... and %d more matches. Be more specific."), extra))
    place(view.more, page, 4, y); view.more:Show(); y = y - 16
  else view.more:Hide() end
  -- Options (collapsed).
  place(view.optionsButton, page, 0, y)
  view.optionsButton:SetText(view.options and L("Fewer options") or L("More options"))
  y = y - 26
  for _, widget in ipairs({ view.askButton, view.qtyLabel, view.qtyBox, view.noteLabel, view.noteBox }) do setShown(widget, view.options) end
  if view.options then
    view.askButton:SetText(view.askedShown and string.format(L("Ask: %s"), view.askedShown) or L("Ask: anyone"))
    place(view.askButton, page, 0, y)
    place(view.qtyLabel, page, 200, y - 5)
    place(view.qtyBox, page, 262, y - 1)
    place(view.noteLabel, page, 314, y - 5)
    place(view.noteBox, page, 352, y - 1)
    y = y - 30
  end
  y = y - 6
  -- My requests.
  local mine = orders.myRequests()
  view.mineHeader:SetText(string.format("%s (%d)", L("My requests"), #mine))
  place(view.mineHeader, page, 0, y); y = y - 20
  for i, row in ipairs(view.mineRows) do
    local entry = mine[i]
    if entry then
      local qty = entry.pending and entry.pending.qty or entry.order.qty
      local item = entry.pending and entry.pending.item or entry.order.item
      row.order = entry.order
      row.text:SetText(string.format("%dx |cffffd100%s|r  |cffaaaaaa%s|r", tonumber(qty) or 1, tostring(item or "?"), orders.requestStatusText(entry)))
      local cancellable = entry.pending or (entry.order and (entry.view.status == "OPEN" or entry.view.status == "CLAIMED") and not entry.view.waiting)
      row.first:Hide()
      row.second.orderId, row.second.action = entry.order and entry.order.id or nil, "cancel"
      row.second.ref = entry.pending and entry.pending.ref or nil
      row.second:SetText(L("Cancel"))
      setShown(row.second, cancellable)
      place(row.frame, page, 0, y)
      row.frame:Show()
      y = y - ROW_H
    else
      row.frame:Hide()
    end
  end
  if #mine > LIST_ROWS then view.mineEmpty:SetText(string.format(L("... and %d more."), #mine - LIST_ROWS)) elseif #mine == 0 then view.mineEmpty:SetText(L("No requests of yours.")) else view.mineEmpty:SetText("") end
  if view.mineEmpty:GetText() ~= "" then place(view.mineEmpty, page, 4, y); view.mineEmpty:Show(); y = y - 18 else view.mineEmpty:Hide() end
  y = y - 6
  -- Requests for me (orders for my recipes, asked of me, mine in progress), then guildmates' not on Discord yet.
  local forMe = off and {} or orders.list(view.all)
  local mineIds = {}
  for _, entry in ipairs(mine) do if entry.order then mineIds[entry.order.id] = true end end
  local rows = {}
  for _, row in ipairs(forMe) do if not mineIds[row.order.id] and not orders.isMyRequest(row.order) then rows[#rows + 1] = row end end
  for _, heard in ipairs(off and {} or orders.heardForMe()) do rows[#rows + 1] = heard end
  view.forMeHeader:SetText(string.format("%s (%d)", L("Requests for me"), #rows))
  place(view.forMeHeader, page, 0, y)
  view.allButton:SetText(view.all and L("Show my recipes") or L("Show all open orders"))
  place(view.allButton, page, (view.width or 580) - 170, y + 4)
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
  elseif #rows == 0 then view.forMeEmpty:SetText(off and "" or (view.all and L("No open orders.") or L("No open orders for your recipes. Show all open orders to see the rest."))) else view.forMeEmpty:SetText("") end
  if view.forMeEmpty:GetText() ~= "" then place(view.forMeEmpty, page, 4, y); view.forMeEmpty:Show(); y = y - 18 else view.forMeEmpty:Hide() end
  place(view.hint, page, 4, y); y = y - math.max(16, textHeight(view.hint) + 4)
  y = y - 8
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
