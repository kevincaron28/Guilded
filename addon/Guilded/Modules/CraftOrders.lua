-- Crafting orders (docs/plans/CRAFTING_ORDERS.md): the guild's Discord craft requests on the "Orders"
-- page of the Guilded window, for crafters to claim and finish in game.
--
--   Discord -> game  The companion writes GuildedOrders (open, claimed, and done in the last day) next to
--                    the standings. A member whose copy came from the companion shares it with the guild
--                    (GuildedOrd addon messages), so members without the companion see the orders too.
--   game -> Discord  Claim, Done and Give back are saved in db.craftOrders.actions and uploaded by your
--                    companion; the bot applies them like the Discord buttons, updates the forum post and
--                    DMs the requester. They are also said on GUILD, so a guildmate's companion carries
--                    them for crafters without one.
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
local ROWS = 6
local ROW_HEIGHT = 58

local orders = {}
ns.craftOrders = orders

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function fold(text) return string.lower(tostring(text or "")) end

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.craftOrders = type(db.craftOrders) == "table" and db.craftOrders or {}
  local s = db.craftOrders
  s.actions = type(s.actions) == "table" and s.actions or {}
  s.heard = type(s.heard) == "table" and s.heard or {}
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
    elseif action.action == "release" then status, mine = "OPEN", false end
  end
  return { status = status, mine = mine, waiting = action ~= nil }
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
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
  return row
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
  orders.prune()
  if ns.onOrdersChange then pcall(ns.onOrdersChange) end
end

-- A guildmate's claim, finish or give-back, as the game reported its sender: kept for this PC's companion to carry.
local function receiveAction(text, sender)
  local id, action, at, character = string.match(text, "^ACT|([%w_%-]+)|(%a+)|(%d+)|(.+)$")
  at = tonumber(at)
  if not id or #id > 40 or not (action == "claim" or action == "done" or action == "release") or not at or at > clock() + 600 or clock() - at > KEEP then return end
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
  ns.message(string.format(L("%d craft order(s) from Discord you can make: the Orders page of the Guilded window (/guilded orders)."), count))
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
  if ns.openToolsPage then pcall(ns.openToolsPage, "Orders") end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded orders [all | alerts on|off] - craft requests from Discord you can make")

function orders.render(view)
  if not view then return end
  orders.prune()
  local current = orders.current()
  view.header:SetText(orders.sourceText(current))
  view.alertsButton:SetText(orders.alertsOn() and L("Order alerts: on") or L("Order alerts: off"))
  view.allButton:SetText(view.all and L("Show my recipes") or L("Show all open orders"))
  local rows = orders.list(view.all)
  local pages = math.max(1, math.ceil(#rows / ROWS))
  if view.pageIndex > pages then view.pageIndex = pages end
  view.pageText:SetText(#rows > ROWS and string.format(L("Page %d / %d"), view.pageIndex, pages) or "")
  if #rows > ROWS then view.prevButton:Show(); view.nextButton:Show() else view.prevButton:Hide(); view.nextButton:Hide() end
  local off = not current or current.off
  view.empty:SetText(not off and #rows == 0 and (view.all and L("No open orders.") or L("No open orders for your recipes. Show all open orders to see the rest.")) or "")
  for i, line in ipairs(view.rows) do
    local row = rows[(view.pageIndex - 1) * ROWS + i]
    if row then
      local order = row.order
      local mark = row.forMe and ("|cff40c0ff" .. L("For you") .. "|r  ") or (not row.canCraft and ("|cff808080" .. L("Not in your recipes") .. "|r  ")) or ""
      line.title:SetText(string.format("%s%dx %s  |cffaaaaaa%s %s|r", mark, tonumber(order.qty) or 1, itemText(order), L("for"), tostring(order.by or "?")))
      line.status:SetText(orders.statusText(row))
      line.reagents:SetText(row.canCraft and orders.reagentText(order) or (order.prof and order.prof ~= "" and (ns.util.professionLabel(order.prof) or order.prof) or ""))
      line.note:SetText(order.note and order.note ~= "" and ("\"" .. clip(order.note, 110) .. "\"") or "")
      local view2 = row.view
      line.first.orderId, line.second.orderId = order.id, order.id
      if view2.status == "OPEN" then
        line.first.action, line.second.action = "claim", "done"
        line.first:SetText(L("Claim")); line.second:SetText(L("Done"))
        line.first:Show(); line.second:Show()
      elseif view2.status == "CLAIMED" and view2.mine then
        line.first.action, line.second.action = "done", "release"
        line.first:SetText(L("Done")); line.second:SetText(L("Give back"))
        line.first:Show(); line.second:Show()
      else
        line.first:Hide(); line.second:Hide()
      end
      line.frame:Show()
    else
      line.frame:Hide()
    end
  end
end

function orders.buildPage(page, helpers)
  local width = helpers.width or 580
  local view = { page = page, rows = {}, all = false, pageIndex = 1 }
  local function redraw() orders.refresh() end
  view.header = helpers.at(helpers.newLabel(page, "", "GameFontDisableSmall"), page, 0, 0)
  view.header:SetWidth(width - 140)
  view.alertsButton = helpers.newButton(page, "Order alerts: on", 130, function() orders.setAlerts(not orders.alertsOn()); redraw() end)
  view.alertsButton:SetPoint("TOPRIGHT", page, "TOPRIGHT", 0, 4)
  view.allButton = helpers.newButton(page, "Show all open orders", 170, function() view.all = not view.all; view.pageIndex = 1; redraw() end)
  view.allButton:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -20)
  view.pageText = helpers.newLabel(page, "", "GameFontHighlightSmall")
  view.pageText:SetPoint("LEFT", view.allButton, "RIGHT", 12, 0)
  view.prevButton = helpers.newButton(page, "Previous", 80, function() view.pageIndex = math.max(1, view.pageIndex - 1); redraw() end)
  view.prevButton:SetPoint("TOPRIGHT", page, "TOPRIGHT", -86, -20)
  view.nextButton = helpers.newButton(page, "Next", 80, function() view.pageIndex = view.pageIndex + 1; redraw() end)
  view.nextButton:SetPoint("TOPRIGHT", page, "TOPRIGHT", 0, -20)
  view.empty = helpers.newLabel(page, "", "GameFontHighlightSmall")
  view.empty:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -56)
  view.empty:SetWidth(width)
  local function onAction(self)
    local row, why = orders.act(self.orderId, self.action)
    if ns.message then
      if not row then ns.message(why)
      elseif self.action == "claim" then ns.message(L("Order claimed. Your companion tells Discord with your next sync (or a guildmate's does)."))
      elseif self.action == "done" then ns.message(L("Order marked done. The requester gets a Discord message after your next sync."))
      else ns.message(L("Order given back.")) end
    end
    redraw()
  end
  for i = 1, ROWS do
    local frame = CreateFrame("Frame", nil, page)
    frame:SetWidth(width)
    frame:SetHeight(ROW_HEIGHT - 4)
    frame:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -52 - (i - 1) * ROW_HEIGHT)
    local back = frame:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints(frame)
    if back.SetColorTexture then back:SetColorTexture(1, 1, 1, i % 2 == 0 and 0.04 or 0.08) end
    local line = { frame = frame }
    line.title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    line.title:SetPoint("TOPLEFT", frame, "TOPLEFT", 6, -4)
    line.title:SetWidth(width - 230)
    line.title:SetJustifyH("LEFT")
    line.status = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    line.status:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -6, -5)
    line.status:SetWidth(210)
    line.status:SetJustifyH("RIGHT")
    line.reagents = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    line.reagents:SetPoint("TOPLEFT", line.title, "BOTTOMLEFT", 0, -4)
    line.reagents:SetWidth(width - 190)
    line.reagents:SetJustifyH("LEFT")
    line.note = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    line.note:SetPoint("TOPLEFT", line.reagents, "BOTTOMLEFT", 0, -3)
    line.note:SetWidth(width - 190)
    line.note:SetJustifyH("LEFT")
    line.second = helpers.newButton(frame, "Done", 80, onAction)
    line.second:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -4, 4)
    line.first = helpers.newButton(frame, "Claim", 80, onAction)
    line.first:SetPoint("RIGHT", line.second, "LEFT", -6, 0)
    frame:Hide()
    view.rows[i] = line
  end
  local hint = helpers.newLabel(page, "Claim an order, craft it, then press Done. Trade or mail the item to the requester; gold never goes through Guilded.", "GameFontDisableSmall")
  hint:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -56 - ROWS * ROW_HEIGHT)
  hint:SetWidth(width)
  orders.ui = view
  page:HookScript("OnShow", redraw)
  return view
end

function orders.refresh()
  local view = orders.ui
  if not view or (view.page and view.page.IsShown and not view.page:IsShown()) then return end
  local ok, err = pcall(orders.render, view)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "craft orders: " .. tostring(err)) end
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
    elseif string.sub(text, 1, 7) == "ORDERS|" then receiveOrders(text, sender)
    elseif string.sub(text, 1, 4) == "ACT|" then receiveAction(text, sender) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "craft orders: " .. tostring(err)) end
end)
