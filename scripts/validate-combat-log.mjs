// WoW Forever restricts the combat log: no addon file may name the combat-log events, because even a
// guarded RegisterEvent can raise Blizzard's blocked-action popup.
export function validateCombatLog(source) {
  if (/["']COMBAT_LOG_EVENT(?:_UNFILTERED)?["']/.test(source)) throw new Error("Combat-log event found; WoW Forever must never register it");
}
