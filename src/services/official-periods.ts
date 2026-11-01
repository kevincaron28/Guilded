import { z } from "zod";
import { localParts, zonedTime } from "./raid-time.js";
import type { GameEdition } from "./game-edition.js";

export const PERIOD_REVIEW = "official-pve-na-2026-10-30-v1";
export const periodMetadataSchema = z.object({
  revision: z.literal(PERIOD_REVIEW), region: z.literal("NA"), timeZone: z.literal("America/Toronto"),
  kind: z.enum(["guilded-quarterly", "mythic-plus", "content-phase"]),
  title: z.string().min(1).max(120), officialStart: z.string().nullable(),
  precision: z.enum(["guilded", "regional-week", "regional-maintenance-date", "instant"]),
  sources: z.array(z.string().url()).min(1).max(4), checkedAt: z.literal("2026-10-30"),
  guildedActivation: z.string().datetime(), partial: z.boolean(),
  calibrationScope: z.string().min(1).max(120), months: z.literal(3).optional()
});
export type OfficialPeriodMetadata = z.infer<typeof periodMetadataSchema>;
export function readPeriodMetadata(value: unknown): OfficialPeriodMetadata | null {
  const result = periodMetadataSchema.safeParse(value);
  return result.success ? result.data : null;
}
/** Calendar months in the owner's zone, retaining seconds and clamping month-end. */
export function addCalendarMonths(at: Date, months = 3): Date {
  const p = localParts(at, "America/Toronto");
  const target = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
  const day = Math.min(p.day, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate());
  const result = zonedTime(target.getUTCFullYear(), target.getUTCMonth() + 1, day, p.hour, p.minute, "America/Toronto");
  return new Date(result.getTime() + at.getUTCSeconds() * 1000 + at.getUTCMilliseconds());
}
export function initialOfficialPeriod(edition: Exclude<GameEdition, "forever">, activation: Date): OfficialPeriodMetadata {
  const shared = { revision: PERIOD_REVIEW, region: "NA", timeZone: "America/Toronto", checkedAt: "2026-10-30", guildedActivation: activation.toISOString(), partial: true } as const;
  const values = {
    "classic-era": { kind: "guilded-quarterly", title: "Guilded Era / Hardcore season", officialStart: null, precision: "guilded", partial: false, months: 3,
      calibrationScope: "era-evergreen", sources: ["https://worldofwarcraft.blizzard.com/en-us/news/23625676"] },
    "classic-tbc": { kind: "content-phase", title: "Gods of Zul'Aman", officialStart: "2026-10-22T22:00:00Z", precision: "instant",
      calibrationScope: "tbc-zulaman-final-reduced-heroics", sources: ["https://worldofwarcraft.blizzard.com/en-us/news/24310652/bcca-the-gods-of-zulaman-now-live"] },
    "classic-mists": { kind: "content-phase", title: "Siege of Orgrimmar - Season 3", officialStart: "2026-06-02", precision: "regional-maintenance-date",
      calibrationScope: "mists-siege-normal-heroic", sources: ["https://news.blizzard.com/en-us/article/24264421/mists-of-pandaria-classic-the-siege-of-orgrimmar-now-live"] },
    retail: { kind: "mythic-plus", title: "Midnight Mythic+ Season 2", officialStart: "2026-08-18", precision: "regional-week",
      calibrationScope: "retail-midnight-mplus-season-2", sources: ["https://news.blizzard.com/en-us/article/24294369/midnight-season-2-is-now-live"] }
  } as const;
  return periodMetadataSchema.parse({ ...shared, ...values[edition] });
}
