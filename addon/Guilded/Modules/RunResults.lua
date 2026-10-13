local addonName, ns = ...
local results = {}
ns.runResults = results
local window

local function L(text) return ns.L and ns.L(text) or text end

local function rosterText(run)
  local names, lines = {}, {}
  for name in pairs(run.players or {}) do names[#names + 1] = name end
  table.sort(names)
  local roles = { TANK = L("Tank"), HEALER = L("Healer"), DPS = "DPS", DAMAGER = "DPS" }
  for _, name in ipairs(names) do
    local player = run.players[name]
    local info = player.class or ""
    if roles[player.role] then info = info .. (info ~= "" and " / " or "") .. roles[player.role] end
    local deaths = type(player.deaths) == "number" and string.format(L("%d deaths"), player.deaths) or L("deaths unknown")
    lines[#lines + 1] = "|cffffd36a" .. name .. "|r" .. (info ~= "" and ("  |cffb0b8c4" .. info .. "|r") or "") .. "\n  " .. deaths
  end
  return table.concat(lines, "\n\n"), #names
end

function results.syncText(run)
  return run.synced and L("Received by Discord. See Season for official points.")
    or L("Saved in game. Type /reload or log out to let your companion upload it. Discord validates the run and awards points.")
end

function results.text(run)
  local seconds = math.max(0, math.floor(run.durationSec or 0))
  local lines = { (run.name or "Dungeon") .. " - " .. (run.state or "?"),
    string.format("Time: %d:%02d", math.floor(seconds / 60), seconds % 60) }
  local kills = 0
  for _, boss in ipairs(run.encounters or {}) do if boss.success then kills = kills + 1 end end
  lines[#lines + 1] = "Bosses defeated: " .. kills .. (run.bossCount and ("/" .. run.bossCount) or "")
  local names = {}
  for name in pairs(run.players or {}) do names[#names + 1] = name end
  table.sort(names)
  lines[#lines + 1] = ""
  for _, name in ipairs(names) do
    local player = run.players[name]
    lines[#lines + 1] = name .. ": " .. (type(player.deaths) == "number" and (player.deaths .. " deaths") or "deaths unknown")
  end
  lines[#lines + 1] = ""
  lines[#lines + 1] = results.syncText(run)
  return table.concat(lines, "\n")
end

function results.show(run)
  results.last = run
  if not UIParent or not CreateFrame then return end
  if not window then
    window = CreateFrame("Frame", "GuildedRunResults", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    window:SetSize(460, 440)
    window:SetPoint("CENTER", UIParent, "CENTER", 0, 100)
    window:SetClampedToScreen(true)
    window:SetMovable(true); window:EnableMouse(true); window:RegisterForDrag("LeftButton")
    window:SetScript("OnDragStart", function(self) self:StartMoving() end)
    window:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
    if window.SetBackdrop then
      window:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12 })
      window:SetBackdropColor(0.035, 0.045, 0.065, 0.97)
      window:SetBackdropBorderColor(0.72, 0.54, 0.2, 1)
    end
    window.heading = window:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    window.heading:SetPoint("TOPLEFT", 20, -22); window.heading:SetWidth(398); window.heading:SetJustifyH("LEFT")
    window.status = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.status:SetPoint("TOPLEFT", 20, -52)
    window.metrics = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
    window.metrics:SetPoint("TOPLEFT", 20, -82); window.metrics:SetWidth(414); window.metrics:SetJustifyH("LEFT")
    window.scroll = CreateFrame("ScrollFrame", nil, window, "UIPanelScrollFrameTemplate")
    window.scroll:SetPoint("TOPLEFT", 20, -125); window.scroll:SetPoint("BOTTOMRIGHT", -36, 83)
    window.content = CreateFrame("Frame", nil, window.scroll)
    window.content:SetWidth(392)
    window.scroll:SetScrollChild(window.content)
    window.text = window.content:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    window.text:SetPoint("TOPLEFT", 0, 0); window.text:SetWidth(392); window.text:SetJustifyH("LEFT")
    window.footer = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.footer:SetPoint("BOTTOMLEFT", 20, 20); window.footer:SetWidth(414); window.footer:SetJustifyH("LEFT")
    window.footer:SetTextColor(0.65, 0.7, 0.76)
    local close = CreateFrame("Button", nil, window, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", 0, 0)
    close:SetScript("OnClick", function() window:Hide() end)
  end
  local roster, count = rosterText(run)
  local seconds = math.max(0, math.floor(run.durationSec or 0))
  local kills = 0
  for _, boss in ipairs(run.encounters or {}) do if boss.success then kills = kills + 1 end end
  window.heading:SetText(run.name or L("Dungeon"))
  window.status:SetText(run.state == "COMPLETED" and L("RUN COMPLETE") or (run.state or "?"))
  window.status:SetTextColor(0.4, 0.85, 0.6)
  window.metrics:SetText(string.format("%d:%02d   |cffb0b8c4%s %d%s|r", math.floor(seconds / 60), seconds % 60,
    L("Bosses"), kills, run.bossCount and ("/" .. run.bossCount) or ""))
  window:SetHeight(math.min(550, math.max(340, 235 + count * 42)))
  window.text:SetText(roster)
  window.content:SetHeight(math.max(1, window.text:GetStringHeight() + 12))
  window.scroll:SetVerticalScroll(0)
  window.footer:SetText(results.syncText(run))
  window:Show()
end

ns.onDungeonSummary = results.show
