-- 8.5 track C4 (addon half): guildmates' professions on Blizzard's guild roster. Skills come from the
-- readiness digests guildmates already share (db.peerRoster) and from your own character. 9.2: the opt-in
-- officer tool that wrote them into PUBLIC guild notes was removed (WoW Forever refuses guild-note edits).
local _, ns = ...
ns = ns or {}
local module = {}
ns.rosterProfessions = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local function norm(name) return ns.normalizeName and ns.normalizeName(name) or name end

-- The same abbreviations and 31-byte rule as the bot's profession-note.ts (tests keep them equal).
local ABBREVIATIONS = {
  alchemy = "Alch", blacksmithing = "Smith", enchanting = "Ench", engineering = "Engi", herbalism = "Herb", leatherworking = "Leath",
  mining = "Mine", skinning = "Skin", tailoring = "Tail", cooking = "Cook", ["first aid"] = "Aid", fishing = "Fish",
}
local ICONS = {
  alchemy = "Trade_Alchemy", blacksmithing = "Trade_BlackSmithing", enchanting = "Trade_Engraving", engineering = "Trade_Engineering",
  herbalism = "Trade_Herbalism", leatherworking = "INV_Misc_ArmorKit_17", mining = "Trade_Mining", skinning = "INV_Misc_Pelt_Wolf_01",
  tailoring = "Trade_Tailoring", cooking = "INV_Misc_Food_15", ["first aid"] = "Spell_Holy_SealOfSacrifice", fishing = "Trade_Fishing",
}
module.NOTE_MAX = 31

local function trim(s) return (tostring(s):gsub("^%s+", ""):gsub("%s+$", "")) end

-- "Alchemy:300,Herbalism:300" (the digest format) -> { { name, skill }, ... }
function module.parse(text)
  local skills = {}
  if type(text) ~= "string" then return skills end
  for name, skill in text:gmatch("([^:,]+):(%d+)") do
    -- Canonical English name whatever language the sender's client used (Util.lua), so the note tag and the icon match.
    if #name <= 40 and #skill <= 4 then
      local canonical, level = ns.util.professionName(trim(name)), tonumber(skill)
      -- "Cuisine:300,Cooking:150" (one profession sent under two spellings) is one entry at the higher skill.
      local twin
      for _, entry in ipairs(skills) do if entry.name == canonical then twin = entry break end end
      if twin then twin.skill = math.max(twin.skill, level)
      elseif #skills < 10 then skills[#skills + 1] = { name = canonical, skill = level } end
    end
  end
  return skills
end

local function sorted(skills)
  local out = {}
  for _, s in ipairs(skills or {}) do if type(s.skill) == "number" and s.skill > 0 then out[#out + 1] = s end end
  table.sort(out, function(a, b) if a.skill ~= b.skill then return a.skill > b.skill end return a.name < b.name end)
  return out
end

-- "Alch300 Herb300": highest skill first, as many as fit in 31 bytes; "" when there are none.
function module.tag(skills, max)
  max = math.min(max or module.NOTE_MAX, module.NOTE_MAX)
  local parts = {}
  for _, s in ipairs(sorted(skills)) do
    local key = s.name:lower()
    local short = ABBREVIATIONS[key] or s.name:gsub("[^A-Za-z]", ""):sub(1, 4)
    local item = short .. math.min(999, s.skill)
    if #table.concat(parts, " ") + (#parts > 0 and 1 or 0) + #item > max then break end
    parts[#parts + 1] = item
  end
  return table.concat(parts, " ")
end

-- True when a public note may be replaced by the tool: empty, or nothing but profession tags.
function module.noteIsWritable(note)
  local text = trim(note or "")
  if text == "" then return true end
  for word in text:gmatch("%S+") do
    local ok = false
    for _, short in pairs(ABBREVIATIONS) do
      local digits = word:match("^" .. short .. "(%d+)$")
      if digits and #digits <= 3 then ok = true; break end
    end
    if not ok then return false end
  end
  return true
end

-- Skills for one guildmate: yourself live, others from the digests they shared.
function module.skillsFor(name)
  local key = norm(name)
  if not key then return {} end
  if key == (ns.playerName and ns.playerName()) and ns.collectProfessions then
    local mine = ns.collectProfessions()
    local out = {}
    for _, p in ipairs(mine) do out[#out + 1] = { name = ns.util.professionName(p.name), skill = p.skillLevel } end
    if #out > 0 then return out end
  end
  local d = db()
  local peer = d and d.peerRoster and d.peerRoster[key]
  return module.parse(peer and peer.professions)
end

function module.icon(name, size)
  local file = ICONS[(name or ""):lower()]
  if not file then return "" end
  return "|TInterface\\Icons\\" .. file .. ":" .. (size or 14) .. "|t "
end

-- One line per profession, with its icon, for a tooltip.
function module.lines(name)
  local out = {}
  for _, s in ipairs(sorted(module.skillsFor(name))) do out[#out + 1] = module.icon(s.name) .. ns.util.professionLabel(s.name) .. " " .. s.skill end
  return out
end

-- Blizzard's guild roster: add the lines to its row tooltip. Hooks are optional and wrapped, so a
-- client that names things differently simply shows nothing instead of an error.
local function memberName(button)
  local info = button and button.memberInfo
  if type(info) == "table" and type(info.name) == "string" then return info.name end
  local index = button and (button.guildIndex or button.index)
  if type(index) == "number" and GetGuildRosterInfo then
    local ok, name = pcall(GetGuildRosterInfo, index)
    if ok and type(name) == "string" then return name end
  end
end
-- (9.3.0) The professions show in a tooltip of Guilded's own, under the game's one. Adding lines to GameTooltip and
-- calling its Show() from this hook ran the game's tooltip code under Guilded's taint.
local ownTip
local function tip()
  if ownTip ~= nil then return ownTip or nil end
  ownTip = false
  if CreateFrame then
    local ok, frame = pcall(CreateFrame, "GameTooltip", "GuildedRosterTooltip", UIParent, "GameTooltipTemplate")
    if ok and type(frame) == "table" then ownTip = frame end
  end
  return ownTip or nil
end
local leaveHooked = setmetatable({}, { __mode = "k" })
local function hideTip() if ownTip and ownTip.Hide then ownTip:Hide() end end
function module.decorate(button)
  local t = tip()
  if not t then return end
  local ok = pcall(function()
    local name = memberName(button)
    if not name then return end
    local lines = module.lines(name)
    if #lines == 0 then return end
    t:SetOwner(button, "ANCHOR_NONE")
    t:ClearLines()
    if GameTooltip then t:SetPoint("TOPLEFT", GameTooltip, "BOTTOMLEFT", 0, -2) end
    t:AddLine(L("Professions"), 1, 0.82, 0)
    for _, line in ipairs(lines) do t:AddLine(line, 1, 1, 1) end
    t:Show()
    if type(button) == "table" and button.HookScript and not leaveHooked[button] then
      if pcall(button.HookScript, button, "OnLeave", hideTip) then leaveHooked[button] = true end
    end
  end)
  return ok
end
local hooked = {}
-- One roster entry frame's own OnEnter script, hooked once. Never hook a Blizzard *Mixin table:
-- hooksecurefunc writes an insecure wrapper into the mixin, every entry frame made from it copies
-- that tainted method, and the Communities UI then hits ADDON_ACTION_FORBIDDEN on every login (9.0.4).
local hookedFrames = setmetatable({}, { __mode = "k" })
function module.hookEntry(entry)
  if type(entry) ~= "table" or hookedFrames[entry] or type(entry.HookScript) ~= "function" then return false end
  local ok = pcall(entry.HookScript, entry, "OnEnter", function(self) module.decorate(self) end)
  if ok then hookedFrames[entry] = true end
  return ok
end

-- The Communities guild roster (load-on-demand): hook each member entry frame as its ScrollBox
-- creates or reuses it (and the ones already there), or the older list's fixed buttons.
local listHooked = false
function module.hookMemberList()
  local list = CommunitiesFrame and CommunitiesFrame.MemberList
  if listHooked or type(list) ~= "table" then return listHooked end
  local box = list.ScrollBox
  if type(box) == "table" and ScrollUtil and type(ScrollUtil.AddInitializedFrameCallback) == "function" then
    -- The callback gets (owner, frame, elementData); take whichever argument is the frame.
    listHooked = pcall(ScrollUtil.AddInitializedFrameCallback, box, function(a, b)
      module.hookEntry(type(b) == "table" and b.HookScript and b or a)
    end, module, true) or listHooked
  end
  -- The owned tooltip must not stay up when the list closes or scrolls away from the row it described.
  local function hideOn(frame, script)
    if type(frame) == "table" and type(frame.HookScript) == "function" then pcall(frame.HookScript, frame, script, hideTip) end
  end
  hideOn(list, "OnHide")
  hideOn(box, "OnMouseWheel")
  hideOn(list.ListScrollFrame, "OnVerticalScroll")
  local buttons = list.ListScrollFrame and list.ListScrollFrame.buttons
  if type(buttons) == "table" then
    for _, button in ipairs(buttons) do module.hookEntry(button) end
    listHooked = true
  end
  return listHooked
end

function module.install()
  if type(hooksecurefunc) == "function" then
    -- Plain global functions: a secure hook on these is safe.
    local function hook(key)
      if hooked[key] or type(_G[key]) ~= "function" then return end
      local ok = pcall(hooksecurefunc, key, function(self) module.decorate(self) end)
      if ok then hooked[key] = true end
    end
    hook("GuildRosterButton_OnEnter")
    hook("GuildFrameButton_OnEnter")
  end
  module.hookMemberList()
end

function module.text()
  local d, lines = db(), {}
  local names = {}
  for key, peer in pairs(d and d.peerRoster or {}) do if peer.professions and peer.professions ~= "" then names[#names + 1] = key end end
  local me = ns.playerName and ns.playerName()
  if me and #module.skillsFor(me) > 0 then names[#names + 1] = me end
  table.sort(names)
  local seen = {}
  for _, key in ipairs(names) do
    if not seen[key] then
      seen[key] = true
      lines[#lines + 1] = (ns.displayName and ns.displayName(key) or key) .. ": " .. module.tag(module.skillsFor(key))
    end
  end
  if #lines == 0 then return L("No professions shared by guildmates yet.") end
  return table.concat(lines, "\n")
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "ADDON_LOADED" }) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event, loaded)
  if event == "PLAYER_LOGIN" or loaded == "Blizzard_Communities" or loaded == "Blizzard_GuildUI" then module.install() end
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
ns.commandHandlers.professions = function() if ns.showCopyText then ns.showCopyText(module.text(), L("Professions")) end end
table.insert(ns.commandHelp, { text = "/guilded professions - what guildmates have shared about their professions" })
