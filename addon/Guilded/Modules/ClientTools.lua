-- Small, user-clicked bridges into existing client windows. Never queue, invite,
-- craft, load protected UI in combat, or replace Blizzard's handlers.
local addonName, ns = ...
ns = ns or {}
local tools = { buttons = {} }
ns.clientTools = tools
local function L(text) return ns.L and ns.L(text) or text end
local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, ...)
  if ok and not (ns.isSecret and ns.isSecret(value)) then return value end
end
local function blocked()
  -- Legacy clients may return nil outside combat. An absent/throwing API or a
  -- hidden result is different and must not permit client-window manipulation.
  if type(InCombatLockdown) ~= "function" then return true end
  local ok, value = pcall(InCombatLockdown)
  if not ok or (ns.isSecret and ns.isSecret(value)) then return true end
  return value ~= false and value ~= nil
end
local function notice(text) if ns.message then ns.message(L(text)) end; return false end
function tools.openFinder()
  if blocked() then return notice("Open this tool after combat.") end
  local edition = ns.util and ns.util.gameEdition()
  if edition == "forever" or edition == "unknown" or type(ToggleLFDParentFrame) ~= "function" then
    return notice("Blizzard's group finder is unavailable on this client. Use guild group posts.")
  end
  if C_LFGInfo and C_LFGInfo.CanPlayerUseGroupFinder and call(C_LFGInfo.CanPlayerUseGroupFinder) ~= true then
    return notice("Blizzard's group finder is unavailable for this character.")
  end
  local ok = pcall(ToggleLFDParentFrame)
  if not ok then return notice("Blizzard's group finder could not be opened.") end
  return true
end
function tools.selectedRecipe(kind)
  if blocked() then return nil end
  if kind == "modern" then
    local page = ProfessionsFrame and ProfessionsFrame.CraftingPage
    local form = page and page.SchematicForm
    local info = form and call(form.GetRecipeInfo, form)
    if type(info) ~= "table" then return nil end
    local id = info.recipeID
    if ns.isSecret and ns.isSecret(id) then return nil end
    if type(id) ~= "number" or id < 1 or id > 10000000 or id ~= math.floor(id) then return nil end
    if ns.isSecret and ns.isSecret(info.isEnchantingRecipe) then return nil end
    if info.isEnchantingRecipe == true then return "enchant:" .. id end
    local schema = C_TradeSkillUI and call(C_TradeSkillUI.GetRecipeSchematic, id, false)
    local item = type(schema) == "table" and schema.outputItemID
    if ns.isSecret and ns.isSecret(item) then return nil end
    if type(item) == "number" and item > 0 then return "item:" .. item end
    return nil
  end
  local selectFn, linkFn = GetTradeSkillSelectionIndex, GetTradeSkillItemLink
  if kind == "craft" then selectFn, linkFn = GetCraftSelectionIndex, GetCraftItemLink end
  local index = call(selectFn)
  if type(index) ~= "number" or index < 1 then return nil end
  local link = call(linkFn, index)
  return type(link) == "string" and link or nil
end
function tools.findCrafter(kind)
  if ns.moduleActive and not ns.moduleActive("recipes") then return false end
  if blocked() then return notice("Open this tool after combat.") end
  local query = tools.selectedRecipe(kind)
  if query and ns.recipes and ns.recipes.whoText and ns.showCopyText then
    ns.showCopyText(ns.recipes.whoText(query), L("Guilded crafters")); return true
  end
  if ns.openGuildPanel then ns.openGuildPanel(nil, "guild", "Crafting") end
  return notice("Select a recipe, or search by name in Guilded crafting.")
end
function tools.attach()
  if blocked() then return end
  for _, entry in ipairs({ { "ProfessionsFrame", "modern" }, { "TradeSkillFrame", "trade" }, { "CraftFrame", "craft" } }) do
    local parent, kind = _G[entry[1]], entry[2]
    if parent and not tools.buttons[entry[1]] then
      local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
      button:SetSize(220, 24); button:SetPoint("TOPRIGHT", parent, "BOTTOMRIGHT", -4, -4)
      button:SetText(L("Guilded crafters"))
      button:SetScript("OnClick", function() tools.findCrafter(kind) end)
      tools.buttons[entry[1]] = button
    end
    local button = tools.buttons[entry[1]]
    if button then
      if not ns.moduleActive or ns.moduleActive("recipes") then button:Show() else button:Hide() end
    end
  end
end
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers.finder = tools.openFinder
local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "ADDON_LOADED", "PLAYER_REGEN_ENABLED", "TRADE_SKILL_SHOW", "CRAFT_SHOW" }) do
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, true) else pcall(frame.RegisterEvent, frame, event) end
end
frame:SetScript("OnEvent", function() tools.attach() end)
