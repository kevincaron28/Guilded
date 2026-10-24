// Season helpers shared by the owner's season calendar (official-seasons.ts). The monthly,
// per-guild rotation of 7.1 is gone (7.3): the bot owner sets every season with /guilded-season.
// The guild column GuildSettings.dungeonSeasonSchedule is no longer read.

export function validTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

// Offset (ms) of a time zone at one instant: local wall time minus UTC.
function zoneOffset(at: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return Date.UTC(Number(parts["year"]), Number(parts["month"]) - 1, Number(parts["day"]), Number(parts["hour"]), Number(parts["minute"]), Number(parts["second"])) - at;
}

/** The instant a local wall time happens in a time zone (DST-aware). Month may overflow (12 = next January). */
export function zonedInstant(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const wall = Date.UTC(year, month, day, hour);
  let at = wall - zoneOffset(wall, timeZone);
  at = wall - zoneOffset(at, timeZone);
  return new Date(at);
}
