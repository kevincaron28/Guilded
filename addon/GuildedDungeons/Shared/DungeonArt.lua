-- Copied from addon/Guilded/Modules/DungeonArt.lua by scripts/build-dungeons-addon.mjs. Edit the original, then run npm run dungeons:sync.
local addonName, ns = ...
-- Dungeon artwork for the result card (9.2.x). Maps a dungeon's name (English or French client) to one of the painted
-- textures in Media\Dungeons\<key>.blp (256x128, made by scripts/build-dungeon-textures.mjs from the paintings the bot
-- draws on its Discord cards). The table below mirrors PAINTED in src/services/dungeon-card.ts, in the same order
-- (first match wins); tests/dungeon-art-addon.test.ts fails when the two drift or a key has no file. A dungeon with no
-- painting (Scarlet Monastery: Armory, unknown names) returns nil and the card keeps its plain background.
local art = {}
ns.dungeonArt = art

-- { key (false = deliberately no painting), pattern, pattern... }; patterns match the lower-cased, accent-folded name.
local MAP = {
  { "alcaz-prison", "alcaz" },
  { false, "scarlet.*armory", "scarlet.*armurerie", "carlate.*armurerie" },
  { "scarlet-library", "scarlet.*library", "scarlet.*biblioth", "carlate.*biblioth" },
  { "scarlet-cathedral", "scarlet.*cathedral", "carlate.*cathedral" },
  { "scarlet-graveyard", "scarlet", "carlate" },
  { "dire-maul-north", "dire ?maul.*north", "dire ?maul.*nord", "hache%-tripes.*nord" },
  { "dire-maul-west", "dire ?maul.*west", "dire ?maul.*ouest", "hache%-tripes.*ouest" },
  { "dire-maul-east", "dire ?maul", "hache%-tripes" },
  { "stratholme-service", "stratholme.*service" },
  { "stratholme-main", "stratholme" },
  { "blackrock-depths", "blackrock.*depths", "rochenoire.*profondeurs", "profondeurs de rochenoire" },
  { "upper-blackrock-spire", "upper.*blackrock", "superieur.*blackrock", "upper.*rochenoire", "superieur.*rochenoire",
    "blackrock.*upper", "blackrock.*superieur", "rochenoire.*upper", "rochenoire.*superieur" },
  { "lower-blackrock-spire", "lower.*blackrock", "inferieur.*blackrock", "lower.*rochenoire", "inferieur.*rochenoire",
    "blackrock.*lower", "blackrock.*inferieur", "rochenoire.*lower", "rochenoire.*inferieur", "blackrock.*spire", "rochenoire.*spire" },
  { "kroldok-stronghold", "krol.?dok" },
  { "razorfen-downs", "razorfen.*downs", "souilles" },
  { "razorfen-kraul", "razorfen", "kraul", "kraal" },
  { "drowned-city", "drowned", "noyee" },
  { "sunken-temple", "sunken", "engloutis", "atal.?hakkar" },
  { "shapers-terrace", "shaper", "faconneur" },
  { "uldaman", "uldaman" },
  { "wailing-caverns", "wailing", "lamentations" },
  { "ragefire-chasm", "ragefire", "ragefeu", "fournaise" },
  { "deadmines", "deadmines", "mortemine" },
  { "shadowfang-keep", "shadowfang", "ombrecroc" },
  { "stockade", "stockade", "geole", "prison" },
  { "blackfathom-deeps", "blackfathom", "brassenoire", "noirprofondeurs" },
  { "gnomeregan", "gnomeregan", "gnomeregon" },
  { "blackmaw-hold", "blackmaw" },
  { "scholomance", "scholomance" },
  { "hall-of-thanes", "thanes" },
  { "ruins-of-lordaeron", "lordaeron" },
  { "excavation-wetlands", "excavation" },
  { "city-of-dalaran", "dalaran" },
  { "zulfarrak", "zul.?farrak" },
  { "maraudon", "maraudon" },
}

-- UTF-8 accents of a French client folded to plain letters (the patterns above are ASCII).
local function fold(text)
  text = string.lower(text)
  text = text:gsub("\195[\128-\134\160-\166]", "a"):gsub("\195[\135\167]", "c"):gsub("\195[\136-\139\168-\171]", "e")
    :gsub("\195[\140-\143\172-\175]", "i"):gsub("\195[\146-\150\178-\182]", "o"):gsub("\195[\153-\156\185-\188]", "u")
  return text
end

--- The painting key for a dungeon name, or nil when it has none.
function art.keyFor(name)
  if type(name) ~= "string" or name == "" then return nil end
  local text = fold(name)
  for _, row in ipairs(MAP) do
    for i = 2, #row do
      if string.find(text, row[i]) then return row[1] or nil end
    end
  end
  return nil
end

--- Every key that has a texture (for the packaging and parity tests).
function art.keys()
  local list, seen = {}, {}
  for _, row in ipairs(MAP) do if row[1] and not seen[row[1]] then seen[row[1]] = true; list[#list + 1] = row[1] end end
  return list
end

--- The texture path (no extension: the client finds Media\Dungeons\<key>.blp) or nil.
function art.path(name)
  local key = art.keyFor(name)
  if not key then return nil end
  return "Interface\\AddOns\\" .. tostring(addonName or "Guilded") .. "\\Media\\Dungeons\\" .. key
end

-- Setting: card artwork on by default; off for low-memory players (Run tab, "Card art" button).
function art.enabled()
  local db = ns.getDb and ns.getDb()
  return not (db and db.settings and db.settings.cardArt == false)
end

function art.setEnabled(enabled)
  local db = ns.getDb and ns.getDb()
  if not db then return end
  db.settings = db.settings or {}
  db.settings.cardArt = enabled and true or false
end
