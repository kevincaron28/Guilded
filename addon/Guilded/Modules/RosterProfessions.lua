-- 8.5 track C4 (addon half): guildmates' professions on Blizzard's guild roster, and an opt-in officer
-- tool that writes them into PUBLIC guild notes. Skills come from the readiness digests guildmates
-- already share (db.peerRoster) and from your own character. The note tool only builds a preview and
-- hands it to the reviewed RosterTools engine: one click per note, verified, audited, never officer
-- notes, and only for notes that are empty or already a profession tag. Nothing runs on login.
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
    if #skills < 10 and #name <= 40 and #skill <= 4 then skills[#skills + 1] = { name = trim(name), skill = tonumber(skill) } end
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
function module.tag(skills)
  local parts = {}
  for _, s in ipairs(sorted(skills)) do
    local key = s.name:lower()
    local short = ABBREVIATIONS[key] or s.name:gsub("[^A-Za-z]", ""):sub(1, 4)
    local item = short .. math.min(999, s.skill)
    if #table.concat(parts, " ") + (#parts > 0 and 1 or 0) + #item > module.NOTE_MAX then break end
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
    for _, p in ipairs(mine) do out[#out + 1] = { name = p.name, skill = p.skillLevel } end
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
  for _, s in ipairs(sorted(module.skillsFor(name))) do out[#out + 1] = module.icon(s.name) .. s.name .. " " .. s.skill end
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
function module.decorate(button)
  if not GameTooltip then return end
  local ok = pcall(function()
    local name = memberName(button)
    if not name then return end
    local lines = module.lines(name)
    if #lines == 0 then return end
    GameTooltip:AddLine(" ")
    GameTooltip:AddLine(L("Professions"), 1, 0.82, 0)
    for _, line in ipairs(lines) do GameTooltip:AddLine(line, 1, 1, 1) end
    GameTooltip:Show()
  end)
  return ok
end
local hooked = {}
function module.install()
  if type(hooksecurefunc) ~= "function" then return end
  local function hook(target, key)
    local fn = type(target) == "table" and target[key] or (type(target) == "string" and _G[target])
    if hooked[key] or type(fn) ~= "function" then return end
    local ok = pcall(hooksecurefunc, target, key, function(self) module.decorate(self) end)
    if ok then hooked[key] = true end
  end
  hook(_G, "GuildRosterButton_OnEnter")
  hook(_G, "GuildFrameButton_OnEnter")
  if CommunitiesMemberListEntryMixin then hook(CommunitiesMemberListEntryMixin, "OnEnter") end
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

-- The opt-in note tool. Rows only for characters whose PUBLIC note is empty or already a tag, whose
-- rank is below yours, and whose tag differs from what is there. Never officer notes, never yourself.
function module.plan()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return nil, L("Current officer access is required.") end
  local snapshot, err = tools.snapshot()
  if not snapshot then return nil, L(err or "Refresh the full guild roster first.") end
  local rows, skipped, lines = {}, { notWritable = 0, noSkills = 0, same = 0 }, { "character\taction\tvalue" }
  local keys = {}
  for key in pairs(snapshot.rows) do keys[#keys + 1] = key end
  table.sort(keys)
  for _, key in ipairs(keys) do
    local row = snapshot.rows[key]
    if row.key ~= snapshot.actor.key and row.rank > snapshot.actor.rank and row.public ~= nil then
      local tag = module.tag(module.skillsFor(row.name))
      if tag == "" then skipped.noSkills = skipped.noSkills + 1
      elseif not module.noteIsWritable(row.public) then skipped.notWritable = skipped.notWritable + 1
      elseif row.public == tag then skipped.same = skipped.same + 1
      elseif #rows < 50 then rows[#rows + 1] = row.name; lines[#lines + 1] = row.name .. "\tpublic\t" .. tag end
    end
  end
  if #rows == 0 then return nil, L("No public notes to update."), skipped end
  return table.concat(lines, "\n"), #rows, skipped
end

function module.preview()
  local tsv, count, skipped = module.plan()
  if not tsv then return nil, count end
  local plan, err = ns.rosterTools.preview(tsv)
  if not plan then return nil, err end
  return plan, count, skipped
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
