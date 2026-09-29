-- Raid tools: help the raid leader explain the fight.
--
--   /guilded rt mark <1-8|clear>          raid target icon on your target (skull = 8, cross = 7 ...)
--   /guilded rt tanks                     skull, cross, square ... on the group's tanks
--   /guilded rt clear                     every raid target icon off the group
--   /guilded rt plan save <boss> = line; line; line    a boss plan (officers and raid leaders)
--   /guilded rt plan show|share|post|delete <boss>     see it, send it to the raid's screens,
--                                                      post it in raid chat, delete it
--   /guilded rt plan list
--   /guilded rt check                     what this client allows
--
-- World markers (the coloured floor markers) can only be placed by a click on a secure button
-- running /wm, so they are buttons on the Raid tools page, made out of combat.
--
-- Plans reach raiders who run Guilded as a window on their screen (prefix GuildedRT), and
-- everyone else through "post in raid chat". Newer clients limit addon messages during a boss
-- fight, so plans are shared before the pull; nothing is sent in combat.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedRT"
local MAX_LINES = 8
local MAX_LINE = 200
local ICON_NAMES = { [1] = "Star", [2] = "Circle", [3] = "Diamond", [4] = "Triangle", [5] = "Moon", [6] = "Square", [7] = "Cross", [8] = "Skull" }
-- Tanks get the kill-order icons first.
local TANK_ICONS = { 8, 7, 6, 5, 4, 3, 2, 1 }

local tools = { incoming = nil }
ns.raidTools = tools
tools.ICON_NAMES = ICON_NAMES

local function active() return not ns.moduleActive or ns.moduleActive("raidtools") end
local function L(text) return ns.L and ns.L(text) or text end
local function inCombat() return ns.compat and ns.compat.inCombat and ns.compat.inCombat() or false end

local function store()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.raidPlans = db.raidPlans or {}
  return db.raidPlans
end

-- Raid leader or assistant (or party leader): allowed to mark and to share plans.
function tools.canLead()
  if not (IsInGroup and IsInGroup()) then return true end
  local leader = UnitIsGroupLeader and UnitIsGroupLeader("player")
  local assist = UnitIsGroupAssistant and UnitIsGroupAssistant("player")
  return (leader or assist) and true or false
end

local function groupUnits()
  local units = {}
  if IsInRaid and IsInRaid() then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do units[#units + 1] = "raid" .. i end
  else
    units[1] = "player"
    for i = 1, 4 do if UnitExists and UnitExists("party" .. i) then units[#units + 1] = "party" .. i end end
  end
  return units
end

local function isTank(unit)
  if UnitGroupRolesAssigned then
    local ok, role = pcall(UnitGroupRolesAssigned, unit)
    if ok and role == "TANK" then return true end
  end
  if GetPartyAssignment then
    local ok, main = pcall(GetPartyAssignment, "MAINTANK", unit)
    if ok and main then return true end
  end
  return false
end

local function setMark(unit, index)
  if not SetRaidTarget then return false end
  return (pcall(SetRaidTarget, unit, index))
end

-- ---------------------------------------------------------------------
-- Marks
-- ---------------------------------------------------------------------

function tools.mark(index)
  if not tools.canLead() then ns.message(L("Only the leader or an assistant can mark.")); return end
  if index == 0 then setMark("target", 0); return end
  if not (UnitExists and UnitExists("target")) then ns.message(L("Target something to mark first.")); return end
  if setMark("target", index) then ns.message(string.format(L("Marked your target: %s."), L(ICON_NAMES[index]))) end
end

-- Kill-order icons on the tanks, in group order. Returns how many were marked.
function tools.markTanks()
  if not tools.canLead() then ns.message(L("Only the leader or an assistant can mark.")); return 0 end
  local marked, names = 0, {}
  for _, unit in ipairs(groupUnits()) do
    if marked < #TANK_ICONS and isTank(unit) then
      marked = marked + 1
      setMark(unit, TANK_ICONS[marked])
      local ok, name = pcall(UnitName, unit)
      names[#names + 1] = string.format("%s %s", L(ICON_NAMES[TANK_ICONS[marked]]), ok and name or "?")
    end
  end
  ns.message(marked > 0 and (L("Tanks marked: ") .. table.concat(names, ", "))
    or L("No tank found: set roles in the raid frame (or main tanks) first."))
  return marked
end

function tools.clearMarks()
  if not tools.canLead() then ns.message(L("Only the leader or an assistant can mark.")); return end
  for _, unit in ipairs(groupUnits()) do setMark(unit, 0) end
  ns.message(L("Raid target icons cleared from the group."))
end

-- ---------------------------------------------------------------------
-- Boss plans: db.raidPlans[boss key] = { boss, lines, by, at }
-- ---------------------------------------------------------------------

local function key(boss) return string.lower((string.gsub(boss or "", "^%s*(.-)%s*$", "%1"))) end
local function cleanLine(text) return (string.gsub(string.sub(text or "", 1, MAX_LINE), "[|\n\r]", " ")) end

-- "Onyxia = tanks on the left; healers in the middle; dps behind" -> boss, lines
function tools.parsePlan(text)
  local boss, rest = string.match(text or "", "^%s*(.-)%s*=%s*(.*)$")
  if not boss or boss == "" then return nil end
  local lines = {}
  for line in string.gmatch(rest, "[^;]+") do
    line = string.gsub(line, "^%s*(.-)%s*$", "%1")
    if line ~= "" and #lines < MAX_LINES then lines[#lines + 1] = cleanLine(line) end
  end
  if #lines == 0 then return nil end
  return boss, lines
end

function tools.savePlan(boss, lines)
  local plans = store()
  if not plans then return false end
  plans[key(boss)] = { boss = boss, lines = lines, by = ns.playerName and ns.playerName(), at = ns.util.serverTime() }
  return true
end

function tools.getPlan(boss)
  local plans = store()
  return plans and plans[key(boss)]
end

function tools.planNames()
  local names = {}
  for _, plan in pairs(store() or {}) do names[#names + 1] = plan.boss end
  table.sort(names)
  return names
end

-- ---------------------------------------------------------------------
-- The plan window every raider with Guilded sees
-- ---------------------------------------------------------------------

local planFrame
function tools.showPlan(plan, from)
  tools.shown = { plan = plan, from = from }
  if not (UIParent and CreateFrame) then return end
  if not planFrame then
    planFrame = CreateFrame("Frame", "GuildedRaidPlanFrame", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    planFrame:SetWidth(360)
    planFrame:SetHeight(200)
    planFrame:SetPoint("TOP", UIParent, "TOP", 0, -140)
    if planFrame.SetBackdrop then
      planFrame:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 14, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
      if planFrame.SetBackdropColor then planFrame:SetBackdropColor(0, 0, 0, 0.85) end
    end
    if planFrame.SetMovable then planFrame:SetMovable(true) end
    if planFrame.EnableMouse then planFrame:EnableMouse(true) end
    if planFrame.RegisterForDrag then planFrame:RegisterForDrag("LeftButton") end
    planFrame:SetScript("OnDragStart", function(self) if self.StartMoving then self:StartMoving() end end)
    planFrame:SetScript("OnDragStop", function(self) if self.StopMovingOrSizing then self:StopMovingOrSizing() end end)
    planFrame.title = planFrame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    planFrame.title:SetPoint("TOPLEFT", planFrame, "TOPLEFT", 12, -10)
    planFrame.text = planFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    planFrame.text:SetPoint("TOPLEFT", planFrame, "TOPLEFT", 12, -30)
    planFrame.text:SetWidth(336)
    if planFrame.text.SetJustifyH then planFrame.text:SetJustifyH("LEFT") end
    local close = CreateFrame("Button", nil, planFrame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", planFrame, "TOPRIGHT", 0, 0)
  end
  planFrame.title:SetText(string.format(L("Plan: %s"), plan.boss) .. (from and ("  (" .. from .. ")") or ""))
  local lines = {}
  for i, line in ipairs(plan.lines) do lines[i] = i .. ". " .. line end
  planFrame.text:SetText(table.concat(lines, "\n"))
  planFrame:SetHeight(46 + 16 * #plan.lines)
  planFrame:Show()
end

-- ---------------------------------------------------------------------
-- Sharing: PLAN|id|0|n|boss then PLAN|id|i|n|line (raid or party channel)
-- ---------------------------------------------------------------------

function tools.sharePlan(boss)
  local plan = tools.getPlan(boss)
  if not plan then ns.message(string.format(L("No plan for %s. /guilded rt plan list"), boss or "?")); return false end
  if not tools.canLead() then ns.message(L("Only the leader or an assistant can share a plan.")); return false end
  if inCombat() then ns.message(L("Share plans before the pull: messages are limited in combat.")); return false end
  local channel = ns.util.groupChannel()
  if not channel then tools.showPlan(plan); ns.message(L("You are not in a group: the plan is shown only to you.")); return false end
  local id = tostring(ns.util.serverTime() % 1000000)
  ns.comm.send(PREFIX, string.format("PLAN|%s|0|%d|%s", id, #plan.lines, cleanLine(plan.boss)), channel)
  for i, line in ipairs(plan.lines) do ns.comm.send(PREFIX, string.format("PLAN|%s|%d|%d|%s", id, i, #plan.lines, line), channel) end
  tools.showPlan(plan, L("you"))
  ns.message(string.format(L("Sent the %s plan to the group's screens."), plan.boss))
  return true
end

-- Also for players without the addon: the plan in raid (or party) chat, one message a line.
function tools.postPlan(boss)
  local plan = tools.getPlan(boss)
  if not plan then ns.message(string.format(L("No plan for %s. /guilded rt plan list"), boss or "?")); return false end
  local channel = ns.util.groupChannel()
  if not channel then ns.message(L("Join a group to post the plan in its chat.")); return false end
  local function say(text)
    pcall(function()
      if C_ChatInfo and C_ChatInfo.SendChatMessage then C_ChatInfo.SendChatMessage(text, channel)
      elseif SendChatMessage then SendChatMessage(text, channel) end
    end)
  end
  say(string.format("[Guilded] %s:", plan.boss))
  for i, line in ipairs(plan.lines) do say(i .. ". " .. line) end
  return true
end

-- Someone in the group may send a plan when they lead the group or assist.
local function senderMayLead(name)
  if ns.isOfficerName and ns.isOfficerName(name) then return true end
  for _, unit in ipairs(groupUnits()) do
    local ok, unitName = pcall(UnitName, unit)
    if ok and ns.normalizeName and ns.normalizeName(unitName) == name then
      return (UnitIsGroupLeader and UnitIsGroupLeader(unit)) or (UnitIsGroupAssistant and UnitIsGroupAssistant(unit)) or false
    end
  end
  return false
end

function tools.receive(text, sender)
  local name = ns.normalizeName and ns.normalizeName(sender)
  if not name or not senderMayLead(name) then return end
  local id, index, total, body = string.match(text, "^PLAN|(%d+)|(%d+)|(%d+)|(.*)$")
  index, total = tonumber(index), tonumber(total)
  if not id or not total or total < 1 or total > MAX_LINES or index > total then return end
  local incoming = tools.incoming
  if not incoming or incoming.id ~= id or incoming.from ~= name then
    incoming = { id = id, from = name, total = total, lines = {}, received = 0 }
    tools.incoming = incoming
  end
  if index == 0 then incoming.boss = body
  elseif not incoming.lines[index] then
    incoming.lines[index] = cleanLine(body)
    incoming.received = incoming.received + 1
  end
  if incoming.boss and incoming.received == incoming.total then
    tools.incoming = nil
    local plan = { boss = incoming.boss, lines = incoming.lines }
    -- Raiders keep the last plan they were shown, so they can open it again.
    local plans = store()
    if plans then plans[key(plan.boss)] = { boss = plan.boss, lines = plan.lines, by = name, at = ns.util.serverTime() } end
    tools.showPlan(plan, name)
    if ns.onRaidToolsChange then pcall(ns.onRaidToolsChange) end
  end
end

-- ---------------------------------------------------------------------
-- What this client allows
-- ---------------------------------------------------------------------

function tools.checkText()
  local function yes(value) return value and L("yes") or L("no") end
  local lines = {
    string.format(L("Raid target icons (SetRaidTarget): %s"), yes(SetRaidTarget ~= nil)),
    string.format(L("Group roles (tanks for Mark tanks): %s"), yes(UnitGroupRolesAssigned ~= nil or GetPartyAssignment ~= nil)),
    string.format(L("World marker buttons (Raid tools page): %s"), yes(ns.syncNow ~= nil and ns.syncNow.reloadButton ~= nil)),
    string.format(L("You can mark now (leader or assistant): %s"), yes(tools.canLead())),
    L("World markers need the leader or an assistant; in combat plans are not sent.")
  }
  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

local function mayEditPlans()
  return (ns.isOfficer and ns.isOfficer()) or tools.canLead()
end

-- args: "plan", action, then the boss (and "= lines" for save).
local function planCommand(args)
  local action = string.lower(args[2] or "list")
  local rest = table.concat(args, " ", 3)
  if action == "save" then
    if not mayEditPlans() then ns.message(L("Officers and raid leaders write plans.")); return end
    local boss, lines = tools.parsePlan(rest)
    if not boss then ns.message(L("Usage: /guilded rt plan save <boss> = first line; second line; ...")); return end
    tools.savePlan(boss, lines)
    ns.message(string.format(L("Saved the %s plan (%d lines)."), boss, #lines))
  elseif action == "show" then
    local plan = tools.getPlan(rest)
    if plan then tools.showPlan(plan) else ns.message(string.format(L("No plan for %s. /guilded rt plan list"), rest)) end
  elseif action == "share" then tools.sharePlan(rest)
  elseif action == "post" then tools.postPlan(rest)
  elseif action == "delete" then
    if not mayEditPlans() then ns.message(L("Officers and raid leaders write plans.")); return end
    local plans = store()
    if plans and plans[key(rest)] then plans[key(rest)] = nil; ns.message(string.format(L("Deleted the %s plan."), rest))
    else ns.message(string.format(L("No plan for %s. /guilded rt plan list"), rest)) end
  else
    local names = tools.planNames()
    ns.message(#names > 0 and (L("Boss plans: ") .. table.concat(names, ", ")) or L("No boss plans yet: /guilded rt plan save <boss> = line; line"))
  end
  if ns.onRaidToolsChange then pcall(ns.onRaidToolsChange) end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["rt"] = function(args)
  local action = string.lower(args[1] or "")
  if action == "mark" then
    local value = string.lower(args[2] or "")
    local index = value == "clear" and 0 or tonumber(value)
    if not index or index < 0 or index > 8 then ns.message(L("Usage: /guilded rt mark <1-8|clear> (8 = skull, 7 = cross)")); return end
    tools.mark(index)
  elseif action == "tanks" then tools.markTanks()
  elseif action == "clear" then tools.clearMarks()
  elseif action == "plan" then planCommand(args)
  elseif action == "check" then
    for line in string.gmatch(tools.checkText(), "[^\n]+") do ns.message(line) end
  else
    ns.message(L("/guilded rt mark <1-8|clear> | tanks | clear | plan save|show|share|post|delete|list | check"))
  end
end
ns.commandHandlers["raidtools"] = ns.commandHandlers["rt"]
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded rt - raid tools: target icons, mark the tanks, boss plans on everyone's screen")

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("PLAYER_LOGIN")
register("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then ns.comm.register(PREFIX); return end
    if not active() then return end
    local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
    if ns.isSecret and (ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender)) then return end
    if prefix ~= PREFIX or (channel ~= "RAID" and channel ~= "PARTY" and channel ~= "INSTANCE_CHAT") then return end
    if ns.normalizeName and ns.normalizeName(sender) == (ns.playerName and ns.playerName()) then return end
    tools.receive(text, sender)
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "raid tools: " .. tostring(err)) end
end)
