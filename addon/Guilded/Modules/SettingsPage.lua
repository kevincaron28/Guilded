-- The settings, in one declarative list (9.3): every switch a member or officer can change, with its tab,
-- group, plain-words label, description, who it affects, and how to read and change it. The game's
-- Options > AddOns > Guilded page (Options.lua) and the Settings page in the Guilded window (Minimap.lua)
-- draw from this one list, so they can never differ.
--
-- Every switch changes the same saved value as before, through the same /guilded command or module
-- function that you could type; nothing here has its own storage. The `saved` field says where.
--
--   ns.settingsPage.entries()          the list for this player (officer entries only for officers)
--   ns.settingsPage.build(parent, o)   draws the tabs and the controls into a frame
local addonName, ns = ...
ns = ns or {}

local page = {}
ns.settingsPage = page

local function L(text) return ns.L and ns.L(text) or text end
local function settings() return ns.getSettings and ns.getSettings() end
local function db() return ns.getDb and ns.getDb() end
local function run(line) if ns.runCommand then ns.runCommand(line) end end
local function isOfficer() return ns.isOfficer and ns.isOfficer() and true or false end

-- ---------------------------------------------------------------------
-- Tabs
-- ---------------------------------------------------------------------

page.TABS = {
  { key = "general", label = "General" },
  { key = "chat", label = "Chat" },
  { key = "announce", label = "Announcements" },
  { key = "dungeons", label = "Dungeons and PvP" },
  { key = "raids", label = "Raids and loot" },
  { key = "officers", label = "Officers", officer = true },
  { key = "advanced", label = "Advanced" },
}

-- Where each optional part (ns.MODULES in Core.lua) is listed: its tab. A part that is not named here lands in
-- Advanced, so a part added later still has a switch.
local MODULE_TAB = {
  chattab = "chat", chattags = "chat", guildlog = "chat",
  milestones = "announce",
  dungeon = "dungeons", scores = "dungeons", battleground = "dungeons", duels = "dungeons", worldpvp = "dungeons", guildmap = "dungeons",
  bidding = "raids", council = "raids", reserve = "raids", imports = "raids", consumables = "raids", calendar = "raids",
  raidsignup = "raids", pugcheck = "raids", recipes = "raids", autoinvite = "raids", recruit = "raids",
}
page.MODULE_TAB = MODULE_TAB

local OPTIONAL_PARTS = "Optional parts (a part turned back on starts after /reload)"

local function moduleDescription(entry)
  return entry.desc and (entry.desc:sub(1, 1):upper() .. entry.desc:sub(2) .. ".") or ""
end

-- One word for where an optional part stands for this player (nil when it is simply on).
local function moduleState(key)
  local s = settings() or {}
  if s.guildModules and s.guildModules.off and s.guildModules.off[key] then return "off for the whole guild" end
  if s.modules and s.modules[key] == false then return "off (your choice)" end
  if ns.moduleActive and not ns.moduleActive(key) then return "on after /reload" end
  return nil
end

-- ---------------------------------------------------------------------
-- The list
-- ---------------------------------------------------------------------

local LANGUAGE_CHOICES = { { "auto", "Auto" }, { "en", "English" }, { "fr", "Fran\195\167ais" }, { "de", "Deutsch" }, { "es", "Espa\195\177ol" } }

local function languageIndex()
  local s = settings()
  local code = s and s.language or "auto"
  for i, choice in ipairs(LANGUAGE_CHOICES) do if choice[1] == code then return i end end
  return 1
end

local CHAT_EVENTS = {
  { "join", "Joins", "Shows a line in the Guilded chat tab when someone joins the guild." },
  { "leave", "Leaves", "Shows a line in the Guilded chat tab when someone leaves the guild." },
  { "kick", "Removals", "Shows a line in the Guilded chat tab when someone is removed from the guild." },
  { "promote", "Promotions", "Shows a line in the Guilded chat tab when someone is promoted." },
  { "demote", "Demotions", "Shows a line in the Guilded chat tab when someone is demoted." },
  { "online", "Coming online", "Shows a line in the Guilded chat tab when a guildmate comes online." },
  { "offline", "Going offline", "Shows a line in the Guilded chat tab when a guildmate goes offline." },
}

local MILESTONES = {
  { "level", "Levels (10, 20...)", "Announces your level milestones: 10, 20, 30 and so on." },
  { "dungeon", "First dungeon clears", "Announces the first time you clear each dungeon." },
  { "hk", "Honorable kills", "Announces your honorable kill milestones." },
  { "duel", "Duel wins", "Announces your duel win milestones." },
  { "prof", "Profession skill", "Announces when a profession skill reaches a milestone." },
  { "ach", "Achievements", "Announces the achievements you earn." },
}

local CALL_MODES = { "toast", "chat", "off" }
local CALL_MODE_WORD = { toast = "Window", chat = "Chat line", off = "Off" }

function page.allEntries()
  local list = {}
  local function add(e) list[#list + 1] = e end
  local function check(tab, group, label, desc, who, saved, get, set, extra)
    local e = { tab = tab, group = group, kind = "check", label = label, desc = desc, who = who, saved = saved, get = get, set = set }
    for k, v in pairs(extra or {}) do e[k] = v end
    add(e)
  end

  -- ----- General -----
  check("general", "Window and language", "Show the minimap button", "The round Guilded button on your minimap; it opens the Guilded window.", "me",
    "settings.minimapHidden (opposite)",
    function() local s = settings(); return not (s and s.minimapHidden) end,
    function(on) run(on and "minimap show" or "minimap hide") end)
  add({ tab = "general", group = "Window and language", kind = "cycle", label = "Language", who = "me", saved = "settings.language",
    desc = "The language of Guilded's windows and messages; Auto follows your game. Type /reload to update open windows.",
    text = function() return L(LANGUAGE_CHOICES[languageIndex()][2]) end,
    next = function() run("lang " .. LANGUAGE_CHOICES[languageIndex() % #LANGUAGE_CHOICES + 1][1]) end })
  add({ tab = "general", group = "Window and language", kind = "action", label = "Smaller window", who = "me", saved = "settings.panelScale",
    desc = "Makes the Guilded window a little smaller.", run = function() run("menu scale smaller") end })
  add({ tab = "general", group = "Window and language", kind = "action", label = "Bigger window", who = "me", saved = "settings.panelScale",
    desc = "Makes the Guilded window a little bigger.", run = function() run("menu scale bigger") end })
  add({ tab = "general", group = "Window and language", kind = "action", label = "Reset window", who = "me", saved = "settings.panelScale, settings.panelPoint",
    desc = "Puts the Guilded window back to its normal size, in the middle of the screen.", run = function() run("menu scale reset") end })

  check("general", "Companion", "Weekly reminder to get the Windows companion",
    "Reminds you at most once a week to install the Windows companion, until you have it.", "me", "settings.companionReminder",
    function() return ns.companionLink and ns.companionLink.enabled() or false end,
    function(on) run(on and "companion on" or "companion off") end, { wide = true })
  add({ tab = "general", group = "Companion", kind = "copy", label = "Get the Windows companion (select a link, Ctrl+C):", who = "me", saved = "(no saved value)",
    texts = function() return ns.companionLink and { ns.companionLink.SHORT, ns.companionLink.DIRECT } or {} end,
    desc = "Addons cannot open web pages, so the download links are here to copy into your browser." })

  check("general", "Login and tooltips", "Show what changed since my last login",
    "Shows one short summary of what changed in the guild since you last logged in.", "me", "GuildedDB.digest.enabled",
    function() local d = db(); return not (d and d.digest and d.digest.enabled == false) end,
    function(on) run(on and "digest on" or "digest off") end, { wide = true })
  add({ tab = "general", group = "Login and tooltips", kind = "cycle", label = "Item tooltips: who can craft it", who = "me", saved = "settings.tooltipCrafters",
    desc = "Adds the guildmates who can craft an item to its tooltip: off, one short line, or the full list.",
    text = function()
      local r = ns.recipes
      local mode = r and r.tooltipMode and r.tooltipMode() or "compact"
      return L(r and r.MODE_WORD and r.MODE_WORD[mode] or "Compact")
    end,
    next = function()
      local r = ns.recipes
      if not (r and r.MODES and r.tooltipMode) then return end
      local current = r.tooltipMode()
      for i, mode in ipairs(r.MODES) do if mode == current then r.setTooltipMode(r.MODES[i % #r.MODES + 1]) return end end
      r.setTooltipMode("compact")
    end })

  -- ----- Chat -----
  check("chat", "Guilded chat tab", "Guilded's messages in their own chat tab",
    "Sends Guilded's own lines to a chat window named Guilded instead of the main chat (you make that window once).", "me", "settings.chatTab",
    function() local s = settings(); return s and s.chatTab == true or false end,
    function(on) run(on and "chat tab" or "chat off") end, { wide = true })
  check("chat", "Guilded chat tab", "Main names in chat", "Shows an alt's main character name next to it in guild and officer chat.", "me", "settings.chatTags",
    function() local s = settings(); return s and s.chatTags == true or false end,
    function(on) run(on and "chattags on" or "chattags off") end, { wide = true })
  for _, event in ipairs(CHAT_EVENTS) do
    local kind = event[1]
    check("chat", "Guild events in the Guilded tab", event[2], event[3], "me", "settings.chatEvents." .. kind,
      function() return ns.chatTab and ns.chatTab.eventEnabled(kind) or false end,
      function(on) if ns.chatTab then ns.chatTab.setEventEnabled(kind, on) end end)
  end
  check("chat", "Guild events in the Guilded tab", "Online and offline lines: officers only",
    "Shows the coming-online and going-offline lines only when the guildmate is an officer, so the tab stays quiet.", "me", "settings.chatEventsOfficersOnly",
    function() return ns.chatTab and ns.chatTab.officersOnlyPresence() or false end,
    function(on) local s = settings(); if s then s.chatEventsOfficersOnly = on and true or nil end end, { wide = true })

  add({ tab = "chat", group = "Guilded chat tab", kind = "action", label = "How to set up the chat tab", who = "me", saved = "(no saved value)",
    desc = "Prints the steps for the Guilded chat tab: which boxes to tick and the font size. WoW keeps those settings and addons cannot change them, so you do it once yourself.",
    run = function() run("chattab") end })

  -- ----- Announcements -----
  check("announce", "Milestones in guild chat", "Announce my milestones in guild chat",
    "Says one line in guild chat when you reach a milestone, so guildmates can cheer; an officer can turn this off for the whole guild.", "me",
    "GuildedDB.milestones.chars[me].settings.enabled",
    function() return ns.milestones and ns.milestones.enabled() or false end,
    function(on) run(on and "milestones on" or "milestones off") end, { wide = true })
  for _, kind in ipairs(MILESTONES) do
    local key = kind[1]
    check("announce", "Which milestones", kind[2], kind[3], "me", "GuildedDB.milestones.chars[me].settings." .. key,
      function() return ns.milestones and ns.milestones.enabled(key) or false end,
      function(on) run("milestones " .. key .. " " .. (on and "on" or "off")) end)
  end

  -- ----- Dungeons and PvP: call for help -----
  add({ tab = "dungeons", group = "Call for help", kind = "cycle", label = "Call for help alerts", who = "me", saved = "settings.helpAlert",
    desc = "How a guildmate's call for help reaches you: a small window, one chat line, or nothing.",
    text = function()
      local cfh = ns.callForHelp
      return L(CALL_MODE_WORD[cfh and cfh.alertMode and cfh.alertMode() or "toast"])
    end,
    next = function()
      local cfh = ns.callForHelp
      local current = cfh and cfh.alertMode and cfh.alertMode() or "toast"
      for i, mode in ipairs(CALL_MODES) do if mode == current then run("sos alert " .. CALL_MODES[i % #CALL_MODES + 1]) return end end
      run("sos alert toast")
    end })
  check("dungeons", "Call for help", "Play a sound", "Plays a sound when a guildmate calls for help.", "me", "settings.helpSound",
    function() return ns.callForHelp and ns.callForHelp.sound and ns.callForHelp.sound() or false end,
    function(on) run("sos sound " .. (on and "on" or "off")) end)
  check("dungeons", "Call for help", "Quiet in combat", "While you fight, shows only a chat line and a small icon: no window and no sound, also just after combat.", "me", "settings.helpQuiet",
    function() return ns.callForHelp and ns.callForHelp.quiet and ns.callForHelp.quiet() or false end,
    function(on) run("sos quiet " .. (on and "on" or "off")) end)
  check("dungeons", "Call for help", "Loud alert for calls in my zone", "Gives a loud alert when a guildmate in your zone calls for help; off means only a chat line.", "me", "settings.helpDefender",
    function() local s = settings(); return not (s and s.helpDefender == false) end,
    function(on) run("sos defender " .. (on and "on" or "off")) end)
  check("dungeons", "Call for help", "Post my calls in guild chat", "When you call for help, one line also goes to guild chat; off keeps your call on Guilded only.", "guild", "settings.helpGuildChat",
    function() local s = settings(); return not (s and s.helpGuildChat == false) end,
    function(on) run("sos chat " .. (on and "on" or "off")) end)
  add({ tab = "dungeons", group = "Call for help", kind = "action", label = "Mute 10 min", who = "me", saved = "(this session only)",
    desc = "No call for help windows for 10 minutes (until you log out or reload).", run = function() run("sos mute") end })
  add({ tab = "dungeons", group = "Call for help", kind = "action", label = "Reset call window", who = "me", saved = "settings.helpPos",
    desc = "Puts the call for help window back at its default place. Drag its title to move it.", run = function() run("sos reset") end })
  check("dungeons", "Duels", "Show a card after each of my duels", "Shows a small card with the result, the record and the rank change after each of your guild duels. Type /guilded duels card test to preview it.", "me", "settings.duelCard",
    function() return not ns.duels or ns.duels.cardEnabled() end,
    function(on) if ns.duels then ns.duels.setCardEnabled(on) end end, { wide = true })

  -- ----- Officers (shown to officers only; each affects the whole guild or this officer's client) -----
  check("officers", "Whole guild", "Allow milestone announcements", "When off, nobody's milestones are announced in guild chat: this wins over every member's own choice.", "guild",
    "GuildedDB.milestones.guild.off (shared with online guildmates)",
    function() return not (ns.milestones and ns.milestones.guildOff and ns.milestones.guildOff()) end,
    function(on) run("announce guild " .. (on and "on" or "off")) end, { officer = true, wide = true })
  if ns.officerNotes and ns.officerNotes.KEYS then
    for _, key in ipairs(ns.officerNotes.KEYS) do
      check("officers", "My officer jobs", ns.officerNotes.LABELS[key], "Done by this officer's game on its own, one change at a time; it can be turned off here.", "officer",
        "GuildedDB.officerAuto.off." .. key,
        function() return ns.officerNotes.enabled(key) end,
        function(on) ns.officerNotes.set(key, on) end, { officer = true, wide = true })
    end
  end

  -- ----- One switch per optional part: yours in its tab, the guild-wide one in Officers -----
  for _, entry in ipairs(ns.MODULES or {}) do
    local key = entry.key
    local tab = MODULE_TAB[key] or "advanced"
    check(tab, OPTIONAL_PARTS, entry.name, moduleDescription(entry), "me", "settings.modules." .. key,
      function() local s = settings(); return not (s and s.modules and s.modules[key] == false) end,
      function(on) run((on and "modules on " or "modules off ") .. key) end,
      { module = key, state = function() return moduleState(key) end })
    check("officers", "Parts for the whole guild", entry.name,
      "Allows this part for everyone in the guild; when off it is off for every member (shared with online guildmates).", "guild",
      "settings.guildModules.off." .. key,
      function() local s = settings(); return not (s and s.guildModules and s.guildModules.off and s.guildModules.off[key]) end,
      function(on) run((on and "modules guild on " or "modules guild off ") .. key) end,
      { officer = true, guildModule = key })
  end

  -- ----- Advanced -----
  local tools = {
    { "Open the tools window", "Opens the Guilded window with the guild, crafting, dungeon and raid pages.", function() run("menu") end },
    { "Guilded setup", "Choose in-game only or an optional Discord connection, and (officers) set up raid teams step by step.",
      function() if ns.options and ns.options.openSetup then ns.options.openSetup() else run("setup") end end },
    { "Diagnostics", "Prints what Guilded knows about your setup in chat, to send to an officer or the developer when something is wrong.", function() run("diag") end },
    { "Raid status", "Says in chat whether a raid is active.", function() run("status") end },
    { "All commands", "Lists every /guilded command in chat.", function() run("help") end },
    { "Addon version", "Shows the Guilded version you run, and the versions of guildmates.", function() run("version") end },
  }
  for _, t in ipairs(tools) do
    add({ tab = "advanced", group = "Help and tools", kind = "action", label = t[1], desc = t[2], who = "me", saved = "(no saved value)", run = t[3] })
  end
  add({ tab = "advanced", group = "Help and tools", kind = "action", label = "Info, data and developer tools",
    desc = "Opens the Guilded window on its advanced view: guildmate data, officer tools, speed report and test raids.", who = "me", saved = "(no saved value)",
    available = function() return ns.openAdvancedSettings ~= nil end,
    run = function() if ns.openAdvancedSettings then ns.openAdvancedSettings() end end })
  return list
end

-- The entries this player can see: officer entries only for officers.
function page.entries()
  local out, officer = {}, isOfficer()
  for _, e in ipairs(page.allEntries()) do
    if officer or not e.officer then out[#out + 1] = e end
  end
  return out
end

-- The check and cycle entries a player can see (officer entries only for officers), as the old flat list.
function page.switches()
  local out = {}
  for _, e in ipairs(page.entries()) do
    if e.kind == "check" or e.kind == "cycle" then out[#out + 1] = e end
  end
  return out
end

function page.visibleTabs()
  local officer, out = isOfficer(), {}
  for _, tab in ipairs(page.TABS) do
    if officer or not tab.officer then out[#out + 1] = tab.key end
  end
  return out
end

-- ---------------------------------------------------------------------
-- Drawing
-- ---------------------------------------------------------------------

local WHO_TEXT = {
  me = "Affects only you.",
  guild = "Affects the whole guild.",
  officer = "Affects only this officer's game.",
}
local TAB_HINT = {
  officers = "These switches change things for the whole guild or for officers. Only officers see this tab.",
  dungeons = "How you hear about calls for help, and the dungeon and PvP parts you can turn off.",
  raids = "The raid and loot parts you can turn off just for you. Officers can turn them off for everyone in the Officers tab.",
  advanced = "Help, diagnostics, and the optional parts that fit nowhere else.",
}

page.WHO_TEXT, page.TAB_HINT = WHO_TEXT, TAB_HINT

local function version()
  local v = (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata("Guilded", "Version"))
    or (GetAddOnMetadata and GetAddOnMetadata("Guilded", "Version"))
  local d = db()
  return tostring(v or (d and d.addonVersion) or "")
end
page.version = version

-- Height of a wrapped text: the client measures it once the width is set; otherwise (tests) an estimate.
local function textHeight(fs, text, width)
  fs:SetWidth(width)
  local h = fs.GetStringHeight and fs:GetStringHeight()
  if type(h) == "number" and h > 0 then return h end
  local perLine = math.max(8, math.floor(width / 6))
  return math.max(1, math.ceil(#text / perLine)) * 12
end

local function showTooltip(owner, e)
  if not GameTooltip then return end
  GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
  GameTooltip:AddLine(L(e.label), 1, 0.82, 0)
  if e.desc then GameTooltip:AddLine(L(e.desc), 1, 1, 1, true) end
  if e.who then GameTooltip:AddLine(L(WHO_TEXT[e.who]), 0.6, 0.8, 1, true) end
  GameTooltip:Show()
end
local function hideTooltip() if GameTooltip then GameTooltip:Hide() end end

-- parent: the frame to draw in. opts: width, left, top (to the tab row), right, bottom (scroll area insets),
-- title (true: "Guilded - Version X" header is drawn by the caller, nothing here).
function page.build(parent, opts)
  opts = opts or {}
  local width = opts.width or 600
  local ui = { rows = {}, frames = {}, heights = {}, tabButtons = {}, built = {} }

  local bar = CreateFrame("Frame", nil, parent)
  bar:SetPoint("TOPLEFT", parent, "TOPLEFT", opts.left or 0, opts.top or 0)
  bar:SetSize(width, 24)
  ui.bar = bar

  local scroll = CreateFrame("ScrollFrame", nil, parent, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", bar, "BOTTOMLEFT", 0, -6)
  scroll:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", opts.right or -26, opts.bottom or 8)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(width - 24, 100)
  scroll:SetScrollChild(content)
  ui.scroll, ui.content = scroll, content

  local contentWidth = width - 24
  local columnWidth = math.floor((contentWidth - 16) / 2)

  local function header(tf, text, y)
    local fs = tf:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    fs:SetPoint("TOPLEFT", tf, "TOPLEFT", 0, y)
    fs:SetWidth(contentWidth)
    fs:SetJustifyH("CENTER")
    fs:SetText(L(text))
    local line = tf:CreateTexture(nil, "ARTWORK")
    line:SetTexture("Interface\\Buttons\\WHITE8X8")
    line:SetVertexColor(0.55, 0.45, 0.1, 0.7)
    line:SetPoint("TOPLEFT", tf, "TOPLEFT", 8, y - 17)
    line:SetSize(contentWidth - 16, 1)
    return 28 + textHeight(fs, L(text), contentWidth) - 12
  end

  local function note(tf, text, y)
    local fs = tf:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    fs:SetPoint("TOPLEFT", tf, "TOPLEFT", 8, y)
    fs:SetJustifyH("LEFT")
    fs:SetText(L(text))
    return textHeight(fs, L(text), contentWidth - 16) + 10
  end

  -- A check or cycle row at (x, y) inside a column of the given width. Returns its height.
  local function control(tf, e, x, y, colW)
    local textW = colW - 34
    local box
    if e.kind == "cycle" then
      box = CreateFrame("Button", nil, tf, "UIPanelButtonTemplate")
      box:SetSize(112, 22)
      box:SetPoint("TOPLEFT", tf, "TOPLEFT", x + 4, y - 2)
      textW = colW - 124
    else
      box = CreateFrame("CheckButton", nil, tf, "UICheckButtonTemplate")
      box:SetSize(24, 24)
      box:SetPoint("TOPLEFT", tf, "TOPLEFT", x, y)
      if box.SetHitRectInsets then box:SetHitRectInsets(0, -(textW + 4), 0, 0) end
    end
    local label = tf:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    label:SetPoint("TOPLEFT", box, "TOPRIGHT", e.kind == "cycle" and 8 or 2, e.kind == "cycle" and -3 or -4)
    label:SetJustifyH("LEFT")
    label:SetText(L(e.label))
    local height = textHeight(label, L(e.label), textW)
    local descText = e.desc and L(e.desc) or nil
    local desc
    if descText then
      desc = tf:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
      desc:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 0, -2)
      desc:SetJustifyH("LEFT")
      desc:SetText(descText)
      -- A part's state ("off for the whole guild") goes in front; reserve a line for it.
      height = height + 2 + textHeight(desc, descText, textW) + (e.state and 12 or 0)
    end
    local row = { e = e, box = box, label = label, desc = desc, descText = descText }
    box.entry = e
    box:SetScript("OnEnter", function(self) showTooltip(self, e) end)
    box:SetScript("OnLeave", hideTooltip)
    box:SetScript("OnClick", function(self)
      if e.kind == "cycle" then pcall(e.next) else pcall(e.set, self:GetChecked() and true or false) end
      ui.refresh()
    end)
    ui.rows[#ui.rows + 1] = row
    return math.max(28, height + 10)
  end

  local function actionButton(tf, e, x, y, w)
    local b = CreateFrame("Button", nil, tf, "UIPanelButtonTemplate")
    b:SetSize(w, 24)
    b:SetPoint("TOPLEFT", tf, "TOPLEFT", x, y)
    b:SetText(L(e.label))
    b:SetScript("OnClick", function() pcall(e.run) end)
    b:SetScript("OnEnter", function(self) showTooltip(self, e) end)
    b:SetScript("OnLeave", hideTooltip)
    ui.rows[#ui.rows + 1] = { e = e, box = b, static = true }
    return b
  end

  local function copyRow(tf, e, y)
    local fs = tf:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    fs:SetPoint("TOPLEFT", tf, "TOPLEFT", 8, y)
    fs:SetJustifyH("LEFT")
    fs:SetText(L(e.label))
    local h = textHeight(fs, L(e.label), contentWidth - 16)
    for i, text in ipairs(e.texts()) do
      local box = CreateFrame("EditBox", nil, tf, "InputBoxTemplate")
      box:SetSize(math.floor(contentWidth / 2) - 20, 22)
      box:SetPoint("TOPLEFT", tf, "TOPLEFT", 14 + (i - 1) * math.floor(contentWidth / 2), y - h - 6)
      box:SetAutoFocus(false)
      box:SetText(text)
      if box.SetCursorPosition then box:SetCursorPosition(0) end
      -- A link to copy, not to edit: any typing puts it back.
      box:SetScript("OnTextChanged", function(self, user) if user and self:GetText() ~= text then self:SetText(text) end end)
      box:SetScript("OnEditFocusGained", function(self) if self.HighlightText then self:HighlightText() end end)
    end
    return h + 34
  end

  local function buildTab(key)
    local tf = CreateFrame("Frame", nil, content)
    tf:SetPoint("TOPLEFT", content, "TOPLEFT", 0, 0)
    tf:SetSize(contentWidth, 100)
    local y = -4
    if TAB_HINT[key] then y = y - note(tf, TAB_HINT[key], y) end
    -- The entries of this tab, grouped in order of first appearance.
    local groups, order = {}, {}
    for _, e in ipairs(page.entries()) do
      if e.tab == key then
        if not groups[e.group] then groups[e.group] = {}; order[#order + 1] = e.group end
        table.insert(groups[e.group], e)
      end
    end
    for _, name in ipairs(order) do
      local entries = groups[name]
      y = y - header(tf, name, y)
      -- Two columns while every control in the group is a short check; anything else takes the whole row.
      local twoColumns = true
      for _, e in ipairs(entries) do if e.kind ~= "check" or e.wide then twoColumns = false end end
      local column, rowHeight = 0, 0
      local actions = {}
      local function flushActions()
        if #actions == 0 then return end
        -- Three buttons a row, or two or one when a translated label needs the room.
        local need = 0
        for _, e in ipairs(actions) do need = math.max(need, #L(e.label) * 6 + 20) end
        local perRow = 3
        while perRow > 1 and need > math.floor((contentWidth - 16 - (perRow - 1) * 4) / perRow) do perRow = perRow - 1 end
        local w = math.floor((contentWidth - 16 - (perRow - 1) * 4) / perRow)
        for i, e in ipairs(actions) do
          actionButton(tf, e, 8 + ((i - 1) % perRow) * (w + 4), y - math.floor((i - 1) / perRow) * 30, w)
        end
        y = y - math.ceil(#actions / perRow) * 30 - 4
        actions = {}
      end
      for _, e in ipairs(entries) do
        if e.kind == "action" then
          if column == 1 then y = y - rowHeight; column, rowHeight = 0, 0 end
          if not e.available or e.available() then actions[#actions + 1] = e end
        else
          flushActions()
          if e.kind == "copy" then
            y = y - copyRow(tf, e, y)
          elseif twoColumns then
            local h = control(tf, e, 8 + column * (columnWidth + 8), y, columnWidth)
            rowHeight = math.max(rowHeight, h)
            column = column + 1
            if column == 2 then y = y - rowHeight; column, rowHeight = 0, 0 end
          else
            y = y - control(tf, e, 8, y, contentWidth - 16)
          end
        end
      end
      if column == 1 then y = y - rowHeight end
      flushActions()
      y = y - 8
    end
    tf:SetHeight(-y + 8)
    ui.heights[key] = -y + 12
    return tf
  end

  -- Tab buttons, wrapped onto a second row when they do not fit (like the model page).
  local function layoutTabs()
    local visible = {}
    for _, key in ipairs(page.visibleTabs()) do visible[key] = true end
    local x, row = 0, 0
    for _, tab in ipairs(page.TABS) do
      local b = ui.tabButtons[tab.key]
      if not b then
        b = CreateFrame("Button", nil, bar, "UIPanelButtonTemplate")
        b:SetScript("OnClick", function() ui.select(tab.key) end)
        ui.tabButtons[tab.key] = b
        b:SetText(L(tab.label))
      end
      if visible[tab.key] then
        local w = math.max(70, #L(tab.label) * 7 + 22)
        if x + w > width and x > 0 then x = 0; row = row + 1 end
        b:SetSize(w, 22)
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", bar, "TOPLEFT", x, -row * 24)
        b:Show()
        x = x + w + 4
      else
        b:Hide()
      end
    end
    bar:SetHeight((row + 1) * 24)
    ui.tabRows = row + 1
  end
  ui.layoutTabs = layoutTabs

  function ui.select(key)
    local allowed = false
    for _, k in ipairs(page.visibleTabs()) do if k == key then allowed = true end end
    if not allowed then key = "general" end
    if not ui.frames[key] then ui.frames[key] = buildTab(key) end
    ui.current = key
    for k, tf in pairs(ui.frames) do if k == key then tf:Show() else tf:Hide() end end
    content:SetHeight(ui.heights[key])
    scroll:SetVerticalScroll(0)
    for k, b in pairs(ui.tabButtons) do
      if k == key then b:LockHighlight() else b:UnlockHighlight() end
    end
    ui.refresh()
  end

  function ui.refresh()
    for _, row in ipairs(ui.rows) do
      local e = row.e
      if not row.static then
        if e.kind == "cycle" then
          local ok, text = pcall(e.text)
          row.box:SetText(ok and text or "")
        else
          local ok, value = pcall(e.get)
          row.box:SetChecked(ok and value and true or false)
        end
        if row.desc and e.state then
          local ok, state = pcall(e.state)
          row.desc:SetText(((ok and state) and (L(state) .. ". ") or "") .. row.descText)
        end
      end
    end
  end

  -- Officer status can change after the page was built (the guild roster loads late): show or hide that tab again.
  function ui.update()
    if ui.officer ~= isOfficer() then
      -- Built for the other rank: forget the drawn tabs and draw them again.
      for _, tf in pairs(ui.frames) do tf:Hide() end
      ui.frames, ui.rows, ui.heights = {}, {}, {}
      ui.officer = isOfficer()
    end
    layoutTabs()
    local allowed = false
    for _, k in ipairs(page.visibleTabs()) do if k == ui.current then allowed = true end end
    ui.select(allowed and ui.current or "general")
  end

  ui.officer = isOfficer()
  layoutTabs()
  ui.select("general")
  return ui
end
