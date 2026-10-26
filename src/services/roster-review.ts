import type { RosterDashboardStore, RosterSnapshot, RosterCharacter } from "./roster-dashboard-store.js";
import type { WebRoute } from "./web-app.js";
import { checkCsrf, sameOrigin, sign, unsign, hashToken } from "./web-auth.js";
import type { RosterPlanWriter } from "./roster-plan-store.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import { guildToolsNav } from "./guild-tools-pages.js";

// Narrow column contracts: Guilded or GRM's English Name/Main/Alt/Realm Name export.
// GRM source: TheGeneticsGuy/Guild-Roster-Manager, Retail/GRM_Export.lua.
// Never accept a full SavedVariables file or unrelated/private-note columns.
// Plans never establish ownership. Applying requires a signed, expiring preview
// and a second complete snapshot check inside the database transaction.
export function parseMainPlan(csv: string): { character: string; realm: string; main: boolean | null }[] {
  if (csv.length > 8_000) throw new Error("size");
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
  const input = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  // Detect only from an exact allowlisted header, never from member text. GRM
  // offers multi-character delimiters and a literal backslash-t as well as CSV.
  const headerLine = input.split("\n", 1)[0]!;
  const delimiters = [",", ";", "~", "::", "||", "\\t", "\t"];
  const delimiter = delimiters.find(separator => {
    const header = headerLine.split(separator).map(value => value.trim().replace(/^"([^"]*)"$/, "$1").toLowerCase()).join(",");
    return header === "name,main/alt,realm name" || separator === "," && header === "character,realm,main";
  });
  if (!delimiter) throw new Error("header");
  const endField = () => { row.push(field.trim()); field = ""; closed = false; };
  const endRow = () => { endField(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > 51) throw new Error("rows"); };
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (input.startsWith(delimiter, i)) { endField(); i += delimiter.length - 1; }
    else if (char === "\n") endRow();
    else if (char === '"' && !field && !closed) quoted = true;
    else if (char === '"' || closed) throw new Error("quotes");
    else field += char;
  }
  if (quoted) throw new Error("quotes");
  endRow();
  const header = rows.shift()?.map(value => value.toLowerCase()).join(",");
  const grm = header === "name,main/alt,realm name";
  if ((!grm && header !== "character,realm,main") || !rows.length) throw new Error("header");
  return rows.map(values => {
    const character = values[0] ?? "", realm = values[grm ? 2 : 1] ?? "", main = values[grm ? 1 : 2] ?? "";
    if (values.length !== 3 || !character || character.length > 80 || realm.length > 80 || [...character + realm].some(char => char.charCodeAt(0) < 32 || char === "|") || !(grm ? /^(main|alt|)$/i : /^(true|false)$/i).test(main)) throw new Error("row");
    return { character, realm, main: grm && !main ? null : /^(main|true)$/i.test(main) };
  });
}
export type PlanStatus = "change" | "unchanged" | "unknown" | "unclaimed" | "duplicate" | "conflict" | "realm" | "unspecified";
export interface MainPlanRow { character: string; realm: string; current: boolean | null; main: boolean | null; status: PlanStatus; characterId?: string }
export function mainPlanRevision(snapshot: RosterSnapshot): string {
  return hashToken(JSON.stringify([snapshot.guild, snapshot.truncated, snapshot.characters.map(row =>
    [row.key, row.characterId, row.name, row.realm, row.memberId, row.isMain, row.updatedAt?.toISOString()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]));
}
export function mainPlanApproval(snapshot: RosterSnapshot, csv: string, user: string, session: string, secret: string, now: Date): string {
  return sign(secret, JSON.stringify({ kind: "main-plan-v1", user, session: hashToken(session), guild: snapshot.guild.id,
    csv: hashToken(csv), revision: mainPlanRevision(snapshot), expires: now.getTime() + 5 * 60_000 }));
}
export function approvedMainPlan(token: string, snapshot: RosterSnapshot, csv: string, user: string, session: string, secret: string, now: Date): boolean {
  try {
    const raw = unsign(secret, token); if (!raw) return false;
    const p = JSON.parse(raw);
    return p.kind === "main-plan-v1" && p.user === user && p.session === hashToken(session) && p.guild === snapshot.guild.id
      && p.csv === hashToken(csv) && p.revision === mainPlanRevision(snapshot) && typeof p.expires === "number"
      && p.expires > now.getTime() && p.expires <= now.getTime() + 5 * 60_000;
  } catch { return false; }
}
export function reviewMainPlan(snapshot: RosterSnapshot, csv: string): MainPlanRow[] {
  if (snapshot.truncated) throw new Error("partial");
  const entries = parseMainPlan(csv);
  const normalize = (name: string) => name.normalize("NFC").toLowerCase();
  const matches = (row: RosterCharacter, entry: typeof entries[number]) => normalize(row.name) === normalize(entry.character)
    && (snapshot.guild.edition === "forever" && !entry.realm || normalize(row.realm) === normalize(entry.realm));
  const plans: (MainPlanRow & { characterRow: RosterCharacter | undefined })[] = entries.map(entry => {
    const candidates = snapshot.characters.filter(row => matches(row, entry));
    const character = candidates.length === 1 ? candidates[0] : undefined;
    const status: PlanStatus = snapshot.guild.edition !== "forever" && !entry.realm ? "realm" : !character ? "unknown" : !character.memberId ? "unclaimed" : entry.main === null ? "unspecified" : character.isMain === entry.main ? "unchanged" : "change";
    return { ...entry, current: character?.isMain ?? null, status, characterRow: character };
  });
  const seen = new Map<string, typeof plans>();
  for (const row of plans) {
    if (!row.characterRow) continue;
    const key = row.characterRow.key;
    const prior = seen.get(key) ?? []; prior.push(row); seen.set(key, prior);
  }
  for (const duplicates of seen.values()) if (duplicates.length > 1) for (const row of duplicates) row.status = "duplicate";
  const members = new Set(plans.flatMap(row => row.characterRow?.memberId ? [row.characterRow.memberId] : []));
  for (const memberId of members) {
    const memberPlans = plans.filter(row => row.characterRow?.memberId === memberId);
    const blocked = memberPlans.some(row => !["change", "unchanged"].includes(row.status));
    const finalMains = snapshot.characters.filter(row => row.memberId === memberId && (memberPlans.find(plan => plan.characterRow?.key === row.key)?.main ?? row.isMain)).length;
    if (blocked || finalMains !== 1) for (const row of memberPlans) if (["change", "unchanged"].includes(row.status)) row.status = "conflict";
  }
  return plans.map(({ character, realm, current, main, status, characterRow }) => ({ character, realm, current, main, status, ...(characterRow?.characterId ? { characterId: characterRow.characterId } : {}) }));
}

export function createRosterReview(store: RosterDashboardStore, writer?: RosterPlanWriter): WebRoute {
  return async (ctx, kit) => {
    if (ctx.request.path !== "/me/roster/review") return null;
    if (!["GET", "HEAD", "POST"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD, POST" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    const title = t("Main/alt change review", "Révision principal/secondaire");
    if (ctx.request.method === "POST" && (!ctx.auth || !ctx.form || !sameOrigin(ctx.request.headers, ctx.auth.siteUrl) || !checkCsrf(ctx.auth.sessionSecret, ctx.sessionToken, ctx.form.get("csrf") ?? undefined))) return kit.page(403, title, t("Reload this page and try again.", "Rechargez cette page et réessayez."), { noindex: true });
    const guildId = ctx.request.query.get("guild") ?? "";
    if (!guildId || guildId.length > 64) return kit.redirect(link("/me/roster", lang));
    try {
      const snapshot = await store.load(ctx.account.discordUserId, guildId);
      if (!snapshot) return kit.page(403, title, t("Current officer access is required.", "Un accès d'officier actuel est requis."), { noindex: true });
      if (snapshot.truncated) return kit.page(409, title, t("A complete roster is required to review account-wide main changes.", "Un effectif complet est requis pour vérifier les principaux du compte."), { noindex: true });
      const csv = ctx.form?.get("plan") ?? "";
      let rows: MainPlanRow[] = [], invalid = false;
      if (ctx.request.method === "POST") { try { rows = reviewMainPlan(snapshot, csv); } catch { invalid = true; } }
      if (ctx.request.method === "POST" && ctx.form?.get("intent") === "apply") {
        if (!writer || invalid || !rows.some(row => row.status === "change") || rows.some(row => !["change", "unchanged"].includes(row.status))
          || ctx.form.get("confirm") !== "APPLY" || !ctx.auth || !ctx.sessionToken
          || !approvedMainPlan(ctx.form.get("approval") ?? "", snapshot, csv, ctx.account.discordUserId, ctx.sessionToken, ctx.auth.sessionSecret, ctx.now)) {
          return kit.page(409, title, t("This confirmation is missing, expired or stale. Review the plan again. Nothing was changed.", "La confirmation est absente, expirée ou périmée. Révisez le plan. Rien n'a été modifié."), { noindex: true });
        }
        try {
          const result = await writer.apply(ctx.account.discordUserId, guildId, csv, mainPlanRevision(snapshot));
          return kit.page(200, title, `<h1>${title}</h1><p>${t("Main/alt changes saved", "Changements principal/secondaire enregistrés")}: ${result.changes}</p><p>${t("Audit receipt", "Référence d'audit")}: ${h(result.auditId)}</p><p>${t("Account ownership and EP/GP balances are unchanged.", "Les propriétaires des comptes et les soldes EP/GP sont inchangés.")}</p><a href="${h(link("/me/roster", lang, { guild: guildId, edition: snapshot.guild.edition }))}">${t("View roster", "Voir l'effectif")}</a>`, { noindex: true });
        } catch {
          return kit.page(409, title, t("The plan could not be applied. Check the current roster and audit history before retrying; review a fresh plan.", "Le plan n'a pas pu être appliqué. Vérifiez l'effectif et l'historique d'audit avant de réessayer; révisez un nouveau plan."), { noindex: true });
        }
      }
      const approval = writer && !invalid && rows.some(row => row.status === "change") && rows.every(row => ["change", "unchanged"].includes(row.status)) && ctx.auth && ctx.sessionToken
        ? mainPlanApproval(snapshot, csv, ctx.account.discordUserId, ctx.sessionToken, ctx.auth.sessionSecret, ctx.now) : null;
      if (!invalid && rows.length && ctx.form?.get("intent") === "receipt") return {
        status: 200, headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="guilded-main-review.json"' },
        body: JSON.stringify({ format: "guilded-main-review-v1", createdAt: ctx.now.toISOString(), guild: snapshot.guild,
          previewOnly: true, applied: false, completeRoster: true,
          proposedChanges: rows.filter(row => row.status === "change").length,
          blockedRows: rows.filter(row => !["change", "unchanged"].includes(row.status)).length,
          instructions: "Review receipt only. Revalidate against current membership before using existing character tools. This file cannot be applied or used as an account-ownership claim.", rows }, null, 2)
      };
      const labels: Record<PlanStatus, string> = {
        change: t("Proposed change", "Changement proposé"), unchanged: t("Already matches", "Déjà identique"), unknown: t("Unknown or ambiguous character", "Personnage inconnu ou ambigu"),
        unclaimed: t("Character is not linked", "Personnage non lié"), duplicate: t("Duplicate character in plan", "Personnage répété"), conflict: t("Plan must leave exactly one main per linked member", "Le plan doit laisser exactement un principal par membre lié"), realm: t("Realm is required", "Royaume requis"), unspecified: t("Source has no main/alt designation", "La source ne précise pas principal/secondaire")
      };
      const status = (value: boolean | null) => value === null ? t("Unknown", "Inconnu") : value ? t("Main", "Principal") : t("Alt", "Secondaire");
      return kit.page(invalid ? 400 : 200, title, `<h1>${title}</h1><p><strong>${h(snapshot.guild.name)}</strong> · ${h(snapshot.guild.edition)}</p>${guildToolsNav(lang, snapshot.guild)}`
        + `<p class="notice">${writer ? t("Review the complete plan, then type APPLY to confirm within five minutes. Only main/alt designations of already-linked characters change; ownership, ranks, notes and EP/GP stay unchanged.", "Révisez le plan complet, puis tapez APPLY pour confirmer dans les cinq minutes. Seul le statut principal/secondaire des personnages déjà liés change; propriétaires, rangs, notes et EP/GP sont conservés.") : t("Preview only. This tool cannot change characters, account links, guild ranks or notes. Use the existing character tools after reviewing the complete plan.", "Aperçu uniquement. Cet outil ne modifie ni personnages, ni liens de compte, ni rangs, ni notes. Utilisez les outils de personnages existants après révision du plan complet.")}</p>`
        + `<p>${t("Paste up to 50 rows with exactly these CSV columns: character,realm,main. Use full display names and true/false. Include both the old and new main when switching.", "Collez au plus 50 lignes CSV avec exactement : character,realm,main. Utilisez les noms complets et true/false. Incluez l'ancien et le nouveau principal lors d'un changement.")}</p>`
        + `<details><summary>${t("Import a GRM main/alt export for review", "Réviser un export principal/secondaire GRM")}</summary><p>${t("Select only Name, Main/Alt and Realm Name in GRM's current-member export, with English headers and Main/Alt values. Comma, semicolon, tilde, double-colon, double-pipe and tab delimiters are detected from the header. Blank status stays unknown. Preserve special characters; review up to 50 rows. Notes, ranks, GUIDs, logs and SavedVariables are not accepted.", "Sélectionnez uniquement Name, Main/Alt et Realm Name dans l'export des membres actuels GRM, avec en-têtes anglais et valeurs Main/Alt. Virgule, point-virgule, tilde, double deux-points, double barre et tabulation sont détectés dans l'en-tête. Un statut vide reste inconnu. Conservez les caractères spéciaux; révisez au plus 50 lignes. Notes, rangs, GUID, journaux et SavedVariables sont refusés.")}</p></details>`
        + (invalid ? `<p role="alert">${t("Invalid CSV. Check the selected format, column headers, values and the 50-row / 8,000-character limits.", "CSV invalide. Vérifiez le format, les en-têtes, les valeurs et les limites de 50 lignes / 8 000 caractères.")}</p>` : "")
        + `<form method="post" action="${h(link("/me/roster/review", lang, { guild: guildId, edition: snapshot.guild.edition }))}"><input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}"><label for="main-plan">CSV</label><textarea id="main-plan" name="plan" maxlength="8000" rows="10" required>${h(csv.slice(0, 8_000))}</textarea><button class="button" type="submit">${t("Review changes", "Vérifier les changements")}</button>${rows.length ? ` <button class="button" type="submit" name="intent" value="receipt">${t("Download review receipt", "Télécharger le bilan de révision")}</button>` : ""}</form>`
        + (rows.length ? `<h2>${t("Review result — nothing saved", "Résultat — rien enregistré")}</h2><div class="table-wrap"><table><thead><tr>${[t("Character", "Personnage"), t("Realm", "Royaume"), t("Current", "Actuel"), t("Proposed", "Proposé"), t("Result", "Résultat")].map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr><td>${h(row.character)}</td><td>${h(row.realm)}</td><td>${status(row.current)}</td><td>${status(row.main)}</td><td>${labels[row.status]}</td></tr>`).join("")}</tbody></table></div>` : "")
        + (approval ? `<form method="post" action="${h(link("/me/roster/review", lang, { guild: guildId, edition: snapshot.guild.edition }))}"><input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}"><input type="hidden" name="intent" value="apply"><input type="hidden" name="approval" value="${h(approval)}"><input type="hidden" name="plan" value="${h(csv)}"><label for="main-confirm">${t("Type APPLY to confirm this reviewed plan", "Tapez APPLY pour confirmer ce plan révisé")}</label><input id="main-confirm" name="confirm" required maxlength="5" autocomplete="off"><button class="button" type="submit">${t("Apply changes", "Appliquer les changements")}</button></form>` : ""), { noindex: true, languageParams: { guild: guildId, edition: snapshot.guild.edition } });
    } catch { return kit.page(503, title, t("The roster could not be loaded. Nothing was changed.", "Impossible de charger l'effectif. Rien n'a été modifié."), { noindex: true }); }
  };
}
