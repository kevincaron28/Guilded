// Friendly raid times: officers type "friday 8pm" instead of ISO-8601.
// Everything is read in the guild's timezone (GuildSettings.timezone).
//
// Accepted (English and French):
//   8pm · 8:30pm · 20:00 · 20h · 20h30            → today, or tomorrow if already past
//   tonight 8pm · today 20:00 · ce soir 20h · aujourd'hui 20h
//   tomorrow 9pm · demain 21h
//   friday 8pm · fri 20:00 · vendredi 20h        → next Friday (today if still ahead)
//   2026-10-03 20:00 · 2026-10-03T20:00           → that date, guild timezone
//   2026-10-03T20:00:00-04:00 · ...Z              → exact (old format still works)

export const TIME_EXAMPLES = "friday 8pm, tonight 20:00, tomorrow 9:30pm, vendredi 20h, 2026-10-03 20:00";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, dimanche: 0, dim: 0,
  monday: 1, mon: 1, lundi: 1, lun: 1,
  tuesday: 2, tue: 2, tues: 2, mardi: 2, mar: 2,
  wednesday: 3, wed: 3, mercredi: 3, mer: 3,
  thursday: 4, thu: 4, thurs: 4, jeudi: 4, jeu: 4,
  friday: 5, fri: 5, vendredi: 5, ven: 5,
  saturday: 6, sat: 6, samedi: 6, sam: 6
};

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

// Wall-clock parts of `date` in `timeZone`.
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", weekday: "short"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts["weekday"] ?? "");
  return {
    year: Number(parts["year"]), month: Number(parts["month"]), day: Number(parts["day"]),
    hour: Number(parts["hour"]) % 24, minute: Number(parts["minute"]), weekday
  };
}

// The instant when the clock in `timeZone` shows this date and time.
// Two passes handle daylight-saving changes.
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const shown = localParts(new Date(guess), timeZone);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    guess += wanted - shownAsUtc;
  }
  return new Date(guess);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

// "8pm", "8:30 pm", "20:00", "20h", "20h30" → [hour, minute]
function parseClock(text: string): [number, number] | null {
  const match = text.trim().match(/^(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm|h)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3]?.toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  // A bare number with no am/pm/h ("8") is ambiguous; raids are evenings.
  if (!suffix && !match[2] && hour >= 1 && hour <= 11) hour += 12;
  if (hour > 23 || minute > 59) return null;
  return [hour, minute];
}

function addDays(parts: LocalParts, days: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function parseRaidTime(input: string, timeZone: string, now = new Date()): Date {
  // A suggestion's label ("friday 8pm → Fri, Oct 2, 20:00") comes back as typed text when the field is
  // clicked again after picking it: what was typed is before the arrow.
  const typed = input.split("→")[0]!;
  const text = typed.trim().toLowerCase().replace(/\s+/g, " ").replace(/\bat\b|\bà\b/g, " ").replace(/\s+/g, " ").trim();
  const fail = () => new Error(`I couldn't read "${input}" as a time. Try: ${TIME_EXAMPLES}.`);
  if (!text) throw fail();

  // Exact ISO with a timezone: keep the old format working.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const date = new Date(typed.trim());
    if (Number.isNaN(date.getTime())) throw fail();
    return date;
  }

  // Calendar date + time, in the guild's timezone.
  const dated = text.match(/^(\d{4})-(\d{2})-(\d{2})[ t](.+)$/);
  if (dated) {
    const clock = parseClock(dated[4] ?? "");
    if (!clock) throw fail();
    return zonedTime(Number(dated[1]), Number(dated[2]), Number(dated[3]), clock[0], clock[1], timeZone);
  }

  const today = localParts(now, timeZone);
  let dayOffset: number | null = null;
  let rest = text;
  const relative: [RegExp, number][] = [
    [/^(tonight|today|ce soir|aujourd'hui|aujourdhui|ce soir à)\s*/, 0],
    [/^(tomorrow|demain)\s*/, 1]
  ];
  for (const [pattern, offset] of relative) {
    if (pattern.test(rest)) {
      dayOffset = offset;
      rest = rest.replace(pattern, "");
    }
  }
  const weekdayWord = rest.match(/^([a-zé]+)\s+/);
  if (dayOffset === null && weekdayWord && weekdayWord[1] && WEEKDAYS[weekdayWord[1]] !== undefined) {
    dayOffset = (WEEKDAYS[weekdayWord[1]]! - today.weekday + 7) % 7;
    rest = rest.slice(weekdayWord[0].length);
  }

  const clock = parseClock(rest);
  if (!clock) throw fail();
  const [hour, minute] = clock;

  // No day given: today if still ahead, otherwise tomorrow.
  const offset = dayOffset ?? 0;
  let target = addDays(today, offset);
  let result = zonedTime(target.year, target.month, target.day, hour, minute, timeZone);
  if (result.getTime() <= now.getTime()) {
    if (dayOffset === null) {
      target = addDays(today, 1);
    } else if (weekdayWord && offset === 0) {
      // "friday 8pm" typed on Friday after 8pm means next Friday.
      target = addDays(today, 7);
    } else {
      throw new Error(`That time (${input}) has already passed.`);
    }
    result = zonedTime(target.year, target.month, target.day, hour, minute, timeZone);
  }
  return result;
}

// Short label like "Fri Oct 3, 20:00" in the guild's timezone.
export function formatRaidTime(date: Date, timeZone: string, language = "en"): string {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date);
}
