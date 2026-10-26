import { teamComposition, teamClassLabel } from "./team-composition.js";
import type { WebContext, WebRoute } from "./web-app.js";
import { escapeHtml as h, link, options, SECURITY_HEADERS, tr, type Lang } from "./web-layout.js";
import type { RosterGuild } from "./roster-dashboard-store.js";
import { recipeQuery, type GuildToolsStore, type TeamView, type GroupView, type CraftRow } from "./guild-tools-store.js";

export function guildToolsNav(lang: Lang, guild: RosterGuild): string {
  const t = tr(lang);
  return `<nav aria-label="${t("Guild tools", "Outils de guilde")}">${[["roster", t("Roster", "Effectif")], ["crafters", t("Crafters", "Artisans")], ["teams", t("Raid teams", "Équipes de raid")], ["groups", t("Group posts", "Annonces de groupe")], ["roster/review", t("Review main/alt changes", "Réviser les principaux")]].map(([path, label]) => `<a href="${h(link(`/me/${path}`, lang, { guild: guild.id, edition: guild.edition }))}">${label}</a>`).join(" · ")}</nav>`;
}
const PATHS = ["/me/crafters", "/me/teams", "/me/history", "/me/groups"];
const utc = (date: Date) => date.toISOString().replace("T", " ").replace(".000Z", " UTC");
const table = (headers: string[], rows: string[][]) => `<div class="table-wrap"><table><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
export const teamVacancies = (core: TeamView) => {
  const count = (role: string) => core.members.filter(row => !row.bench && row.role === role).length;
  return { TANK: core.tankLimit === null ? null : Math.max(0, core.tankLimit - count("TANK")), HEALER: core.healerLimit === null ? null : Math.max(0, core.healerLimit - count("HEALER")), DPS: core.dpsLimit === null ? null : Math.max(0, core.dpsLimit - count("DPS")) };
};
export function filterGroupPosts(rows: GroupView[], query: string, need: string): GroupView[] {
  return rows.filter(row => row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (!need || row.signedUp < row.size && row.missing && (need === "TANK" ? row.missing.TANK : need === "HEALER" ? row.missing.HEALER : row.missing.DPS) > 0));
}

export function createGuildToolsPages(store: GuildToolsStore) {
  const route: WebRoute = async (ctx, kit) => {
    if (!PATHS.includes(ctx.request.path)) return null;
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    const path = ctx.request.path;
    const guildId = ctx.request.query.get("guild") ?? "";
    const q = (ctx.request.query.get("q") ?? "").trim();
    const characterId = ctx.request.query.get("character") ?? "";
    const coreId = ctx.request.query.get("core") ?? "";
    const need = ctx.request.query.get("need") ?? "";
    const title = path === "/me/crafters" ? t("Guild crafters", "Artisans de guilde") : path === "/me/teams" ? t("Raid teams", "Équipes de raid") : path === "/me/history" ? t("Character links and history", "Personnages liés et historique") : t("Guild group posts", "Annonces de groupe de guilde");
    if ([guildId, characterId, coreId].some(id => id.length > 64) || q.length > 200 || !["", "TANK", "HEALER", "DPS"].includes(need)) return kit.page(400, title, t("Invalid filter.", "Filtre invalide."), { noindex: true });
    if (path === "/me/crafters" && q) {
      try { recipeQuery(q); } catch { return kit.page(400, title, t("Enter a valid item name, numeric ID or WoW item link.", "Entrez un nom d'objet, un identifiant numérique ou un lien d'objet WoW valide."), { noindex: true }); }
    }
    try {
      if (!guildId) {
        const guilds = await store.guilds(ctx.account.discordUserId);
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Choose a guild where you currently have officer access.", "Choisissez une guilde où vous avez actuellement accès comme officier.")}</p><ul>${guilds.map(guild => `<li><a href="${h(link(path, lang, { guild: guild.id, edition: guild.edition }))}">${h(guild.name)} · ${h(guild.edition)}</a></li>`).join("")}</ul>${guilds.length ? "" : `<p>${t("No eligible guilds.", "Aucune guilde admissible.")}</p>`}`, { noindex: true });
      }
      if (path === "/me/history" && !characterId) return kit.redirect(link("/me/roster", lang, { guild: guildId }));
      const result = path === "/me/crafters" ? await store.craft(ctx.account.discordUserId, guildId, q)
        : path === "/me/teams" ? await store.teams(ctx.account.discordUserId, guildId)
        : path === "/me/history" ? await store.history(ctx.account.discordUserId, guildId, characterId)
        : await store.groups(ctx.account.discordUserId, guildId);
      if (!result) return kit.page(403, title, t("These records are unavailable with your current membership and permissions.", "Ces données ne sont pas accessibles avec votre adhésion et vos permissions actuelles."), { noindex: true });
      const { guild } = result;
      const params = { guild: guild.id, edition: guild.edition, q, core: coreId, character: characterId, need };
      const header = `<h1>${title}</h1><p><strong>${h(guild.name)}</strong> · ${h(guild.edition)} · <a href="${h(link(path, lang))}">${t("Choose another guild", "Choisir une autre guilde")}</a></p>${guildToolsNav(lang, guild)}`;
      const hidden = `<input type="hidden" name="guild" value="${h(guild.id)}"><input type="hidden" name="edition" value="${h(guild.edition)}"><input type="hidden" name="lang" value="${lang}">`;
      const partial = result.truncated ? `<p class="notice">${t("Bounded preview: some older records or entries are omitted. Counts describe only the displayed sample.", "Aperçu limité : certains enregistrements anciens ou certaines entrées sont omis. Les comptes décrivent uniquement l'échantillon affiché.")}</p>` : "";
      const unknown = t("Unknown", "Inconnu");
      let body = "";
      if (path === "/me/crafters") {
        const data = result.data as CraftRow[];
        body = `<p>${t("Search the recipes members have scanned and synced. A match does not prove that the character is online or that materials are available.", "Recherchez les recettes relevées et synchronisées. Un résultat ne prouve pas que le personnage est en ligne ni que les composants sont disponibles.")}</p>`
          + `<form method="get" action="${path}">${hidden}<label for="recipe-q">${t("Item name, ID or WoW item link", "Nom, identifiant ou lien d'objet WoW")}</label><input id="recipe-q" name="q" maxlength="200" value="${h(q)}"><button class="button" type="submit">${t("Find crafters", "Trouver des artisans")}</button></form>`
          + `<p>${t("Enchantments use a negative spell ID. Results older than seven days are marked stale; refresh by opening the profession window and syncing the companion.", "Les enchantements utilisent un identifiant de sort négatif. Les relevés de plus de sept jours sont marqués anciens; ouvrez le métier puis synchronisez le compagnon pour actualiser.")}</p>`
          + table([t("Recipe", "Recette"), t("Character", "Personnage"), t("Realm", "Royaume"), t("Profession", "Métier"), t("Scanned (UTC)", "Relevé (UTC)")], data.map(row => [h(`${row.itemName} (#${row.itemKey})`), h(row.character), h(row.realm || unknown), h(row.profession), `${h(utc(row.scannedAt))}${ctx.now.getTime() - row.scannedAt.getTime() > 7 * 86_400_000 ? ` · ${t("Stale", "Ancien")}` : ""}`]))
          + (!data.length ? `<p>${q ? t("No known matching recipe. This is not proof that nobody in the guild can craft it.", "Aucune recette connue correspondante. Cela ne prouve pas qu'aucun membre ne peut la fabriquer.") : t("Enter a search to load recipes.", "Lancez une recherche pour charger les recettes.")}</p>` : "");
      } else if (path === "/me/teams") {
        const cores = result.data as TeamView[];
        const selected = cores.find(core => core.id === coreId);
        body = `<p>${t("Raid teams, schedules and linked characters. Bench and trial status are independent. Attendance remains on each member's account, across their linked characters.", "Équipes de raid, horaires et personnages liés. Les statuts remplaçant et essai sont indépendants. La présence reste attribuée au compte du membre, tous personnages liés confondus.")}</p>`
          + `<form method="get" action="${path}">${hidden}<label for="team-core">${t("Team", "Équipe")}</label><select id="team-core" name="core">${options([{ value: "", label: t("All team summaries", "Résumés de toutes les équipes") }, ...cores.map(core => ({ value: core.id, label: core.name }))], selected?.id ?? "")}</select><button class="button" type="submit">${t("Show", "Afficher")}</button></form>`;
        for (const core of selected ? [selected] : cores) {
          const missing = teamVacancies(core);
          body += `<section class="card"><h2><a href="${h(link(path, lang, { guild: guildId, edition: guild.edition, core: core.id }))}">${h(core.name)}</a></h2><p>${h(core.schedule || t("Schedule not recorded", "Horaire non enregistré"))}${core.timezone ? ` · ${h(core.timezone)}` : ""}</p><p>${t("Rostered", "Inscrits")}: ${core.members.length} · ${t("Bench", "Remplaçants")}: ${core.members.filter(row => row.bench).length} · ${t("Trial", "Essai")}: ${core.members.filter(row => row.trial).length}</p><p>${t("Open roster roles (configured targets)", "Rôles libres (objectifs configurés)")}: Tank ${missing.TANK ?? unknown} · ${t("Healer", "Soigneur")} ${missing.HEALER ?? unknown} · DPS ${missing.DPS ?? unknown}</p></section>`;
          if (selected) {
            body += table([t("Character", "Personnage"), t("Realm", "Royaume"), t("Role", "Rôle"), t("Status", "Statut"), t("Linked main", "Principal lié"), t("Backup characters", "Personnages de remplacement")], core.members.map(row => [row.characterId ? `<a href="${h(link("/me/history", lang, { guild: guildId, edition: guild.edition, character: row.characterId }))}">${h(row.name || unknown)}</a>` : h(row.name || unknown), h(row.realm || unknown), h(row.role), [row.bench ? t("Bench", "Remplaçant") : t("Core", "Titulaire"), ...(row.trial ? [t("Trial", "Essai")] : []), ...(!row.assigned ? [t("Character not assigned; linked main shown", "Personnage non affecté; principal lié affiché")] : [])].join(" · "), h(row.main || unknown), row.backups.map(h).join("<br>") || "—"]));
            const composition = teamComposition(core, guild.edition);
            body += `<h3>${t("Team composition", "Composition de l'équipe")}</h3><p>${t("Recorded classes of assigned, non-benched characters. Trials are included; backups and unassigned mains are excluded. This is a roster plan, not live attendance or proof of learned spells.", "Classes enregistrées des personnages affectés, hors remplaçants. Les essais sont inclus; les personnages de secours et principaux non affectés sont exclus. Il s'agit du plan d'effectif, pas d'une présence en direct ni d'une preuve de sorts appris.")}</p>`
              + table([t("Class", "Classe"), t("Count", "Nombre"), t("Assigned characters", "Personnages affectés")], composition.classes.map(([name, members]) => [h(teamClassLabel(name, lang)), String(members.length), members.map(h).join("<br>")]))
              + `<p>${t("Unknown assignments/classes", "Affectations/classes inconnues")}: ${composition.unknown} · ${t("Duplicate assignments excluded", "Doublons exclus")}: ${composition.duplicates}</p>`;
            if (composition.provisional) body += `<p>${t("Forever uses a provisional Classic baseline; confirm custom spells in game.", "Forever utilise une base Classic provisoire; confirmez les sorts personnalisés en jeu.")}</p>`;
            if (composition.buffs) body += `<h3>${t("Potential buffs", "Améliorations potentielles")}</h3><p>${t("Confirm spell availability and active buffs in the game's Ready page. Class presence alone does not establish level, talents, range or aura coverage.", "Confirmez les sorts disponibles et améliorations actives dans la page de préparation en jeu. La classe seule ne confirme ni niveau, ni talents, ni portée, ni effets actifs.")}</p>`
              + table([t("Buff", "Amélioration"), t("Potential providers", "Sources potentielles")], composition.buffs.map(buff => [h(t(buff.en, buff.fr)), buff.status === "potential" ? buff.providers.map(h).join("<br>") : buff.status === "unknown" ? unknown : t("No assigned class provider", "Aucune classe source affectée")]));
            else body += `<p>${t("Retail buff assumptions do not apply to this edition. Use the class composition above and verify spells and party coverage in game.", "Les améliorations Retail ne s'appliquent pas à cette édition. Utilisez la composition ci-dessus et vérifiez les sorts et la portée de groupe en jeu.")}</p>`;
          }
        }
        body += `<p>${t("Manage team changes through the Discord or companion tools. Role vacancies use each team’s configured targets.", "Gérez les changements via Discord ou le compagnon. Les rôles libres suivent les objectifs configurés de chaque équipe.")}</p>`;
      } else if (path === "/me/history") {
        const data = result.data as NonNullable<Awaited<ReturnType<GuildToolsStore["history"]>>>["data"];
        body = `<h2>${h(data.name)}</h2><p>${t("Member-wide history: these linked characters share attendance and point records in this guild. This does not identify which alt was played unless the original record says so.", "Historique du membre : ces personnages liés partagent les présences et les points dans cette guilde. Cela n'identifie pas l'alt joué si le relevé d'origine ne le précise pas.")}</p><ul>`
          + data.characters.map(row => `<li><a href="${h(link(path, lang, { guild: guildId, edition: guild.edition, character: row.id }))}">${h(row.name)} · ${h(row.realm)}</a> · ${row.main ? t("Main", "Principal") : t("Alt", "Secondaire")}</li>`).join("") + `</ul>`
          + table([t("Date (UTC)", "Date (UTC)"), t("Record", "Enregistrement"), t("Event / item", "Événement / objet"), t("Result", "Résultat"), t("Raid team", "Équipe de raid")], data.events.map(row => [h(utc(row.at)), row.kind === "attendance" ? t("Attendance", "Présence") : row.kind === "loot" ? t("Loot", "Butin") : t("Points", "Points"), h(row.title), h(row.detail), h(row.team || "—")]))
          + (!data.events.length ? `<p>${t("No recorded history yet.", "Aucun historique enregistré.")}</p>` : "");
      } else {
        const rows = filterGroupPosts(result.data as GroupView[], q, need);
        body = `<p>${t("Browse guild group posts. Open the original Discord post to sign up or change your role.", "Consultez les annonces de groupe de guilde. Ouvrez l'annonce Discord d'origine pour vous inscrire ou changer de rôle.")}</p>`
          + `<form method="get" action="${path}">${hidden}<div class="filters"><div><label for="group-q">${t("Dungeon or title", "Donjon ou titre")}</label><input id="group-q" name="q" value="${h(q)}" maxlength="200"></div><div><label for="group-need">${t("Needs role", "Rôle recherché")}</label><select id="group-need" name="need">${options([{ value: "", label: t("Any", "Tous") }, { value: "TANK", label: "Tank" }, { value: "HEALER", label: t("Healer", "Soigneur") }, { value: "DPS", label: "DPS" }], need)}</select></div><button class="button" type="submit">${t("Filter", "Filtrer")}</button></div></form>`
          + table([t("Group", "Groupe"), t("Levels", "Niveaux"), t("Signed up", "Inscrits"), t("Needed roles", "Rôles recherchés"), t("Posted (UTC)", "Publié (UTC)")], rows.map(row => [row.url ? `<a href="${h(row.url)}" rel="noreferrer">${h(row.title)}</a>` : h(row.title), `${row.minLevel ?? "—"}–${row.maxLevel ?? "—"}`, `${row.signedUp}/${row.size}`, row.missing ? `Tank ${row.missing.TANK} · ${t("Healer", "Soigneur")} ${row.missing.HEALER} · DPS ${row.missing.DPS}` : t("Any role", "Tous rôles"), h(utc(row.createdAt))]))
          + (!rows.length ? `<p>${t("No open group posts match.", "Aucune annonce ouverte correspondante.")}</p>` : "")
          + `<p>${t("Signups show the recorded group composition. Check the original post for the latest replies.", "Les inscriptions montrent la composition enregistrée. Consultez l'annonce d'origine pour les réponses récentes.")}</p>`;
      }
      return kit.page(200, title, header + partial + body, { noindex: true, languageParams: params });
    } catch {
      return kit.page(503, title, t("These records could not be loaded. Try again shortly; no data was changed.", "Impossible de charger ces données. Réessayez sous peu; aucune donnée n'a été modifiée."), { noindex: true });
    }
  };
  const meSection = async (ctx: WebContext) => ctx.account ? `<h2>${ctx.t("Guild tools", "Outils de guilde")}</h2><p>${[["crafters", ctx.t("Crafter search", "Recherche d'artisans")], ["teams", ctx.t("Raid teams", "Équipes de raid")], ["groups", ctx.t("Group posts", "Annonces de groupe")]].map(([path, label]) => `<a href="${h(link(`/me/${path}`, ctx.lang))}">${label}</a>`).join(" · ")}</p>` : "";
  return { route, meSection };
}
