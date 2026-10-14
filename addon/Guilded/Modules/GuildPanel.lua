-- A non-secure side tab. Never add a display mode to Blizzard's own registry.
local addonName, ns = ...
local view = {}
ns.guildPanel = view

function view.attach()
  if view.tab or (InCombatLockdown and InCombatLockdown()) then return end
  local host = CommunitiesFrame or GuildFrame
  if not host then return end
  local tab = CreateFrame("CheckButton", nil, host)
  view.tab = tab
  tab:SetSize(38, 38)
  if host.GuildInfoTab then
    tab:SetPoint("TOPLEFT", host.GuildInfoTab, "BOTTOMLEFT", 0, -20)
  else tab:SetPoint("TOPLEFT", host, "TOPRIGHT", 0, -36) end
  tab:SetNormalTexture("Interface\\AddOns\\Guilded\\Media\\GuildedLogo")
  tab:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
  tab:SetCheckedTexture("Interface\\Buttons\\CheckButtonHilight", "ADD")
  tab:SetScript("OnClick", function(self)
    if InCombatLockdown and InCombatLockdown() then self:SetChecked(false); return end
    if ns.windowState and ns.windowState().guildHost then
      ns.closeGuildPanel()
    else
      ns.openGuildPanel(host)
      self:SetChecked(true)
    end
  end)
  tab:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine("Guilded")
    GameTooltip:AddLine(ns.L("Standings") .. " / " .. ns.L("Crafting") .. " / " .. ns.L("Season"))
    GameTooltip:Show()
  end)
  tab:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  host:HookScript("OnHide", function() ns.closeGuildPanel() end)
  if hooksecurefunc and host.SetDisplayMode then
    hooksecurefunc(host, "SetDisplayMode", function() ns.closeGuildPanel() end)
  end
  for _, key in ipairs({ "ChatTab", "RosterTab", "GuildBenefitsTab", "GuildInfoTab" }) do
    if host[key] then host[key]:HookScript("OnClick", function() ns.closeGuildPanel() end) end
  end
end

local events = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "ADDON_LOADED", "PLAYER_REGEN_ENABLED" }) do events:RegisterEvent(event) end
events:SetScript("OnEvent", function()
  local ok, err = pcall(view.attach)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild panel: " .. tostring(err)) end
end)
