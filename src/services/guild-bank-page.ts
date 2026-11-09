import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebRoute } from "./web-app.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { lineChartSvg } from "./stats-page.js";
import { goldText, loadGuildBank, summarizeLedger } from "./guild-bank.js";
import { bankItems, itemUrl, lowStock, qualityColor, searchBankItems } from "./guild-bank-member.js";

// 9.0: the read-only Guild bank page (/me/guild-bank) on the guild tools site: what the bank held
// when someone last opened it, the gold over time, and the ledger (who deposited or withdrew what,
// when). Officers only, with the same check as the Statistics page. No script, inline SVG chart.
// 9.1 (docs/plans/GUILD_BANK.md): members see the contents too, with a search, unless officers
// turned member search off (/bank settings); the gold chart, the ledger and who moved what stay
// officers only. Item names link to Wowhead in their quality colour.

type T = (en: string, fr: string) => string;
type Bank = Awaited<ReturnType<typeof loadGuildBank>>;
interface TabRow { tab: number; name: string; items: { id: number; name: string; count: number; q?: number }[] }
type Targets = { itemId: number; itemName: string; minCount: number }[];

/** An item name linked to its Wowhead page, in its quality colour when known. */
export function itemLinkHtml(id: number, name: string, quality?: number): string {
  const color = qualityColor(quality);
  return `<a class="bank-item" href="${h(itemUrl(id))}" rel="noopener" target="_blank"${color ? ` style="color:${color}"` : ""}>${h(name)}</a>`;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

const TYPE_WORDS: Record<string, [string, string]> = {
  deposit: ["deposited", "a déposé"], withdraw: ["withdrew", "a retiré"], move: ["moved", "a déplacé"],
  repair: ["repaired with", "a réparé avec"], buytab: ["bought a tab for", "a acheté un onglet pour"], withdrawfortab: ["paid for a tab", "a payé un onglet"]
};
const verb = (type: string, t: T) => { const w = TYPE_WORDS[type.toLowerCase()]; return w ? t(w[0], w[1]) : h(type); };

export function guildBankBody(bank: Bank, t: T, view: { officer?: boolean; query?: string; targets?: Targets } = { officer: true }): string {
  const parts: string[] = [];
  const officer = view.officer !== false;
  if (!bank.contents && !bank.gold.length && !bank.ledger.length) {
    return `<p>${t("Nothing yet. The ledger fills in when someone with access to the guild bank opens it with Guilded on, and their companion (or a guildmate's) syncs.",
      "Rien pour l'instant. Le registre se remplit quand quelqu'un ayant accès à la banque de guilde l'ouvre avec Guilded, puis que son compagnon (ou celui d'un membre) synchronise.")}</p>`;
  }
  if (bank.contents) {
    const tabs = (Array.isArray(bank.contents.tabs) ? bank.contents.tabs : []) as unknown as TabRow[];
    parts.push(`<h2>${t("Contents", "Contenu")}</h2><p>${t("Last seen", "Vu le")} ${h(when(bank.contents.observedAt))} UTC · ${t("Gold", "Or")}: <strong>${h(goldText(bank.contents.money))}</strong></p>`);
    const all = bankItems(tabs);
    const low = lowStock(all, view.targets ?? []);
    if (low.length) {
      parts.push(`<h3>${t("Below minimum", "Sous le minimum")}</h3><ul>${low.map((row) => `<li>${itemLinkHtml(row.itemId, row.itemName)}: ${row.have} / ${row.min}</li>`).join("")}</ul>`);
    }
    const query = (view.query ?? "").trim();
    if (query) {
      const hits = searchBankItems(all, query);
      parts.push(`<h3>${t("Search", "Recherche")}: ${h(query)}</h3>` + (hits.length
        ? `<table><thead><tr><th>${t("Item", "Objet")}</th><th>${t("Count", "Quantité")}</th><th>${t("Tab", "Onglet")}</th></tr></thead><tbody>${hits.slice(0, 100).map((i) => `<tr><td>${itemLinkHtml(i.id, i.name, i.quality)}</td><td>${i.count}</td><td>${i.tabs.map((tab) => h(tab.name)).join(", ")}</td></tr>`).join("")}</tbody></table>`
        : `<p>${t("Not in the bank.", "Pas dans la banque.")}</p>`));
    }
    for (const tab of tabs) {
      const items = [...(tab.items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      parts.push(`<details${tabs.length <= 2 ? " open" : ""}><summary><strong>${h(tab.name)}</strong> · ${items.length} ${t("item(s)", "objet(s)")}</summary>`
        + (items.length ? `<table><thead><tr><th>${t("Item", "Objet")}</th><th>${t("Count", "Quantité")}</th></tr></thead><tbody>${items.map((i) => `<tr><td>${itemLinkHtml(i.id, i.name, i.q)}</td><td>${i.count}</td></tr>`).join("")}</tbody></table>` : `<p>${t("Empty.", "Vide.")}</p>`)
        + `</details>`);
    }
  }
  if (!officer) return parts.join("") || `<p>${t("Nothing yet.", "Rien pour l'instant.")}</p>`;
  if (bank.gold.length) {
    parts.push(lineChartSvg(bank.gold.map((p) => day(p.at)), [{ label: t("Gold", "Or"), values: bank.gold.map((p) => Number(p.money / 10000n)), color: "#c9a227" }], t("Gold over time", "Or au fil du temps")));
  }
  if (bank.ledger.length) {
    const people = summarizeLedger(bank.ledger);
    parts.push(`<h2>${t("Who moved what", "Qui a déplacé quoi")}</h2><table><thead><tr><th>${t("Member", "Membre")}</th><th>${t("Gold in", "Or déposé")}</th><th>${t("Gold out", "Or retiré")}</th><th>${t("Items in", "Objets déposés")}</th><th>${t("Items out", "Objets retirés")}</th></tr></thead><tbody>`
      + people.map((p) => `<tr><td>${h(p.actor)}</td><td>${p.deposited ? h(goldText(p.deposited)) : ""}</td><td>${p.withdrawn ? h(goldText(p.withdrawn)) : ""}</td><td>${p.itemsIn || ""}</td><td>${p.itemsOut || ""}</td></tr>`).join("") + `</tbody></table>`);
    parts.push(`<h2>${t("Ledger", "Registre")}</h2><table><thead><tr><th>${t("When (UTC, about)", "Quand (UTC, environ)")}</th><th>${t("Member", "Membre")}</th><th>${t("What", "Quoi")}</th></tr></thead><tbody>`
      + bank.ledger.map((row) => {
        const what = row.kind === "money" ? h(goldText(row.amount)) : `${row.itemId ? itemLinkHtml(row.itemId, row.itemName ?? `#${row.itemId}`) : h(row.itemName ?? "?")} ×${row.count ?? 1}${row.tab ? ` (${t("tab", "onglet")} ${row.tab}${row.tab2 ? ` → ${row.tab2}` : ""})` : ""}`;
        return `<tr><td>${h(when(row.at))}</td><td>${h(row.actor)}</td><td>${verb(row.type, t)} ${what}</td></tr>`;
      }).join("") + `</tbody></table>`
      + `<p>${t("Times are about an hour accurate: the game gives each line's age in hours. The same line uploaded by several members is shown once.",
        "Les heures sont précises à environ une heure près : le jeu donne l'âge de chaque ligne en heures. Une même ligne envoyée par plusieurs membres n'apparaît qu'une fois.")}</p>`);
  }
  return parts.join("");
}

export function createGuildBankPage(database: PrismaClient, access: GuildDashboardAccess, memberAccess?: GuildDashboardAccess): { route: WebRoute } {
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== "/me/guild-bank") return null;
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    const title = t("Guild bank", "Banque de guilde");
    const guildId = ctx.request.query.get("guild") ?? "";
    const query = (ctx.request.query.get("q") ?? "").slice(0, 100);
    if (guildId.length > 64) return kit.page(400, title, t("Invalid filter.", "Filtre invalide."), { noindex: true });
    const days = Math.min(365, Math.max(7, Number(ctx.request.query.get("days")) || 30));
    const members = memberAccess ?? access;
    try {
      if (!guildId) {
        const guilds = await members.guilds(ctx.account.discordUserId);
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Choose a guild.", "Choisissez une guilde.")}</p><ul>${guilds.map(g => `<li><a href="${h(link("/me/guild-bank", lang, { guild: g.id, edition: g.edition }))}">${h(g.name)} · ${h(g.edition)}</a></li>`).join("")}</ul>`, { noindex: true });
      }
      // Officers see everything; members (9.1) the contents and the search, unless officers turned it off.
      const officerGuild = await access.authorize(ctx.account.discordUserId, guildId);
      const guild = officerGuild ?? (memberAccess ? await memberAccess.authorize(ctx.account.discordUserId, guildId) : null);
      const settings = guild && !officerGuild ? await database.guildSettings.findUnique({ where: { guildId }, select: { guildBankMemberSearch: true } }) : null;
      if (!guild || (!officerGuild && settings?.guildBankMemberSearch === false)) {
        return kit.page(403, title, t("These records are unavailable with your current membership and permissions.", "Ces données ne sont pas accessibles avec votre adhésion et vos permissions actuelles."), { noindex: true });
      }
      const officer = !!officerGuild;
      const bank = officer ? await loadGuildBank(database, guildId, days)
        : { contents: await database.guildBankContents.findUnique({ where: { guildId } }), gold: [], ledger: [] };
      const targets = await database.guildBankTarget.findMany({ where: { guildId }, select: { itemId: true, itemName: true, minCount: true } });
      const body = guildBankBody(bank, t, { officer, query, targets });
      const style = `<style>.stat-chart{margin:1rem 0}.stat-chart figcaption{font-weight:600}.stat-key{display:inline-block;margin-right:1rem;font-size:.9em}.stat-key i{display:inline-block;width:.8em;height:.8em;margin-right:.3em;border-radius:2px}table{border-collapse:collapse;width:100%;margin:.5rem 0}td,th{text-align:left;padding:.2rem .5rem;border-bottom:1px solid rgba(127,127,127,.25)}details{margin:.4rem 0}.bank-item{text-decoration:none}.bank-item:hover{text-decoration:underline}</style>`;
      const search = `<form method="get" action="/me/guild-bank"><input type="hidden" name="guild" value="${h(guild.id)}"><input type="hidden" name="edition" value="${h(guild.edition)}">${lang === "fr" ? `<input type="hidden" name="lang" value="fr">` : ""}`
        + `<label>${t("Search the bank", "Chercher dans la banque")} <input type="search" name="q" value="${h(query)}" maxlength="100"></label> <button type="submit">${t("Search", "Chercher")}</button></form>`;
      const header = `<h1>${title}</h1><p><strong>${h(guild.name)}</strong> · ${h(guild.edition)} · <a href="${h(link("/me/guild-bank", lang))}">${t("Choose another guild", "Choisir une autre guilde")}</a>`
        + (officer ? ` · <a href="${h(link("/me/statistics", lang, { guild: guild.id, edition: guild.edition }))}">${t("Statistics", "Statistiques")}</a></p>`
          + `<p>${[7, 30, 90, 365].map(n => n === days ? `<strong>${n} ${t("days", "jours")}</strong>` : `<a href="${h(link("/me/guild-bank", lang, { guild: guild.id, edition: guild.edition, days: String(n) }))}">${n} ${t("days", "jours")}</a>`).join(" · ")}</p>`
          : `</p><p>${t("What the bank held when someone last opened it with Guilded. Ask for an item with /bank request in Discord or /guilded gbank request in game.",
            "Ce que la banque contenait à sa dernière ouverture avec Guilded. Demandez un objet avec /bank request dans Discord ou /guilded gbank request en jeu.")}</p>`);
      return kit.page(200, title, style + header + search + body, { noindex: true, languageParams: { guild: guild.id, edition: guild.edition } });
    } catch {
      return kit.page(503, title, t("These records could not be loaded. Try again shortly; no data was changed.", "Impossible de charger ces données. Réessayez sous peu; aucune donnée n'a été modifiée."), { noindex: true });
    }
  };
  return { route };
}
