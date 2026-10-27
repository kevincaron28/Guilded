-- Soft reserves, inside the addon (like SoftRes.it, no website needed).
--
--   * An officer opens the list: /guilded reserve open [per player] [title]. That officer
--     is the keeper of the list.
--   * Members reserve an item with /guilded reserve <shift-click link> (or the Reserves
--     tab). Their addon sends it to the keeper, who checks it and shares the whole list
--     back to the guild, so everyone sees the same list. Players without the addon
--     whisper the keeper: res [item link].
--   * Lock it when the raid starts (/guilded reserve lock). When the item drops,
--     /guilded reserve who <item> shows who reserved it and /guilded reserve roll <item>
--     rolls between only them. /guilded reserve award <player> <item> records the loot
--     and uses up that reserve.
--   * Item tooltips say who reserved the item; the loot council list puts reservers first.
--
-- Items are stored by item id, so a link is needed (shift-click). The list lives in the
-- guild's saved data and survives /reload.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedRes"
-- SR+: every week a player reserves the same item and does not get it adds this much to their
-- roll for it (counted when an officer clears or reopens the list, once per weekly reset).
local PLUS_STEP = 10
local DEFAULT_LIMIT = 1
local MAX_LIMIT = 5
local CHUNK = 200

local reserve = {}
ns.reserve = reserve

local function L(text) return ns.L and ns.L(text) or text end

-- ---------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.reserves = db.reserves or {}
  local s = db.reserves
  s.entries = s.entries or {}
  s.names = s.names or {}
  s.limit = s.limit or DEFAULT_LIMIT
  s.plus = s.plus or {}
  return s
end
reserve.state = state

-- SR+ bonus of a player for an item id (0 when none).
function reserve.plusFor(name, id)
  local s = state()
  local weeks = s and name and id and s.plus[name .. ":" .. tostring(id)] or 0
  return weeks * PLUS_STEP
end

-- The weekly reset a moment belongs to, as a number that changes once a week: the game's own
-- reset when the client knows it (US and EU differ), else Tuesday 15:00 UTC as the bot uses.
local function resetWeek()
  local now = ns.util and ns.util.serverTime and ns.util.serverTime() or time()
  if C_DateAndTime and C_DateAndTime.GetSecondsUntilWeeklyReset then
    local ok, left = pcall(C_DateAndTime.GetSecondsUntilWeeklyReset)
    -- The reset is on the hour; rounding keeps a one-second wobble from changing the week.
    if ok and type(left) == "number" and left > 0 then return math.floor((now + left + 1800) / 3600) end
  end
  -- 1970-01-06 was a Tuesday.
  return math.floor((now - (5 * 86400 + 15 * 3600)) / (7 * 86400))
end
reserve.resetWeek = resetWeek

-- SR+ counts weeks, not lists: a guild that opens a list per raid night, or runs two raids a week,
-- still adds one week. Reserves are gathered per week (s.weekKeys, for the week s.plusWeek); when
-- that week is over, each item reserved in it and not won earns one more week, and items reserved
-- on no list that week lose their bonus. A week with no reserves at all changes nothing, so a
-- skipped raid week keeps everyone's SR+.
local function finishWeek(s)
  if next(s.weekKeys) then
    local kept = {}
    for key in pairs(s.weekKeys) do kept[key] = (s.plus[key] or 0) + 1 end
    s.plus = kept
  end
  s.plusWeek, s.weekKeys = nil, {}
end

-- Called before the list is emptied. A list kept from before this rule has no week: it counts as
-- an older one, as lists always did.
local function carryPlus(s)
  s.weekKeys = s.weekKeys or {}
  local listWeek = s.listWeek or 0
  if s.plusWeek and s.plusWeek ~= listWeek then finishWeek(s) end
  s.plusWeek = listWeek
  for name, list in pairs(s.entries or {}) do
    for _, id in ipairs(list) do s.weekKeys[name .. ":" .. tostring(id)] = true end
  end
  if listWeek ~= resetWeek() then finishWeek(s) end
end
reserve.carryPlus = carryPlus

-- Won: that item's SR+ is used up, and it does not count for this week either.
local function wonPlus(s, name, id)
  local key = name .. ":" .. tostring(id)
  s.plus[key] = nil
  if s.weekKeys then s.weekKeys[key] = nil end
end

-- "|cff...|Hitem:17067::...|h[Name]|h|r", "item:17067" or "17067" -> 17067
local function itemId(text)
  if not text then return nil end
  local id = string.match(text, "item:(%d+)") or string.match(text, "^%s*(%d+)%s*$")
  return id and tonumber(id) or nil
end
reserve.itemId = itemId

local function remember(s, id, text)
  local name = string.match(text or "", "%[(.-)%]")
  if name and id then s.names[id] = name end
end

local function itemName(id)
  local s = state()
  local known = s and s.names[id]
  if known then return known end
  local name
  if GetItemInfo then
    local ok, result = pcall(GetItemInfo, id)
    if ok then name = result end
  end
  if name and s then s.names[id] = name end
  return name or ("item " .. tostring(id))
end
reserve.itemName = itemName

local function sortedPlayers(s)
  local names = {}
  for name, list in pairs(s.entries) do
    if #list > 0 then table.insert(names, name) end
  end
  table.sort(names)
  return names
end

-- Players who reserved this item, sorted.
local function holders(id)
  local s = state()
  local found = {}
  if not (s and id) then return found end
  for name, list in pairs(s.entries) do
    for _, reserved in ipairs(list) do
      if reserved == id then table.insert(found, name) break end
    end
  end
  table.sort(found)
  return found
end
reserve.holders = holders

function reserve.isReserved(name, item)
  local id = itemId(item)
  if not (id and name) then return false end
  for _, holder in ipairs(holders(id)) do
    if holder == name then return true end
  end
  return false
end

-- Extra tooltip lines for an item id (none when nobody reserved it).
function reserve.tooltipLines(id)
  local found = holders(id)
  if #found == 0 then return {} end
  return { L("Reserved by") .. " " .. table.concat(found, ", ") }
end

local function isHost()
  local s = state()
  return s and s.host and s.host == ns.playerName()
end

-- ---------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------

local function groupChannel()
  return ns.util.groupChannel()
end

-- Reserves are usually made days before the raid, so the guild is the audience.
local function shareChannel()
  if IsInGuild and IsInGuild() then return "GUILD" end
  return groupChannel()
end

local function sendAddon(text, channel, target)
  if not channel then return end
  ns.comm.send(PREFIX, text, channel, target)
end

local function sendChat(text, channel, target)
  if not channel then return end
  pcall(function()
    if C_ChatInfo and C_ChatInfo.SendChatMessage then
      C_ChatInfo.SendChatMessage(text, channel, nil, target)
    elseif SendChatMessage then
      SendChatMessage(text, channel, nil, target)
    end
  end)
end

local function announce(text)
  ns.message(text)
  sendChat("[Guilded] " .. text, groupChannel() or (IsInGuild and IsInGuild() and "GUILD" or nil))
end

local function notify()
  if ns.onReserveChange then pcall(ns.onReserveChange) end
end

-- A change made by the keeper stamps the list (the companion exports it, and the newest copy
-- wins in Discord). Everyone else keeps the keeper's stamp, which travels with the list, so a
-- member's copy can never look newer than the keeper's.
local function changed()
  local s = state()
  if s and ns.now then s.updatedAt = ns.now() end
  notify()
end

-- "a;b;c" pieces packed into messages of at most CHUNK characters.
local function pack(pieces)
  local chunks, buffer = {}, ""
  for _, piece in ipairs(pieces) do
    if buffer ~= "" and string.len(buffer) + 1 + string.len(piece) > CHUNK then
      table.insert(chunks, buffer)
      buffer = ""
    end
    buffer = buffer == "" and piece or (buffer .. ";" .. piece)
  end
  if buffer ~= "" then table.insert(chunks, buffer) end
  return chunks
end

-- The keeper shares the whole list: settings, then "VER|<stamp>|<chunks>", the SR+ weeks of the
-- reserves on the list ("P|", always at least one so an empty one clears old bonuses), then the
-- entries in short chunks. A receiver only swaps in the new list once every entry chunk has
-- arrived, so a lost message leaves the previous list in place instead of a half list. Older
-- clients ignore "P|" and simply show no SR+.
local function shareNow()
  local s = state()
  if not (s and isHost()) then return end
  local channel = shareChannel()
  local entries, bonuses = {}, {}
  for _, name in ipairs(sortedPlayers(s)) do
    table.insert(entries, name .. "=" .. table.concat(s.entries[name], ","))
    local weeks = {}
    for _, id in ipairs(s.entries[name]) do
      local count = s.plus[name .. ":" .. tostring(id)]
      if count and count > 0 then table.insert(weeks, id .. ":" .. count) end
    end
    if #weeks > 0 then table.insert(bonuses, name .. "=" .. table.concat(weeks, ",")) end
  end
  local chunks, plusChunks = pack(entries), pack(bonuses)
  if #plusChunks == 0 then plusChunks = { "" } end
  sendAddon(string.format("STATE|%d|%d|%s", s.open and 1 or 0, s.limit, s.title or ""), channel)
  sendAddon("CLR", channel)
  sendAddon(string.format("VER|%s|%d", s.updatedAt or (ns.now and ns.now()) or "", #chunks), channel)
  for _, chunk in ipairs(plusChunks) do sendAddon("P|" .. chunk, channel) end
  for _, chunk in ipairs(chunks) do sendAddon("L|" .. chunk, channel) end
end
reserve.share = shareNow

local sharePending = false
local function scheduleShare()
  if not (C_Timer and C_Timer.After) then shareNow() return end
  if sharePending then return end
  sharePending = true
  C_Timer.After(2, function() sharePending = false; shareNow() end)
end

-- ---------------------------------------------------------------------
-- Changing the list (on the keeper's side)
-- ---------------------------------------------------------------------

-- Returns true, or false and the reason.
local function addFor(name, id)
  local s = state()
  if not s then return false, "No saved data yet." end
  if not s.open then return false, L("Reserves are locked.") end
  local list = s.entries[name] or {}
  for _, reserved in ipairs(list) do
    if reserved == id then return true end
  end
  if #list >= s.limit then
    if s.limit == 1 then list = {}
    else return false, string.format(L("You already have %d reserves. Remove one first."), s.limit) end
  end
  table.insert(list, id)
  s.entries[name] = list
  return true
end

local function removeFor(name, id)
  local s = state()
  local list = s and s.entries[name]
  if not list then return false end
  local kept, removed = {}, false
  for _, reserved in ipairs(list) do
    if id and reserved ~= id then table.insert(kept, reserved) else removed = true end
  end
  s.entries[name] = #kept > 0 and kept or nil
  return removed
end

-- A request that reached the keeper. `reply`: "addon", "whisper" or nil.
local function hostChange(action, name, id, replyTo, reply)
  local s = state()
  if not (s and isHost() and name and id) then return end
  local ok, problem
  if action == "ADD" then
    ok, problem = addFor(name, id)
  else
    if not s.open then ok, problem = false, L("Reserves are locked.") else ok = removeFor(name, id) end
  end
  if ok then
    scheduleShare()
    changed()
  end
  local text = ok and string.format(action == "ADD" and L("Reserved: %s") or L("Removed: %s"), itemName(id)) or problem
  if not ok and not problem then text = L("You had not reserved that.") end
  if reply == "addon" then sendAddon((ok and "ACK|" or "REJECT|") .. text, "WHISPER", replyTo)
  elseif reply == "whisper" then sendChat("[Guilded] " .. text, "WHISPER", replyTo) end
  return ok and true or false, text
end

-- ---------------------------------------------------------------------
-- Player actions
-- ---------------------------------------------------------------------

local function reserveItem(text)
  local id = itemId(text)
  if not id then ns.message(L("Shift-click the item to reserve it: /guilded reserve <item link>")); return end
  local s = state()
  if not s then return end
  remember(s, id, text)
  local me = ns.playerName()
  if isHost() then
    local _, text = hostChange("ADD", me, id, nil, nil)
    ns.message(text)
  elseif s.hostSender then
    -- The name travels along so the keeper can show it (it may never have seen the item).
    local name = string.gsub(s.names[id] or "", "[|;=,]", "")
    sendAddon("ADD|" .. id .. "|" .. name, "WHISPER", s.hostSender)
  else
    ns.message(L("No reserve list is open. An officer opens one with /guilded reserve open."))
  end
end

local function unreserveItem(text)
  local id = itemId(text)
  if not id then ns.message(L("Shift-click the item to remove it: /guilded reserve remove <item link>")); return end
  local s = state()
  if not s then return end
  if isHost() then
    local _, text = hostChange("DEL", ns.playerName(), id, nil, nil)
    ns.message(text)
  elseif s.hostSender then sendAddon("DEL|" .. id, "WHISPER", s.hostSender)
  else ns.message(L("No reserve list is open. An officer opens one with /guilded reserve open.")) end
end
reserve.add = reserveItem
reserve.remove = unreserveItem

-- ---------------------------------------------------------------------
-- Officer actions
-- ---------------------------------------------------------------------

local function needOfficer()
  if ns.isOfficer() then return true end
  ns.message(L("Only officers can do that."))
  return false
end

local function openList(args)
  if not needOfficer() then return end
  local s = state()
  if not s then return end
  local limit = tonumber(args[1])
  local first = 1
  -- Without a number, the raid core's setting (Discord: /core setup) decides.
  if limit then first = 2 else limit = ns.loot and ns.loot.reserveLimit and ns.loot.reserveLimit() or DEFAULT_LIMIT end
  limit = math.max(1, math.min(MAX_LIMIT, math.floor(limit)))
  local title = table.concat(args, " ", first)
  s.open, s.limit, s.title, s.host, s.hostSender = true, limit, title, ns.playerName(), nil
  carryPlus(s)
  s.entries, s.listWeek = {}, resetWeek()
  changed()
  shareNow()
  announce(string.format(L("Soft reserves are open%s: %d per player. Reserve with /guilded reserve [item link], or whisper me: res [item link]."),
    title ~= "" and (" (" .. title .. ")") or "", limit))
end

local function setLocked(locked)
  if not needOfficer() then return end
  local s = state()
  if not (s and s.host) then ns.message(L("No reserve list is open. An officer opens one with /guilded reserve open.")); return end
  if not isHost() then s.host = ns.playerName(); s.hostSender = nil end
  s.open = not locked
  changed()
  shareNow()
  announce(locked and L("Soft reserves are locked.") or L("Soft reserves are open again."))
end

local function clearList()
  if not needOfficer() then return end
  local s = state()
  if not s then return end
  carryPlus(s)
  s.open, s.host, s.hostSender, s.entries = false, nil, nil, {}
  changed()
  sendAddon("DONE|" .. (s.updatedAt or ""), shareChannel())
  ns.message(L("Reserves cleared."))
end

-- An officer adds or removes for another player (someone without the addon, a fix).
local function officerChange(action, args)
  if not needOfficer() then return end
  local s = state()
  if not (s and s.host) then ns.message(L("No reserve list is open. An officer opens one with /guilded reserve open.")); return end
  local name = ns.normalizeName(args[1])
  local id = itemId(table.concat(args, " ", 2))
  if not name or (action == "ADD" and not id) then ns.message("Usage: /guilded reserve add <player> <item link>"); return end
  if not isHost() then ns.message(L("Only the officer who opened the list can change it.")); return end
  remember(s, id, table.concat(args, " ", 2))
  if action == "ADD" then
    local wasOpen = s.open
    s.open = true -- an officer may add after the lock
    local ok, problem = addFor(name, id)
    s.open = wasOpen
    if not ok then ns.message(problem) return end
  else
    removeFor(name, id)
  end
  changed()
  shareNow()
end

-- A whole list from elsewhere (softres.it CSV or Gargul export, Modules/LootImports.lua): this
-- officer becomes the keeper and the list opens with exactly those reserves, then is shared like
-- any list. An import is the raid's full list, so it replaces what was there (SR+ weeks carry
-- over as when a list is reopened). Returns players, items or nil and the reason.
function reserve.importEntries(map, title, names)
  if not (ns.isOfficer and ns.isOfficer()) then return nil, L("Only officers can do that.") end
  local s = state()
  if not s then return nil, "No saved data yet." end
  local entries, players, items, most = {}, 0, 0, 1
  for name, ids in pairs(map or {}) do
    local list, seen = {}, {}
    for _, id in ipairs(ids) do
      if not seen[id] and #list < MAX_LIMIT then seen[id] = true; table.insert(list, id) end
    end
    if #list > 0 then
      entries[name] = list
      players, items = players + 1, items + #list
      if #list > most then most = #list end
    end
  end
  if players == 0 then return nil, L("No reserves found in that text.") end
  carryPlus(s)
  s.open, s.limit, s.title, s.host, s.hostSender = true, math.min(MAX_LIMIT, most), title or "", ns.playerName(), nil
  s.entries, s.listWeek = entries, resetWeek()
  for id, name in pairs(names or {}) do s.names[id] = name end
  changed()
  shareNow()
  return players, items
end

local function whoText(itemText)
  local id = itemId(itemText)
  if not id then return "Usage: /guilded reserve who <item link>" end
  local s = state()
  if s then remember(s, id, itemText) end
  local found = holders(id)
  if #found == 0 then return string.format(L("Nobody reserved %s."), itemName(id)) end
  return string.format(L("%s is reserved by: %s"), itemName(id), table.concat(found, ", "))
end

local function rollFor(itemText)
  if not needOfficer() then return end
  local id = itemId(itemText)
  if not id then ns.message("Usage: /guilded reserve roll <item link>"); return end
  local s = state()
  if s then remember(s, id, itemText) end
  local found = holders(id)
  if #found == 0 then ns.message(whoText(itemText)); return end
  if #found == 1 then
    announce(string.format(L("%s: only %s reserved it."), itemName(id), found[1]))
    return
  end
  if not ns.lootRoll then ns.message(L("Loot roll unavailable. Reload the complete Guilded addon.")); return end
  if ns.lootRoll.session then ns.message(L("Finish the pending loot roll or use /guilded lootroll cancel.")); return end
  -- Check what would refuse the roll-off before telling the group it started (seen in game: the
  -- group read "rolling between ..." while a Guilded Games match blocked it).
  if GuildedGames and GuildedGames.state and GuildedGames.state() then
    ns.message(L("Finish Guilded Games before starting a loot roll.")); return
  end
  if not ns.util.groupChannel() then ns.message(L("Join a party or raid before starting a loot roll.")); return end
  local shown = {}
  for _, name in ipairs(found) do
    local plus = reserve.plusFor(name, id)
    table.insert(shown, plus > 0 and string.format("%s (+%d)", name, plus) or name)
  end
  announce(string.format(L("%s: rolling between %s."), itemName(id), table.concat(shown, ", ")))
  local bonuses = {}
  for _, name in ipairs(found) do
    bonuses[name] = reserve.plusFor(name, id)
  end
  ns.lootRoll.start(found, bonuses)
end

local function awardTo(args)
  if not needOfficer() then return end
  local name = ns.normalizeName(args[1])
  local itemText = table.concat(args, " ", 2)
  local gp = 0
  local id = itemId(itemText)
  if not (name and id) then ns.message("Usage: /guilded reserve award <player> <item link> [GP]"); return end
  -- A trailing number after a plain item id is the GP; after a link it can only be the GP.
  local trailing = string.match(itemText, "|r%s+(%d+)%s*$") or (string.match(itemText, "^%s*%d+%s+(%d+)%s*$"))
  if trailing then gp = tonumber(trailing) end
  local s = state()
  if s then remember(s, id, itemText) end
  local plain = itemName(id)
  ns.runCommand("loot " .. name .. " " .. plain .. " " .. gp)
  if gp > 0 then ns.runCommand("gp " .. name .. " " .. gp .. " Reserve: " .. plain) end
  local removed = s and removeFor(name, id)
  if s then wonPlus(s, name, id) end
  changed()
  if s and isHost() then
    if removed then shareNow() end
  elseif s and s.host then
    -- Another officer keeps the list: tell them, or the winner keeps the reserve and its SR+.
    if s.hostSender then sendAddon("WON|" .. name .. "|" .. id, "WHISPER", s.hostSender)
    else sendAddon("WON|" .. name .. "|" .. id, shareChannel()) end
  end
  announce(string.format(L("%s goes to %s."), plain, name))
end

-- ---------------------------------------------------------------------
-- Text for the window and /guilded reserve list
-- ---------------------------------------------------------------------

function reserve.mine()
  local s = state()
  local me = ns.playerName() or ""
  local list = s and s.entries[me] or {}
  local names = {}
  for _, id in ipairs(list) do
    local plus = reserve.plusFor(me, id)
    table.insert(names, itemName(id) .. (plus > 0 and string.format(" (SR+%d)", plus) or ""))
  end
  return names
end

function reserve.statusText(maxLines)
  local s = state()
  if not (s and s.host) then return L("No reserve list is open.") end
  local lines = {}
  local head = string.format(L("Reserves: %s, %d per player"), s.open and L("open") or L("locked"), s.limit)
  if s.title and s.title ~= "" then head = head .. " - " .. s.title end
  table.insert(lines, head .. " (" .. s.host .. ")")
  local mine = reserve.mine()
  table.insert(lines, L("Yours") .. ": " .. (#mine > 0 and table.concat(mine, ", ") or L("nothing yet")))
  local players = sortedPlayers(s)
  local shown = maxLines or 12
  for i = 1, math.min(shown, #players) do
    local names = {}
    for _, id in ipairs(s.entries[players[i]]) do
      local plus = reserve.plusFor(players[i], id)
      table.insert(names, itemName(id) .. (plus > 0 and string.format(" (SR+%d)", plus) or ""))
    end
    table.insert(lines, players[i] .. ": " .. table.concat(names, ", "))
  end
  if #players > shown then table.insert(lines, string.format(L("... and %d more players"), #players - shown)) end
  if #players == 0 then table.insert(lines, L("Nobody has reserved yet.")) end
  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["reserve"] = function(args)
  local first = args[1] or ""
  -- A bare item link reserves it.
  if itemId(first) then reserveItem(table.concat(args, " ")); return end
  local action = string.lower(first)
  table.remove(args, 1)
  if action == "add" then
    -- Members: add <link>. Officers: add <player> <link> reserves for someone else.
    local target = args[1] and not itemId(args[1]) and ns.normalizeName(args[1])
    if target and ns.isOfficer() then officerChange("ADD", args) else reserveItem(table.concat(args, " ")) end
  elseif action == "remove" or action == "unreserve" then
    local target = args[1] and not itemId(args[1]) and ns.normalizeName(args[1])
    if target and ns.isOfficer() then officerChange("DEL", args) else unreserveItem(table.concat(args, " ")) end
  elseif action == "open" then openList(args)
  elseif action == "lock" then setLocked(true)
  elseif action == "unlock" then setLocked(false)
  elseif action == "clear" then clearList()
  elseif action == "share" then
    if needOfficer() then shareNow() end
  elseif action == "who" then ns.message(whoText(table.concat(args, " ")))
  elseif action == "roll" then rollFor(table.concat(args, " "))
  elseif action == "award" then awardTo(args)
  elseif action == "list" or action == "status" or action == "mine" or action == "" then ns.message(reserve.statusText(30))
  else
    ns.message("/guilded reserve <item link> | remove <link> | list | who <link>   -   officers: open [per player] [title] | lock | unlock | clear | add <player> <link> | roll <link> | award <player> <link> [GP]")
  end
end
ns.commandHandlers["res"] = ns.commandHandlers["reserve"]
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded reserve <item link> - soft reserve an item (officers: open, lock, roll, award)")

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local function onEvent(_, event, ...)
  if event == "PLAYER_LOGIN" then
    ns.comm.register(PREFIX)
    -- Ask the keeper for the current list (they answer once in a while).
    if C_Timer and C_Timer.After then
      C_Timer.After(15, function()
        local s = state()
        if s and not isHost() then sendAddon("REQ", shareChannel()) end
      end)
    end
  elseif event == "CHAT_MSG_WHISPER" then
    -- Players without the addon: "res [item link]" or "unres [item link]" to the keeper.
    if not isHost() then return end
    local text, sender = ...
    if ns.isSecret(text) or ns.isSecret(sender) then return end
    local verb = string.match(string.lower(text or ""), "^%s*(%a+)%s")
    local id = itemId(text)
    if not (verb and id) then return end
    local s = state()
    remember(s, id, text)
    local name = ns.normalizeName(sender)
    if verb == "res" or verb == "reserve" then hostChange("ADD", name, id, sender, "whisper")
    elseif verb == "unres" or verb == "unreserve" then hostChange("DEL", name, id, sender, "whisper") end
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, _, sender = ...
    if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or prefix ~= PREFIX then return end
    local name = ns.normalizeName(sender)
    if not name or name == ns.playerName() then return end
    local s = state()
    if not s then return end
    local kind = string.match(text, "^(%u+)")
    if kind == "ADD" or kind == "DEL" then
      local id = tonumber(string.match(text, "^%u+|(%d+)"))
      local known = string.match(text, "^%u+|%d+|(.+)$")
      if id and known and not s.names[id] then s.names[id] = known end
      hostChange(kind, name, id, sender, "addon")
    elseif kind == "REQ" then
      if isHost() and (not reserve.lastShare or (time() - reserve.lastShare) > 30) then
        reserve.lastShare = time()
        shareNow()
      end
    elseif kind == "ACK" or kind == "REJECT" then
      local message = string.match(text, "^%u+|(.*)$")
      if message and s.hostSender == sender then ns.message(message) end
    elseif ns.isOfficerName(name) then
      -- The list comes only from an officer.
      if kind == "WON" then
        -- Another officer gave a reserved item out: the keeper takes it off the list.
        local player, id = string.match(text, "^WON|([^|]+)|(%d+)$")
        id = tonumber(id)
        if isHost() and player and id then
          removeFor(player, id)
          wonPlus(s, player, id)
          changed()
          shareNow()
        end
      elseif kind == "STATE" then
        local open, limit, title = string.match(text, "^STATE|(%d)|(%d+)|(.*)$")
        if not open then return end
        s.host, s.hostSender = name, sender
        s.open, s.limit, s.title = open == "1", math.max(1, math.min(MAX_LIMIT, tonumber(limit) or DEFAULT_LIMIT)), title
      elseif kind == "DONE" then
        if s.host == name then
          s.open, s.host, s.hostSender, s.entries = false, nil, nil, {}
          local stamp = string.match(text, "^DONE|(.+)$")
          if stamp and not ns.util.tooFarAhead(stamp) then s.updatedAt = stamp end
        end
        reserve.incoming = nil
      elseif kind == "CLR" then
        if s.host == name then reserve.incoming = { from = name, entries = {}, received = 0 } end
      elseif kind == "VER" then
        local incoming = reserve.incoming
        local stamp, total = string.match(text, "^VER|([^|]*)|(%d+)$")
        if not (incoming and incoming.from == name and total) then return end
        incoming.stamp, incoming.total = stamp, tonumber(total)
      elseif kind == "L" then
        local incoming = reserve.incoming
        if s.host ~= name or not incoming or incoming.from ~= name then return end
        for entry in string.gmatch(string.match(text, "^L|(.*)$") or "", "[^;]+") do
          local player, ids = string.match(entry, "^([^=]+)=([%d,]+)$")
          if player then
            local list = {}
            for id in string.gmatch(ids, "%d+") do table.insert(list, tonumber(id)) end
            incoming.entries[player] = list
          end
        end
        incoming.received = incoming.received + 1
      elseif kind == "P" then
        local incoming = reserve.incoming
        if s.host ~= name or not incoming or incoming.from ~= name then return end
        incoming.plus = incoming.plus or {}
        for entry in string.gmatch(string.match(text, "^P|(.*)$") or "", "[^;]+") do
          local player, list = string.match(entry, "^([^=]+)=([%d:,]+)$")
          if player then
            for id, weeks in string.gmatch(list, "(%d+):(%d+)") do
              incoming.plus[player .. ":" .. id] = math.min(tonumber(weeks), 52)
            end
          end
        end
      end
      -- The whole list arrived: swap it in at once, with the keeper's stamp.
      local incoming = reserve.incoming
      if incoming and incoming.total and incoming.received >= incoming.total then
        s.entries = incoming.entries
        -- An older keeper sends no "P|": keep what was there.
        if incoming.plus then s.plus = incoming.plus end
        if incoming.stamp and incoming.stamp ~= "" and not ns.util.tooFarAhead(incoming.stamp) then s.updatedAt = incoming.stamp end
        reserve.incoming = nil
      end
      notify()
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_WHISPER")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(...)
  if ns.moduleActive and not ns.moduleActive("reserve") then return end -- /guilded modules
  local ok, err = pcall(onEvent, ...)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "reserve: " .. tostring(err)) end
end)
