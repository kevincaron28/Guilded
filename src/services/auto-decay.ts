import { pilotGuildScope } from "../hosted-pilot.js";
import type { PrismaClient } from "@prisma/client";
import { createEpgpService } from "./epgp.js";
import { effectiveRules } from "./core-rules.js";
import { weekStart } from "./dungeon-rules.js";

// Automatic EPGP decay (/epgp decay weekly:true): once after every weekly reset (Tuesday 15:00
// UTC), the guild pool decays by the guild's percent and every core with its own pool by its
// own. Called hourly from main.ts. Each pool decays in one transaction under a reference for
// that week, so a failed run is simply tried again next hour and can never decay twice.
export async function runAutoDecay(database: PrismaClient, now = new Date()): Promise<number> {
  const reset = weekStart(now);
  const due = await database.guildSettings.findMany({ where: { ...pilotGuildScope, autoDecay: true } });
  const epgp = createEpgpService(database);
  let decayed = 0;
  for (const settings of due) {
    if (settings.lastAutoDecayAt && settings.lastAutoDecayAt.getTime() >= reset.getTime()) continue;
    const week = reset.toISOString().slice(0, 10);
    try {
      if (!settings.coreLootOnly && settings.epgpDecayPercent > 0) await epgp.applyDecay(settings.guildId, settings.epgpDecayPercent, "auto-decay", null, `decay:guild:${week}`);
      const cores = await database.raidCore.findMany({ where: { guildId: settings.guildId, separatePool: true } });
      for (const core of cores) {
        const percent = effectiveRules(settings, core).decayPercent;
        if (percent > 0) await epgp.applyDecay(settings.guildId, percent, "auto-decay", core.id, `decay:${core.id}:${week}`);
      }
      await database.guildSettings.update({ where: { id: settings.id }, data: { lastAutoDecayAt: now } });
      decayed++;
    } catch (error) {
      console.error(`Automatic decay failed for guild ${settings.guildId}`, error);
    }
  }
  return decayed;
}
