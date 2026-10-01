-- Recipes and cooldowns: who in the guild can craft what, when cooldowns are ready, and
-- a shopping list of materials.
--
--   * When you open a profession window, Guilded reads every recipe you know (and what it
--     needs, and any cooldown) and remembers it. Open each of your professions once.
--   * It then tells the guild, in short low-rate messages, so every Guilded can answer
--     "who can craft this?" without asking anyone. The list reaches Discord with the
--     companion's export (/craft who, /profession cooldowns).
--   * Item tooltips say who can craft the item.
--
--   /guilded recipes who <item link or name>   who can craft it
--   /guilded recipes mine                      what your characters' professions hold
--   /guilded recipes mats <item link> [count]  shopping list for a recipe you know
--   /guilded recipes share                     send your recipes to the guild again
--   /guilded cooldowns [mine]                  profession cooldowns, ready or not
--
-- Recipes are stored by id (an item id, or minus a spell id for enchants) so they do not
-- depend on the game language. Names come from the game's item cache and fill in over time.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedRcp"
local CHUNK = 200
local MAX_KEYS = 800
local MAX_CHUNKS = 40
local MAX_COOLDOWNS = 20
-- Windows that are not a profession (a hunter's pet training uses the same window as enchanting).
local NOT_PROFESSIONS = { ["Beast Training"] = true, UNKNOWN = true }

local recipes = {}
ns.recipes = recipes

local function L(text) return ns.L and ns.L(text) or text end

-- ---------------------------------------------------------------------
-- Saved data (per guild)
-- ---------------------------------------------------------------------

local function book()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.recipeBook = db.recipeBook or {}
  local b = db.recipeBook
  b.people = b.people or {}     -- [player] = { [profession] = { v = epoch, keys = { id, ... } } }
  b.names = b.names or {}       -- [key] = "Name"
  b.mats = b.mats or {}         -- [key] = { { id = itemId, count = n, name = "..." }, ... } (your own recipes)
  b.cooldowns = b.cooldowns or {} -- [player] = { { prof = "...", name = "...", readyAt = epoch }, ... }
  b.cooldownAt = b.cooldownAt or {} -- [player] = epoch the cooldowns above were last updated
  return b
end
recipes.book = book

local function serverTime()
  if GetServerTime then return GetServerTime() end
  return time()
end

-- item:19364 -> 19364; enchant:7418 or spell:7418 -> -7418
local function keyFromLink(link)
  if type(link) ~= "string" then return nil end
  local item = string.match(link, "item:(%d+)")
  if item then return tonumber(item) end
  local spell = string.match(link, "enchant:(%d+)") or string.match(link, "spell:(%d+)")
  if spell then return -tonumber(spell) end
  return nil
end
recipes.keyFromLink = keyFromLink

local function cleanText(text)
  return (string.gsub(tostring(text or ""), "[|;,~]", ""))
end

-- A name for a recipe key: what we saw, else the game's cache, else a placeholder.
local function nameFor(key)
  local b = book()
  local known = b and b.names[key]
  if known then return known end
  local name
  pcall(function()
    if key > 0 and GetItemInfo then name = GetItemInfo(key)
    elseif key < 0 and GetSpellInfo then name = GetSpellInfo(-key) end
  end)
  if name and b then b.names[key] = name end
  return name or ((key > 0 and "item " or "enchant ") .. tostring(math.abs(key)))
end
recipes.nameFor = nameFor

-- ---------------------------------------------------------------------
-- Sending to the guild (slowly)
-- ---------------------------------------------------------------------

-- Core's paced queue (Util.lua) spaces the messages out.
local function enqueue(text)
  if not (IsInGuild and IsInGuild()) then return end
  ns.comm.send(PREFIX, text, "GUILD")
end
recipes.queueLength = function() return ns.comm.pending(PREFIX) end

-- One profession's list, cut into chunks: R|profession|version|n|N|key,key,...
local function shareProfession(profession, entry)
  local chunks, buffer = {}, ""
  for _, key in ipairs(entry.keys) do
    local piece = tostring(key)
    if buffer ~= "" and string.len(buffer) + 1 + string.len(piece) > CHUNK then
      table.insert(chunks, buffer)
      buffer = ""
    end
    buffer = buffer == "" and piece or (buffer .. "," .. piece)
  end
  if buffer ~= "" then table.insert(chunks, buffer) end
  if #chunks == 0 then chunks[1] = "" end -- empty lists remove old recipes on receivers
  for n, chunk in ipairs(chunks) do
    enqueue(string.format("R|%s|%d|%d|%d|%s", cleanText(profession), entry.v, n, #chunks, chunk))
  end
  local b, names = book(), ""
  for _, key in ipairs(entry.keys) do
    local name = b and b.names[key]
    if name then
      local part = tostring(key) .. "~" .. string.sub(cleanText(name), 1, 180)
      if #names + #part + 1 > 220 then enqueue("N|" .. names); names = "" end
      names = names == "" and part or (names .. ";" .. part)
    end
  end
  if names ~= "" then enqueue("N|" .. names) end
end

local function shareCooldowns(profession, list)
  enqueue("CDC|" .. cleanText(profession))
  for _, cooldown in ipairs(list) do
    if cooldown.prof == profession then
      enqueue(string.format("CD|%s|%d|%s", cleanText(profession), cooldown.readyAt, cleanText(cooldown.name)))
    end
  end
end

-- Tell the guild about everything you know (or one profession).
function recipes.shareMine(onlyProfession)
  local b, me = book(), ns.playerName()
  if not (b and me and b.people[me]) then return 0 end
  local count = 0
  for profession, entry in pairs(b.people[me]) do
    if not onlyProfession or onlyProfession == profession then
      shareProfession(profession, entry)
      shareCooldowns(profession, b.cooldowns[me] or {})
      count = count + 1
    end
  end
  b.sharedAt = serverTime()
  return count
end

local sharePending = false
local function scheduleShare(profession)
  if not (C_Timer and C_Timer.After) then recipes.shareMine(profession) return end
  if sharePending then return end
  sharePending = true
  C_Timer.After(5, function() sharePending = false; recipes.shareMine() end)
end

function recipes.pruneMine()
  if not ns.collectProfessions then return end
  local current, complete = ns.collectProfessions()
  if not complete then return end
  local b, me = book(), ns.playerName()
  if not (b and me) then return end
  local keep = {}
  for _, profession in ipairs(current) do keep[profession.name] = true end
  for profession, entry in pairs(b.people[me] or {}) do
    if not keep[profession] and #entry.keys > 0 then
      local empty = { v = math.max(serverTime(), entry.v + 1), keys = {} }
      b.people[me][profession] = empty
      shareProfession(profession, empty)
      shareCooldowns(profession, {})
    end
  end
  local cooldowns = {}
  for _, cooldown in ipairs(b.cooldowns[me] or {}) do if keep[cooldown.prof] then cooldowns[#cooldowns + 1] = cooldown end end
  b.cooldowns[me] = cooldowns
  b.cooldownAt[me] = serverTime()
end

-- ---------------------------------------------------------------------
-- Reading a profession window
-- ---------------------------------------------------------------------

-- The two windows have the same shape and different function names.
local function apiFor(kind)
  if kind == "trade" then
    return {
      line = function() return GetTradeSkillLine and GetTradeSkillLine() end,
      count = GetNumTradeSkills, info = GetTradeSkillInfo, link = GetTradeSkillItemLink,
      cooldown = GetTradeSkillCooldown,
      reagents = GetTradeSkillNumReagents, reagent = GetTradeSkillReagentInfo, reagentLink = GetTradeSkillReagentItemLink,
      expand = ExpandTradeSkillSubClass, collapse = CollapseTradeSkillSubClass
    }
  end
  return {
    line = function() return GetCraftDisplaySkillLine and GetCraftDisplaySkillLine() end,
    count = GetNumCrafts, info = GetCraftInfo, link = GetCraftItemLink,
    reagents = GetCraftNumReagents, reagent = GetCraftReagentInfo, reagentLink = GetCraftReagentItemLink,
    expand = ExpandCraftSkillLine, collapse = CollapseCraftSkillLine
  }
end

-- Opens every collapsed group so all recipes are listed, and closes them again afterwards.
local function expandAll(api)
  local opened = {}
  if not (api.expand and api.count and api.info) then return opened end
  local i = 1
  while i <= api.count() and i < 2000 do
    local name, kind, _, isExpanded = api.info(i)
    if kind == "header" and not isExpanded then
      api.expand(i)
      table.insert(opened, name)
    end
    i = i + 1
  end
  return opened
end

local function collapseAgain(api, opened)
  if #opened == 0 or not api.collapse then return end
  local wanted = {}
  for _, name in ipairs(opened) do wanted[name] = true end
  for i = api.count(), 1, -1 do
    local name, kind = api.info(i)
    if kind == "header" and wanted[name] then api.collapse(i) end
  end
end

-- Returns { profession, keys, names, mats, cooldowns } or nil when there is nothing to read.
-- The classic trade/craft window and functions (GetTradeSkillInfo, GetCraftInfo, ...).
local function readLegacyWindow(kind)
  local api = apiFor(kind)
  if not (api.count and api.info and api.link) then return nil end
  local profession = api.line()
  if type(profession) ~= "string" or profession == "" or NOT_PROFESSIONS[profession] then return nil end
  local total = api.count()
  if not total or total < 1 then return nil end
  local opened = expandAll(api)
  local result = { profession = profession, keys = {}, names = {}, mats = {}, cooldowns = {} }
  local seen = {}
  local now = serverTime()
  for i = 1, api.count() do
    local name, rowKind = api.info(i)
    if name and rowKind ~= "header" then
      local link = api.link(i)
      local key = keyFromLink(link)
      if key and not seen[key] then
        seen[key] = true
        table.insert(result.keys, key)
        result.names[key] = string.match(link or "", "%[(.-)%]") or name
        if api.reagents and api.reagent then
          local mats = {}
          for j = 1, (api.reagents(i) or 0) do
            local reagentName, _, count = api.reagent(i, j)
            local reagentKey = api.reagentLink and keyFromLink(api.reagentLink(i, j))
            if reagentName and reagentKey and reagentKey > 0 then
              table.insert(mats, { id = reagentKey, count = count or 1, name = reagentName })
            end
          end
          result.mats[key] = mats
        end
        local seconds = api.cooldown and api.cooldown(i)
        if type(seconds) == "number" and seconds > 0 then
          table.insert(result.cooldowns, { prof = profession, name = name, readyAt = now + math.floor(seconds) })
        end
      end
    end
  end
  collapseAgain(api, opened)
  table.sort(result.keys)
  return result
end

-- The revamped profession window (Legion and later; also the Classic clients that share that
-- code). GetTradeSkillInfo/GetCraftInfo and TRADE_SKILL_SHOW/CRAFT_SHOW do not exist here, so
-- the classic reader above finds nothing and this one runs instead. C_TradeSkillUI.GetAllRecipeIDs
-- ignores collapsed groups and filters by itself, so there is no expand/collapse to do.
local function readModernWindow()
  local ui = C_TradeSkillUI
  if not (ui and ui.GetAllRecipeIDs and ui.GetRecipeInfo) then return nil end
  local ok, recipeIDs = pcall(ui.GetAllRecipeIDs)
  if not ok or not recipeIDs or #recipeIDs == 0 then return nil end
  local profession
  if ui.GetBaseProfessionInfo then
    local infoOk, baseInfo = pcall(ui.GetBaseProfessionInfo)
    profession = infoOk and baseInfo and baseInfo.professionName or nil
  end
  if type(profession) ~= "string" or profession == "" or NOT_PROFESSIONS[profession] then return nil end
  local result = { profession = profession, keys = {}, names = {}, mats = {}, cooldowns = {} }
  local seen = {}
  for _, recipeID in ipairs(recipeIDs) do
    local infoOk, info = pcall(ui.GetRecipeInfo, recipeID)
    if infoOk and info and info.learned and info.name then
      local key
      if info.isEnchantingRecipe then
        -- The recipe id is the enchant's spell id: the same key the classic window gives
        -- ("enchant:<spell id>"), so crafters are found whichever client read the recipe.
        key = -recipeID
      elseif info.hyperlink then
        key = keyFromLink(info.hyperlink)
      end
      local schematic
      if (not key or ui.GetRecipeSchematic) and ui.GetRecipeSchematic then
        local schemaOk, s = pcall(ui.GetRecipeSchematic, recipeID, false)
        if schemaOk then schematic = s end
      end
      if not key and schematic and schematic.outputItemID then key = schematic.outputItemID end
      if key and not seen[key] then
        seen[key] = true
        table.insert(result.keys, key)
        result.names[key] = info.name
        if schematic and schematic.reagentSlotSchematics then
          local mats = {}
          for _, slot in ipairs(schematic.reagentSlotSchematics) do
            local reagent = slot.reagents and slot.reagents[1]
            local itemId = reagent and reagent.itemID
            if itemId and slot.quantityRequired then
              local reagentName = GetItemInfo and GetItemInfo(itemId)
              table.insert(mats, { id = itemId, count = slot.quantityRequired, name = reagentName or ("item " .. itemId) })
            end
          end
          result.mats[key] = mats
        end
        -- No cooldown reading here yet: unlike the classic API there is no single call for it,
        -- and a recipe missing from the cooldown list is harmless (it just shows as not on cooldown).
      end
    end
  end
  table.sort(result.keys)
  return result
end

-- Whether the open window shows someone else's recipes, and whose. A profession link from chat
-- or a guildmate's profession opened from the guild window names its owner: those recipes are
-- saved under the owner's name (never as yours), so browsing the guild fills in who can craft
-- what, even for players without Guilded. The guild-wide recipe list and NPC / crafting-order
-- views belong to nobody in particular and are not saved. Returns viewingOthers, ownerName.
local function viewingOthers()
  local function secret(value) return ns.isSecret and ns.isSecret(value) end
  local function call(fn)
    if type(fn) ~= "function" then return nil end
    local ok, first, second = pcall(fn)
    if ok and not secret(first) then return first, second end
    return nil
  end
  local ui = C_TradeSkillUI
  for _, fn in ipairs({ ui and ui.IsTradeSkillLinked or false, IsTradeSkillLinked or false }) do
    local linked, owner = call(fn)
    if linked then
      if type(owner) == "string" and owner ~= "" and not secret(owner) then
        return true, ns.normalizeName and ns.normalizeName(owner) or owner
      end
      return true, nil
    end
  end
  for _, fn in ipairs({ ui and ui.IsTradeSkillGuild or false, ui and ui.IsNPCCrafting or false,
    ui and ui.IsTradeSkillGuildMember or false, IsTradeSkillGuild or false }) do
    if call(fn) then return true, nil end
  end
  return false, nil
end
recipes.viewingOthers = viewingOthers

local function readWindow(kind)
  local others, owner = viewingOthers()
  if others and not owner then return nil end
  local read = readLegacyWindow(kind) or (kind == "trade" and readModernWindow() or nil)
  if read and owner then
    -- Someone else's list: only which recipes they know. Materials and cooldowns are yours only.
    read.owner, read.mats, read.cooldowns = owner, {}, {}
  end
  return read
end

-- Recipes that share one cooldown (all transmutes) are shown as one line.
local function mergeCooldowns(list)
  local groups, order = {}, {}
  for _, cooldown in ipairs(list) do
    local slot = math.floor(cooldown.readyAt / 120)
    local id = cooldown.prof .. ":" .. slot
    local group = groups[id]
    if not group then
      group = { prof = cooldown.prof, readyAt = cooldown.readyAt, names = {} }
      groups[id] = group
      table.insert(order, id)
    end
    table.insert(group.names, cooldown.name)
  end
  local merged = {}
  for _, id in ipairs(order) do
    local group = groups[id]
    local name = group.names[1]
    if #group.names > 1 then
      local prefix = string.match(name, "^(.-):")
      local shared = prefix ~= nil
      for _, other in ipairs(group.names) do
        if not shared or string.match(other, "^(.-):") ~= prefix then shared = false break end
      end
      name = shared and prefix or (name .. " +" .. (#group.names - 1))
    end
    table.insert(merged, { prof = group.prof, name = name, readyAt = group.readyAt })
  end
  return merged
end

local function sameKeys(a, b)
  if not a or #a ~= #b then return false end
  for i = 1, #a do
    if a[i] ~= b[i] then return false end
  end
  return true
end

-- Keeps what was read. Returns true when the recipe list changed.
function recipes.store(read)
  local b, me = book(), ns.playerName()
  if not (b and me and read) then return false end
  if read.owner and read.owner ~= me then
    -- A guildmate's profession you looked at: kept under their name, marked "viewed", and never
    -- over what their own addon reported (that is fresher and complete).
    b.people[read.owner] = b.people[read.owner] or {}
    local before = b.people[read.owner][read.profession]
    if before and not before.viewed then return false end
    local changed = not (before and sameKeys(before.keys, read.keys))
    if changed then b.people[read.owner][read.profession] = { v = serverTime(), keys = read.keys, viewed = true } end
    for key, name in pairs(read.names) do b.names[key] = name end
    return changed
  end
  b.people[me] = b.people[me] or {}
  local before = b.people[me][read.profession]
  local changed = not (before and sameKeys(before.keys, read.keys))
  if changed then b.people[me][read.profession] = { v = serverTime(), keys = read.keys } end
  for key, name in pairs(read.names) do b.names[key] = name end
  for key, mats in pairs(read.mats) do b.mats[key] = mats end
  -- Cooldowns of this profession are replaced by what the window says now.
  local kept = {}
  for _, cooldown in ipairs(b.cooldowns[me] or {}) do
    if cooldown.prof ~= read.profession then table.insert(kept, cooldown) end
  end
  for _, cooldown in ipairs(mergeCooldowns(read.cooldowns)) do table.insert(kept, cooldown) end
  local cooldownChanged = #kept ~= #(b.cooldowns[me] or {})
  b.cooldowns[me] = kept
  b.cooldownAt[me] = serverTime()
  if changed or cooldownChanged or #read.cooldowns > 0 then
    b.dirty = true
  end
  return changed
end

local function scan(kind)
  local ok, read = pcall(readWindow, kind)
  if not ok then
    if ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "recipes: " .. tostring(read)) end
    return
  end
  if not read then return end
  local changed = recipes.store(read)
  if read.owner and read.owner ~= ns.playerName() then
    if changed then
      ns.message(string.format(L("Guilded saved %s's %s recipes (%d) from the window you opened."), read.owner, read.profession, #read.keys))
    end
    if ns.onRecipesChange then pcall(ns.onRecipesChange) end
    return
  end
  local b = book()
  if b and (changed or b.dirty) then
    b.dirty = nil
    scheduleShare(read.profession)
  end
  if changed then
    ns.message(string.format(L("Guilded read your %s recipes (%d). Your guild can now see who can craft what."), read.profession, #read.keys))
  end
  if ns.onRecipesChange then pcall(ns.onRecipesChange) end
end
recipes.scan = scan

-- ---------------------------------------------------------------------
-- Receiving from other players
-- ---------------------------------------------------------------------

local pending = {}
local lastReply = 0

local function onMessage(text, sender)
  local b = book()
  local name = ns.normalizeName(sender)
  if not (b and name) then return end
  local kind = string.match(text, "^(%u+)|")
  if kind == "Q" then
    if serverTime() - lastReply >= 60 then lastReply = serverTime(); recipes.shareMine() end
  elseif kind == "R" then
    local profession, v, n, total, list = string.match(text, "^R|([^|]+)|(%d+)|(%d+)|(%d+)|(.*)$")
    n, total, v = tonumber(n), tonumber(total), tonumber(v)
    if not (profession and n and total and v) or total < 1 or total > MAX_CHUNKS or n < 1 or n > total then return end
    local id = name .. "|" .. profession
    local partial = pending[id]
    if not partial or partial.v ~= v or partial.total ~= total then
      partial = { v = v, total = total, chunks = {} }
      pending[id] = partial
    end
    partial.chunks[n] = list
    for i = 1, total do
      if not partial.chunks[i] then return end
    end
    local keys = {}
    for i = 1, total do
      for key in string.gmatch(partial.chunks[i], "-?%d+") do
        table.insert(keys, tonumber(key))
        if #keys >= MAX_KEYS then break end
      end
    end
    pending[id] = nil
    b.people[name] = b.people[name] or {}
    local current = b.people[name][profession]
    -- Their own report always beats a copy someone saved by looking at their window.
    if current and not current.viewed and current.v >= v then return end
    b.people[name][profession] = { v = v, keys = keys }
    for _, key in ipairs(keys) do nameFor(key) end
    if ns.onRecipesChange then pcall(ns.onRecipesChange) end
  elseif kind == "N" then
    for part in string.gmatch(string.sub(text, 3), "[^;]+") do
      local key, label = string.match(part, "^(%-?%d+)~(.+)$")
      key = tonumber(key)
      if key and #label <= 180 then
        for _, entry in pairs(b.people[name] or {}) do
          for _, known in ipairs(entry.keys) do
            if known == key then b.names[key] = label end
          end
        end
      end
    end
  elseif kind == "CDC" then
    local profession = string.match(text, "^CDC|(.+)$")
    if not profession then return end
    local kept = {}
    for _, cooldown in ipairs(b.cooldowns[name] or {}) do
      if cooldown.prof ~= profession then table.insert(kept, cooldown) end
    end
    b.cooldowns[name] = kept
    b.cooldownAt[name] = serverTime()
  elseif kind == "CD" then
    local profession, readyAt, cooldownName = string.match(text, "^CD|([^|]+)|(%d+)|(.*)$")
    if not profession then return end
    local list = b.cooldowns[name] or {}
    if #list < MAX_COOLDOWNS then
      table.insert(list, { prof = profession, name = cooldownName, readyAt = tonumber(readyAt) })
    end
    b.cooldowns[name] = list
    b.cooldownAt[name] = serverTime()
    if ns.onRecipesChange then pcall(ns.onRecipesChange) end
  end
end

-- ---------------------------------------------------------------------
-- Questions
-- ---------------------------------------------------------------------

-- Who can craft a recipe key: { { name = "Ann", profession = "Alchemy" }, ... }
function recipes.crafters(key)
  local b = book()
  local found = {}
  if not (b and key) then return found end
  for player, professions in pairs(b.people) do
    for profession, entry in pairs(professions) do
      for _, known in ipairs(entry.keys) do
        if known == key then table.insert(found, { name = player, profession = profession }) break end
      end
    end
  end
  table.sort(found, function(x, y) return x.name < y.name end)
  return found
end

-- Recipe keys whose name contains the text (matches only names the game has told us).
local function keysNamed(text)
  local b = book()
  local needle = string.lower(text or "")
  local keys, seen = {}, {}
  if not b or needle == "" then return keys end
  for _, professions in pairs(b.people) do
    for _, entry in pairs(professions) do
      for _, key in ipairs(entry.keys) do
        if not seen[key] then
          seen[key] = true
          local name = b.names[key] or nameFor(key)
          if string.find(string.lower(name), needle, 1, true) then table.insert(keys, key) end
        end
      end
    end
  end
  table.sort(keys)
  return keys
end

function recipes.tooltipLines(id)
  local found = recipes.crafters(id)
  if #found == 0 then return {} end
  local parts = {}
  for i = 1, math.min(4, #found) do
    table.insert(parts, string.format("%s (%s)", found[i].name, found[i].profession))
  end
  return { L("Crafted by") .. " " .. table.concat(parts, ", ") .. (#found > 4 and (" +" .. (#found - 4)) or "") }
end

local function whoText(query)
  local key = keyFromLink(query)
  local keys = key and { key } or keysNamed(query)
  if #keys == 0 then
    return string.format(L("Nobody is known to craft \"%s\" yet. Only players with Guilded who have opened their profession window show up."), query)
  end
  local lines = {}
  for i = 1, math.min(6, #keys) do
    local crafters = recipes.crafters(keys[i])
    local parts = {}
    for _, crafter in ipairs(crafters) do table.insert(parts, string.format("%s (%s)", crafter.name, crafter.profession)) end
    table.insert(lines, nameFor(keys[i]) .. ": " .. (#parts > 0 and table.concat(parts, ", ") or L("nobody known")))
  end
  if #keys > 6 then table.insert(lines, string.format(L("... and %d more matches. Be more specific."), #keys - 6)) end
  return table.concat(lines, "\n")
end

local function mineText()
  local b, me = book(), ns.playerName()
  local mine = b and me and b.people[me]
  if not mine then return L("Open your profession windows once so Guilded can read your recipes.") end
  local names = {}
  for profession in pairs(mine) do table.insert(names, profession) end
  table.sort(names)
  local lines = {}
  for _, profession in ipairs(names) do
    table.insert(lines, string.format("%s: %d %s", profession, #mine[profession].keys, L("recipes")))
  end
  local people = 0
  for _ in pairs(b.people) do people = people + 1 end
  table.insert(lines, string.format(L("%d guild members' recipes are known to you."), people))
  return table.concat(lines, "\n")
end

-- Materials for a recipe you know, times a count, as a shopping list.
local function matsText(query, count)
  local b = book()
  local key = keyFromLink(query)
  if not key then
    local keys = keysNamed(query)
    key = keys[1]
  end
  local mats = b and key and b.mats[key]
  if not mats then
    return L("Guilded only knows the materials of recipes you know yourself. Open the profession window, then try again.")
  end
  count = math.max(1, math.floor(tonumber(count) or 1))
  local lines = { string.format(L("Materials for %d x %s:"), count, nameFor(key)) }
  for _, mat in ipairs(mats) do
    local need = mat.count * count
    local have = GetItemCount and GetItemCount(mat.id, true) or nil
    table.insert(lines, string.format("%d x %s%s", need, mat.name, have and string.format(" (%s %d)", L("you have"), have) or ""))
  end
  return table.concat(lines, "\n")
end

local function duration(seconds)
  if seconds <= 0 then return L("ready") end
  local hours = math.floor(seconds / 3600)
  local minutes = math.floor((seconds % 3600) / 60)
  if hours >= 24 then return string.format("%dd %dh", math.floor(hours / 24), hours % 24) end
  if hours > 0 then return string.format("%dh %dm", hours, minutes) end
  return string.format("%dm", math.max(1, minutes))
end
recipes.duration = duration

function recipes.cooldownLines(onlyMine)
  local b, me = book(), ns.playerName()
  local rows = {}
  if not b then return rows end
  local now = serverTime()
  for player, list in pairs(b.cooldowns) do
    if not onlyMine or player == me then
      for _, cooldown in ipairs(list) do
        table.insert(rows, { player = player, name = cooldown.name, prof = cooldown.prof, left = cooldown.readyAt - now })
      end
    end
  end
  table.sort(rows, function(x, y)
    if x.left ~= y.left then return x.left < y.left end
    return x.player < y.player
  end)
  local lines = {}
  for _, row in ipairs(rows) do
    table.insert(lines, string.format("%s - %s (%s): %s", row.player, row.name, row.prof, duration(row.left)))
  end
  return lines
end

-- ---------------------------------------------------------------------
-- A reminder for professions never read
-- ---------------------------------------------------------------------

-- The game gives addons a recipe list only while its window is open, so a profession nobody
-- opened yet is unknown. Gathering skills have no recipes and are left out (by skill line id,
-- which does not depend on the game language).
local GATHERING = { [182] = true, [186] = true, [393] = true, [356] = true, [794] = true }

function recipes.unreadProfessions()
  local out = {}
  if not (GetProfessions and GetProfessionInfo) then return out end
  local b, me = book(), ns.playerName()
  local mine = (b and me and b.people[me]) or {}
  local ok, a, b2, c, d, e, f = pcall(GetProfessions)
  if not ok then return out end
  for _, index in ipairs({ a or false, b2 or false, c or false, d or false, e or false, f or false }) do
    if index then
      local infoOk, name, _, _, _, _, _, skillLine = pcall(GetProfessionInfo, index)
      if infoOk and type(name) == "string" and not (ns.isSecret and ns.isSecret(name))
        and not GATHERING[tonumber(skillLine) or 0] and not mine[name] then
        table.insert(out, name)
      end
    end
  end
  return out
end

-- Once per character and profession, a line saying which window to open once. Returns the names.
function recipes.remindUnread()
  local b, me = book(), ns.playerName()
  if not (b and me) then return {} end
  b.reminded = b.reminded or {}
  local names = {}
  for _, name in ipairs(recipes.unreadProfessions()) do
    local key = me .. ":" .. name
    if not b.reminded[key] then
      b.reminded[key] = true
      table.insert(names, name)
    end
  end
  if #names > 0 then
    ns.message(string.format(L("Open your %s window once so your guild can see what you craft (Guilded reads it by itself)."), table.concat(names, ", ")))
  end
  return names
end

-- ---------------------------------------------------------------------
-- Commands and events
-- ---------------------------------------------------------------------

recipes.whoText = whoText
recipes.mineText = mineText

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["recipes"] = function(args)
  local action = string.lower(args[1] or "")
  table.remove(args, 1)
  if action == "who" or action == "craft" then
    local query = table.concat(args, " ")
    if query == "" then ns.message("Usage: /guilded recipes who <item link or name>") return end
    ns.message(whoText(query))
  elseif action == "mine" or action == "list" then ns.message(mineText())
  elseif action == "mats" or action == "materials" then
    local count = tonumber(args[#args])
    if count and #args > 1 then table.remove(args) else count = 1 end
    local query = table.concat(args, " ")
    if query == "" then ns.message("Usage: /guilded recipes mats <item link> [count]") return end
    ns.message(matsText(query, count))
  elseif action == "share" then
    local sent = recipes.shareMine()
    ns.message(sent > 0 and L("Sending your recipes to the guild.") or L("Open your profession windows once so Guilded can read your recipes."))
  else
    ns.message("/guilded recipes who <item> | mine | mats <item> [count] | share   -   /guilded cooldowns [mine]")
  end
end

ns.commandHandlers["cooldowns"] = function(args)
  local lines = recipes.cooldownLines(string.lower(args[1] or "") == "mine")
  if #lines == 0 then ns.message(L("No profession cooldowns are known. They are read when you open a profession window.")) return end
  for i = 1, math.min(15, #lines) do ns.message(lines[i]) end
  if #lines > 15 then ns.message(string.format(L("... and %d more."), #lines - 15)) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded recipes who <item> - who in the guild can craft it; /guilded cooldowns - profession cooldowns")

local function onEvent(_, event, ...)
  if event == "PLAYER_LOGIN" then
    ns.comm.register(PREFIX)
    -- Tell the guild what you know, once in a while and not all at the same second.
    if C_Timer and C_Timer.After then
      C_Timer.After(12, function()
        recipes.pruneMine()
        if ns.isOfficer and ns.isOfficer() then
          enqueue("Q|" .. serverTime()) -- collect online guildmates' recipes for an officer relay
          if ns.send then ns.send("PROFREQ|" .. serverTime(), "GUILD") end
        end
      end)
      C_Timer.After(45 + math.random(0, 60), function()
        local b = book()
        if b then recipes.shareMine() end
        pcall(recipes.remindUnread)
      end)
    end
  elseif event == "TRADE_SKILL_SHOW" or event == "TRADE_SKILL_UPDATE" or event == "TRADE_SKILL_LIST_UPDATE" then
    recipes.later("trade")
  elseif event == "CRAFT_SHOW" or event == "CRAFT_UPDATE" then
    recipes.later("craft")
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, channel, sender = ...
    if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or prefix ~= PREFIX or channel ~= "GUILD" then return end
    if ns.normalizeName(sender) == ns.playerName() then return end
    onMessage(text, sender)
  end
end

-- The window fires many updates while it fills; read it once things settle.
local waiting = {}
function recipes.later(kind)
  if waiting[kind] then return end
  waiting[kind] = true
  if C_Timer and C_Timer.After then
    C_Timer.After(0.7, function() waiting[kind] = nil; scan(kind) end)
  else
    waiting[kind] = nil
    scan(kind)
  end
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "TRADE_SKILL_SHOW", "TRADE_SKILL_UPDATE", "TRADE_SKILL_LIST_UPDATE", "CRAFT_SHOW", "CRAFT_UPDATE", "CHAT_MSG_ADDON" }) do
  -- Crafting events vary by client; unsupported alternatives are expected.
  local optional = event ~= "PLAYER_LOGIN" and event ~= "CHAT_MSG_ADDON"
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, optional)
  else pcall(frame.RegisterEvent, frame, event) end
end
frame:SetScript("OnEvent", function(...)
  if ns.moduleActive and not ns.moduleActive("recipes") then return end -- /guilded modules
  local ok, err = pcall(onEvent, ...)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "recipes: " .. tostring(err)) end
end)
