// Preserve the Retail/Forever prohibition while allowing the narrowly gated
// Classic completion adapter. Runtime Lua tests also exercise both client paths.
export function validateCombatLog(source, dungeonModule = false) {
  if (dungeonModule) {
    source = source.replace('if clientEdition == "classic-era" or clientEdition == "classic-tbc" or clientEdition == "classic-mists" then\n  compat.registerEvent(frame, "COMBAT_LOG_EVENT_UNFILTERED", true)\nend', "");
    source = source.replace('elseif event == "COMBAT_LOG_EVENT_UNFILTERED" then\n    -- Never register or read combat logs on Retail or Forever (restricted APIs).\n    local edition = ns.util.gameEdition()\n    if edition ~= "classic-era" and edition ~= "classic-tbc" and edition ~= "classic-mists" then return end', "");
  }
  if (/["']COMBAT_LOG_EVENT(?:_UNFILTERED)?["']/.test(source)) throw new Error("Unguarded combat-log event; Retail/Forever must never register it");
}
