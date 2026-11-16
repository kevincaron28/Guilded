import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { characterKey, foreverSameName, realmKey } from "../../companion/character-identity.mjs";
import { findCharacter } from "./character-match.js";
import { linkPairedCharacter } from "./character-pairing.js";

// One-click claim (owner decision, 16 November 2026): a zero-setup install reports the characters of one WoW account
// (DeviceCharacter, owned by nobody). Once the member is known (a Discord sign-in claimed the install, or /guilded verify
// linked one of those characters) we offer ONE prompt per install: "Link these N characters to you?" with Link / Not now.
//
// Rules: a character another member owns is never offered (it is listed as taken); a member's own unlink (BLOCKED) and an
// officer's removal (REMOVED) are respected; "Not now" snoozes that install for 7 days; the DM is sent at most once per
// install per 7 days; linking twice does nothing. The evidence stays what it is today: the member's own signed-in companion
// is not enough for "confirmed" either (a device does not say which character is logged in): a claim only reports (named), and a signed upload of the played character confirms it.
// The same offer is answered in the companion window (hub-style API in companion-api.ts) and in a Discord DM.

export const OFFER_SNOOZE_MS = 7 * 86_400_000;
export const OFFER_DM_GAP_MS = 7 * 86_400_000;
/** A device reports at most 12 characters of one WoW account. */
const MAX_OFFERED = 12;
const MAX_DMS = 3;

export const CLAIM_PREFIX = "linked:dclaim:"; // + device id
export const SNOOZE_PREFIX = "linked:dsnooze:"; // + device id
export const DM_OFF_ID = "linked:dcoff"; // "Don't send these": the member's own off switch (Member.claimDmOff)

export interface OfferedCharacter { name: string; realm: string; className: string | null; level: number | null; /** The guild roster synced from the game lists it. */ corroborated?: boolean }
export interface DeviceOffer {
  deviceId: string;
  /** The Guild row the install syncs to (this member's server). */
  guildId: string;
  /** Characters of this install that nobody owns and the member did not decline. */
  characters: OfferedCharacter[];
  /** Names another member already owns: shown as "linked to someone else", never claimed. */
  taken: string[];
  snoozedUntil: Date | null;
  dmAt: Date | null;
}

type Db = PrismaClient;

/** Offers for one member, one per install with at least one character to link. Snoozed installs are left out unless asked for. */
export async function offersFor(db: Db, memberId: string, now = new Date(), options: { includeSnoozed?: boolean; deviceId?: string } = {}): Promise<DeviceOffer[]> {
  const member = await db.member.findUnique({
    where: { id: memberId }, select: { id: true, guildId: true, status: true, characters: { where: { detachedAt: null }, select: { name: true, realm: true, confirmedAt: true, linkEvidence: true } } }
  });
  if (!member || member.status !== "ACTIVE") return [];
  const own = member.characters.map((character) => character.name);
  // An install's list is client-controlled (registration is open, uploads are unsigned), so an unclaimed install only counts as this
  // member's through one of their CONFIRMED characters, matched on name and realm.
  const anchors = member.characters.filter((character) => character.confirmedAt || character.linkEvidence === "heard" || character.linkEvidence === "officer");
  const devices = await db.companionDevice.findMany({
    where: {
      guildId: member.guildId, revokedAt: null, ...(options.deviceId ? { id: options.deviceId } : {}),
      OR: [{ claimedMemberId: memberId }, { claimedMemberId: null }]
    },
    select: {
      id: true, claimedMemberId: true,
      characters: { orderBy: { lastSeenAt: "desc" }, take: MAX_OFFERED, select: { name: true, realm: true, className: true, level: true } },
      claimOffers: { where: { memberId }, select: { snoozedUntil: true, dmAt: true } }
    }
  });
  if (!devices.length) return [];
  const [roster, guildCharacters, declined] = await Promise.all([
    db.guildRosterEntry.findMany({ where: { guildId: member.guildId, gameEdition: "forever", inGuild: true }, select: { nameKey: true } }),
    db.character.findMany({ where: { member: { guildId: member.guildId } }, select: { name: true, realm: true, gameEdition: true, memberId: true, detachedAt: true } }),
    db.characterVerifyClaim.findMany({ where: { guildId: member.guildId, memberId, status: { in: ["BLOCKED", "REMOVED"] } }, select: { nameKey: true } })
  ]);
  const declinedKeys = new Set(declined.map((row) => row.nameKey));
  const inRoster = new Set(roster.map((row) => row.nameKey));
  const offers: DeviceOffer[] = [];
  for (const device of devices) {
    // An unclaimed install is only this member's when it reported one of their characters; their own claimed install always is.
    const claimed = device.claimedMemberId === memberId;
    const theirs = claimed || device.characters.some((character) => anchors.some((anchor) => foreverSameName(anchor.name, character.name) && realmKey(anchor.realm) === realmKey(character.realm)));
    if (!theirs) continue;
    const row = device.claimOffers[0];
    if (!options.includeSnoozed && row?.snoozedUntil && row.snoozedUntil > now) continue;
    const characters: OfferedCharacter[] = [];
    const taken: string[] = [];
    for (const character of device.characters) {
      if (own.some((name) => foreverSameName(name, character.name))) continue;
      if (declinedKeys.has(characterKey(character.name, character.realm, "forever"))) continue;
      const existing = findCharacter(guildCharacters, character.name, character.realm, "forever");
      if (existing) {
        if (existing.memberId !== memberId && !existing.detachedAt) taken.push(character.name);
        continue;
      }
      // The guild roster (synced from the game itself) is the outside witness. An unclaimed install never offers a name it does not back;
      // the member's own claimed install may offer it, but only as "reported".
      const corroborated = inRoster.has(characterKey(character.name, character.realm, "forever"));
      if (!corroborated && !claimed) continue;
      characters.push({ name: character.name, realm: character.realm, className: character.className, level: character.level, corroborated });
    }
    if (characters.length) offers.push({ deviceId: device.id, guildId: member.guildId, characters, taken, snoozedUntil: row?.snoozedUntil ?? null, dmAt: row?.dmAt ?? null });
  }
  return offers;
}

/** "Not now": the install is not offered to this member again for 7 days. */
export async function snoozeOffer(db: Db, memberId: string, deviceId: string, now = new Date()): Promise<Date | null> {
  // Only an install that really offers this member something can be snoozed (an unknown id would otherwise be a foreign-key error).
  if (!(await offersFor(db, memberId, now, { includeSnoozed: true, deviceId })).length) return null;
  const snoozedUntil = new Date(now.getTime() + OFFER_SNOOZE_MS);
  await db.deviceClaimOffer.upsert({ where: { memberId_deviceId: { memberId, deviceId } }, create: { memberId, deviceId, snoozedUntil }, update: { snoozedUntil } });
  return snoozedUntil;
}

/** "Link": links what is still offered for this install. Linking twice, or after someone else took a name, links nothing more. */
export async function claimOffer(db: Db, memberId: string, deviceId: string, now = new Date()): Promise<{ linked: string[]; skipped: string[] } | null> {
  const [offer] = await offersFor(db, memberId, now, { includeSnoozed: true, deviceId });
  if (!offer) return null;
  // A device reports a WoW account's characters, not which one is logged in, and the roster only proves a name exists in the guild:
  // neither is ownership evidence (security review, 16 November 2026), so a claim only reports. A character becomes confirmed when it
  // is the logged-in character of a signed upload from the member's own companion, a heard verify code, or an officer link.
  const linked: string[] = [];
  const skipped: string[] = [];
  const rows = await db.deviceCharacter.findMany({ where: { deviceId }, select: { name: true, realm: true, displayName: true, className: true, race: true, level: true } });
  for (const wanted of offer.characters) {
    const row = rows.find((candidate) => candidate.name === wanted.name && candidate.realm === wanted.realm);
    if (!row?.className) { skipped.push(wanted.name); continue; }
    const status = await linkPairedCharacter(db, offer.guildId, memberId, {
      name: row.name, realm: row.realm, class: row.className, race: row.race ?? "", level: row.level ?? 0, spec: "", professions: [],
      ...(row.displayName ? { displayName: row.displayName } : {}), gameEdition: "forever"
    }, { confirm: false, evidence: "named" }).catch(() => "link-retry" as const);
    (status === "linked" || status === "already-linked" ? linked : skipped).push(row.name);
  }
  await db.deviceClaimOffer.upsert({ where: { memberId_deviceId: { memberId, deviceId } }, create: { memberId, deviceId, doneAt: now }, update: { doneAt: now } });
  return { linked, skipped };
}

const lineOf = (character: OfferedCharacter) => `• **${escapeMarkdown(character.name)}**${character.className ? ` — ${escapeMarkdown(character.className)}${character.level ? ` ${character.level}` : ""}` : ""}`;

/** The DM (or any chat prompt) for one install's offer, with its Link / Not now buttons. */
export function offerMessage(lang: Lang, server: string, offer: DeviceOffer): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  const list = offer.characters.slice(0, MAX_OFFERED).map(lineOf).join("\n");
  const taken = offer.taken.length ? `\n\n${t(lang, "claim.taken", { names: offer.taken.map((name) => `**${escapeMarkdown(name)}**`).join(", ") })}` : "";
  return {
    content: `${t(lang, "claim.ask", { count: offer.characters.length, server: escapeMarkdown(server), list })}${taken}`.slice(0, 1900),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CLAIM_PREFIX}${offer.deviceId}`).setLabel(t(lang, "claim.link")).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${SNOOZE_PREFIX}${offer.deviceId}`).setLabel(t(lang, "claim.later")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(DM_OFF_ID).setLabel(t(lang, "claim.off")).setStyle(ButtonStyle.Secondary))]
  };
}

/**
 * The Discord DM fallback: for a member who is not in the companion (after /guilded verify, or when nobody opens the companion window).
 * At most one DM per install per 7 days, never for a snoozed install, marked before sending so a closed DM never repeats. Never throws.
 */
export async function offerByDm(client: Pick<Client, "users" | "guilds"> | null | undefined, db: Db, memberId: string, now = new Date()): Promise<number> {
  if (!client) return 0;
  try {
    const member = await db.member.findUnique({ where: { id: memberId }, select: { discordUserId: true, claimDmOff: true, guildId: true, guild: { select: { discordId: true } } } });
    // The member's "Don't send these" and the officers' guild-wide switch both win.
    if (!member || member.claimDmOff) return 0;
    const settings = await db.guildSettings.findUnique({ where: { guildId: member.guildId }, select: { language: true, claimDmEnabled: true } });
    if (settings?.claimDmEnabled === false) return 0;
    const offers = (await offersFor(db, memberId, now)).filter((offer) => !offer.dmAt || now.getTime() - offer.dmAt.getTime() >= OFFER_DM_GAP_MS).slice(0, MAX_DMS);
    if (!offers.length) return 0;
    const lang = asLang(settings?.language);
    const server = (await client.guilds.fetch(member.guild.discordId).catch(() => null))?.name ?? "Discord";
    let sent = 0;
    for (const offer of offers) {
      // Claimed by one writer: two uploads racing for the same offer send one DM (the loser's update matches no row).
      await db.deviceClaimOffer.createMany({ data: [{ memberId, deviceId: offer.deviceId }], skipDuplicates: true });
      const claimed = await db.deviceClaimOffer.updateMany({
        where: { memberId, deviceId: offer.deviceId, OR: [{ dmAt: null }, { dmAt: { lte: new Date(now.getTime() - OFFER_DM_GAP_MS) } }] }, data: { dmAt: now }
      });
      if (!claimed.count) continue;
      await client.users.send(member.discordUserId, { ...offerMessage(lang, server, offer), allowedMentions: { parse: [] } });
      sent += 1;
    }
    return sent;
  } catch {
    return 0; // DMs closed or Discord unavailable: say nothing
  }
}

/** After /guilded verify linked characters: each of those Discord users gets the offer for the installs of their WoW account. Never throws. */
export async function offerByDmToUsers(client: Pick<Client, "users" | "guilds"> | null | undefined, db: Db, guildId: string, discordUserIds: readonly string[], now = new Date()): Promise<void> {
  if (!client) return;
  try {
    const members = await db.member.findMany({ where: { guildId, discordUserId: { in: [...new Set(discordUserIds)] } }, select: { id: true } });
    for (const member of members) await offerByDm(client, db, member.id, now);
  } catch { /* an offer never fails a link */ }
}

/** A Link / Not now press from the DM: the member is the presser, resolved through the install's server. */
export async function answerOfferButton(db: Db, discordUserId: string, customId: string, now = new Date()): Promise<string | null> {
  if (customId === DM_OFF_ID) {
    await db.member.updateMany({ where: { discordUserId }, data: { claimDmOff: true } });
    return `${t("en", "claim.offDone")}\n${t("fr", "claim.offDone")}`;
  }
  const claim = customId.startsWith(CLAIM_PREFIX);
  if (!claim && !customId.startsWith(SNOOZE_PREFIX)) return null;
  const deviceId = customId.slice((claim ? CLAIM_PREFIX : SNOOZE_PREFIX).length);
  const device = await db.companionDevice.findUnique({ where: { id: deviceId }, select: { guildId: true, guild: { select: { name: true, settings: { select: { language: true } } } } } });
  const lang = asLang(device?.guild?.settings?.language);
  const member = device?.guildId ? await db.member.findUnique({ where: { guildId_discordUserId: { guildId: device.guildId, discordUserId } }, select: { id: true } }) : null;
  if (!device || !member) return `${t("en", "claim.gone")}\n${t("fr", "claim.gone")}`;
  if (!claim) return (await snoozeOffer(db, member.id, deviceId, now)) ? t(lang, "claim.snoozed") : t(lang, "claim.nothing");
  const result = await claimOffer(db, member.id, deviceId, now);
  if (!result) return t(lang, "claim.nothing");
  if (!result.linked.length) return t(lang, "claim.nothing");
  return t(lang, "claim.done", { server: escapeMarkdown(device.guild?.name ?? "Discord"), names: result.linked.map((name) => `**${escapeMarkdown(name)}**`).join(", ") });
}
