import { SlashCommandBuilder } from "discord.js";

// The listed person's way to ask the officers for a review (services/do-not-invite-flow.ts). Private; shows nothing about the entry.
export const appealCommand = new SlashCommandBuilder()
  .setName("appeal")
  .setDescription("Ask the officers to review a do-not-invite entry tied to your Discord account.")
  .addStringOption((o) => o.setName("message").setDescription("What the officers should know").setMaxLength(500));
