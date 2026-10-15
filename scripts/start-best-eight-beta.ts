import { parseArgs } from "node:util";
import { stat } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { startSeason } from "../src/services/dungeon-admin.js";
import { bestEightBetaRules, BEST_EIGHT_PRESET_ID, BEST_EIGHT_SEASON_NAME } from "../src/services/dungeon-beta-preset.js";

// Run with scripts/with-env.mjs. No Discord login, deployment or file deletion.
const { values } = parseArgs({ options: {
  "guild-id": { type: "string" }, "guild-name": { type: "string" },
  "expected-season": { type: "string" }, "backup": { type: "string" },
  apply: { type: "boolean", default: false }
} });
if (!values["guild-id"] || !values["guild-name"]) throw new Error("Supply --guild-id <database guild ID> --guild-name <exact guild name>. Dry-run is the default.");
const db = new PrismaClient();
try {
  const guild = await db.guild.findUniqueOrThrow({ where: { id: values["guild-id"] }, select: { id: true, name: true } });
  if (guild.name !== values["guild-name"]) throw new Error("Guild name does not match the selected database guild ID.");
  const seasons = await db.dungeonSeason.findMany({ where: { guildId: guild.id, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  const current = seasons[0];
  if ((current?.ratingRules as { presetId?: string } | null)?.presetId === BEST_EIGHT_PRESET_ID) {
    console.log(JSON.stringify({ alreadyStarted: true, guild, seasonId: current!.id, endsAt: current!.endsAt }));
  } else {
    if (seasons.length !== 1 || !current) throw new Error("Expected exactly one active season. Resolve season state before using this migration.");
    console.log(JSON.stringify({ apply: values.apply, guild, expectedSeason: current.id, previous: current.name,
      next: BEST_EIGHT_SEASON_NAME, endsAt: null, rules: bestEightBetaRules(),
      action: "Archive previous results; start a new empty season. Keep all runs and SavedVariables." }, null, 2));
    if (values.apply) {
      if (values["expected-season"] !== current.id) throw new Error("Supply the exact --expected-season ID printed by dry-run.");
      const backup = values.backup ? await stat(values.backup) : null;
      if (!backup?.isFile() || backup.size === 0) throw new Error("Supply --backup pointing to the verified non-empty pre-update database backup. This script checks the file, not its recoverability.");
      const result = await startSeason(db, guild.id, BEST_EIGHT_SEASON_NAME, current.id, undefined, bestEightBetaRules());
      console.log(JSON.stringify({ started: result.season.id, archived: result.ended, endsAt: result.season.endsAt }));
    }
  }
} finally { await db.$disconnect(); }
