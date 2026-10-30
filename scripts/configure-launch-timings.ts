import { createHash } from "node:crypto";
import { prisma } from "../src/database.js";
import { launchTimingRules, LAUNCH_TIMING_REVIEW } from "../src/services/dungeon-launch-timings.js";
import { configureNextSeasonRules } from "../src/services/official-seasons.js";
import { lockDungeonCalendar } from "../src/services/dungeon-calendar-lock.js";
import { withEdition } from "../src/services/edition-context.js";

const supported = ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"] as const;
const selection = process.argv.find(v => v.startsWith("--edition="))?.slice(10);
if (selection && !supported.some(e => e === selection)) throw new Error("Unknown --edition; omit it to apply all five");
const editions = selection ? supported.filter(e => e === selection) : supported;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const apply = process.argv.includes("--apply");
const expected = process.argv.find(v => v.startsWith("--expected="))?.slice(11);
if (apply && !expected) throw new Error("Apply requires --expected=<previewHash> from a reviewed dry run");
try {
  const result = await prisma.$transaction(async tx => {
    // Fixed lock order and one transaction: selected editions commit or none do.
    for (const edition of editions) await lockDungeonCalendar(tx, true, edition);
    const now = new Date();
    const preview = [];
    for (const edition of editions) {
      const next = await tx.officialSeason.findFirst({ where: { gameEdition: edition, startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
      if (!next || next.number !== 1) throw new Error(`Expected a scheduled, unstarted Season 1 for ${edition}`);
      const proposed = launchTimingRules(edition);
      preview.push({ edition, seasonId: next.id, number: next.number, startsAt: next.startsAt.toISOString(),
        previousSnapshotSha256: hash(next.rules), proposedRulesSha256: proposed.sha256,
        changedRoutes: proposed.changedRoutes, unverifiedRoutes: proposed.unverifiedRoutes });
    }
    const previewHash = hash(preview);
    if (apply) {
      if (expected !== previewHash) throw new Error("Preview changed; inspect a new dry run before applying");
      for (const edition of editions) await withEdition(edition, () => configureNextSeasonRules(tx, launchTimingRules(edition).rules, now));
    }
    return { applied: apply, review: LAUNCH_TIMING_REVIEW, previewHash, editions: preview };
  }, { maxWait: 30_000, timeout: 30_000 });
  console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
