import type { WebContext } from "./web-app.js";
import { escapeHtml, link } from "./web-layout.js";
import { linkStatusLines, type LinkStatus } from "./link-status.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterTrustMap, trustLabel, type CharacterTrust } from "./character-trust.js";
import { armoryCharacterUrl, armoryUrl } from "./armory-link.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { characterCardHtml } from "./character-card.js";
import { ME_CHARACTER_MAIN_PATH, ME_CHARACTER_UNLINK_PATH, meCharacterNotice } from "./me-character-actions.js";

/** One of the member's own characters, as the /me/ table and card show it. Make main and Unlink are small forms beside each row (me-character-actions.ts, docs/plans/V9_4_PLAN.md T8B). */
export interface MeCharacter {
  id: string; name: string; isMain: boolean; trust: CharacterTrust;
  level: number | null; className: string; race: string | null;
  /** The Discord server (Guild row) the character is linked to. */
  serverName: string;
  /** The character is in that server's synced in-game guild roster, and its rank there (or the last rank an officer's addon saw). */
  inGuild: boolean; guildRank: string | null;
  /** The full "First Last" name for the armory link when one is known, else the stored name (the link then falls back to the armory search). */
  armoryName: string;
}

const clean = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ") || null;

/** The member's own linked characters (at most 25), each confirmed or only reported (character-trust.ts), with their server and in-game guild rank. Two bounded queries on top of the trust ones. */
export function meCharacterList(database: Pick<PrismaClient, "character" | "characterVerifyClaim" | "guildRosterEntry">) {
  return async (discordUserId: string): Promise<MeCharacter[]> => {
    const rows = await database.character.findMany({
      where: { member: { discordUserId, status: { not: "LEFT" } } },
      select: { id: true, memberId: true, name: true, displayName: true, realm: true, gameEdition: true, isMain: true, confirmedAt: true, linkEvidence: true,
        level: true, className: true, race: true, guildRankName: true, member: { select: { guildId: true, guild: { select: { name: true } } } } },
      orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 25
    });
    const trust = new Map<string, CharacterTrust>();
    const roster = new Map<string, { rankName: string | null }>();
    for (const guildId of new Set(rows.map((row) => row.member.guildId))) {
      const own = rows.filter((row) => row.member.guildId === guildId);
      for (const [id, value] of await characterTrustMap(database, guildId, own)) trust.set(id, value);
      const entries = await database.guildRosterEntry.findMany({
        where: { guildId, inGuild: true, nameKey: { in: [...new Set(own.map((row) => characterKey(row.name, row.realm, row.gameEdition ?? "forever")))] } },
        select: { nameKey: true, gameEdition: true, rankName: true }, take: 50
      });
      for (const entry of entries) roster.set(`${guildId}\n${entry.gameEdition}\n${entry.nameKey}`, { rankName: entry.rankName });
    }
    return rows.map((row) => {
      const entry = roster.get(`${row.member.guildId}\n${row.gameEdition ?? "forever"}\n${characterKey(row.name, row.realm, row.gameEdition ?? "forever")}`);
      return {
        id: row.id, name: row.displayName || row.name, isMain: row.isMain, trust: trust.get(row.id) ?? "reported",
        level: row.level ?? null, className: row.className, race: clean(row.race), serverName: row.member.guild?.name ?? "",
        inGuild: !!entry, guildRank: clean(entry?.rankName) ?? clean(row.guildRankName), armoryName: row.displayName?.includes(" ") ? row.displayName : row.name
      };
    });
  };
}

const armoryOf = (row: MeCharacter, lang: "en" | "fr") =>
  (row.armoryName.trim().includes(" ") ? armoryCharacterUrl(row.armoryName, lang) : null) ?? armoryUrl({ name: row.armoryName, displayName: row.name });

/** The characters table for /me/ (every value escaped; no scripts). With a CSRF token each row has Make main and Unlink as small forms. */
export function meCharacterTable(list: readonly MeCharacter[], t: (en: string, fr: string) => string, lang: "en" | "fr", csrf: string | null = null): string {
  const head = [t("Character", "Personnage"), t("Level", "Niveau"), t("Class", "Classe"), t("Discord server", "Serveur Discord"), t("In-game guild", "Guilde en jeu"), t("Rank", "Rang"), t("Main", "Principal"), t("Status", "Statut"), t("Armory", "Armurerie"), ...(csrf ? [t("Actions", "Actions")] : [])];
  const rows = list.map((row) => {
    const armory = armoryOf(row, lang);
    const form = (path: string, label: string) => `<form method="post" action="${escapeHtml(link(path, lang))}" style="display:inline"><input type="hidden" name="csrf" value="${escapeHtml(csrf ?? "")}"><input type="hidden" name="character" value="${escapeHtml(row.id)}"><button class="link" type="submit">${label}</button></form>`;
    const actions = csrf ? `<td>${row.isMain ? "" : `${form(ME_CHARACTER_MAIN_PATH, t("Make main", "Rendre principal"))} `}${form(ME_CHARACTER_UNLINK_PATH, t("Unlink", "Délier"))}</td>` : "";
    return `<tr><td>${escapeHtml(row.name)}</td><td class="num">${row.level ?? "–"}</td><td>${escapeHtml(row.className)}</td><td>${row.serverName ? escapeHtml(row.serverName) : "–"}</td>`
      + `<td>${row.inGuild && row.serverName ? escapeHtml(row.serverName) : `<span class="muted">${t("not seen in the roster", "absent de la liste")}</span>`}</td><td>${row.guildRank ? escapeHtml(row.guildRank) : "–"}</td>`
      + `<td>${row.isMain ? t("Yes", "Oui") : t("No", "Non")}</td><td><span class="${row.trust === "confirmed" ? "trust-confirmed" : "trust-reported"}">${escapeHtml(trustLabel(row.trust, lang))}</span></td>`
      + `<td>${armory ? `<a href="${escapeHtml(armory)}" target="_blank" rel="noopener noreferrer">${t("Armory ↗", "Armurerie ↗")}</a>` : "–"}</td>${actions}</tr>`;
  }).join("");
  return `<div style="overflow-x:auto"><table class="dense"><thead><tr>${head.map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// The /me/ "Your characters" block: connected, last synced, what to do next. Characters link through the
// Guilded app (WoW Forever only; Battle.net discovery was removed with the other WoW editions, see
// docs/plans/FOREVER_ONLY_REMOVAL.md). Stored Battle.net selections stay in the database, unread.
export function charactersMeSection(status: (discordUserId: string) => Promise<LinkStatus>, characters?: (discordUserId: string) => Promise<MeCharacter[]>) {
  return async (ctx: WebContext): Promise<string> => {
    if (!ctx.account) return "";
    const { t } = ctx;
    const lines = linkStatusLines(await status(ctx.account.discordUserId), ctx.lang, ctx.now)
      .map(line => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")).join("<br>");
    // A failed list never hides the status lines above it.
    const list = characters ? await characters(ctx.account.discordUserId).catch(() => []) : [];
    const table = list.length ? meCharacterTable(list, t, ctx.lang, ctx.csrf) : "";
    const main = list.find((row) => row.isMain) ?? list[0];
    const card = main ? characterCardHtml({ name: main.name, className: main.className, race: main.race, level: main.level, guild: main.inGuild ? main.serverName : null, rank: main.guildRank, armoryUrl: armoryOf(main, ctx.lang) }, t) : "";
    const note = list.some((row) => row.trust === "reported")
      ? `<p>${t("Reported, not verified. A character is confirmed once your own Guilded app has synced it and the guild roster agrees (or a guildmate's addon heard your /guilded verify line), or when an officer links it.", "Signalé, non vérifié. Un personnage est confirmé quand votre propre application Guilded l'a synchronisé et que la liste de la guilde le confirme (ou que l'addon d'un coéquipier a entendu votre ligne /guilded verify), ou quand un officier le lie.")}</p>`
      : "";
    const noCompanion = table ? "" : `<p class="muted">${t("No companion? You still appear on the leaderboards: your dungeon runs and duels reach the site through other players’ companions. Search your character name on the leaderboards page. The companion adds instant sync and links your characters to this account.", "Pas de compagnon ? Vous apparaissez quand même aux classements : vos donjons et vos duels arrivent sur le site par le compagnon d’autres joueurs. Cherchez le nom de votre personnage sur la page des classements. Le compagnon ajoute la synchro instantanée et lie vos personnages à ce compte.")} <a href="${link("/leaderboards/", ctx.lang)}">${t("Leaderboards", "Classements")}</a></p>`;
    const notice = meCharacterNotice(ctx.request.query.get("char"), t);
    const banner = notice ? `<p class="notice${notice.error ? " error" : ""}">${escapeHtml(notice.text)}</p>` : "";
    return `<h2>${t("Your characters", "Vos personnages")}</h2>${banner}<p>${lines}</p>${table ? `${card}${table}${note}` : noCompanion}`;
  };
}
