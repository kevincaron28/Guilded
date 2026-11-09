-- Guild bank snapshot: what the guild bank held the last time someone with Guilded opened it,
-- per tab, with the gold. Kept in this guild's saved data on this PC.
--
--   /guilded gbank [item]     search the last snapshot (or show its summary)
--   /guilded gbank copy       the whole snapshot as tab-separated text, for a spreadsheet
--   /guilded gbank request [count] <item>   ask the guild bank for an item (9.1)
--   /guilded gbank requests   your bank requests and what officers did with them
--   /guilded gbank low        items below the minimum officers set
--
-- 9.1 (docs/plans/GUILD_BANK.md): members who never open the bank still search it. The companion
-- writes the guild's last bank contents next to the standings (GuildedBank, from any member who
-- opened it); the newer of that and this PC's own snapshot is searched. A request is saved in
-- db.bankRequests, uploaded by this member's companion and turned into a Discord request with an
-- officer card; it leaves the queue once GuildedBank.requests lists it.
--
-- Only tabs you are allowed to view are read. Clients without a guild bank (Classic Era) have
-- nothing to read, and say so.
local addonName, ns = ...
ns = ns or {}

local SLOTS_PER_TAB = 98
local QUERY_SPACING = 0.6
local SCAN_DELAY = 1.5

local bank = {}
ns.guildBank = bank

local scanPending = false

local function L(text) return ns.L and ns.L(text) or text end

local function available()
  return type(GetNumGuildBankTabs) == "function" and type(GetGuildBankItemLink) == "function" and type(GetGuildBankItemInfo) == "function"
end

local function state()
  local db = ns.getDb and ns.getDb()
  return db
end

local function itemIdOf(link)
  local id = type(link) == "string" and string.match(link, "item:(%d+)")
  return id and tonumber(id) or nil
end
local function itemNameOf(link) return type(link) == "string" and string.match(link, "%[(.-)%]") or nil end
-- The item's quality from its link colour (0 poor ... 5 legendary); nil when the colour is unknown.
local QUALITY_OF = { ["9d9d9d"] = 0, ffffff = 1, ["1eff00"] = 2, ["0070dd"] = 3, a335ee = 4, ff8000 = 5, e6cc80 = 6 }
local function qualityOf(link)
  local hex = type(link) == "string" and string.match(link, "|c%x%x(%x%x%x%x%x%x)")
  return hex and QUALITY_OF[string.lower(hex)] or nil
end
bank.qualityOf = qualityOf

-- ---------------------------------------------------------------------
-- 9.0 ledger: the game's guild bank logs (who deposited or withdrew what, and the gold), kept
-- beyond the 25 lines per tab the game shows, plus a gold history. Saved in db.guildBankLog for
-- the companion (docs/GUILD_BANK_LEDGER.md). The game gives each line's age in hours, so the
-- same line read again within 3 hours is the same line. Every API is checked first: a client
-- without them records nothing.
-- ---------------------------------------------------------------------
local MAX_LOG_LINES = 2000
local MAX_GOLD_POINTS = 400
local SAME_LINE_SECONDS = 3 * 3600
local function clock() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function logState()
  local db = state()
  if not db then return nil end
  db.guildBankLog = type(db.guildBankLog) == "table" and db.guildBankLog or {}
  local log = db.guildBankLog
  log.items = type(log.items) == "table" and log.items or {}
  log.money = type(log.money) == "table" and log.money or {}
  log.gold = type(log.gold) == "table" and log.gold or {}
  return log
end
local function ageSeconds(years, months, days, hours)
  return (((tonumber(years) or 0) * 365 + (tonumber(months) or 0) * 30 + (tonumber(days) or 0)) * 24 + (tonumber(hours) or 0)) * 3600
end
local function nameKey(name)
  if type(name) ~= "string" or (ns.isSecret and ns.isSecret(name)) then return nil end
  -- A name the resolver refuses (nil) stays refused; never fall back to the raw text.
  if ns.normalizeName then return ns.normalizeName(name) end
  return name
end
local function sameLine(a, b)
  return a.type == b.type and a.name == b.name and a.item == b.item and a.count == b.count and a.amount == b.amount
    and a.tab == b.tab and math.abs((a.at or 0) - (b.at or 0)) <= SAME_LINE_SECONDS
end
local function keep(list, line)
  for i = #list, math.max(1, #list - 400), -1 do if sameLine(list[i], line) then return false end end
  table.insert(list, line)
  return true
end
local function trim(list, max)
  table.sort(list, function(a, b) return (a.at or 0) < (b.at or 0) end)
  while #list > max do table.remove(list, 1) end
end
local function moneyTab()
  return (tonumber(MAX_GUILDBANK_TABS) or 8) + 1
end
function bank.logsAvailable()
  return type(GetNumGuildBankTransactions) == "function" and type(GetGuildBankTransaction) == "function"
end
function bank.moneyLogAvailable()
  return type(GetNumGuildBankMoneyTransactions) == "function" and type(GetGuildBankMoneyTransaction) == "function"
end

-- Reads every log the server has sent; returns how many new lines were kept.
function bank.readLogs()
  local log = logState()
  if not log then return 0 end
  local now, added = clock(), 0
  if bank.logsAvailable() then
    local tabs = tonumber((GetNumGuildBankTabs and GetNumGuildBankTabs())) or 0
    for tab = 1, math.min(tabs, 8) do
      local okCount, count = pcall(GetNumGuildBankTransactions, tab)
      for index = 1, math.min(okCount and tonumber(count) or 0, 100) do
        local ok, kind, name, link, quantity, tab1, tab2, years, months, days, hours = pcall(GetGuildBankTransaction, tab, index)
        local who = ok and nameKey(name)
        local item = ok and itemIdOf(link)
        if who and item and type(kind) == "string" and kind:match("^%a+$") then
          local line = { type = kind:sub(1, 20), name = who, item = item, itemName = itemNameOf(link), count = math.max(1, math.floor(tonumber(quantity) or 1)),
            tab = tonumber(tab1) or tab, tab2 = tonumber(tab2), at = now - ageSeconds(years, months, days, hours) }
          if keep(log.items, line) then added = added + 1 end
        end
      end
    end
    trim(log.items, MAX_LOG_LINES)
  end
  if bank.moneyLogAvailable() then
    local okCount, count = pcall(GetNumGuildBankMoneyTransactions)
    for index = 1, math.min(okCount and tonumber(count) or 0, 100) do
      local ok, kind, name, amount, years, months, days, hours = pcall(GetGuildBankMoneyTransaction, index)
      local who = ok and nameKey(name)
      local copper = ok and tonumber(amount)
      if who and copper and copper >= 0 and type(kind) == "string" and kind:match("^%a+$") then
        local line = { type = kind:sub(1, 20), name = who, amount = math.floor(copper), at = now - ageSeconds(years, months, days, hours) }
        if keep(log.money, line) then added = added + 1 end
      end
    end
    trim(log.money, MAX_LOG_LINES)
  end
  log.readAt = now
  return added
end

-- One gold reading per bank visit (at most one every 10 minutes), for the gold history chart.
function bank.noteGold(copper)
  local log = logState()
  copper = tonumber(copper)
  if not log or not copper or copper < 0 then return end
  local now, last = clock(), log.gold[#log.gold]
  if last and now - (last.at or 0) < 600 then last.money, last.at = math.floor(copper), now return end
  table.insert(log.gold, { at = now, money = math.floor(copper) })
  while #log.gold > MAX_GOLD_POINTS do table.remove(log.gold, 1) end
end

-- Asks the server for every tab's log and the money log (it answers with GUILDBANKLOG_UPDATE).
function bank.queryLogs()
  if type(QueryGuildBankLog) ~= "function" then return end
  local tabs = tonumber((GetNumGuildBankTabs and GetNumGuildBankTabs())) or 0
  local queries = {}
  for tab = 1, math.min(tabs, 8) do queries[#queries + 1] = tab end
  queries[#queries + 1] = moneyTab()
  for i, tab in ipairs(queries) do
    local function ask() pcall(QueryGuildBankLog, tab) end
    if C_Timer and C_Timer.After then C_Timer.After(i * QUERY_SPACING, ask) else ask() end
  end
end

-- Reads every viewable tab the client has data for; returns the snapshot (or nil).
function bank.scan()
  local db = state()
  if not (db and available()) then return nil end
  local tabs = tonumber((GetNumGuildBankTabs())) or 0
  if tabs < 1 then return nil end
  local snapshot = { at = ns.now and ns.now() or "", epoch = clock(), by =ns.playerName and ns.playerName() or "", tabs = {}, items = 0 }
  if GetGuildBankMoney then snapshot.money = tonumber((GetGuildBankMoney())) end
  if snapshot.money then bank.noteGold(snapshot.money) end
  local slots = tonumber(MAX_GUILDBANK_SLOTS_PER_TAB) or SLOTS_PER_TAB
  for tab = 1, math.min(tabs, 8) do
    local name, _, viewable = nil, nil, true
    if GetGuildBankTabInfo then name, _, viewable = GetGuildBankTabInfo(tab) end
    if viewable then
      local items, found = {}, false
      for slot = 1, slots do
        local link = GetGuildBankItemLink(tab, slot)
        local id = itemIdOf(link)
        if id then
          local _, count = GetGuildBankItemInfo(tab, slot)
          if not items[id] then snapshot.items = snapshot.items + 1 end
          local entry = items[id] or { name = itemNameOf(link) or ("item " .. id), count = 0, q = qualityOf(link) }
          entry.count = entry.count + (tonumber(count) or 1)
          items[id] = entry
          found = true
        end
      end
      local previous = db.guildBank and db.guildBank.tabs and db.guildBank.tabs[tab]
      if found or not (previous and previous.items and next(previous.items)) then
        snapshot.tabs[tab] = { name = name or (L("Tab") .. " " .. tab), items = items, at = snapshot.at }
      else
        -- The server had not sent this tab yet: keep what an earlier visit saw, with its date.
        snapshot.tabs[tab] = previous
        for _ in pairs(previous.items) do snapshot.items = snapshot.items + 1 end
      end
    end
  end
  -- Keep the previous snapshot when nothing at all was readable (the server had not answered).
  if snapshot.items == 0 and db.guildBank and (db.guildBank.items or 0) > 0 then return db.guildBank end
  db.guildBank = snapshot
  return snapshot
end

local function scheduleScan()
  if scanPending then return end
  scanPending = true
  local function run() scanPending = false; bank.scan() end
  if C_Timer and C_Timer.After then C_Timer.After(SCAN_DELAY, run) else run() end
end

-- Opening the bank: ask the server for each tab, a little apart, then read them.
function bank.onOpened()
  if not available() then return end
  local tabs = tonumber((GetNumGuildBankTabs())) or 0
  for tab = 1, math.min(tabs, 8) do
    local function ask() if QueryGuildBankTab then pcall(QueryGuildBankTab, tab) end end
    if C_Timer and C_Timer.After then C_Timer.After((tab - 1) * QUERY_SPACING, ask) else ask() end
  end
  scheduleScan()
  bank.queryLogs()
end

-- What the companion wrote from Discord (GuildedBank): the guild's last contents, the low list
-- and this member's requests. Nil when there is none.
function bank.synced()
  local synced = rawget(_G, "GuildedBank")
  return type(synced) == "table" and synced or nil
end

-- The snapshot to search: this PC's own, or the guild's from Discord when that one is newer.
local function source()
  local db = state()
  local own, synced = db and db.guildBank, bank.synced()
  local syncedAt = synced and tonumber(synced.at)
  if syncedAt and type(synced.items) == "table" and (not own or syncedAt > (tonumber(own.epoch) or 0)) then
    local stamp = date and date("%Y-%m-%d %H:%M", syncedAt) or tostring(syncedAt)
    return { synced = true, at = stamp, by = L("Discord"), items = #synced.items, money = tonumber(synced.money), list = synced.items }
  end
  return own
end

-- Rows: tab, item id, item name, count.
function bank.rows(search)
  local snapshot = source()
  local rows, needle = {}, search and search ~= "" and string.lower(search) or nil
  local function add(tabName, tab, id, item)
    if not needle or string.find(string.lower(item.name or ""), needle, 1, true) then
      table.insert(rows, { tab = tab, tabName = tabName, id = id, name = item.name, count = item.count, q = item.q })
    end
  end
  if snapshot and snapshot.synced then
    for i, item in ipairs(snapshot.list) do
      if type(item) == "table" and tonumber(item.id) then add(tostring(item.tab or ""), i, tonumber(item.id), item) end
    end
  else
    for tab, info in pairs(snapshot and snapshot.tabs or {}) do
      for id, item in pairs(info.items or {}) do add(info.name, tab, id, item) end
    end
  end
  table.sort(rows, function(a, b) if a.name == b.name then return a.tab < b.tab end return (a.name or "") < (b.name or "") end)
  return rows, snapshot
end

-- ---------------------------------------------------------------------
-- 9.1 requests: saved here, uploaded by this member's companion, at most 10 waiting.
-- ---------------------------------------------------------------------
local MAX_QUEUED = 10
local KEEP_QUEUED = 14 * 86400
local function queue()
  local db = state()
  if not db then return nil end
  db.bankRequests = type(db.bankRequests) == "table" and db.bankRequests or {}
  return db.bankRequests
end

-- Drops requests Discord already has (GuildedBank.requests lists their ref) and very old ones.
function bank.pruneRequests()
  local list, synced = queue(), bank.synced()
  if not list then return end
  local known = {}
  for _, r in ipairs(synced and type(synced.requests) == "table" and synced.requests or {}) do
    if type(r) == "table" and type(r.ref) == "string" and r.ref ~= "" then known[r.ref] = true end
  end
  local now = clock()
  for ref, r in pairs(list) do
    if known[ref] or type(r) ~= "table" or now - (tonumber(r.at) or 0) > KEEP_QUEUED then list[ref] = nil end
  end
end

-- Saves a request; returns the saved row, or nil and the reason.
function bank.request(count, text)
  local list = queue()
  if not list then return nil, L("Guilded is not ready yet.") end
  bank.pruneRequests()
  local waiting = 0
  for _ in pairs(list) do waiting = waiting + 1 end
  if waiting >= MAX_QUEUED then return nil, L("You already have 10 requests waiting for the companion.") end
  text = type(text) == "string" and string.match(string.gsub(text, "|", ""), "^%s*(.-)%s*$") or ""
  if #text < 2 then return nil, L("Name the item you need.") end
  count = math.max(1, math.min(1000, math.floor(tonumber(count) or 1)))
  local rows = bank.rows(text)
  local match
  for _, r in ipairs(rows) do if string.lower(r.name or "") == string.lower(text) then match = r break end end
  if not match and #rows == 1 then match = rows[1] end
  local now = clock()
  local ref = string.format("%d-%d", now, math.random(100000, 999999))
  local row = { ref = ref, item = string.sub(match and match.name or text, 1, 100), itemId = match and match.id or nil, count = count, at = now }
  list[ref] = row
  return row
end

local STATUS_TEXT = { PENDING = "pending", APPROVED = "approved", FULFILLED = "fulfilled", DENIED = "denied", CANCELLED = "cancelled" }
function bank.requestLines()
  bank.pruneRequests()
  local lines = {}
  for _, r in pairs(queue() or {}) do
    table.insert(lines, string.format("  %d x %s - %s", r.count or 1, r.item or "?", L("waiting for the companion")))
  end
  local synced = bank.synced()
  for _, r in ipairs(synced and type(synced.requests) == "table" and synced.requests or {}) do
    if type(r) == "table" then
      table.insert(lines, string.format("  %d x %s - %s", tonumber(r.count) or 1, tostring(r.item or "?"), L(STATUS_TEXT[r.status] or "pending")))
    end
  end
  return lines
end

function bank.lowLines()
  local synced = bank.synced()
  local lines = {}
  for _, r in ipairs(synced and type(synced.low) == "table" and synced.low or {}) do
    if type(r) == "table" then table.insert(lines, string.format("  %s: %d / %d", tostring(r.itemName or "?"), tonumber(r.have) or 0, tonumber(r.min) or 0)) end
  end
  return lines
end

local function gold(copper)
  if not copper then return "?" end
  return string.format("%dg %ds %dc", math.floor(copper / 10000), math.floor(copper / 100) % 100, copper % 100)
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["gbank"] = function(args)
  if ns.moduleActive and not ns.moduleActive("guildbank") then return end
  args = args or {}
  local action = string.lower(args[1] or "")
  if action == "request" then
    local count, first = 1, 2
    if tonumber(args[2]) then count, first = tonumber(args[2]), 3 end
    local row, why = bank.request(count, table.concat(args, " ", first))
    if not row then ns.message(why or L("Could not save the request.")) return end
    ns.message(string.format(L("Request saved: %d x %s. Your companion sends it to the officers with the next sync; /guilded gbank requests shows what they did."), row.count, row.item))
    return
  end
  if action == "requests" then
    local lines = bank.requestLines()
    if #lines == 0 then ns.message(L("You have no bank requests.")) return end
    ns.message(L("Your guild bank requests:"))
    for i = 1, math.min(15, #lines) do ns.message(lines[i]) end
    return
  end
  if action == "low" then
    local lines = bank.lowLines()
    if #lines == 0 then ns.message(L("Nothing is below its minimum (or officers set none).")) return end
    ns.message(L("Below minimum (have / target):"))
    for i = 1, math.min(15, #lines) do ns.message(lines[i]) end
    return
  end
  if not available() and not bank.synced() then ns.message(L("This game client has no guild bank.")) return end
  local rows, snapshot = bank.rows(action ~= "copy" and table.concat(args, " ") or nil)
  if not snapshot then ns.message(L("No guild bank snapshot yet. Open the guild bank once (any tab) with Guilded on.")) return end
  if action == "copy" then
    local lines = { "Tab\tItem ID\tItem\tCount" }
    for _, r in ipairs(rows) do table.insert(lines, string.format("%s\t%d\t%s\t%d", r.tabName, r.id, r.name, r.count)) end
    if ns.showCopyText then ns.showCopyText(table.concat(lines, "\n"), L("Guilded - guild bank (paste into a spreadsheet)")) end
    return
  end
  ns.message(string.format(L("Guild bank on %s (by %s): %d different item(s), %s."), snapshot.at or "?", snapshot.by or "?", snapshot.items or 0, gold(snapshot.money)))
  if args[1] then
    if #rows == 0 then ns.message(L("Not in the last snapshot.")) end
    for i = 1, math.min(15, #rows) do ns.message(string.format("  %s x%d (%s)", rows[i].name, rows[i].count, rows[i].tabName)) end
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded gbank [item] | copy - what the guild bank held when it was last opened")
table.insert(ns.commandHelp, "/guilded gbank request [count] <item> | requests | low - ask the guild bank, see your requests and low items")

local frame = CreateFrame("Frame")
local function optional(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, true) else pcall(frame.RegisterEvent, frame, event) end
end
optional("GUILDBANKFRAME_OPENED")
optional("GUILDBANKBAGSLOTS_CHANGED")
optional("PLAYER_INTERACTION_MANAGER_FRAME_SHOW")
optional("GUILDBANKLOG_UPDATE")
frame:SetScript("OnEvent", function(_, event, kind)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("guildbank") then return end
    if event == "GUILDBANKFRAME_OPENED" then bank.onOpened()
    elseif event == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW" then
      local banker = Enum and Enum.PlayerInteractionType and Enum.PlayerInteractionType.GuildBanker
      if banker and kind == banker then bank.onOpened() end
    elseif event == "GUILDBANKBAGSLOTS_CHANGED" then scheduleScan()
    elseif event == "GUILDBANKLOG_UPDATE" then bank.readLogs() end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guildbank: " .. tostring(err)) end
end)
