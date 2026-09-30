local addonName, ns = ...
local results = {}
ns.runResults = results
local window

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
  lines[#lines + 1] = run.synced and "Received by Discord. See Season for official points." or "Waiting to sync. Discord validates the run and awards points."
  return table.concat(lines, "\n")
end

function results.show(run)
  results.last = run
  if not UIParent or not CreateFrame then return end
  if not window then
    window = CreateFrame("Frame", "GuildedRunResults", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    window:SetSize(380, 300)
    window:SetPoint("CENTER", UIParent, "CENTER", 0, 100)
    window:SetClampedToScreen(true)
    window:SetMovable(true); window:EnableMouse(true); window:RegisterForDrag("LeftButton")
    window:SetScript("OnDragStart", function(self) self:StartMoving() end)
    window:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
    if window.SetBackdrop then
      window:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12 })
      window:SetBackdropColor(0, 0, 0, 0.9)
    end
    window.text = window:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    window.text:SetPoint("TOPLEFT", 14, -30); window.text:SetWidth(352); window.text:SetJustifyH("LEFT")
    local close = CreateFrame("Button", nil, window, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", 0, 0)
    close:SetScript("OnClick", function() window:Hide() end)
  end
  window.text:SetText(results.text(run))
  window:Show()
end

ns.onDungeonSummary = results.show
