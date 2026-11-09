import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AddonCharacter } from "../integrations/addon.js";
import { linkPairedCharacter } from "./character-pairing.js";
import { autoLinkUnclaimed } from "./character-autolink.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { gameEditionOf } from "./game-edition.js";

type Snapshot = { character?: AddonCharacter | null | undefined; alts: readonly AddonCharacter[] };

/**
 * A signed-in companion proves a Discord member; every character that PC reports (the one logged in
 * and the alts) becomes theirs, an officer's included. No code, no name match. A name another member
 * owns, or one an officer removed from this member, is left alone (linkPairedCharacter refuses both).
 */
export async function linkUploaderCharacters(database: PrismaClient, guildId: string, memberId: string, snapshot: Snapshot) {
  const own = snapshot.character ? characterKey(snapshot.character.name, snapshot.character.realm, gameEditionOf(snapshot.character)) : null;
  // 9.0.8: a failed link (a timeout under load) never fails the upload: the next upload links again.
  // The signed-in companion is this member's own: what it uploads is confirmed, not only reported.
  const status = snapshot.character ? await linkPairedCharacter(database, guildId, memberId, snapshot.character, { confirm: true })
    .catch((error: unknown) => { console.error("Linking the uploader's character failed", error); return "link-retry" as const; }) : "missing-character" as const;
  for (const alt of snapshot.alts) {
    if (own && characterKey(alt.name, alt.realm, gameEditionOf(alt)) === own) continue;
    await linkPairedCharacter(database, guildId, memberId, alt, { confirm: true }).catch((error: unknown) => console.error("Linking an alt failed", error));
  }
  return status;
}

/**
 * A duplicate or unchanged export skips the import, never the linking: a member who still has no
 * linked character gets the by-name matching again (their name may have changed since, or the
 * first attempt ran before they joined).
 */
export async function repairMissingLinks(discordGuild: DiscordGuild | null, database: PrismaClient, guildId: string, memberId: string | null | undefined): Promise<{ character: string; member: string }[]> {
  if (!discordGuild || !memberId) return [];
  if (await database.character.count({ where: { memberId } }) > 0) return [];
  return autoLinkUnclaimed(discordGuild, database, guildId).catch((error: unknown) => { console.warn("Repairing missing links failed", error); return []; });
}
