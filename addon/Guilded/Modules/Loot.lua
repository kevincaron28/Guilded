-- Loot systems per raid core. The Discord bot knows how each raid core decides loot; the
-- companion writes that into Standings.lua (GuildedLoot) and Sync.lua keeps it for the officer.
--
--   EPGP      players bid GP (Modules/Bidding.lua)
--   COUNCIL   raiders answer BiS / upgrade / off-spec, officers decide (Modules/Council.lua)
--   RESERVE   soft reserves: the reservers of a dropped item roll for it (Modules/Reserve.lua)
--   PRIORITY  every item has a set GP price; it goes to the highest PR of the players who want
--             it, and they pay that price (Modules/Council.lua, priority kind)
--
-- Which core is being run: the raid the bot expects next (its core), or the one you pick with
-- /guilded core <name>. With no core the guild's default system is used.
--
--   /guilded drop <item link> [seconds]   an item dropped: start it the way this core does it
--   /guilded drop mode [system|auto]      show, or override, the loot system
--   /guilded core [name|auto]             show, or pick, the raid core you are running
local addonName, ns = ...
ns = ns or {}

local loot = {}
ns.loot = loot

local MODES = { EPGP = true, COUNCIL = true, RESERVE = true, PRIORITY = true }
local MODE_LABEL = {
  EPGP = "GP bids", COUNCIL = "loot council", RESERVE = "soft reserves", PRIORITY = "EPGP priority (set prices)"
}
local DEFAULT_SECONDS = { EPGP = 30, COUNCIL = 60, PRIORITY = 45 }

local function L(text) return ns.L and ns.L(text) or text end

local function settings()
  return ns.getSettings and ns.getSettings()
end

local function rules()
  return ns.getLootRules and ns.getLootRules() or nil
end

-- Same spelling rule as the bot's item keys and the tooltip's (Util.lua).
local function itemKey(name) return ns.util.itemKey(name) end

-- ---------------------------------------------------------------------
-- Which core, which system
-- ---------------------------------------------------------------------

-- The rules of a core by its id, or by its name (case does not matter), or nil. Ids are what is
-- kept (a core renamed on Discord still matches); names are what people type.
local function coreNamed(value)
  local r = rules()
  if not (r and value and value ~= "") then return nil end
  for _, core in ipairs(r.cores or {}) do
    if core.id ~= "" and core.id == value then return core end
  end
  local wanted = string.lower(value)
  for _, core in ipairs(r.cores or {}) do
    if string.lower(core.name) == wanted then return core end
  end
  return nil
end
loot.coreNamed = coreNamed

-- The core being run: picked by hand, else the one the next raid was made for. Returns its
-- current name (a saved id is turned into the name Discord has now) and whether it was picked.
function loot.coreName()
  local s = settings()
  if s and s.activeCore and s.activeCore ~= "" then
    local core = coreNamed(s.activeCore)
    return core and core.name or s.activeCore, true
  end
  local nextRaid = GuildedNextRaid
  if type(nextRaid) == "table" then
    local byId = type(nextRaid.coreId) == "string" and nextRaid.coreId ~= "" and coreNamed(nextRaid.coreId)
    if byId then return byId.name, false end
    if type(nextRaid.core) == "string" and nextRaid.core ~= "" then return nextRaid.core, false end
  end
  return nil
end

function loot.core()
  local s = settings()
  if s and s.activeCore and s.activeCore ~= "" then return coreNamed(s.activeCore) end
  local nextRaid = GuildedNextRaid
  if type(nextRaid) == "table" and type(nextRaid.coreId) == "string" and nextRaid.coreId ~= "" then
    local byId = coreNamed(nextRaid.coreId)
    if byId then return byId end
  end
  return coreNamed((loot.coreName()))
end

-- "EPGP", "COUNCIL", "RESERVE" or "PRIORITY", and where that came from.
function loot.mode()
  local s = settings()
  if s and MODES[s.lootMode or ""] then return s.lootMode, "override" end
  local core = loot.core()
  if core and MODES[core.mode or ""] then return core.mode, "core" end
  local r = rules()
  if r and MODES[r.default or ""] then return r.default, "guild" end
  return "EPGP", "guild"
end

function loot.label(mode)
  return L(MODE_LABEL[mode] or mode)
end

function loot.reserveLimit()
  local core = loot.core()
  return core and core.reserves or 1
end

-- Prices an officer set in game (the popup below, or /guilded price): used at once, and sent
-- to Discord with the next companion upload (the newer of this and Discord's price is kept).
-- db.itemPrices["<core id>:<item key>"] = { name, id, gp, core, at }.
local function localPrices()
  local d = ns.getDb and ns.getDb()
  if not d then return nil end
  d.itemPrices = d.itemPrices or {}
  return d.itemPrices
end

function loot.setPrice(item, gp)
  local prices = localPrices()
  local name = string.match(item or "", "%[(.-)%]") or item
  local key = itemKey(name)
  gp = math.floor(tonumber(gp) or -1)
  if not (prices and key) or gp < 0 or gp > 100000 then return false end
  local core = loot.core()
  local coreId = core and core.id or ""
  prices[coreId .. ":" .. key] = {
    name = name, id = tonumber(string.match(item or "", "item:(%d+)")), gp = gp, core = coreId,
    at = ns.now and ns.now() or ""
  }
  if ns.syncNow and ns.syncNow.mark then ns.syncNow.mark() end
  return true, name, core and core.name
end

-- The set GP price of an item (a link, or a plain name) in this core, or nil.
function loot.priceOf(item)
  if type(item) ~= "string" then return nil end
  local core = loot.core()
  local r = rules()
  local name = string.match(item, "%[(.-)%]") or item
  local id = string.match(item, "item:(%d+)") or string.match(item, "^%s*(%d+)%s*$")
  -- A price set in game wins (it is the newest), this core's first, then the guild-wide one.
  local prices = localPrices()
  local key = itemKey(name)
  if prices and key then
    local own = (core and core.id ~= "" and prices[core.id .. ":" .. key]) or prices[":" .. key]
    if own then return own.gp end
  end
  local keys = {}
  local byName = itemKey(name)
  if byName and not string.match(item, "^%s*%d+%s*$") then table.insert(keys, byName) end
  if id then table.insert(keys, "#" .. id) end
  for _, source in ipairs({ core and core.values, r and r.values }) do
    for _, key in ipairs(keys) do
      if source and source[key] then return source[key] end
    end
  end
  return nil
end

-- PR in the pool the core uses: its own pool when it has one, else the guild pool.
function loot.prFor(name)
  local core = loot.core()
  if core and core.pool then
    local row = core.players and core.players[name]
    return row and row.pr or 0
  end
  local standing = ns.getStanding and ns.getStanding(name)
  return standing and standing.pr or 0
end

-- EP in the pool the core uses (for the core's minimum EP).
function loot.epFor(name)
  local core = loot.core()
  if core and core.pool then
    local row = core.players and core.players[name]
    return row and row.ep or 0
  end
  local standing = ns.getStanding and ns.getStanding(name)
  return standing and standing.ep or 0
end

-- The share of the price an off-spec win costs (percent, 50 unless Discord says otherwise:
-- /core rules offspec_percent) and the EP a player needs before priority counts them first
-- (/core rules min_ep; 0 = no minimum).
function loot.offspecPercent()
  local core = loot.core()
  local value = core and tonumber(core.offspec)
  if not value then return 50 end
  return math.max(0, math.min(100, value))
end

function loot.minEp()
  local core = loot.core()
  return math.max(0, core and tonumber(core.minEp) or 0)
end

-- A starting GP price for an item nobody priced yet, from its item level and slot: the usual EPGP
-- shape (price doubles every 26 item levels, weighted by slot), scaled so a Classic tier chest
-- (ilvl 66-78) lands around 70-100 GP and capped at 5000. Only a suggestion: the officer sees it
-- in the price box and can change it. nil when the game does not know the item yet.
local SLOT_WEIGHT = {
  INVTYPE_HEAD = 1, INVTYPE_CHEST = 1, INVTYPE_ROBE = 1, INVTYPE_LEGS = 1, INVTYPE_2HWEAPON = 2,
  INVTYPE_SHOULDER = 0.75, INVTYPE_HAND = 0.75, INVTYPE_WAIST = 0.75, INVTYPE_FEET = 0.75, INVTYPE_TRINKET = 0.75,
  INVTYPE_WRIST = 0.5625, INVTYPE_NECK = 0.5625, INVTYPE_CLOAK = 0.5625, INVTYPE_FINGER = 0.5625,
  INVTYPE_SHIELD = 0.5625, INVTYPE_HOLDABLE = 0.5625, INVTYPE_WEAPONOFFHAND = 0.5625,
  INVTYPE_WEAPON = 1.5, INVTYPE_WEAPONMAINHAND = 1.5,
  INVTYPE_RANGED = 0.5, INVTYPE_RANGEDRIGHT = 0.5, INVTYPE_THROWN = 0.5, INVTYPE_RELIC = 0.3
}
function loot.suggestGp(level, equipLoc, quality)
  level = tonumber(level)
  if not level or level <= 0 then return nil end
  local weight = SLOT_WEIGHT[equipLoc or ""] or 1
  -- Epic items cost the full price; rare ones less (as in the EPGP tables).
  local qualityFactor = (tonumber(quality) or 4) >= 4 and 1 or 0.6
  local value = 200 * 2 ^ (level / 26 - 4) * weight * qualityFactor
  value = math.min(5000, value) -- capped before rounding (huge item levels overflow an integer)
  return math.max(1, math.floor(value / 5 + 0.5) * 5)
end

function loot.suggestFor(item)
  local suggestion
  pcall(function()
    if not GetItemInfo then return end
    local _, _, quality, level, _, _, _, _, equipLoc = GetItemInfo(item)
    suggestion = loot.suggestGp(level, equipLoc, quality)
  end)
  return suggestion
end

-- ---------------------------------------------------------------------
-- An item dropped
-- ---------------------------------------------------------------------

local function officerOnly()
  if ns.isOfficer() then return true end
  ns.message(L("Only officers can do that."))
  return false
end

local function call(handler, args)
  local fn = ns.commandHandlers and ns.commandHandlers[handler]
  if not fn then ns.message(string.format("The %s part of Guilded is not loaded.", handler)) return end
  fn(args)
end

local function moduleOn(key)
  return not ns.moduleActive or ns.moduleActive(key)
end

function loot.drop(args)
  if not officerOnly() then return end
  local last = #args
  local seconds
  if last >= 2 and tonumber(args[last]) then
    seconds = math.floor(tonumber(args[last]))
    last = last - 1
  end
  local item = table.concat(args, " ", 1, last)
  if item == "" then ns.message("Usage: /guilded drop <item link> [seconds]   (mode: /guilded drop mode)") return end
  local mode = loot.mode()
  seconds = seconds or DEFAULT_SECONDS[mode]

  if mode == "COUNCIL" then
    if not moduleOn("council") then ns.message(L("Loot council is off (/guilded modules).")) return end
    call("council", { "start", item, tostring(seconds) })
  elseif mode == "PRIORITY" then
    if not moduleOn("council") then ns.message(L("Loot council is off (/guilded modules).")) return end
    local price = loot.priceOf(item)
    if not price then
      -- No price yet: ask for one right here; it is kept and sent to Discord for next time.
      if loot.askPrice(item, seconds) then return end
      ns.message(string.format(L("No GP price is set for %s in %s. Set it with /guilded price <item> <GP> (or /core items on Discord), then drop it again."),
        item, loot.coreName() or L("this raid")))
      return
    end
    if not (ns.council and ns.council.startPriority) then ns.message("Priority loot is not loaded.") return end
    ns.council.startPriority(item, price, seconds)
  elseif mode == "RESERVE" then
    if not moduleOn("reserve") then ns.message(L("Soft reserves are off (/guilded modules).")) return end
    local id = ns.reserve and ns.reserve.itemId(item)
    if not id then ns.message(L("Shift-click the item so Guilded can see who reserved it.")) return end
    local holders = ns.reserve.holders(id)
    if #holders > 0 then
      call("reserve", { "roll", item })
    else
      ns.message(string.format(L("Nobody reserved %s: free roll. Players type 1 to join, then /guilded games roll."), item))
      if moduleOn("games") then call("games", { "highroll" }) end
    end
  else
    if not moduleOn("bidding") then ns.message(L("GP bidding is off (/guilded modules).")) return end
    local r = rules()
    call("bid", { "start", tostring(r and r.minimumBid or 10), item, tostring(seconds) })
  end
end

-- The "what does this cost?" box: a game popup with a number field. Accept saves the price and
-- starts the item at it. Returns false where the popup system is missing (tests, odd clients).
local PRICE_POPUP = "GUILDED_ITEM_PRICE"
function loot.priceAccepted(data, text)
  local gp = math.floor(tonumber(text) or -1)
  if gp < 0 or gp > 100000 then ns.message(L("Type a price from 0 to 100000 GP.")) return false end
  local ok, name, coreName = loot.setPrice(data.item, gp)
  if not ok then return false end
  ns.message(string.format(L("%s now costs %d GP in %s (sent to Discord with the next upload)."), name, gp, coreName or L("every core")))
  if ns.council and ns.council.startPriority then ns.council.startPriority(data.item, gp, data.seconds) end
  return true
end

function loot.askPrice(item, seconds)
  if not (StaticPopupDialogs and StaticPopup_Show) then return false end
  if not StaticPopupDialogs[PRICE_POPUP] then
    StaticPopupDialogs[PRICE_POPUP] = {
      text = L("%s has no GP price in %s yet. Its price in GP:"),
      button1 = ACCEPT or "Accept", button2 = CANCEL or "Cancel",
      hasEditBox = true, timeout = 0, whileDead = true, hideOnEscape = true,
      OnAccept = function(self, data)
        local box = self.editBox or self.EditBox
        pcall(loot.priceAccepted, data, box and box:GetText() or "")
      end,
      EditBoxOnEnterPressed = function(box)
        local popup = box:GetParent()
        pcall(loot.priceAccepted, popup.data, box:GetText() or "")
        popup:Hide()
      end,
      EditBoxOnEscapePressed = function(box) box:GetParent():Hide() end
    }
  end
  local ok, frame = pcall(StaticPopup_Show, PRICE_POPUP, string.match(item, "%[(.-)%]") or item, loot.coreName() or L("this raid"), { item = item, seconds = seconds })
  -- Prefilled with a suggestion from the item level and slot (see suggestGp).
  local suggestion = ok and loot.suggestFor(item)
  local box = frame and (frame.editBox or frame.EditBox)
  if suggestion and box and box.SetText then
    pcall(box.SetText, box, tostring(suggestion))
    if box.HighlightText then pcall(box.HighlightText, box) end
  end
  return ok
end

-- ---------------------------------------------------------------------
-- Drops seen in the raid, and trades still owed
-- ---------------------------------------------------------------------
--
-- The officer's addon notes the epic items that drop (a corpse opened with LOOT_OPENED, or items
-- handed out by personal / group loot with ENCOUNTER_LOOT_RECEIVED, which also names who got
-- it). The Loot page lists them with a Drop button, so nobody has to shift-click from the loot
-- window. When an item is awarded to someone other than the player holding it, both are told
-- to trade it: a looted item can only be traded for 2 hours.

local DROP_KEEP_SECONDS = 2 * 60 * 60
local TRADE_SECONDS = 2 * 60 * 60
local MIN_QUALITY = 4 -- epic
local MAX_DROPS = 30

local function serverNow() return ns.util.serverTime() end

local function dropState()
  local d = ns.getDb and ns.getDb()
  if not d then return nil end
  d.lootDrops = d.lootDrops or { items = {}, trades = {} }
  local now = serverNow()
  for _, list in ipairs({ d.lootDrops.items, d.lootDrops.trades }) do
    for i = #list, 1, -1 do
      if (now - (tonumber(list[i].at) or 0)) > DROP_KEEP_SECONDS then table.remove(list, i) end
    end
  end
  return d.lootDrops
end

local function nameOfLink(link) return string.match(link or "", "%[(.-)%]") or link end

local function qualityOf(link, fallback)
  if fallback then return fallback end
  local quality
  pcall(function() if GetItemInfo then quality = select(3, GetItemInfo(link)) end end)
  return quality
end

-- Returns true when the drop was new. `key` tells the same drop seen twice apart from a second copy.
function loot.recordDrop(link, holder, key, quality)
  if type(link) ~= "string" or link == "" then return false end
  quality = qualityOf(link, quality)
  if quality and quality < MIN_QUALITY then return false end
  local state = dropState()
  if not state then return false end
  key = key or (link .. "|" .. tostring(holder or ""))
  for _, entry in ipairs(state.items) do
    if entry.key == key then return false end
  end
  table.insert(state.items, { key = key, link = link, holder = holder, at = serverNow() })
  while #state.items > MAX_DROPS do table.remove(state.items, 1) end
  if ns.onLootChange then pcall(ns.onLootChange) end
  return true
end

-- Drops not started yet, newest first.
function loot.drops()
  local state = dropState()
  local list = {}
  if not state then return list end
  for i = #state.items, 1, -1 do
    if not state.items[i].started then table.insert(list, state.items[i]) end
  end
  return list
end

-- Starts a listed drop the way this core decides loot.
function loot.startDrop(index)
  local entry = loot.drops()[tonumber(index) or 0]
  if not entry then ns.message(L("No such drop. /guilded drops lists them.")) return end
  entry.started = true
  loot.drop({ entry.link })
  if ns.onLootChange then pcall(ns.onLootChange) end
end

-- Called when loot is recorded (Core.lua): if a player other than the winner holds the item,
-- remember the trade and say so.
function loot.noteAward(item, winner)
  local state = dropState()
  if not (state and winner) then return end
  local wanted = nameOfLink(item)
  for i = #state.items, 1, -1 do
    local entry = state.items[i]
    if nameOfLink(entry.link) == wanted and not entry.awarded then
      entry.awarded, entry.started = winner, true
      if entry.holder and entry.holder ~= winner then
        table.insert(state.trades, { link = entry.link, holder = entry.holder, winner = winner, at = entry.at })
        if entry.holder == ns.playerName() then
          ns.message(string.format(L("Trade %s to %s (you can trade it for 2 hours after it dropped)."), entry.link, winner))
        else
          ns.message(string.format(L("%s holds %s: remind them to trade it to %s within 2 hours."), entry.holder, entry.link, winner))
        end
      end
      if ns.onLootChange then pcall(ns.onLootChange) end
      return
    end
  end
end

-- "Holder -> winner: item (1:23 left)" lines, for the Loot page and /guilded drops.
function loot.tradesText()
  local state = dropState()
  local lines = {}
  if not state then return "" end
  local now = serverNow()
  for _, trade in ipairs(state.trades) do
    if not trade.done then
      local left = math.max(0, TRADE_SECONDS - (now - (tonumber(trade.at) or now)))
      table.insert(lines, string.format(L("Trade: %s -> %s: %s (%d:%02d left)"), trade.holder, trade.winner, nameOfLink(trade.link),
        math.floor(left / 3600), math.floor(left / 60) % 60))
    end
  end
  return table.concat(lines, "\n")
end

function loot.clearDrops()
  local d = ns.getDb and ns.getDb()
  if d then d.lootDrops = { items = {}, trades = {} } end
  if ns.onLootChange then pcall(ns.onLootChange) end
end

-- Only an officer in a raid (or a test raid) notes drops.
local function watching()
  if not (ns.isOfficer and ns.isOfficer()) then return false end
  if IsInRaid and IsInRaid() then return true end
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  return raid ~= nil
end

function loot.onLootEvent(event, ...)
  if not watching() then return end
  if event == "ENCOUNTER_LOOT_RECEIVED" then
    local encounterId, _, link, _, player = ...
    if ns.isSecret and (ns.isSecret(link) or ns.isSecret(player)) then return end
    local holder = ns.normalizeName and ns.normalizeName(player)
    loot.recordDrop(link, holder, string.format("%s|%s|%s", tostring(encounterId), tostring(link), tostring(holder)))
  elseif event == "LOOT_OPENED" then
    if not (GetNumLootItems and GetLootSlotLink) then return end
    for slot = 1, GetNumLootItems() do
      local link = GetLootSlotLink(slot)
      if link and not (ns.isSecret and ns.isSecret(link)) then
        local source = GetLootSourceInfo and GetLootSourceInfo(slot)
        local quality
        if GetLootSlotInfo then quality = select(5, GetLootSlotInfo(slot)) end
        loot.recordDrop(link, nil, string.format("%s|%s", tostring(source or slot), link), tonumber(quality))
      end
    end
  end
end

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

local function describe()
  local mode, source = loot.mode()
  local name, manual = loot.coreName()
  local where = name and string.format("%s%s", name, manual and "" or " (next raid)") or L("no raid core")
  local text = string.format(L("Loot system: %s - %s."), loot.label(mode),
    source == "override" and L("chosen by you") or source == "core" and where or L("the guild's default"))
  if not rules() then text = text .. " " .. L("(No rules from Discord yet: the companion sends them with the standings.)") end
  return text
end
loot.describe = describe

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["drop"] = function(args)
  local first = string.lower(args[1] or "")
  if first == "mode" then
    table.remove(args, 1)
    local wanted = string.upper(args[1] or "")
    local s = settings()
    if wanted == "" then ns.message(describe()) return end
    if not officerOnly() then return end
    if wanted == "AUTO" then
      if s then s.lootMode = nil end
      ns.message(describe())
    elseif MODES[wanted] then
      if s then s.lootMode = wanted end
      ns.message(describe())
    else
      ns.message("/guilded drop mode EPGP | COUNCIL | RESERVE | PRIORITY | auto")
    end
    if ns.onLootChange then pcall(ns.onLootChange) end
    return
  end
  loot.drop(args)
end

-- /guilded price <item link or name> <GP>: set a price in game (officers), for the core being run.
ns.commandHandlers["price"] = function(args)
  if not officerOnly() then return end
  local last = #args
  local gp = tonumber(args[last] or "")
  if last < 2 or not gp then
    ns.message("Usage: /guilded price <item link or name> <GP>   (the price is kept for the raid core being run)")
    return
  end
  local item = table.concat(args, " ", 1, last - 1)
  local ok, name, coreName = loot.setPrice(item, gp)
  if not ok then ns.message(L("Type a price from 0 to 100000 GP.")) return end
  ns.message(string.format(L("%s now costs %d GP in %s (sent to Discord with the next upload)."), name, math.floor(gp), coreName or L("every core")))
end

ns.commandHandlers["core"] = function(args)
  local wanted = table.concat(args, " ")
  local s = settings()
  if wanted == "" then
    ns.message(describe())
    local r = rules()
    if r and #(r.cores or {}) > 0 then
      local names = {}
      for _, core in ipairs(r.cores) do
        table.insert(names, string.format("%s (%s)", core.name, loot.label(core.mode)))
      end
      ns.message(L("Raid cores:") .. " " .. table.concat(names, ", "))
    end
    return
  end
  if not officerOnly() then return end
  if string.lower(wanted) == "auto" or string.lower(wanted) == "none" then
    if s then s.activeCore = nil end
  else
    local core = coreNamed(wanted)
    if not core then ns.message(string.format(L("No raid core called \"%s\" is known."), wanted)) return end
    -- Kept by id, so a rename on Discord does not lose it (older data without ids: the name).
    if s then s.activeCore = (core.id ~= "" and core.id) or core.name end
  end
  ns.message(describe())
  if ns.onLootChange then pcall(ns.onLootChange) end
end

-- /guilded drops [number | clear]: the items that dropped, start one, or empty the list.
ns.commandHandlers["drops"] = function(args)
  if not officerOnly() then return end
  local first = string.lower(args[1] or "")
  if first == "clear" then loot.clearDrops() ns.message(L("Drop list cleared.")) return end
  if tonumber(first) then loot.startDrop(tonumber(first)) return end
  local list = loot.drops()
  if #list == 0 then ns.message(L("No drops noted yet (epic items, while you are in a raid).")) end
  for i, entry in ipairs(list) do
    if i > 10 then break end
    ns.message(string.format("%d. %s%s", i, entry.link, entry.holder and (" - " .. entry.holder) or ""))
  end
  local trades = loot.tradesText()
  if trades ~= "" then ns.message(trades) end
end

do
  local events = CreateFrame and CreateFrame("Frame")
  if events then
    for _, event in ipairs({ "LOOT_OPENED", "ENCOUNTER_LOOT_RECEIVED" }) do
      if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(events, event)
      else pcall(events.RegisterEvent, events, event) end
    end
    events:SetScript("OnEvent", function(_, event, ...)
      local ok, err = pcall(loot.onLootEvent, event, ...)
      if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded loot drops: " .. tostring(err)) end
    end)
  end
end

ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded drops [number | clear] - the epic items that dropped this raid (start one by its number) and trades still owed" })
table.insert(ns.commandHelp, { officer = true, text = "/guilded drop <item link> [seconds] - start an item the way this raid core decides loot (bids, council, reserves or priority); /guilded core [name] - pick the raid core" })
table.insert(ns.commandHelp, { officer = true, text = "/guilded price <item> <GP> - set an item's GP price in game (sent to Discord with the next upload)" })
