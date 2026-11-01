import type { WebContext, WebRoute } from "./web-app.js";
import { checkCsrf, sameOrigin, sign, unsign, hashToken } from "./web-auth.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import { parsePlan, PLAN_KINDS, PlanningError, type PlanKind, type PlanPayload, type raidPlanningStore } from "./raid-planning.js";

const EMPTY: PlanPayload = { summary: "", assignments: "", preparation: "", resources: [], items: [] };
export function planningApproval(secret: string, session: string, user: string, raid: string, kind: string, expected: number, payload: PlanPayload, active: boolean, now: Date) {
  return sign(secret, JSON.stringify({ user, session: hashToken(session), raid, kind, expected, payload: hashToken(JSON.stringify(payload)), active, expires: now.getTime() + 600000 }));
}
export function verifyPlanningApproval(token: string, secret: string, session: string, user: string, raid: string, kind: string, expected: number, payload: PlanPayload, active: boolean, now: Date) {
  try { const raw = unsign(secret, token); if (!raw) return false; const p = JSON.parse(raw);
    return p.user === user && p.session === hashToken(session) && p.raid === raid && p.kind === kind && p.expected === expected
      && p.payload === hashToken(JSON.stringify(payload)) && p.active === active && p.expires > now.getTime() && p.expires <= now.getTime() + 600000;
  } catch { return false; }
}
function fields(payload: PlanPayload) { return { summary: payload.summary, assignments: payload.assignments, preparation: payload.preparation,
  resources: payload.resources.map(r => `${r.source} | ${r.url} | ${r.checked}`).join("\n"), items: payload.items.map(i => `${i.name} | ${i.perPerson} | ${i.fixed}`).join("\n") }; }
function display(payload: PlanPayload, ctx: WebContext) {
  const { t } = ctx;
  return `<p style="white-space:pre-wrap">${h(payload.summary)}</p><h3>${t("Assignments / decisions", "Affectations / décisions")}</h3><p style="white-space:pre-wrap">${h(payload.assignments || "—")}</p><h3>${t("Preparation", "Préparation")}</h3><p style="white-space:pre-wrap">${h(payload.preparation || "—")}</p>`
    + `<h3>${t("External evidence and resources", "Sources et ressources externes")}</h3><p>${t("Manual links, not independently verified. Dates are the author's last review; freshness is not proof of correctness.", "Liens manuels, non vérifiés indépendamment. Les dates indiquent la dernière révision par l’auteur; la fraîcheur ne prouve pas l’exactitude.")}</p><ul>${payload.resources.map(r => `<li><a href="${h(r.url)}" rel="noopener noreferrer" target="_blank">${h(r.source)}</a> · ${h(new URL(r.url).hostname)} · ${h(r.checked)}${Date.parse(r.checked) < ctx.now.getTime() - 30 * 86400000 ? ` · ${t("Review freshness", "Vérifier la fraîcheur")}` : ""}</li>`).join("") || `<li>${t("No sources supplied.", "Aucune source fournie.")}</li>`}</ul>`
    + (payload.items.length ? `<ul>${payload.items.map(i => `<li>${h(i.name)}: ${i.perPerson} ${t("per confirmed signup", "par inscription confirmée")} + ${i.fixed} ${t("fixed", "fixes")}</li>`).join("")}</ul>` : "");
}

export function createRaidPlanning(store: ReturnType<typeof raidPlanningStore>) {
  const path = "/me/raid-plans";
  const meSection = async (ctx: WebContext) => `<h2>${ctx.t("Raid preparation and catch-up", "Préparation et résumé des raids")}</h2><p><a href="${link(path, ctx.lang)}">${ctx.t("Playbooks, approved recaps and voluntary supplies", "Plans, résumés approuvés et provisions volontaires")}</a></p>`;
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== path) return null;
    if (!ctx.account) return kit.signInPrompt();
    if (!["GET", "HEAD", "POST"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD, POST" }, body: "" };
    const { t, lang } = ctx, user = ctx.account.discordUserId, title = t("Raid preparation and catch-up", "Préparation et résumé des raids");
    const guild = ctx.request.query.get("guild") ?? "", raid = ctx.request.query.get("raid") ?? "", kind = (ctx.request.query.get("kind") ?? "PLAYBOOK") as PlanKind;
    if (guild.length > 64 || raid.length > 64 || !PLAN_KINDS.includes(kind)) return kit.page(400, title, t("Invalid selection.", "Sélection invalide."), { noindex: true });
    if (ctx.request.method === "POST" && (!guild || !raid || !ctx.form || !ctx.auth || !ctx.sessionToken || !sameOrigin(ctx.request.headers, ctx.auth.siteUrl)
      || !checkCsrf(ctx.auth.sessionSecret, ctx.sessionToken, ctx.form.get("csrf") ?? undefined))) return kit.page(403, title, t("Reload this page and try again.", "Rechargez cette page et réessayez."), { noindex: true });
    try {
      if (!guild) {
        const rows = await store.guilds(user);
        return kit.page(200, title, `<h1>${title}</h1><ul>${rows.map(g => `<li><a href="${h(link(path, lang, { guild: g.id }))}">${h(g.name)} · ${h(g.edition)}</a></li>`).join("") || `<li>${t("No verified guild access. Check Discord and your membership, then refresh.", "Aucun accès de guilde vérifié. Vérifiez Discord et votre appartenance, puis actualisez.")}</li>`}</ul>`, { noindex: true });
      }
      if (!raid) {
        const rows = await store.list(user, guild);
        if (!rows) throw new PlanningError("access");
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Visible raids among the 60 most recently scheduled. Test raids are excluded.", "Raids visibles parmi les 60 plus récemment planifiés. Les raids de test sont exclus.")}</p><ul>${rows.map(r => `<li><a href="${h(link(path, lang, { guild, raid: r.id, kind }))}">${h(r.title)}</a> · ${h(r.scheduledAt.toISOString())}</li>`).join("") || `<li>${t("No accessible raids with a signup channel.", "Aucun raid accessible avec salon d’inscription.")}</li>`}</ul>`, { noindex: true });
      }
      const data = await store.load(user, guild, raid, kind); if (!data) throw new PlanningError("access");
      const action = h(link(path, lang, { guild, raid, kind })), csrf = `<input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}">`;
      let draft: PlanPayload | null = null, proof = "", active = true;
      const expected = data.current?.revision ?? 0;
      if (ctx.request.method === "POST") {
        const form = ctx.form!, intent = form.get("intent");
        if (intent === "pledge") {
          if (kind !== "SUPPLIES" || form.get("consent") !== "yes") throw new PlanningError("consent");
          const numbers = ["item", "quantity", "delivered"].map(k => form.get(k) ?? "");
          if (numbers.some(v => !/^\d{1,4}$/.test(v))) throw new PlanningError("quantity");
          await store.pledge(user, guild, raid, form.get("revision") ?? "", Number(numbers[0]), Number(numbers[1]), Number(numbers[2]));
          return kit.redirect(link(path, lang, { guild, raid, kind }));
        }
        if (!data.officer || !["preview", "publish"].includes(intent ?? "")) throw new PlanningError("access");
        draft = parsePlan(kind, Object.fromEntries(["summary", "assignments", "preparation", "resources", "items"].map(k => [k, form.get(k) ?? ""])), ctx.now);
        active = form.get("active") !== "no";
        if (intent === "publish") {
          if (form.get("confirm") !== "yes" || !verifyPlanningApproval(form.get("approval") ?? "", ctx.auth!.sessionSecret, ctx.sessionToken!, user, raid, kind, expected, draft, active, ctx.now)) throw new PlanningError("stale");
          await store.publish(user, guild, raid, kind, expected, draft, active);
          return kit.redirect(link(path, lang, { guild, raid, kind }));
        }
        proof = planningApproval(ctx.auth!.sessionSecret, ctx.sessionToken!, user, raid, kind, expected, draft, active, ctx.now);
      }
      const current = data.current?.payload as unknown as PlanPayload | undefined;
      const labels: Record<PlanKind, string> = { PLAYBOOK: t("Playbook", "Plan de raid"), RECAP: t("Catch-up", "Résumé"), SUPPLIES: t("Supplies", "Provisions") };
      let body = `<h1>${h(data.raid.title)} · ${labels[kind]}</h1><p>${h(data.guild.name)} · ${h(data.guild.edition)} · ${h(data.raid.scheduledAt.toISOString())}</p><nav>${PLAN_KINDS.map(k => `<a href="${h(link(path, lang, { guild, raid, kind: k }))}">${labels[k]}</a>`).join(" · ")}</nav>`
        + `<p>${t("Only explicitly approved content is shared with current members who can view this raid's signup channel. Private raid notes, voice and absence judgments are never imported here.", "Seul le contenu explicitement approuvé est partagé avec les membres actuels ayant accès au salon d’inscription. Les notes privées, conversations vocales et jugements d’absence ne sont jamais importés ici.")}</p>`;
      body += current && data.current?.active ? `<h2>${t("Approved revision", "Version approuvée")} ${data.current.revision}</h2><p>${h(data.current.approvedAt.toISOString())}</p>${display(current, ctx)}` : `<p>${t("No active approved content. An officer can prepare a preview below.", "Aucun contenu approuvé actif. Un officier peut préparer un aperçu ci-dessous.")}</p>`;
      if (kind === "SUPPLIES" && current && data.current?.active) {
        body += `<p>${t("Targets use current confirmed signups only; tentative and waitlisted members are excluded. Pledges are voluntary, never loot points. Totals include current members; delivered amounts are self-reported, not verified inventory. A new plan revision requires fresh pledges.", "Les objectifs utilisent seulement les inscriptions confirmées actuelles. Les engagements sont volontaires, sans points de butin. Les totaux incluent les membres actuels; les livraisons sont déclarées, non vérifiées. Une nouvelle version nécessite de nouveaux engagements.")} ${t("Confirmed", "Confirmés")}: ${data.confirmed}</p>`;
        current.items.forEach((item, index) => {
          const total = data.totals.find(r => r.itemIndex === index), mine = data.pledges.find(r => r.itemIndex === index);
          const target = item.fixed + item.perPerson * data.confirmed, pledged = total?._sum.quantity ?? 0, delivered = total?._sum.delivered ?? 0;
          body += `<section><h3>${h(item.name)}</h3><p>${t("Target / pledged / delivered / still needed", "Objectif / promis / livré / reste à livrer")}: ${target} / ${pledged} / ${delivered} / ${Math.max(0, target - delivered)}</p><p><a href="${h(link("/me/crafters", lang, { guild, q: item.name }))}">${t("Find recorded crafters (officer access)", "Trouver les artisans enregistrés (officiers)")}</a> · ${t("Members can use /craft request and /craft claim in Discord.", "Les membres peuvent utiliser /craft request et /craft claim dans Discord.")}</p>`;
          if (["PLANNED", "ACTIVE"].includes(data.raid.status)) body += `<form method="post" action="${action}">${csrf}<input type="hidden" name="intent" value="pledge"><input type="hidden" name="revision" value="${h(data.current!.id)}"><input type="hidden" name="item" value="${index}"><label for="q${index}">${t("My promised total (0 withdraws)", "Mon total promis (0 retire)")}</label><input id="q${index}" name="quantity" type="number" min="0" max="9999" value="${mine?.quantity ?? 0}" required><label for="d${index}">${t("Already delivered", "Déjà livré")}</label><input id="d${index}" name="delivered" type="number" min="0" max="9999" value="${mine?.delivered ?? 0}" required><label><input type="checkbox" name="consent" value="yes" required>${t("Share these amounts in the guild totals. I can correct or withdraw them.", "Partager ces montants dans les totaux de guilde. Je peux les corriger ou retirer.")}</label><button class="button">${t("Save my pledge", "Enregistrer mon engagement")}</button></form>`;
          body += "</section>";
        });
      }
      if (data.officer) {
        body += `<h2>${t("Bench rotation advice — officer decision", "Conseil de rotation — décision de l’officier")}</h2><p>${t("Among available confirmed/waitlisted players in each role, more recorded benches in the last 8 completed raids of this same core receive earlier suggestions. Ties use signup time, then stable member identity. Missing history and absences do not subtract credit. This is not a performance ranking and never changes signups, attendance, points or loot. Override any suggestion through the existing raid controls after discussing availability and composition.", "Parmi les joueurs confirmés/en attente de chaque rôle, ceux ayant davantage de mises au banc enregistrées dans les 8 derniers raids terminés du même core sont proposés en premier. Les égalités suivent l’heure d’inscription, puis l’identité stable. L’historique manquant et les absences ne retirent rien. Ce n’est pas un classement de performance et aucun point, butin ou inscription n’est modifié. Décidez avec les contrôles habituels après discussion des disponibilités et de la composition.")}</p>`;
        if (!data.rotation) body += `<p>${t("No core is attached; comparable team history is unavailable.", "Aucun core associé; historique comparable indisponible.")}</p>`;
        else if (data.rotation.limited) body += `<p>${t("More than 200 candidates; advice withheld because the candidate list is incomplete.", "Plus de 200 candidats; conseils masqués car la liste est incomplète.")}</p>`;
        else {
          body += `<p>${t("Completed raids in history", "Raids terminés dans l’historique")}: ${data.rotation.historyCount}. ${t("No recorded history means unknown, not poor attendance.", "Un historique absent signifie inconnu, pas une mauvaise présence.")}</p>`;
          for (const role of data.rotation.roles) body += `<h3>${h(role.role)} · ${t("Configured seats", "Places configurées")}: ${role.cap ?? t("Not set", "Non défini")}</h3><ul>${role.rows.map(r => `<li>${h(r.name)} · ${t("Recorded benches", "Mises au banc enregistrées")}: ${r.benches} · ${t("Raids with a record", "Raids avec relevé")}: ${r.recorded} · ${r.suggested === null ? t("No capacity-based suggestion", "Aucun conseil sans capacité") : r.suggested ? t("Suggested seat", "Place suggérée") : t("Discuss standby", "Discuter du remplacement")}</li>`).join("") || `<li>${t("No available candidates for this role.", "Aucun candidat disponible pour ce rôle.")}</li>`}</ul>`;
        }
        const editing = fields(draft ?? current ?? EMPTY);
        if (draft) body += `<section class="card"><h2>${t("Preview — not saved", "Aperçu — non enregistré")}</h2><p>${active ? t("Publish to members", "Publier aux membres") : t("Withdraw active content", "Retirer le contenu actif")}</p>${display(draft, ctx)}<form method="post" action="${action}">${csrf}${Object.entries(editing).map(([key, value]) => `<input type="hidden" name="${key}" value="${h(value)}">`).join("")}<input type="hidden" name="active" value="${active ? "yes" : "no"}"><input type="hidden" name="intent" value="publish"><input type="hidden" name="approval" value="${h(proof)}"><label><input type="checkbox" name="confirm" value="yes" required>${t("I approve this exact revision for the stated audience.", "J’approuve cette version exacte pour ce public.")}</label><button class="button">${t("Confirm approved revision", "Confirmer la version approuvée")}</button></form></section>`;
        body += `<h2>${t("Officer editor", "Éditeur d’officier")}</h2><p>${t("Each approval creates an immutable revision. To undo, copy a previous revision into this editor and approve it again. Withdrawing hides current content from members; officer history remains. Maximum 20 recent revisions shown.", "Chaque approbation crée une version immuable. Pour annuler, recopiez une ancienne version et approuvez-la. Le retrait masque le contenu aux membres; l’historique des officiers reste. Les 20 dernières versions sont affichées.")}</p><form method="post" action="${action}">${csrf}<input type="hidden" name="intent" value="preview">`;
        const names = { summary: t("Progress / purpose", "Progression / objectif"), assignments: t("Assignments / decisions", "Affectations / décisions"), preparation: t("Preparation", "Préparation"), resources: t("Sources: source label | HTTPS URL | review date YYYY-MM-DD (one per line)", "Sources : nom | URL HTTPS | date AAAA-MM-JJ (une par ligne)"), items: t("Supplies: item | quantity per confirmed signup | fixed quantity (one per line)", "Provisions : objet | quantité par inscription confirmée | quantité fixe (une par ligne)") };
        for (const key of Object.keys(editing) as (keyof typeof editing)[]) if (key !== "items" || kind === "SUPPLIES") body += `<label for="plan-${key}">${names[key]}</label><textarea id="plan-${key}" name="${key}" rows="4" maxlength="${key === "resources" || key === "items" ? 6000 : 3000}" ${key === "summary" || key === "items" ? "required" : ""}>${h(editing[key])}</textarea>`;
        body += `<label><input type="checkbox" name="active" value="no">${t("Withdraw active content instead of publishing", "Retirer le contenu actif au lieu de publier")}</label><button class="button">${t("Preview changes", "Aperçu des changements")}</button></form><h2>${t("Revision history", "Historique des versions")}</h2>`;
        for (const row of data.history) body += `<details><summary>${row.revision} · ${h(row.approvedAt.toISOString())} · ${row.active ? t("Approved", "Approuvé") : t("Withdrawn", "Retiré")}</summary>${display(row.payload as unknown as PlanPayload, ctx)}</details>`;
      }
      return kit.page(200, title, body, { noindex: true, languageParams: { guild, raid, kind } });
    } catch (error) {
      return kit.page(error instanceof PlanningError ? 409 : 503, title, error instanceof PlanningError
        ? t("The request could not be applied. Check access, field formats and quantities, then reload and preview again; another officer may have changed the plan. Nothing from this request was published.", "La demande n’a pas pu être appliquée. Vérifiez l’accès, les formats et quantités, puis rechargez et prévisualisez; un autre officier a peut-être modifié le plan. Rien de cette demande n’a été publié.")
        : t("Planning is unavailable. Retry when Discord and Guilded are reachable.", "La planification est indisponible. Réessayez lorsque Discord et Guilded sont accessibles."), { noindex: true });
    }
  };
  return { route, meSection };
}
