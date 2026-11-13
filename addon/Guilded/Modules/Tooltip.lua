-- Item tooltips: who wishlisted an item, what it usually costs in GP, and your priority.
--
-- The data comes from the Discord bot (wishlists and past awards), written next to the
-- standings by the companion and shared with the guild by Sync.lua. An item nobody wants
-- and nobody has been awarded shows nothing. Turn it off with /guilded modules off tooltip.
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.tooltip = module

local PRIORITY_WORD = { [1] = "high", [2] = "medium", [3] = "low" }

-- Text in the player's language (Locale.lua), English when there is no translation.
local function L(text) return ns.L and ns.L(text) or text end
local GOLD_R, GOLD_G, GOLD_B = 0.83, 0.69, 0.22

-- Same rule as the bot's item keys (Util.lua).
function module.itemKey(name) return ns.util.itemKey(name) end

-- Position among the players with standings, by PR (1 = highest).
local function rankOf(mine)
  local d = ns.getDb and ns.getDb()
  local players = d and d.standings and d.standings.players
  if not players then return nil end
  local better, count = 0, 0
  for _, row in pairs(players) do
    count = count + 1
    if (row.pr or 0) > (mine.pr or 0) then better = better + 1 end
  end
  return better + 1, count
end

-- The extra tooltip lines for an item name (an empty list when there is nothing to say).
function module.lines(itemName, link)
  module.crafterExpandable = false
  local key = module.itemKey(itemName)
  local info = key and ns.getItemInsight and ns.getItemInsight(key)
  local lines = {}
  -- Soft reserves (Modules/Reserve.lua) come first; they need the item id from the link.
  local id = ns.reserve and ns.reserve.itemId and ns.reserve.itemId(link)
  if id and (not ns.moduleActive or ns.moduleActive("reserve")) then
    for _, line in ipairs(ns.reserve.tooltipLines(id)) do table.insert(lines, line) end
  end
  -- That's My BiS priorities an officer imported (Modules/LootImports.lua).
  if id and ns.lootImports then
    for _, line in ipairs(ns.lootImports.tooltipLines(id)) do table.insert(lines, line) end
  end
  -- Who in the guild can craft it (Modules/Recipes.lua).
  local craftId = ns.recipes and ns.recipes.keyFromLink and ns.recipes.keyFromLink(link)
  if craftId and craftId > 0 and (not ns.moduleActive or ns.moduleActive("recipes")) then
    local craftLines, expandable = ns.recipes.tooltipLines(craftId)
    for _, line in ipairs(craftLines) do table.insert(lines, line) end
    module.crafterExpandable = expandable and true or false
  end
  if not info then return lines end
  local wish = info.wish or {}
  if #wish > 0 then
    local parts = {}
    for _, entry in ipairs(wish) do
      table.insert(parts, string.format("%s (%s)", tostring(entry[1]), L(PRIORITY_WORD[entry[2]] or "?")))
    end
    local more = (info.wn or #wish) - #wish
    table.insert(lines, L("Wanted by") .. " " .. table.concat(parts, ", ") .. (more > 0 and (" +" .. more .. " " .. L("more")) or ""))
  end
  if info.gp then
    local awards = info.n or 1
    table.insert(lines, string.format(awards == 1 and L("Usually costs about %d GP (%d award)") or L("Usually costs about %d GP (%d awards)"), info.gp, awards))
  end
  local me = ns.playerName and ns.playerName()
  local mine = me and ns.getStanding and ns.getStanding(me)
  if mine and #lines > 0 then
    local rank, count = rankOf(mine)
    table.insert(lines, string.format(L("Your PR is %.2f"), mine.pr or 0) .. (rank and string.format(L(" (#%d of %d)"), rank, count) or ""))
  end
  return lines
end

-- `fresh` = called by the tooltip data processor, which runs once per newly filled tooltip on
-- every tooltip (comparison tooltips included), so no "already done" flag is needed; the flag
-- is only for the old script hook, which can fire more than once for one item. It is kept in a
-- Guilded-side weak table: nothing is written onto the game's tooltip object (9.3.0, taint).
local done = setmetatable({}, { __mode = "k" })
local function decorate(tooltip, fresh)
  if not tooltip or (not fresh and done[tooltip]) then return end
  if ns.moduleActive and not ns.moduleActive("tooltip") then return end
  if not tooltip.GetItem then return end
  -- (9.2.1) The data processor runs this inside the game's own tooltip code, so whatever runs here taints the
  -- rest of that code (a later protected call is then refused: "Guilded tried to call UNKNOWN()" after a gear
  -- change, 13 Nov 2026). Keep the footprint small: never in combat, and only the main item tooltips
  -- (not the comparison tooltips the equipment code fills while gear is being swapped).
  if ns.util and ns.util.inCombat and ns.util.inCombat() then return end
  if GameTooltip and tooltip ~= GameTooltip and tooltip ~= ItemRefTooltip then return end
  local ok, name, link = pcall(tooltip.GetItem, tooltip)
  if not ok or type(name) ~= "string" then return end
  if ns.isSecret and ns.isSecret(name) then return end
  if type(link) ~= "string" or (ns.isSecret and ns.isSecret(link)) then link = nil end
  local lines = module.lines(name, link)
  if #lines == 0 then return end
  if not fresh then done[tooltip] = true end
  for _, line in ipairs(lines) do
    if type(line) == "table" then
      -- Already formatted (the crafter lines): no prefix, wrapped when long.
      tooltip:AddLine(line.raw, GOLD_R, GOLD_G, GOLD_B, line.wrap and true or nil)
    else
      tooltip:AddLine("Guilded: " .. line, GOLD_R, GOLD_G, GOLD_B)
    end
  end
  -- Stamped only after a line was really added: a blocked-action record just after it says so (Core.lua).
  ns.lastTooltipAt = GetTime and GetTime() or nil
  -- No Show() and no refresh from here: the data processor shows the tooltip itself, and calling the game's
  -- tooltip functions from addon code runs its code under Guilded's taint.
end
module.decorate = decorate

-- Cleared with the tooltip (old script hook only).
local function clear(tooltip) done[tooltip] = nil end

local function hookTooltips()
  if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType then
    TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip)
      pcall(decorate, tooltip, true)
    end)
  end
  -- Older tooltip system (and the shift-click link tooltip): the script hook.
  for _, tooltip in ipairs({ GameTooltip, ItemRefTooltip }) do
    if tooltip and tooltip.HookScript then
      pcall(tooltip.HookScript, tooltip, "OnTooltipCleared", clear)
      if not (TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall) then
        pcall(tooltip.HookScript, tooltip, "OnTooltipSetItem", decorate)
      end
    end
  end
end

-- (9.3.0) There is no Shift refresh any more: pressing Shift used to make Guilded call RefreshData/SetHyperlink on
-- GameTooltip, running the game's tooltip code under Guilded's taint exactly while a player compared gear. The
-- full crafter list is shown when the game itself fills the tooltip with Shift already held.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
  local ok, err = pcall(hookTooltips)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "tooltip: " .. tostring(err)) end
end)
