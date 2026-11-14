import { clearLeaderboardCaches } from "./leaderboard-cache-hooks.js";
import { guildWhere, currentGuildScope } from "./guild-scope.js";
import { normalizeProfessionName } from "./profession-names.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { reattachDetached, type LinkEvidence } from "./character-move.js";
import { hostedPilot } from "../hosted-pilot.js";
import { PILOT_DENIED } from "./pilot-policy.js";

export function createGuildService(database: PrismaClient) {
  return {
    ensureGuild(discordId: string, name: string) {
      const scope = currentGuildScope();
      if (scope?.guild.discordId === discordId) return Promise.resolve(scope.guild);
      // Lite servers get a record for their setup and signups; scheduled jobs still skip them (pilotGuildScope).
      const tier = hostedPilot.tier(discordId);
      if (tier === "blocked") throw new Error(PILOT_DENIED);
      return Promise.resolve(database.guild.upsert({
        where: guildWhere(discordId),
        create: {
          discordId,
          name,
          // Only a genuinely new full Guild opts in automatically. Lite and
          // existing/missing settings stay private; old imports stay private too.
          settings: { create: tier === "approved" ? { publicDungeonRuns: true, publicDungeonRunsSince: new Date() } : {} }
        },
        update: { name }
      })).then((guild) => { if (tier === "approved") clearLeaderboardCaches(); return guild; });
    },

    async ensureMember(guildId: string, discordUserId: string, displayName: string) {
      return database.member.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        create: { guildId, discordUserId, displayName },
        update: { displayName }
      });
    },

    listCharacters(memberId: string) {
      return database.character.findMany({
        where: { memberId },
        include: { professions: true },
        orderBy: [{ isMain: "desc" }, { name: "asc" }]
      });
    },

    async addCharacter(input: {
      memberId: string;
      name: string;
      displayName?: string;
      gameEdition?: string;
      realm: string;
      className: string;
      spec?: string;
      level?: number;
      race?: string;
      isMain: boolean;
      /** What proves the link (character-move.ts). Typed in, claimed or matched by name unless said otherwise. */
      linkEvidence?: LinkEvidence;
    }) {
      const owner = await database.member.findUniqueOrThrow({ where: { id: input.memberId }, select: { guildId: true, guild: { select: { gameEdition: true } } } });
      const gameEdition = input.gameEdition ?? owner.guild.gameEdition;
      if (gameEdition !== owner.guild.gameEdition) throw new Error("This character belongs to a different WoW edition.");
      if (input.isMain) {
        await database.character.updateMany({
          where: { memberId: input.memberId },
          data: { isMain: false }
        });
      }
      // A character that was unlinked before comes back as the same row, with its history.
      const back = await reattachDetached(database as unknown as Prisma.TransactionClient, owner.guildId, input.memberId, { name: input.name, realm: input.realm, gameEdition }, input.linkEvidence ?? "named");
      if (back) {
        return database.character.update({
          where: { id: back.character.id },
          data: {
            ...(input.displayName ? { displayName: input.displayName } : {}),
            className: input.className,
            ...(input.spec ? { spec: input.spec } : {}), ...(input.level ? { level: input.level } : {}), ...(input.race?.trim() ? { race: input.race.trim() } : {}),
            isMain: input.isMain || back.character.isMain
          }
        });
      }
      return database.character.create({
        data: {
          memberId: input.memberId,
          guildId: owner.guildId,
          linkEvidence: input.linkEvidence ?? "named",
          name: input.name,
          gameEdition,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          realm: input.realm,
          className: input.className,
          spec: input.spec ?? null,
          level: input.level ?? null,
          race: input.race?.trim() || null,
          isMain: input.isMain
        }
      });
    },

    setProfession(characterId: string, rawProfession: string, skillLevel: number) {
      const profession = normalizeProfessionName(rawProfession);
      return database.professionSkill.upsert({
        where: { characterId_profession: { characterId, profession } },
        create: { characterId, profession, skillLevel },
        update: { skillLevel }
      });
    },

    getSettings(guildId: string) {
      return database.guildSettings.findUnique({ where: { guildId } });
    },

    updateSettings(guildId: string, data: {
      publicDungeonRuns?: boolean;
      attendanceDkp?: number;
      lateAttendanceDkp?: number;
      bossKillDkp?: number;
      minimumBid?: number;
      bidIncrement?: number;
      auctionDurationSec?: number;
      epgpDecayPercent?: number;
      baseGp?: number;
      raidReminderMinutes?: number;
      epCompletionBonus?: number;
      notifyChannelId?: string | null;
      dungeonChannelId?: string | null;
      raidLogChannelId?: string | null;
      dungeonLeaderboardChannelId?: string | null;
      dungeonLeaderboardMessageId?: string | null;
      duelBoardEnabled?: boolean;
      duelCardsEnabled?: boolean;
      seasonCardsEnabled?: boolean;
      duelBoardMessageId?: string | null;
      raceBoardEnabled?: boolean;
      raceBoardChannelId?: string | null;
      raceBoardMessageId?: string | null;
      pvpModuleEnabled?: boolean;
      raceBoardTop?: number;
      raceEnded?: boolean;
      raceHallBackfilledAt?: Date | null;
      bgLadderEnabled?: boolean;
      bgLadderMessageId?: string | null;
      dungeonSignupChannelId?: string | null;
      lootChannelId?: string | null;
      craftChannelId?: string | null;
      readinessChannelId?: string | null;
      coreChannelId?: string | null;
      lootMode?: string;
      autoApplyImports?: boolean;
      wclGuildId?: number | null;
      wclBaseUrl?: string | null;
      weeklyReportEnabled?: boolean;
      timezone?: string;
      language?: string;
      welcomeDelivery?: string;
      welcomeRoleIds?: string[];
      welcomeRolePrompt?: string | null;
      welcomeChannelId?: string | null;
      welcomeMessageTemplate?: string | null;
      rulesChannelId?: string | null;
      rulesGate?: boolean;
      onboardingNudge?: boolean;
      gameReminderAuto?: boolean;
      gameRemindAllAt?: Date | null;
      farewellChannelId?: string | null;
      farewellMessageTemplate?: string | null;
      applicantRoleId?: string | null;
      memberRoleId?: string | null;
      raidSignupChannelId?: string | null;
      logChannelId?: string | null;
      meritEnabled?: boolean;
      answerChannelId?: string | null;
      aiAnswers?: boolean;
      characterSignups?: boolean;
      messageLogEnabled?: boolean;
      starboardChannelId?: string | null;
      starboardThreshold?: number;
    }) {
      return database.guildSettings.update({
        where: { guildId },
        data
      });
    }
  };
}
