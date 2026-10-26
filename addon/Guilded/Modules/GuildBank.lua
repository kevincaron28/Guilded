-- Guild bank snapshot: what the guild bank held the last time someone with Guilded opened it,
-- per tab, with the gold. Kept in this guild's saved data on this PC.
--
--   /guilded gbank [item]     search the last snapshot (or show its summary)
--   /guilded gbank copy       the whole snapshot as tab-separated text, for a spreadsheet
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

-- Reads every viewable tab the client has data for; returns the snapshot (or nil).
function bank.scan()
  local db = state()
  if not (db and available()) then return nil end
  local tabs = tonumber(GetNumGuildBankTabs()) or 0
  if tabs < 1 then return nil end
  local snapshot = { at = ns.now and ns.now() or "", by = ns.playerName and ns.playerName() or "", tabs = {}, items = 0 }
  if GetGuildBankMoney then snapshot.money = tonumber(GetGuildBankMoney()) end
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
          local entry = items[id] or { name = itemNameOf(link) or ("item " .. id), count = 0 }
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
  local tabs = tonumber(GetNumGuildBankTabs()) or 0
  for tab = 1, math.min(tabs, 8) do
    local function ask() if QueryGuildBankTab then pcall(QueryGuildBankTab, tab) end end
    if C_Timer and C_Timer.After then C_Timer.After((tab - 1) * QUERY_SPACING, ask) else ask() end
  end
  scheduleScan()
end

-- Rows: tab, item id, item name, count.
function bank.rows(search)
  local db = state()
  local snapshot = db and db.guildBank
  local rows, needle = {}, search and search ~= "" and string.lower(search) or nil
  for tab, info in pairs(snapshot and snapshot.tabs or {}) do
    for id, item in pairs(info.items or {}) do
      if not needle or string.find(string.lower(item.name or ""), needle, 1, true) then
        table.insert(rows, { tab = tab, tabName = info.name, id = id, name = item.name, count = item.count })
      end
    end
  end
  table.sort(rows, function(a, b) if a.name == b.name then return a.tab < b.tab end return (a.name or "") < (b.name or "") end)
  return rows, snapshot
end

local function gold(copper)
  if not copper then return "?" end
  return string.format("%dg %ds %dc", math.floor(copper / 10000), math.floor(copper / 100) % 100, copper % 100)
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["gbank"] = function(args)
  if ns.moduleActive and not ns.moduleActive("guildbank") then return end
  if not available() then ns.message(L("This game client has no guild bank.")) return end
  local action = string.lower(args[1] or "")
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

local frame = CreateFrame("Frame")
local function optional(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, true) else pcall(frame.RegisterEvent, frame, event) end
end
optional("GUILDBANKFRAME_OPENED")
optional("GUILDBANKBAGSLOTS_CHANGED")
optional("PLAYER_INTERACTION_MANAGER_FRAME_SHOW")
frame:SetScript("OnEvent", function(_, event, kind)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("guildbank") then return end
    if event == "GUILDBANKFRAME_OPENED" then bank.onOpened()
    elseif event == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW" then
      local banker = Enum and Enum.PlayerInteractionType and Enum.PlayerInteractionType.GuildBanker
      if banker and kind == banker then bank.onOpened() end
    elseif event == "GUILDBANKBAGSLOTS_CHANGED" then scheduleScan() end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guildbank: " .. tostring(err)) end
end)
