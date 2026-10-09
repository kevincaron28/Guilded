import type { PrismaClient } from "@prisma/client";
import { hostedPilot } from "../hosted-pilot.js";
import { PILOT_DENIED } from "./pilot-policy.js";

export function createGuildService(database: PrismaClient) {
  return {
    ensureGuild(discordId: string, name: string) {
      if (!hostedPilot.allows(discordId)) throw new Error(PILOT_DENIED);
      return database.guild.upsert({
        where: { discordId },
        create: {
          discordId,
          name,
          settings: { create: {} }
        },
        update: { name }
      });
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
      realm: string;
      className: string;
      spec?: string;
      level?: number;
      race?: string;
      isMain: boolean;
    }) {
      if (input.isMain) {
        await database.character.updateMany({
          where: { memberId: input.memberId },
          data: { isMain: false }
        });
      }
      return database.character.create({
        data: {
          memberId: input.memberId,
          name: input.name,
          realm: input.realm,
          className: input.className,
          spec: input.spec ?? null,
          level: input.level ?? null,
          race: input.race?.trim() || null,
          isMain: input.isMain
        }
      });
    },

    setProfession(characterId: string, profession: string, skillLevel: number) {
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
      farewellChannelId?: string | null;
      farewellMessageTemplate?: string | null;
      applicantRoleId?: string | null;
      memberRoleId?: string | null;
      raidSignupChannelId?: string | null;
      logChannelId?: string | null;
      meritEnabled?: boolean;
      answerChannelId?: string | null;
      aiAnswers?: boolean;
    }) {
      return database.guildSettings.update({
        where: { guildId },
        data
      });
    }
  };
}
