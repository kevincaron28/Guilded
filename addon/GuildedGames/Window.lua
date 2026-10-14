local _, ns = ...
local L = ns.L
local window, body, showingHistory, confirmCancel
function ns.refresh()
  if body then body:SetText(showingHistory and ns.history() or ns.status()) end
end
function ns.open()
  if InCombatLockdown and InCombatLockdown() then ns.tell(L("Open the host window after combat.")); return end
  if not window then
    window = CreateFrame("Frame", "GuildedGamesWindow", UIParent, "BasicFrameTemplateWithInset")
    window:SetSize(620, 600); window:SetPoint("CENTER"); window:SetMovable(true); window:EnableMouse(true)
    window:RegisterForDrag("LeftButton")
    window:SetScript("OnDragStart", function(self) self:StartMoving() end)
    window:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
    local logo = window:CreateTexture(nil, "ARTWORK")
    logo:SetSize(22, 22); logo:SetPoint("TOPLEFT", 8, -2)
    logo:SetTexture("Interface\\AddOns\\GuildedGames\\Media\\Logo")
    local title = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOP", 0, -6); title:SetText("Guilded Games")
    local function label(text, x, y)
      local f = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
      f:SetPoint("TOPLEFT", x, y); f:SetText(L(text)); return f
    end
    local function button(text, x, y, callback)
      local b = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
      b:SetSize(140, 26); b:SetPoint("TOPLEFT", x, y); b:SetText(L(text)); b:SetScript("OnClick", callback); return b
    end
    label("Player / duel opponent (name-realm)", 18, -38)
    local player = CreateFrame("EditBox", nil, window, "InputBoxTemplate")
    player:SetSize(290, 24); player:SetPoint("TOPLEFT", 300, -33); player:SetAutoFocus(false); player:SetMaxLetters(80)
    player:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
    local choices = { { "High roll", "high" }, { "Deathroll", "death" }, { "Duel", "duel" },
      { "Closest target", "target" }, { "Trivia", "trivia" }, { "Team trivia", "trivia", true } }
    for i, choice in ipairs(choices) do
      local game, team = choice[2], choice[3]
      button(choice[1], 18 + ((i - 1) % 3) * 198, -72 - math.floor((i - 1) / 3) * 32, function()
        showingHistory = false; ns.start(game, team, 5, player:GetText()); ns.refresh()
      end)
    end
    label("Five rounds for Target and Trivia. Teams alternate A/B on joining.", 18, -140)
    button("Join myself", 18, -164, function() SlashCmdList.GUILDEDGAMES("join") end)
    button("Next round", 216, -164, function() ns.nextRound() end)
    button("Skip question", 414, -164, function() ns.skip() end)
    button("Remove player", 18, -198, function() ns.remove(player:GetText()) end)
    button("Rematch", 216, -198, function() showingHistory = false; ns.rematch() end)
    local cancel
    cancel = button("Cancel", 414, -198, function()
      local now = GetTime()
      if confirmCancel and now - confirmCancel < 5 then ns.cancel(); confirmCancel = nil; cancel:SetText(L("Cancel"))
      else confirmCancel = now; cancel:SetText(L("Confirm cancel")) end
    end)
    button("History", 18, -552, function() showingHistory = true; ns.refresh() end)
    button("Back", 216, -552, function() showingHistory = false; ns.refresh() end)
    local scroll = CreateFrame("ScrollFrame", nil, window, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 18, -240); scroll:SetPoint("BOTTOMRIGHT", -36, 64)
    local content = CreateFrame("Frame", nil, scroll); content:SetSize(554, 1200); scroll:SetScrollChild(content)
    body = content:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    body:SetPoint("TOPLEFT"); body:SetWidth(550); body:SetJustifyH("LEFT"); body:SetJustifyV("TOP")
    if UISpecialFrames then table.insert(UISpecialFrames, "GuildedGamesWindow") end
  end
  window:Show(); ns.refresh()
end
