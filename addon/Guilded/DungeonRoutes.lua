-- November endpoint preparation. Intentionally empty until real-client evidence
-- is reviewed. Never populate from guessed Classic IDs or mutable SavedVariables.
local _, ns = ...
local routes = { verified = {} }
ns.dungeonRoutes = routes

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
