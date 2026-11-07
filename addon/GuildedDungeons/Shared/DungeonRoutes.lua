-- Copied from addon/Guilded/DungeonRoutes.lua by scripts/build-dungeons-addon.mjs. Edit the original, then run npm run dungeons:sync.
-- Client-verified overrides and a separate source-reviewed provisional catalog.
local _, ns = ...
local routes = { verified = {} }
ns.dungeonRoutes = routes

-- Source-reviewed WoW Forever endpoints (none yet; the earlier source catalog covered other WoW
-- editions only). Rows use { edition, instanceId, participationBand, completion, requiredEncounters }.
routes.sourced = {}

-- Same endpoint shape as the frozen server routes. Only the server decides
-- eligibility, required encounters, presence and points.
function routes.matchesFinal(config, instanceId, difficultyId, encounterId, name)
  local matches = 0
  for _, route in ipairs(config or {}) do
    local proof = route.verification
    local band = route.participationBand
    if proof and type(proof.build) == "string" and proof.build ~= ""
      and type(proof.runRef) == "string" and proof.runRef ~= ""
      and route.instanceId == instanceId and band and band.difficultyId == difficultyId then
      local matched = false
      for _, id in ipairs(route.completion and route.completion.ids or {}) do
        if type(id) == "number" and id > 0 and id == encounterId then matched = true end
      end
      for _, alias in ipairs(route.completion and route.completion.names or {}) do
        if type(name) == "string" and name ~= "" and type(alias) == "string"
          and string.lower(alias) == string.lower(name) then matched = true end
      end
      if matched then matches = matches + 1 end
    end
  end
  return matches == 1
end

function routes.sourceFinal(instanceId, difficultyId, encounterId, npcId)
  local count = 0
  for _, route in ipairs(routes.sourced or {}) do
    if route.edition == ns.util.gameEdition() and route.instanceId == instanceId
      and route.participationBand.difficultyId == difficultyId then
      for _, id in ipairs(npcId and route.completion.npcIds or route.completion.ids) do
        if id == (npcId or encounterId) then count = count + 1 end
      end
    end
  end
  return count == 1
end

function routes.sameBoss(instanceId, difficultyId, a, id, kind)
  if a.id == id and a.kind == kind then return true end
  for _, route in ipairs(routes.sourced or {}) do
    if route.edition == ns.util.gameEdition() and route.instanceId == instanceId
      and route.participationBand.difficultyId == difficultyId then
      local bosses = {route.completion}
      for _, boss in ipairs(route.requiredEncounters) do bosses[#bosses+1] = boss end
      for _, boss in ipairs(bosses) do
        local first, second = false, false
        for _, value in ipairs(a.kind == "npc" and boss.npcIds or boss.ids) do if value == a.id then first = true end end
        for _, value in ipairs(kind == "npc" and boss.npcIds or boss.ids) do if value == id then second = true end end
        if first and second then return true end
      end
    end
  end
  return false
end
