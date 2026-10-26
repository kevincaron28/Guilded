-- What counts as a flask, food, augment rune, vantus rune or raid buff, by spell id.
--
-- Spell ids do not change with the game language, so a French client is read as
-- reliably as an English one (buff names are only a fallback in Consumables.lua).
-- The lists follow the Ready Check Consumables addon (MIT, (c) 2026 Yvairel); see
-- docs/CREDITS.md. Adding a new flask or rune after a patch is one number in a table.
local addonName, ns = ...
ns = ns or {}

local data = {}
ns.consumableData = data

local function set(list)
  local out = {}
  for _, id in ipairs(list) do out[id] = true end
  return out
end

-- Flask aura ids: Midnight, then The War Within, then Dragonflight.
data.FLASK = set({
  1235057, 1235108, 1235110, 1235111,
  432021, 432473, 431971, 431972, 431974, 431973,
  371339, 374000, 371354, 371204, 370662, 373257, 371386, 370652, 371172, 371186,
})

-- Augment rune aura ids.
data.AUGMENT = set({ 1264426, 1242347, 1234969, 243191, 246492, 224572 })

-- Vantus rune aura ids (Midnight raids, then The War Within).
data.VANTUS = set({
  1276687, 1276688, 1276691, 1276698, 1276704, 1276705, 1276708, 1276709, 1276711, 1276712,
  1276714, 1276715, 1276685, 1276686, 1300174, 1300173, 1276666, 1276669, 1276682, 1276683,
  1303172, 1303180, 1303173, 1303181, 1303174, 1303182, 1303175, 1303183, 1303176, 1303184,
  1303177, 1303185, 1303178, 1303186, 1303179, 1303187, 1310439,
  1236892, 1236900, 1236893, 1236901, 1236894, 1236902, 1236895, 1236903, 1236896, 1236904,
  1236897, 1236905, 1236898, 1236906, 1236899, 1236907, 472541, 472604, 472596, 472602,
  472595, 472601, 472597, 472603, 472592, 472598, 472594, 472600, 472593, 472599, 472521,
  472591, 457610, 458701, 458702, 458703, 458704, 458705, 458706, 458707,
})

-- Every food gives the same "Well Fed" buff icon, and eating shows an eating icon,
-- so food is told apart by icon (a new food needs no update).
data.WELL_FED_ICONS = set({ 136000 })
data.EATING_ICONS = set({ 132805, 133950 })

-- Raid buffs a class brings. `class` is who provides it; a player is only blamed for
-- lacking it when someone of that class is in the group. `spells` are the aura ids
-- that count (the class spell and its look-alikes).
data.RAID_BUFFS = {
  { key = "ap", label = "Attack power", class = "WARRIOR", spells = { 6673 } },
  { key = "sta", label = "Stamina", class = "PRIEST", spells = { 21562 } },
  { key = "int", label = "Intellect", class = "MAGE", spells = { 1459 } },
  { key = "vers", label = "Versatility", class = "DRUID", spells = { 1126 } },
  { key = "mast", label = "Mastery", class = "SHAMAN", spells = { 462854 } },
  { key = "move", label = "Movement", class = "EVOKER",
    spells = { 381748, 381758, 381732, 381741, 381746, 381750, 381749, 381751, 381752, 381753, 381754, 381756, 381757 } },
}

-- spell id -> raid buff key
data.RAID_BUFF_BY_SPELL = {}
for _, buff in ipairs(data.RAID_BUFFS) do
  for _, id in ipairs(buff.spells) do data.RAID_BUFF_BY_SPELL[id] = buff.key end
end

data.RAID_BUFF_BY_KEY = {}
for _, buff in ipairs(data.RAID_BUFFS) do data.RAID_BUFF_BY_KEY[buff.key] = buff end

-- This catalog describes Retail. Classic spell ranks, party-only buffs and
-- Forever's custom rules cannot be inferred from Retail class membership.
-- nil means no verified coverage catalog, not a fully buffed group.
function data.activeRaidBuffs()
  local edition = ns.util and ns.util.gameEdition()
  local catalog = ns.raidBuffCatalogs and ns.raidBuffCatalogs[edition]
  if catalog then return catalog.buffs end
  if edition == "retail" then return data.RAID_BUFFS end
  return nil
end

local buffCache = {}
function data.raidBuffKey(id, name)
  local edition = ns.util and ns.util.gameEdition()
  local buffs = data.activeRaidBuffs()
  if not buffs then return nil end
  local clock = GetTime and GetTime() or 0
  if buffCache.edition == edition and clock - buffCache.at < 30 then return buffCache.ids[id] or buffCache.names[name] end
  buffCache = { edition = edition, at = clock, ids = {}, names = {} }
  for _, buff in ipairs(buffs) do
    for _, spell in ipairs(buff.spells) do
      buffCache.ids[spell] = buff.key
      -- A ranked TBC spell may have a new ID but the same localized base name.
      -- Only compare names actually supplied by this client, not English guesses.
      -- World-effect variants can mean "stored in Chronoboon", not active.
      -- Only the explicitly listed active aura IDs establish world-buff evidence.
      if edition ~= "retail" and buff.scope ~= "world" then
        local fn = C_Spell and C_Spell.GetSpellName or GetSpellInfo
        if type(fn) == "function" then
          local ok, known = pcall(fn, spell)
          if ok and not (ns.isSecret and ns.isSecret(known)) and type(known) == "string" then buffCache.names[known] = buff.key end
        end
      end
    end
  end
  return buffCache.ids[id] or buffCache.names[name]
end
