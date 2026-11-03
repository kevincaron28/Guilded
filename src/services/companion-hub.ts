import type { PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { effectiveRules } from "./core-rules.js";
import { ManageError, type ManageAccess, type ManageResult } from "./companion-manage.js";
import type { SetupCheck } from "./setup-status.js";

// The companion's hub (Home, My characters, Reserves, Server). Everything here reads or writes
// through the same tables and rules as Discord and the website; the roles come from
// companionAccess (a fresh Discord role check), never from the companion. Raid and core edits
// stay in companion-manage.ts.

const OFFICERS_ONLY = "Only Officers and Guild Masters can change the server settings.";

export interface HubCharacter {
  id: string; name: string; displayName: string | null; realm: string; className: string; spec: string | null; level: number | null;
  isMain: boolean; edition: string; rank: string | null;
  guild: { name: string; edition: string; current: boolean; discordId: string; serverName?: string | null };
  cores: { id: string; name: string; role: string; bench: boolean; trial: boolean; backup: boolean; lootMode: string | null }[];
}

// Discord markup in the setup checklist, as plain words for the app.
export function plainText(text: string): string {
  return text
    .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (_m, seconds: string) => new Date(Number(seconds) * 1000).toISOString().slice(0, 10))
    .replace(/<#\d+>/g, "a channel").replace(/<@&?\d+>/g, "someone")
    .replace(/\*\*|`/g, "");
}

export function plainChecks(checks: SetupCheck[]): SetupCheck[] {
  return checks.map((check) => ({ ...check, label: plainText(check.label), fix: plainText(check.fix) }));
}

const serverAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("server.language"), value: z.enum(["en", "fr"]) }),
  z.object({ action: z.literal("server.publicSharing.off") }),
  z.object({ action: z.literal("server.achievements"), on: z.boolean() }),
  z.object({ action: z.literal("server.reminders"), on: z.boolean() }),
  z.object({ action: z.literal("server.weeklyReport"), on: z.boolean() }),
  z.object({ action: z.literal("server.autoImport"), on: z.boolean() })
]);
export type ServerAction = z.infer<typeof serverAction>;

export interface HubHooks {
  // Records the current achievements as already announced, so turning announcements on posts
  // only what is earned from now on (as /config achievements does).
  baselineAchievements?: (guildId: string) => Promise<unknown>;
}

export function createCompanionHub(database: PrismaClient, hooks: HubHooks = {}) {
  async function characters(guildId: string, discordUserId: string): Promise<HubCharacter[]> {
    // The caller's own characters in every server where they are an active member: found by the
    // Discord account the credential proved, never by an id the companion sends.
    const memberships = await database.member.findMany({
      where: { discordUserId, status: "ACTIVE", isTest: false },
      select: {
        guild: { select: { id: true, name: true, gameEdition: true, discordId: true } },
        characters: {
          orderBy: [{ isMain: "desc" }, { name: "asc" }],
          select: {
            id: true, name: true, displayName: true, realm: true, className: true, spec: true, level: true, isMain: true, gameEdition: true, guildRankName: true,
            coreSpots: { select: { role: true, bench: true, trial: true, core: { select: { id: true, name: true, lootMode: true } } } },
            coreBackups: { select: { role: true, spot: { select: { bench: true, trial: true, core: { select: { id: true, name: true, lootMode: true } } } } } }
          }
        }
      }
    });
    const rows: HubCharacter[] = [];
    for (const membership of memberships) {
      for (const c of membership.characters) {
        rows.push({
          id: c.id, name: c.name, displayName: c.displayName, realm: c.realm, className: c.className, spec: c.spec, level: c.level,
          isMain: c.isMain, edition: c.gameEdition, rank: c.guildRankName,
          guild: { name: membership.guild.name, edition: membership.guild.gameEdition, current: membership.guild.id === guildId, discordId: membership.guild.discordId },
          cores: [
            ...c.coreSpots.map((spot) => ({ id: spot.core.id, name: spot.core.name, role: spot.role, bench: spot.bench, trial: spot.trial, backup: false, lootMode: spot.core.lootMode })),
            ...c.coreBackups.map((backup) => ({ id: backup.spot.core.id, name: backup.spot.core.name, role: backup.role, bench: backup.spot.bench, trial: backup.spot.trial, backup: true, lootMode: backup.spot.core.lootMode }))
          ]
        });
      }
    }
    // This server first, then the others; main characters lead within a server.
    return rows.sort((a, b) => Number(b.guild.current) - Number(a.guild.current) || a.guild.name.localeCompare(b.guild.name));
  }

  // Soft reserves are kept in the game addon and replaced wholesale by each officer upload
  // (reserves.ts), so the app only shows them: a write here would vanish at the next sync.
  async function reserves(guildId: string, mine: HubCharacter[]) {
    const [list, settings, cores] = await Promise.all([
      database.reserveList.findUnique({ where: { guildId } }),
      database.guildSettings.findUnique({ where: { guildId } }),
      database.raidCore.findMany({ where: { guildId }, orderBy: { name: "asc" } })
    ]);
    const own = mine.filter((c) => c.guild.current);
    const rows = list?.active ? await database.itemReserve.findMany({ where: { guildId }, orderBy: [{ itemName: "asc" }, { character: "asc" }] }) : [];
    const ownKeys = new Set(own.map((c) => `${c.name.toLowerCase()}\0${c.realm.toLowerCase()}`));
    const byItem = new Map<number, { itemId: number; itemName: string; characters: string[]; mine: boolean }>();
    for (const row of rows) {
      const entry = byItem.get(row.itemId) ?? { itemId: row.itemId, itemName: row.itemName, characters: [], mine: false };
      entry.characters.push(row.character);
      if (ownKeys.has(`${row.character.toLowerCase()}\0${row.realm.toLowerCase()}`)) entry.mine = true;
      byItem.set(row.itemId, entry);
    }
    return {
      // False on purpose: see above. The app says where to reserve instead of offering a button.
      writable: false,
      list: list ? { active: list.active, open: list.open && list.active, title: list.title, perPlayer: list.perPlayer, keeper: list.keeper, syncedAt: list.syncedAt.toISOString() } : null,
      items: [...byItem.values()].slice(0, 500),
      mineCount: rows.filter((row) => ownKeys.has(`${row.character.toLowerCase()}\0${row.realm.toLowerCase()}`)).length,
      cores: cores.map((core) => { const rules = effectiveRules(settings, core); return { id: core.id, name: core.name, lootMode: rules.lootMode, reservesPerPlayer: rules.reservesPerPlayer }; })
    };
  }

  async function server(guildId: string, checks: SetupCheck[] | null) {
    const settings = await database.guildSettings.findUnique({ where: { guildId } });
    const guild = await database.guild.findUnique({ where: { id: guildId }, select: { officerSyncAt: true } });
    return {
      checks: checks ? plainChecks(checks) : null,
      settings: {
        language: settings?.language === "fr" ? "fr" : "en",
        publicSharing: settings?.publicDungeonRuns ?? false,
        achievementAnnounce: settings?.achievementAnnounceEnabled ?? false,
        achievementChannelSet: !!settings?.achievementChannelId,
        reminders: (settings?.raidReminderMinutes ?? 0) > 0,
        weeklyReport: settings?.weeklyReportEnabled ?? false,
        autoImport: settings?.autoApplyImports ?? false,
        welcomeDelivery: settings?.welcomeDelivery ?? "CHANNEL",
        welcomeChannelSet: !!settings?.welcomeChannelId
      },
      officerSyncAt: guild?.officerSyncAt?.toISOString() ?? null
    };
  }

  return {
    // `checks` is the /setup checklist, gathered from Discord by the caller; null when it could
    // not be read (the app then says so). Officers get the server section, members do not.
    async view(guildId: string, access: ManageAccess, checks: SetupCheck[] | null) {
      const guild = await database.guild.findUniqueOrThrow({ where: { id: guildId }, select: { name: true, gameEdition: true } });
      const mine = await characters(guildId, access.actorId);
      return {
        me: { officer: access.officer, raidLeader: access.raidLeader },
        updatedAt: new Date().toISOString(),
        guild: { name: guild.name, edition: guild.gameEdition },
        characters: mine,
        reserves: await reserves(guildId, mine),
        server: access.officer ? await server(guildId, checks) : null
      };
    },

    async applyServer(guildId: string, access: ManageAccess, input: unknown): Promise<ManageResult> {
      if (!access.officer) throw new ManageError(OFFICERS_ONLY, 403);
      const action = serverAction.parse(input);
      const settings = await database.guildSettings.findUnique({ where: { guildId } });
      if (!settings) throw new ManageError("This server has no settings yet. Run /setup start in Discord first.", 409);
      const update = (data: Record<string, unknown>) => database.guildSettings.update({ where: { guildId }, data });
      switch (action.action) {
        case "server.language":
          await update({ language: action.value });
          return { message: action.value === "fr" ? "Bot messages are now in French." : "Bot messages are now in English.", audit: { setting: "language", value: action.value } };
        case "server.publicSharing.off":
          // Turning sharing on needs the typed consent in Discord (/mod leaderboard); only off is one click.
          await update({ publicDungeonRuns: false });
          return { message: "Public sharing is off. New runs will not be published; runs already public stay public.", audit: { setting: "publicDungeonRuns", value: false } };
        case "server.achievements":
          if (action.on) {
            if (!settings.achievementChannelId) throw new ManageError("Pick the channel to post in first: /config achievements announce:true channel:#... in Discord.", 409);
            if (!settings.achievementAnnounceEnabled) await hooks.baselineAchievements?.(guildId);
          }
          await update({ achievementAnnounceEnabled: action.on });
          return { message: action.on ? "Achievement announcements are on. Only new unlocks are posted." : "Achievement announcements are off. Achievements are still recorded.", audit: { setting: "achievementAnnounceEnabled", value: action.on } };
        case "server.reminders":
          await update({ raidReminderMinutes: action.on ? 60 : 0 });
          return { message: action.on ? "Raid reminders are on (60 minutes before start)." : "Raid reminders are off.", audit: { setting: "raidReminderMinutes", value: action.on ? 60 : 0 } };
        case "server.weeklyReport":
          await update({ weeklyReportEnabled: action.on });
          return { message: action.on ? "The weekly report is on." : "The weekly report is off.", audit: { setting: "weeklyReportEnabled", value: action.on } };
        case "server.autoImport":
          await update({ autoApplyImports: action.on });
          return { message: action.on ? "Uploads are applied automatically." : "Officers apply uploads themselves with /import apply.", audit: { setting: "autoApplyImports", value: action.on } };
      }
    }
  };
}
