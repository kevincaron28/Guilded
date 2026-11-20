-- Personal milestones, said once in guild chat so guildmates can cheer (8.4.5).
--
--   level   every 10th level and the edition's maximum level
--   dungeon the first completed run of each dungeon (Dungeon.lua's finished-run hook)
--   hk      lifetime honorable kills: 1, 100, 500, 1000
--   duel    duels won against guildmates: 1, 10, 50, 100 (Duels.lua)
--   prof    profession skill steps 75, 150, 225, 300 (150 and 300 are announced; the others are recorded for the bot)
--   secret  secret achievements (Modules/SecretAchievements.lua; first: killed by the Son of Arugal), announced like the others
--   gold    gold held on this character, as a TIER (1-4 = 100, 500, 1,000, 5,000 gold); only the tier is recorded, never the amount.
--           Checked at login and (debounced, never in combat) on PLAYER_MONEY. Announced only when the member turns `gold` on (OFF by default).
--   auction auction house tiers (9.4): sales sold (1, 100, 1,000; counted from the "A buyer has been found" system line, from install on) and
--           profit (statistic 919, gold earned from auctions: 100, 1,000, 10,000 gold). Only the tier 1-3 is recorded (ref `auction:sold-<tier>`
--           / `auction:profit-<tier>`), never a count or an amount. OFF by default like gold (`/guilded announce auction on`).
--   ach     every WoW Forever in-game achievement (Modules/GameAchievements.lua records them here; the newest is announced)
--
-- ON by default for every character (owner decision, 5 Nov 2026): the first time a line is offered, a one-time
-- local notice (chat frame only) says so and how to stop. (9.3.8) WoW Forever refuses guild chat an addon sends by itself, so
-- each line waits in a small Share bar and goes out from the player's click (see ms.offer / ms.share below).
-- Each player can turn it off, or turn single types off (/guilded announce, Settings); officers can switch it off for
-- the whole guild, which wins over member choices. Every milestone is offered once per character, ever (persisted), to
-- the GUILD channel only, and never in combat. What a character already had when this module first ran, or reached
-- while announcements were off, is recorded silently (and uploaded with the companion), never announced later.
--
--   /guilded announce                         status (also /guilded milestones)
--   /guilded announce on | off                my milestones in guild chat
--   /guilded announce level|dungeon|hk|duel on|off
--   /guilded announce guild off | on          officers: off (or back on) for the whole guild
local _, ns = ...
local ms = {}
ns.milestones = ms

local PREFIX = "GuildedMile"
local RETRY_COMBAT = 15
local MAX_TRIES = 4
local MAX_LOG = 500 -- non-achievement rows (level, dungeon, ...)
local MAX_ACH_LOG = 2500 -- achievement rows keep their own, larger room so they never push real milestones out
local KINDS = { "level", "dungeon", "hk", "duel", "prof", "ach", "secret", "gold", "auction" }
-- Gold held per tier (the bot owns the same list in achievements-catalogue.ts); the value that travels is the tier number 1-4.
local GOLD_STEPS = { 100, 500, 1000, 5000 }
local GOLD_NAMES = { "Pocket Change", "Coin Collector", "Thousandaire", "Gold Goblin" }
local GOLD_DEBOUNCE = 5
local GOLD_STAT = 334 -- "Most gold ever owned" (WoW Forever statistics), so a character that once held the gold still earns the tier
local AUCTION_PROFIT_STAT = 919 -- "Gold earned from auctions"
local SOLD_STEPS = { 1, 100, 1000 }
local SOLD_NAMES = { "First Sale", "Market Regular", "Auction Baron" }
local PROFIT_STEPS = { 100, 1000, 10000 } -- gold
local PROFIT_NAMES = { "Profit Margin I", "Profit Margin II", "Profit Margin III" }
local HK_STEPS = { 1, 100, 500, 1000 }
local DUEL_STEPS = { 1, 10, 50, 100 }
local PROF_STEPS = { 75, 150, 225, 300 }
local PROF_ANNOUNCED = { [150] = true, [300] = true }
-- Skill line ids do not depend on the game language; the key is what the bot reads in the upload.
local PROF_KEYS = { [171] = "alchemy", [164] = "blacksmithing", [333] = "enchanting", [202] = "engineering", [182] = "herbalism",
  [165] = "leatherworking", [186] = "mining", [393] = "skinning", [197] = "tailoring", [185] = "cooking", [129] = "firstaid", [356] = "fishing" }
local FOREVER_CAP = 60

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("milestones") end
local function epoch() local ok, v = pcall(GetServerTime); return ok and tonumber(v) or time() end
local function safe(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, ...)
  if not ok or (ns.isSecret and ns.isSecret(value)) then return nil end
  return value
end

local function root()
  local d = ns.getDb and ns.getDb()
  if not d then return nil end
  d.milestones = type(d.milestones) == "table" and d.milestones or {}
  d.milestones.chars = type(d.milestones.chars) == "table" and d.milestones.chars or {}
  return d.milestones
end
local function identity()
  local name, realm = safe(UnitName, "player"), safe(GetRealmName)
  if type(name) ~= "string" or name == "" then return nil end
  realm = type(realm) == "string" and realm or ""
  if realm == "" then
    -- (Forever 1.60.1) The realm is hidden: keep using the record this character already has ("Name-<old realm>").
    local d = ns.getDb and ns.getDb()
    local chars = d and d.milestones and d.milestones.chars
    if type(chars) == "table" then
      local prefix, best = name .. "-", nil
      for key, entry in pairs(chars) do
        if type(key) == "string" and string.sub(key, 1, #prefix) == prefix and type(entry) == "table" and (not best or key < best) then best = key end
      end
      if best then return best, name, chars[best].realm or "" end
    end
  end
  return name .. "-" .. realm, name, realm
end
-- This character's record: settings (default OFF), what was reached, and the upload log.
local function current()
  local r = root(); local key, name, realm = identity()
  if not r or not key then return nil end
  local c = r.chars[key]
  if type(c) ~= "table" then c = {}; r.chars[key] = c end
  c.name, c.realm = name, realm
  c.done = type(c.done) == "table" and c.done or {}
  c.log = type(c.log) == "table" and c.log or {}
  c.settings = type(c.settings) == "table" and c.settings or {}
  return c, r
end
-- A type is on unless the member turned it off; gold is the exception: it is OFF until the member turns it on.
local function kindOn(c, kind)
  if kind == "gold" or kind == "auction" then return c.settings[kind] == true end
  return c.settings[kind] ~= false
end
function ms.enabled(kind)
  local c = current()
  if not c or c.settings.enabled == false or ms.guildOff() then return false end
  return kind == nil or kindOn(c, kind)
end
-- True only when this character turned announcements off itself (all of them, or `kind`); the officer's guild-wide switch is not
-- counted, and an unknown character is not "off". Duels.lua uses it for its local result line.
function ms.memberOff(kind)
  local c = current()
  if not c then return false end
  return c.settings.enabled == false or (kind ~= nil and c.settings[kind] == false)
end
function ms.setEnabled(on, kind)
  local c = current()
  if not c then return false end
  if kind then c.settings[kind] = on and true or false else c.settings.enabled = on and true or false end
  if ms.offer then ms.offer() end
  return true
end

local function maxLevel()
  local cap = safe(GetMaxPlayerLevel)
  if type(cap) == "number" and cap >= 10 then return cap end
  return FOREVER_CAP
end

-- ----- announcing ------------------------------------------------------

local queue = {}
local function messageFor(item, name)
  if item.kind == "level" then
    if item.cap then return string.format(L("%s reached the maximum level (%d)!"), name, item.value) end
    return string.format(L("%s reached level %d!"), name, item.value)
  elseif item.kind == "dungeon" then
    return string.format(L("%s cleared %s for the first time!"), name, item.label or "?")
  elseif item.kind == "hk" then
    if item.value == 1 then return string.format(L("%s scored a first honorable kill!"), name) end
    return string.format(L("%s reached %d honorable kills!"), name, item.value)
  elseif item.kind == "prof" then
    return string.format(L("%s reached skill %d in %s!"), name, item.value, item.label or "?")
  elseif item.kind == "gold" then
    return string.format(L("%s reached the gold milestone: %s!"), name, L(item.label or "?"))
  elseif item.kind == "auction" then
    return string.format(L("%s reached the auction house milestone: %s!"), name, L(item.label or "?"))
  elseif item.kind == "ach" then
    return string.format(L("%s earned the achievement %s!"), name, item.label or "?")
  elseif item.kind == "secret" then
    return string.format(L("%s unlocked a secret achievement: %s!"), name, item.label or "?")
  elseif item.kind == "duel" then
    if item.value == 1 then return string.format(L("%s won a first duel!"), name) end
    return string.format(L("%s has won %d duels!"), name, item.value)
  end
end
ms.message = messageFor

local function inCombat()
  return (InCombatLockdown and InCombatLockdown() == true) or (UnitAffectingCombat and UnitAffectingCombat("player") == true)
end

-- (9.3.8) A milestone line goes to guild chat only from the player's click on Share.
-- WoW Forever refuses a guild-chat line an addon sends on its own (from a game event or a timer): every milestone line sent that
-- way raised "ADDON_ACTION_BLOCKED: Guilded tried to call UNKNOWN()" within a second (owner's saved diagnostics, 13-17 Nov 2026:
-- level 30, fishing 150, cooking 150 and first aid 150, each at the second the milestone was recorded; then an achievement toast
-- while mining). The automatic guild welcome was removed in 9.2 for the same refusal. So a reached milestone waits in a small
-- Share bar (never shown in combat), and the line is sent inside the click, the one moment the game accepts it.
local MAX_WAITING = 5
local bar
local function nextText()
  local c = current()
  while queue[1] do
    local text = c and messageFor(queue[1], c.name)
    if text then return text end
    table.remove(queue, 1)
  end
  return nil
end
-- True when nothing should be offered any more (turned off since, no guild): the waiting lines are dropped.
local function stale(item)
  local c = current()
  return not c or not active() or c.settings.enabled == false or ms.guildOff() or not kindOn(c, item.kind) or not (IsInGuild and IsInGuild())
end

local function ensureBar()
  if bar then return bar end
  bar = CreateFrame("Frame", "GuildedMilestoneShare", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  bar:SetWidth(330); bar:SetHeight(70)
  bar:SetPoint("TOP", UIParent, "TOP", 0, -150)
  if bar.SetFrameStrata then bar:SetFrameStrata("MEDIUM") end
  if bar.SetClampedToScreen then bar:SetClampedToScreen(true) end
  if bar.SetBackdrop then
    pcall(bar.SetBackdrop, bar, { bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    if bar.SetBackdropColor then pcall(bar.SetBackdropColor, bar, 0.05, 0.05, 0.07, 0.95) end
  end
  bar.label = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  bar.label:SetPoint("TOPLEFT", bar, "TOPLEFT", 10, -10)
  bar.label:SetWidth(290)
  local function button(label, width, onClick)
    local b = CreateFrame("Button", nil, bar, "UIPanelButtonTemplate")
    b:SetWidth(width); b:SetHeight(22)
    if b.SetText then b:SetText(label) end
    b:SetScript("OnClick", onClick)
    return b
  end
  bar.share = button(L("Share in guild chat"), 150, function() ms.share() end)
  bar.share:SetPoint("BOTTOMLEFT", bar, "BOTTOMLEFT", 10, 8)
  bar.later = button(L("Not now"), 90, function() table.remove(queue, 1); ms.offer() end)
  bar.later:SetPoint("LEFT", bar.share, "RIGHT", 4, 0)
  local x = CreateFrame("Button", nil, bar, "UIPanelCloseButton")
  x:SetPoint("TOPRIGHT", bar, "TOPRIGHT", 2, 2)
  x:SetScript("OnClick", function() queue = {}; ms.offer() end)
  bar.close = x
  bar:Hide()
  return bar
end
ms.bar = function() return ensureBar() end

-- Shows the Share bar with the first waiting line, or hides it when nothing waits. Never sends anything.
local offerTimer = false
function ms.offer()
  if queue[1] and stale(queue[1]) then queue = {} end
  local text = nextText()
  if not text then
    if bar then bar.text = nil; bar:Hide() end
    return false
  end
  if inCombat() then
    if bar then bar:Hide() end
    if not offerTimer and C_Timer and C_Timer.After then
      offerTimer = true
      C_Timer.After(RETRY_COMBAT, function() offerTimer = false; ms.offer() end)
    end
    return false
  end
  local c = current()
  -- One local notice (chat frame only, never sent) before the first line is offered on this character.
  if c and not c.settings.noticed then
    c.settings.noticed = true
    if ns.message then ns.message(L("Guilded offers to share your milestones (levels, first dungeon clears, PvP and duel milestones) in guild chat: click Share to post one. Type /guilded announce off to stop, or turn types off in Settings.")) end
  end
  ensureBar()
  bar.text = text
  bar.label:SetText(text)
  bar:Show()
  return true
end

-- The Share button: sends the first waiting line, from inside the click. Returns true when it went out.
function ms.share()
  local item = queue[1]
  if not item then ms.offer(); return false end
  if stale(item) then queue = {}; ms.offer(); return false end
  local text = nextText()
  if not text then ms.offer(); return false end
  item = queue[1]
  local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
  -- Marked while it runs: a refusal raised inside is named in the diagnostic (Core.lua), not "UNKNOWN()".
  ns.guardedCall = { name = "SendChatMessage (milestone Share)" }
  local ok, err = pcall(send, text, "GUILD")
  ns.guardedCall = nil
  if ok and err ~= false then
    table.remove(queue, 1)
  else
    -- Refused (restricted chat): the line stays for another click, a few times.
    item.tries = (item.tries or 0) + 1
    if item.tries >= MAX_TRIES then table.remove(queue, 1) end
  end
  ms.offer()
  return ok and err ~= false
end
-- Lines waiting for a Share click (tests, status).
function ms.waiting() return #queue end

-- ----- recording -------------------------------------------------------

-- Marks a milestone reached (once per character, ever). `item` = { kind, value, label, cap }.
-- `silent` records without announcing (older steps of a jump, the first baseline, announcements off).
function ms.reach(id, ref, item, silent)
  local c = current()
  if not c or not active() or c.done[id] then return false end
  -- An achievement carries the date the game gave it (and its text, for the bot's badge catalogue); everything else is "now".
  local at = tonumber(item.at) or epoch()
  c.done[id] = at
  c.log[#c.log + 1] = { id = id, kind = item.kind, ref = ref, value = item.value, at = at, label = item.kind == "ach" and item.label or nil,
    desc = item.kind == "ach" and item.desc or nil, category = item.kind == "ach" and item.category or nil, points = item.kind == "ach" and item.points or nil }
  -- Oldest first, but each group only evicts itself: achievements never evict a level or dungeon milestone.
  local achCount, otherCount = 0, 0
  for _, row in ipairs(c.log) do if row.kind == "ach" then achCount = achCount + 1 else otherCount = otherCount + 1 end end
  local over = item.kind == "ach" and achCount - MAX_ACH_LOG or otherCount - MAX_LOG
  local isAch = item.kind == "ach"
  local i = 1
  while over > 0 and i <= #c.log do
    if (c.log[i].kind == "ach") == isAch then table.remove(c.log, i); over = over - 1 else i = i + 1 end
  end
  if not silent and c.settings.enabled ~= false and not ms.guildOff() and kindOn(c, item.kind) and c.baselined then
    queue[#queue + 1] = item
    -- Only the newest few wait; an older one that was never shared is dropped (it stays recorded).
    while #queue > MAX_WAITING do table.remove(queue, 1) end
    ms.offer()
  end
  if ns.syncNow and ns.syncNow.mark then pcall(ns.syncNow.mark) end
  return true
end

-- Every step at or below `value`: the highest new one is announced, lower new ones are recorded silently.
local function reachSteps(kind, steps, value, make)
  local new = {}
  for _, step in ipairs(steps) do
    local c = current()
    if c and value >= step and not c.done[kind .. ":" .. step] then new[#new + 1] = step end
  end
  for i, step in ipairs(new) do
    local item, ref = make(step)
    ms.reach(kind .. ":" .. step, ref, item, i < #new or item.announce == false)
  end
end

function ms.checkLevel(level)
  level = tonumber(level)
  if not level or level < 1 then return end
  local cap, steps = maxLevel(), {}
  for step = 10, cap - 1, 10 do steps[#steps + 1] = step end
  steps[#steps + 1] = cap
  reachSteps("level", steps, level, function(step) return { kind = "level", value = step, cap = step == cap }, "level:" .. step end)
end

function ms.checkHonorableKills()
  local hk = safe(GetPVPLifetimeStats)
  if type(hk) ~= "number" or hk ~= hk or hk < 0 then return end
  reachSteps("hk", HK_STEPS, math.floor(hk), function(step) return { kind = "hk", value = step }, "hk:" .. step end)
end

-- Gold held: copper to the highest tier reached (0 = below the first). Only this number leaves this function.
function ms.goldTier(copper)
  copper = tonumber(copper)
  if not copper or copper ~= copper or copper < 0 then return 0 end
  local gold, tier = math.floor(copper / 10000), 0
  for i, need in ipairs(GOLD_STEPS) do if gold >= need then tier = i end end
  return tier
end
-- A money value from GetStatistic as copper, or nil. The client gives a string such as "12g 34s 56c", "12 <gold icon> 34 <silver icon>",
-- a localized "12 po 34 pa", a plain number, or "--" when it has nothing; every shape is read the same way, anything else is nil.
function ms.parseMoney(value)
  if type(value) == "number" then
    if value ~= value or value < 0 then return nil end
    return math.floor(value)
  end
  if type(value) ~= "string" then return nil end
  local text = value:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
  if not text:find("%d") then return nil end
  local total, pos, any = 0, 1, false
  while true do
    local s1, e1, num = text:find("(%d[%d,%.%s\194\160]*)", pos)
    if not s1 then break end
    local digits = num:gsub("%D", "")
    local amount = tonumber(digits)
    local rest = text:sub(e1 + 1)
    local unit, used
    local iconText = rest:match("^|T[^|]*|t")
    if iconText then
      local icon = iconText:lower()
      unit = icon:find("gold", 1, true) and "g" or icon:find("silver", 1, true) and "s" or icon:find("copper", 1, true) and "c" or nil
      used = #iconText
    else
      local word = rest:match("^%s*(%a+)")
      if word then
        word = word:lower()
        unit = (word:sub(1, 1) == "g" or word:sub(1, 2) == "po" or word == "or") and "g"
          or (word:sub(1, 1) == "s" or word:sub(1, 2) == "pa" or word:sub(1, 2) == "ar") and "s"
          or (word:sub(1, 1) == "c" or word:sub(1, 2) == "pc" or word:sub(1, 2) == "cu") and "c" or nil
        used = unit and #rest:match("^%s*%a+") or 0
      end
    end
    if amount then
      any = true
      total = total + amount * (unit == "g" and 10000 or unit == "s" and 100 or 1)
    end
    pos = e1 + 1 + (used or 0)
  end
  return any and total or nil
end

-- Gold held: what the purse holds now, or the most gold this character ever owned (statistic 334), whichever is more.
local function heldCopper()
  local now = tonumber(safe(GetMoney)) or 0
  local ever = ms.parseMoney(safe(GetStatistic, GOLD_STAT)) or 0
  return math.max(now, ever)
end
-- Records the tiers this character's purse reached. Never in combat (unless `force`, the silent baseline); the amount is not kept.
-- `silent` records without ever announcing (the one-time catch-up for characters that predate the statistic).
function ms.checkGold(force, silent)
  if not force and inCombat() then return false end
  local tier = ms.goldTier(heldCopper())
  if tier < 1 then return false end
  reachSteps("gold", { 1, 2, 3, 4 }, tier, function(step)
    local item = { kind = "gold", value = step, label = GOLD_NAMES[step] }
    if silent then item.announce = false end
    return item, "gold:" .. step
  end)
  return true
end

-- ----- auction house (9.4) ---------------------------------------------

-- The pattern for the client's own "sold" system line (ERR_AUCTION_SOLD_S), whatever the game language: magic characters escaped, %s = anything.
function ms.soldPattern(template)
  if template == nil then template = ERR_AUCTION_SOLD_S end
  if type(template) ~= "string" or template == "" then return nil end
  local escaped = template:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"):gsub("%%%%1%%%$s", ".+"):gsub("%%%%s", ".+")
  return "^" .. escaped .. "$"
end
function ms.isSoldLine(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return false end
  local pattern = ms.soldPattern()
  return pattern ~= nil and text:find(pattern) ~= nil
end
local function tierOf(value, steps)
  local tier = 0
  for i, need in ipairs(steps) do if value >= need then tier = i end end
  return tier
end
function ms.soldTier(count) count = tonumber(count); return (count and count == count) and tierOf(count, SOLD_STEPS) or 0 end
function ms.profitTier(copper) copper = tonumber(copper); return (copper and copper == copper and copper >= 0) and tierOf(math.floor(copper / 10000), PROFIT_STEPS) or 0 end

local function reachAuction(sub, tier, names, silent)
  local new = {}
  for step = 1, tier do
    local c = current()
    if c and not c.done["auction:" .. sub .. "-" .. step] then new[#new + 1] = step end
  end
  for i, step in ipairs(new) do
    local id = "auction:" .. sub .. "-" .. step
    ms.reach(id, id, { kind = "auction", value = step, label = names[step] }, silent or i < #new)
  end
end
-- Records the sales and profit tiers. The sale count lives on this character's record and never leaves it; only tiers do.
function ms.checkAuction(force, silent)
  if not force and inCombat() then return false end
  local c = current()
  if not c then return false end
  c.auctionSold = tonumber(c.auctionSold) or 0 -- past sales before install cannot be known: the count starts at 0
  reachAuction("sold", ms.soldTier(c.auctionSold), SOLD_NAMES, silent)
  reachAuction("profit", ms.profitTier(ms.parseMoney(safe(GetStatistic, AUCTION_PROFIT_STAT))), PROFIT_NAMES, silent)
  return true
end
-- CHAT_MSG_SYSTEM: one more sale when the line is the client's "buyer found" text. Counting is just a number, so it also works mid-fight;
-- the tier check waits for the fight to end.
function ms.onSystemMessage(text)
  local c = current()
  if not c or not c.baselined or not ms.isSoldLine(text) then return false end
  c.auctionSold = (tonumber(c.auctionSold) or 0) + 1
  ms.scheduleGold()
  return true
end

-- PLAYER_MONEY fires on every coin: look once, a few seconds after the last change, and wait out a fight.
local goldTimer = false
function ms.scheduleGold(delay)
  if goldTimer or not (C_Timer and C_Timer.After) then return end
  goldTimer = true
  C_Timer.After(delay or GOLD_DEBOUNCE, function()
    goldTimer = false
    local c = current()
    if not c or not c.baselined or not active() then return end
    if inCombat() then ms.scheduleGold(RETRY_COMBAT); return end
    pcall(ms.checkGold)
    pcall(ms.checkAuction)
  end)
end

-- PLAYER_MONEY: only a character that has had its silent first run is watched.
function ms.onMoney()
  local c = current()
  if c and c.baselined then ms.scheduleGold() end
end

-- A duel win total from Duels.lua.
function ms.checkDuelWins(wins)
  wins = tonumber(wins)
  if not wins then return end
  reachSteps("duel", DUEL_STEPS, wins, function(step) return { kind = "duel", value = step }, "duel:" .. step end)
end

-- Profession skill steps, per profession (by skill line id, so any game language gives the same key).
-- Reaching 300 while watching (not found already there at the first run) also records `profnew:<key>`, which lets the
-- bot tell "first in the guild to reach 300" from a skill that was simply already there.
function ms.checkProfessions()
  if not (GetProfessions and GetProfessionInfo) then return end
  local ok, a, b, c, d, e, f = pcall(GetProfessions)
  if not ok then return end
  for _, index in ipairs({ a or false, b or false, c or false, d or false, e or false, f or false }) do
    if index then
      local infoOk, name, _, skill, _, _, _, line = pcall(GetProfessionInfo, index)
      local key = infoOk and PROF_KEYS[tonumber(line) or 0]
      skill = infoOk and tonumber(skill)
      if key and skill and skill > 0 and type(name) == "string" and not (ns.isSecret and ns.isSecret(name)) then
        reachSteps("prof:" .. key, PROF_STEPS, math.floor(skill), function(step)
          local cur = current()
          if step == 300 and cur and cur.baselined then ms.reach("profnew:" .. key, "profnew:" .. key, { kind = "prof", value = 300 }, true) end
          return { kind = "prof", value = step, label = name, announce = PROF_ANNOUNCED[step] == true }, "prof:" .. key .. "-" .. step
        end)
      end
    end
  end
end

-- This character's record, for Modules/GameAchievements.lua (settings, what was reached, the upload log).
function ms.state() return (current()) end

-- Dungeon.lua's finished-run hook: the first completed run of each dungeon, for this character.
function ms.onDungeonRun(run)
  if type(run) ~= "table" or run.state ~= "COMPLETED" or type(run.instanceId) ~= "number" then return end
  local c = current()
  if not c then return end
  -- Only a run this character took part in (each player records for themself, never for others).
  if type(run.players) ~= "table" or not run.players[c.name] then return end
  local id = "dungeon:" .. run.instanceId
  ms.reach(id, id, { kind = "dungeon", value = run.instanceId, label = run.name or ("#" .. run.instanceId) }, false)
end

-- First run of the module on a character: everything already reached is recorded silently, so turning
-- announcements on later never replays history.
local function baseline()
  local c = current()
  if not c or c.baselined then return end
  ms.checkLevel(safe(UnitLevel, "player"))
  ms.checkHonorableKills()
  ms.checkProfessions()
  ms.checkGold(true)
  ms.checkAuction(true, true)
  c.statsBaselined = true
  local d = ns.getDb and ns.getDb()
  for _, run in pairs(d and d.dungeon and d.dungeon.runs or {}) do
    if type(run) == "table" and run.state == "COMPLETED" and type(run.instanceId) == "number" and type(run.players) == "table" and run.players[c.name] then
      local id = "dungeon:" .. run.instanceId
      ms.reach(id, id, { kind = "dungeon", value = run.instanceId, label = run.name }, true)
    end
  end
  if ns.duels and ns.duels.myWins then ms.checkDuelWins(ns.duels.myWins()) end
  c.baselined = true
end
ms.baseline = baseline

-- ----- officer guild-wide switch ---------------------------------------

local function send(text)
  if IsInGuild and IsInGuild() then ns.comm.send(PREFIX, text, "GUILD") end
end
-- True when an officer turned announcements off for the whole guild (that wins over every member's choice).
function ms.guildOff()
  local r = root()
  return r and r.guild and r.guild.off == true or false
end
-- Officers only. Shared with online guildmates now and again whenever an officer logs in.
function ms.setGuildOff(off)
  local r = root()
  if not r or not (ns.isOfficer and ns.isOfficer()) then return false end
  r.guild = { off = off and true or false, at = epoch(), by = safe(UnitName, "player") }
  if off then queue = {}; ms.offer() end
  send(string.format("GOFF|%d|%d", off and 1 or 0, r.guild.at))
  return true
end

function ms.onAddonMessage(text, sender)
  if type(text) ~= "string" then return end
  local kind, off, at = text:match("^(GOFF)|(%d)|(%d+)$")
  if kind ~= "GOFF" then return end
  at = tonumber(at)
  -- Only an officer's word counts; a future date would pin the switch forever.
  if not at or (ns.isOfficerName and not ns.isOfficerName(sender)) or (ns.util and ns.util.tooFarAhead and ns.util.tooFarAhead(at)) then return end
  local r = root()
  if not r or (r.guild and (r.guild.at or 0) >= at) then return end
  r.guild = { off = off == "1", at = at, by = tostring(sender):match("^[^-]+") }
  if off == "1" then queue = {}; ms.offer() end
end

-- ----- commands --------------------------------------------------------

local function stateWord(on) return on and "ON" or "OFF" end
local function status()
  local c = current()
  if not c then return end
  ns.message(string.format(L("Milestone announcements in guild chat: %s. Level %s, dungeons %s, honorable kills %s, duels %s, professions %s."),
    stateWord(c.settings.enabled ~= false), stateWord(c.settings.level ~= false), stateWord(c.settings.dungeon ~= false),
    stateWord(c.settings.hk ~= false), stateWord(c.settings.duel ~= false), stateWord(c.settings.prof ~= false)))
  ns.message(string.format(L("Achievements in guild chat: %s."), stateWord(c.settings.ach ~= false)))
  ns.message(string.format(L("Gold milestones in guild chat: %s."), stateWord(c.settings.gold == true)))
  ns.message(string.format(L("Auction house milestones in guild chat: %s."), stateWord(c.settings.auction == true)))
  if ms.guildOff() then ns.message(L("Milestone announcements are turned off for the whole guild by an officer.")) end
end
local function handle(args)
  args = type(args) == "table" and args or {}
  local a, b = string.lower(args[1] or ""), string.lower(args[2] or "")
  if a == "on" or a == "off" then
    ms.setEnabled(a == "on")
    ns.message(a == "on" and L("Milestone announcements are ON. /guilded announce off turns them off.") or L("Milestone announcements are OFF."))
  elseif a == "guild" then
    if b ~= "on" and b ~= "off" then ns.message("/guilded announce guild on | off"); return end
    if ms.setGuildOff(b == "off") then
      ns.message(b == "off" and L("Milestone announcements are turned off for the whole guild by an officer.") or L("Milestone announcements are allowed for the guild again."))
    else ns.message(L("Officer or guild-master rank is required for this command.")) end
  else
    for _, kind in ipairs(KINDS) do
      if a == kind and (b == "on" or b == "off") then ms.setEnabled(b == "on", kind); status(); return end
    end
    status()
    ns.message("/guilded announce on | off | level|dungeon|hk|duel|prof|ach|secret|gold|auction on|off | guild on|off (officers)")
  end
end
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["milestones"] = handle
ns.commandHandlers["announce"] = handle
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded announce on | off - my milestones (level 10, first dungeon clears, honorable kills, duel wins) in guild chat; ON by default")
table.insert(ns.commandHelp, { officer = true, text = "/guilded announce guild off | on - officers: turn milestone announcements off (or back on) for the whole guild" })

-- ----- events ----------------------------------------------------------

-- Dungeon.lua calls ns.onDungeonRunFinished(run) when a run ends; keep whatever was there (Scores.lua) and add ours.
local previousHook = ns.onDungeonRunFinished
ns.onDungeonRunFinished = function(run)
  if previousHook then pcall(previousHook, run) end
  pcall(ms.onDungeonRun, run)
end

local frame = CreateFrame("Frame")
local events = { "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "PLAYER_LEVEL_UP", "PLAYER_PVP_KILLS_CHANGED", "CHAT_MSG_COMBAT_HONOR_GAIN", "SKILL_LINES_CHANGED", "CHAT_MSG_SKILL", "PLAYER_MONEY", "MAIL_INBOX_UPDATE", "CHAT_MSG_SYSTEM", "CHAT_MSG_ADDON" }
for _, event in ipairs(events) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event, a, b, c, d)
  local ok, err = pcall(function()
    if not active() then return end
    if event == "PLAYER_LOGIN" then
      ns.comm.register(PREFIX)
    elseif event == "PLAYER_ENTERING_WORLD" then
      baseline()
      -- A character from before 9.4 gets the new statistics read once, silently, so nothing old is announced.
      local cur = current()
      if cur and cur.baselined and not cur.statsBaselined then
        cur.statsBaselined = true
        pcall(ms.checkGold, true, true)
        pcall(ms.checkAuction, true, true)
      end
      ms.checkHonorableKills()
      ms.scheduleGold()
      -- An officer's guild-wide switch is repeated at login so members who were offline get it too.
      local r = root()
      if r and r.guild and r.guild.off and ns.isOfficer and ns.isOfficer() and C_Timer and C_Timer.After then
        C_Timer.After(45, function() send(string.format("GOFF|1|%d", r.guild.at)) end)
      end
    elseif event == "PLAYER_LEVEL_UP" then
      baseline(); ms.checkLevel(a)
    elseif event == "PLAYER_PVP_KILLS_CHANGED" or event == "CHAT_MSG_COMBAT_HONOR_GAIN" then
      ms.checkHonorableKills()
    elseif event == "PLAYER_MONEY" or event == "MAIL_INBOX_UPDATE" then
      ms.onMoney()
    elseif event == "CHAT_MSG_SYSTEM" then
      ms.onSystemMessage(a)
    elseif event == "SKILL_LINES_CHANGED" or event == "CHAT_MSG_SKILL" then
      if current() and current().baselined then ms.checkProfessions() end
    elseif event == "CHAT_MSG_ADDON" and ns.comm.accept(a, b, c, d, PREFIX, function(sender) return ns.isGuildMember and ns.isGuildMember(sender) end) and c == "GUILD" then
      ms.onAddonMessage(b, d)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "milestones: " .. tostring(err)) end
end)
