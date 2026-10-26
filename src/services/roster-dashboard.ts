import type { WebContext, WebRoute } from "./web-app.js";
import { escapeHtml as h, link, options, SECURITY_HEADERS } from "./web-layout.js";
import { csvBuffer, toCsv } from "./exports.js";
import type { RosterCharacter, RosterDashboardStore } from "./roster-dashboard-store.js";
import { guildToolsNav } from "./guild-tools-pages.js";

const PATH = "/me/roster";
const PAGE_SIZE = 50;
const UNKNOWN = "__unknown__";
export interface RosterFilters { q: string; className: string; race: string; profession: string; kind: string; min: number | null; max: number | null }
export function rosterFilters(query: URLSearchParams): RosterFilters {
  const text = (name: string) => {
    const value = (query.get(name) ?? "").trim();
    if (value.length > 80) throw new Error("Filter too long");
    return value;
  };
  const level = (name: string) => {
    const value = text(name);
    if (!value) return null;
    if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 200) throw new Error("Invalid level");
    return Number(value);
  };
  const filters = { q: text("q"), className: text("class"), race: text("race"), profession: text("profession"), kind: text("kind"), min: level("min"), max: level("max") };
  if (!["", "main", "alt", "unclaimed"].includes(filters.kind) || (filters.min !== null && filters.max !== null && filters.min > filters.max)) throw new Error("Invalid filter");
  return filters;
}
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
export function filterRoster(rows: RosterCharacter[], filters: RosterFilters): RosterCharacter[] {
  const matches = (value: string | null, filter: string) => !filter || (filter === UNKNOWN ? !value : value === filter);
  return rows.filter(row => (!filters.q || normalized(`${row.name} ${row.realm}`).includes(normalized(filters.q)))
    && matches(row.className, filters.className) && matches(row.race, filters.race)
    && (!filters.profession || (filters.profession === UNKNOWN ? !row.professions.length : row.professions.includes(filters.profession)))
    && (!filters.kind || (filters.kind === "main" ? row.isMain === true : filters.kind === "alt" ? row.isMain === false : row.memberId === null))
    && (filters.min === null || (row.level !== null && row.level >= filters.min))
    && (filters.max === null || (row.level !== null && row.level <= filters.max)));
}
export function rosterCounts(rows: RosterCharacter[]) {
  return { characters: rows.length, linkedMembers: new Set(rows.flatMap(row => row.memberId ? [row.memberId] : [])).size, unclaimed: rows.filter(row => row.memberId === null).length };
}
export function rosterCsv(rows: RosterCharacter[]): Buffer {
  return csvBuffer(toCsv(["character", "realm", "class", "race", "level", "link_status", "main", "professions", "data_refreshed_at"], rows.map(row =>
    [row.name, row.realm, row.className, row.race, row.level, row.memberId === null ? "unclaimed" : "linked", row.isMain, row.professions.join("; "), row.refreshedAt])));
}

export function createRosterDashboard(store: RosterDashboardStore) {
  const meSection = async (ctx: WebContext) => ctx.account
    ? `<h2>${ctx.t("Guild roster", "Effectif de guilde")}</h2><p>${ctx.t("Officers can search their guild's synced characters and export a filtered roster.", "Les officiers peuvent rechercher les personnages synchronisés et exporter un effectif filtré.")}</p><p><a href="${h(link(PATH, ctx.lang))}">${ctx.t("Open roster dashboard", "Ouvrir le tableau des effectifs")}</a></p>` : "";
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== PATH && ctx.request.path !== `${PATH}/export`) return null;
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    const title = t("Guild roster", "Effectif de guilde");
    const query = ctx.request.query;
    const guildId = query.get("guild") ?? "";
    if (guildId.length > 64) return kit.page(400, title, t("Invalid guild selection.", "Sélection de guilde invalide."), { noindex: true });
    let filters: RosterFilters;
    try { filters = rosterFilters(query); }
    catch { return kit.page(400, title, t("Check the filters and level range.", "Vérifiez les filtres et la plage de niveaux."), { noindex: true }); }
    try {
      if (!guildId) {
        if (ctx.request.path.endsWith("/export")) return kit.page(400, title, t("Choose a guild first.", "Choisissez d'abord une guilde."), { noindex: true });
        const guilds = await store.guilds(ctx.account.discordUserId);
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Choose a guild. Access requires your current officer role and active Guilded membership.", "Choisissez une guilde. Votre rôle actuel d'officier et une adhésion Guilded active sont requis.")}</p>`
          + (guilds.length ? `<ul>${guilds.map(guild => `<li><a href="${h(link(PATH, lang, { guild: guild.id, edition: guild.edition }))}">${h(guild.name)} · ${h(guild.edition)}</a></li>`).join("")}</ul>`
            : `<p>${t("No eligible guilds are available. Check your membership and officer role in Discord.", "Aucune guilde admissible. Vérifiez votre adhésion et votre rôle d'officier dans Discord.")}</p>`), { noindex: true });
      }
      const snapshot = await store.load(ctx.account.discordUserId, guildId);
      if (!snapshot) return kit.page(403, title, t("This roster is unavailable with your current membership and permissions.", "Cet effectif n'est pas accessible avec votre adhésion et vos permissions actuelles."), { noindex: true });
      const available = (filter: string, values: (string | null)[]) => !filter || filter === UNKNOWN || values.includes(filter);
      if (!available(filters.className, snapshot.characters.map(row => row.className)) || !available(filters.race, snapshot.characters.map(row => row.race)) || !available(filters.profession, snapshot.characters.flatMap(row => row.professions))) {
        return kit.page(400, title, `<p>${t("A filter no longer matches this roster. Clear the filters and try again.", "Un filtre ne correspond plus à cet effectif. Effacez les filtres et réessayez.")}</p><p><a href="${h(link(PATH, lang, { guild: guildId, edition: snapshot.guild.edition }))}">${t("Clear filters", "Effacer les filtres")}</a></p>`, { noindex: true });
      }
      const rows = filterRoster(snapshot.characters, filters);
      if (ctx.request.path.endsWith("/export")) {
        // Never silently export a truncated sample as a complete guild roster.
        if (snapshot.truncated) return kit.page(409, title, t("This roster exceeds the dashboard limit. Export is unavailable for this partial snapshot.", "Cet effectif dépasse la limite du tableau. L'export est indisponible pour cet aperçu partiel."), { noindex: true });
        return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="guilded-roster.csv"' }, body: "", ...(ctx.request.method === "HEAD" ? {} : { binaryBody: rosterCsv(rows) }) };
      }
      const counts = rosterCounts(rows);
      const unknown = t("Unknown", "Inconnu");
      const href = (extra: Record<string, string>) => h(link(PATH, lang, { guild: guildId, edition: snapshot.guild.edition, q: filters.q, class: filters.className, race: filters.race, profession: filters.profession, kind: filters.kind, min: filters.min?.toString(), max: filters.max?.toString(), ...extra }));
      const select = (name: string, label: string, values: string[], selected: string) => `<div><label for="roster-${name}">${label}</label><select id="roster-${name}" name="${name}">${options([{ value: "", label: t("All", "Tous") }, ...[...new Set(values.filter(Boolean))].sort().map(value => ({ value, label: value })), { value: UNKNOWN, label: unknown }], selected)}</select></div>`;
      const input = (name: string, label: string, value: string, type = "text") => `<div><label for="roster-${name}">${label}</label><input id="roster-${name}" name="${name}" type="${type}" value="${h(value)}" ${type === "number" ? 'min="1" max="200"' : 'maxlength="80"'}></div>`;
      const summaries = (label: string, values: (string | null)[]) => {
        const totals = new Map<string, number>();
        for (const value of values) { const key = value || unknown; totals.set(key, (totals.get(key) ?? 0) + 1); }
        return `<section class="card"><h3>${label}</h3><ul>${[...totals].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => `<li>${h(name)}: ${count}</li>`).join("") || `<li>${t("No matches", "Aucun résultat")}</li>`}</ul></section>`;
      };
      const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      const rawPage = query.get("page") ?? "1";
      const page = /^\d{1,5}$/.test(rawPage) ? Math.max(1, Math.min(pageCount, Number(rawPage))) : 1;
      const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const body = `<h1>${title}</h1><p><strong>${h(snapshot.guild.name)}</strong> · ${h(snapshot.guild.edition)} · <a href="${h(link(PATH, lang))}">${t("Choose another guild", "Choisir une autre guilde")}</a></p>`
        + guildToolsNav(lang, snapshot.guild)
        + `<p class="notice">${t("Synced character data, not a live guild census. Data refresh times do not prove online activity. Unknown details remain unknown.", "Données de personnages synchronisées, pas un recensement en direct. Les dates d'actualisation ne prouvent pas une activité en ligne. Les détails inconnus restent inconnus.")}</p>`
        + (snapshot.truncated ? `<p class="notice">${t("Partial snapshot: only the first 1,000 records are available. Counts and filters describe this sample; export is disabled.", "Aperçu partiel : seuls les 1 000 premiers enregistrements sont disponibles. Les comptes et filtres décrivent cet échantillon; l'export est désactivé.")}</p>` : "")
        + `<form method="get" action="${PATH}"><input type="hidden" name="guild" value="${h(guildId)}"><input type="hidden" name="edition" value="${h(snapshot.guild.edition)}"><input type="hidden" name="lang" value="${lang}"><div class="filters">`
        + input("q", t("Name or realm", "Nom ou royaume"), filters.q)
        + select("class", t("Class", "Classe"), snapshot.characters.map(row => row.className), filters.className)
        + select("race", t("Race", "Race"), snapshot.characters.flatMap(row => row.race ? [row.race] : []), filters.race)
        + select("profession", t("Profession", "Métier"), snapshot.characters.flatMap(row => row.professions), filters.profession)
        + `<div><label for="roster-kind">${t("Character status", "Statut du personnage")}</label><select id="roster-kind" name="kind">${options([{ value: "", label: t("All", "Tous") }, { value: "main", label: t("Mains", "Principaux") }, { value: "alt", label: t("Alts", "Secondaires") }, { value: "unclaimed", label: t("Unclaimed", "Non liés") }], filters.kind)}</select></div>`
        + input("min", t("Minimum level", "Niveau minimum"), filters.min?.toString() ?? "", "number") + input("max", t("Maximum level", "Niveau maximum"), filters.max?.toString() ?? "", "number")
        + `<button class="button" type="submit">${t("Apply filters", "Appliquer les filtres")}</button></div></form>`
        + `<p><a href="${h(link(PATH, lang, { guild: guildId, edition: snapshot.guild.edition }))}">${t("Clear filters", "Effacer les filtres")}</a></p>`
        + `<h2>${t("Matching records", "Enregistrements correspondants")}</h2><div class="cards">${[[t("Characters", "Personnages"), counts.characters], [t("Linked members represented", "Membres liés représentés"), counts.linkedMembers], [t("Unclaimed characters", "Personnages non liés"), counts.unclaimed]].map(([label, count]) => `<section class="card"><h3>${label}</h3><p>${count}</p></section>`).join("")}</div>`
        + `<p>${t("Unclaimed characters are not counted as distinct people. Main/alt status applies only to linked characters.", "Les personnages non liés ne sont pas comptés comme des personnes distinctes. Le statut principal/secondaire s'applique aux personnages liés.")}</p>`
        + `<div class="cards">${summaries(t("Characters by class", "Personnages par classe"), rows.map(row => row.className))}${summaries(t("Characters by race", "Personnages par race"), rows.map(row => row.race))}${summaries(t("Characters by profession (may overlap)", "Personnages par métier (chevauchement possible)"), rows.flatMap(row => row.professions.length ? row.professions : [null]))}</div>`
        + (!snapshot.truncated ? `<p><a href="${href({}).replace(PATH + "?", PATH + "/export?")}">${t("Export all matching rows (CSV)", "Exporter toutes les lignes correspondantes (CSV)")}</a></p>` : "")
        + `<div class="table-wrap"><table><thead><tr>${[t("Character", "Personnage"), t("Realm", "Royaume"), t("Class", "Classe"), t("Race", "Race"), t("Level", "Niveau"), t("Status", "Statut"), t("Professions", "Métiers"), t("Data refreshed (UTC)", "Données actualisées (UTC)")].map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>`
        + visible.map(row => `<tr><td>${row.characterId ? `<a href="${h(link("/me/history", lang, { guild: guildId, edition: snapshot.guild.edition, character: row.characterId }))}">${h(row.name)}</a>` : h(row.name)}</td>${[row.realm || unknown, row.className || unknown, row.race || unknown, row.level?.toString() ?? unknown, row.isMain === null ? t("Unclaimed", "Non lié") : row.isMain ? t("Main", "Principal") : t("Alt", "Secondaire"), row.professions.join(", ") || unknown, row.refreshedAt?.toISOString().replace("T", " ").replace(".000Z", " UTC") ?? unknown].map(value => `<td>${h(value)}</td>`).join("")}</tr>`).join("")
        + `</tbody></table></div>${rows.length ? "" : `<p>${t("No characters match these filters.", "Aucun personnage ne correspond à ces filtres.")}</p>`}`
        + `<nav aria-label="${t("Roster pages", "Pages des effectifs")}">${page > 1 ? `<a href="${href({ page: String(page - 1) })}">${t("Previous", "Précédent")}</a> · ` : ""}${page} / ${pageCount}${page < pageCount ? ` · <a href="${href({ page: String(page + 1) })}">${t("Next", "Suivant")}</a>` : ""}</nav>`;
      return kit.page(200, title, body, { noindex: true, languageParams: { guild: guildId, edition: snapshot.guild.edition, q: filters.q, class: filters.className, race: filters.race, profession: filters.profession, kind: filters.kind, min: filters.min?.toString(), max: filters.max?.toString(), page: String(page) } });
    } catch {
      return kit.page(503, title, t("The roster could not be loaded. Try again shortly; no data was changed.", "Impossible de charger l'effectif. Réessayez sous peu; aucune donnée n'a été modifiée."), { noindex: true });
    }
  };
  return { route, meSection };
}
