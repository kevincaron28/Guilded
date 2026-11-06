import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebRoute } from "./web-app.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { lineChartSvg } from "./stats-page.js";
import { goldText, loadGuildBank, summarizeLedger } from "./guild-bank.js";

// 9.0: the read-only Guild bank page (/me/guild-bank) on the guild tools site: what the bank held
// when someone last opened it, the gold over time, and the ledger (who deposited or withdrew what,
// when). Officers only, with the same check as the Statistics page. No script, inline SVG chart.

type T = (en: string, fr: string) => string;
type Bank = Awaited<ReturnType<typeof loadGuildBank>>;
interface TabRow { tab: number; name: string; items: { id: number; name: string; count: number }[] }

const day = (d: Date) => d.toISOString().slice(0, 10);
const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

const TYPE_WORDS: Record<string, [string, string]> = {
  deposit: ["deposited", "a déposé"], withdraw: ["withdrew", "a retiré"], move: ["moved", "a déplacé"],
  repair: ["repaired with", "a réparé avec"], buytab: ["bought a tab for", "a acheté un onglet pour"], withdrawfortab: ["paid for a tab", "a payé un onglet"]
};
const verb = (type: string, t: T) => { const w = TYPE_WORDS[type.toLowerCase()]; return w ? t(w[0], w[1]) : h(type); };

export function guildBankBody(bank: Bank, t: T): string {
  const parts: string[] = [];
  if (!bank.contents && !bank.gold.length && !bank.ledger.length) {
    return `<p>${t("Nothing yet. The ledger fills in when someone with access to the guild bank opens it with Guilded on, and their companion (or a guildmate's) syncs.",
      "Rien pour l'instant. Le registre se remplit quand quelqu'un ayant accès à la banque de guilde l'ouvre avec Guilded, puis que son compagnon (ou celui d'un membre) synchronise.")}</p>`;
  }
  if (bank.contents) {
    const tabs = (Array.isArray(bank.contents.tabs) ? bank.contents.tabs : []) as unknown as TabRow[];
    parts.push(`<h2>${t("Contents", "Contenu")}</h2><p>${t("Last seen", "Vu le")} ${h(when(bank.contents.observedAt))} UTC · ${t("Gold", "Or")}: <strong>${h(goldText(bank.contents.money))}</strong></p>`);
    for (const tab of tabs) {
      const items = [...(tab.items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      parts.push(`<details${tabs.length <= 2 ? " open" : ""}><summary><strong>${h(tab.name)}</strong> · ${items.length} ${t("item(s)", "objet(s)")}</summary>`
        + (items.length ? `<table><thead><tr><th>${t("Item", "Objet")}</th><th>${t("Count", "Quantité")}</th></tr></thead><tbody>${items.map((i) => `<tr><td>${h(i.name)}</td><td>${i.count}</td></tr>`).join("")}</tbody></table>` : `<p>${t("Empty.", "Vide.")}</p>`)
        + `</details>`);
    }
  }
  if (bank.gold.length) {
    parts.push(lineChartSvg(bank.gold.map((p) => day(p.at)), [{ label: t("Gold", "Or"), values: bank.gold.map((p) => Number(p.money / 10000n)), color: "#c9a227" }], t("Gold over time", "Or au fil du temps")));
  }
  if (bank.ledger.length) {
    const people = summarizeLedger(bank.ledger);
    parts.push(`<h2>${t("Who moved what", "Qui a déplacé quoi")}</h2><table><thead><tr><th>${t("Member", "Membre")}</th><th>${t("Gold in", "Or déposé")}</th><th>${t("Gold out", "Or retiré")}</th><th>${t("Items in", "Objets déposés")}</th><th>${t("Items out", "Objets retirés")}</th></tr></thead><tbody>`
      + people.map((p) => `<tr><td>${h(p.actor)}</td><td>${p.deposited ? h(goldText(p.deposited)) : ""}</td><td>${p.withdrawn ? h(goldText(p.withdrawn)) : ""}</td><td>${p.itemsIn || ""}</td><td>${p.itemsOut || ""}</td></tr>`).join("") + `</tbody></table>`);
    parts.push(`<h2>${t("Ledger", "Registre")}</h2><table><thead><tr><th>${t("When (UTC, about)", "Quand (UTC, environ)")}</th><th>${t("Member", "Membre")}</th><th>${t("What", "Quoi")}</th></tr></thead><tbody>`
      + bank.ledger.map((row) => {
        const what = row.kind === "money" ? h(goldText(row.amount)) : `${h(row.itemName ?? `#${row.itemId}`)} ×${row.count ?? 1}${row.tab ? ` (${t("tab", "onglet")} ${row.tab}${row.tab2 ? ` → ${row.tab2}` : ""})` : ""}`;
        return `<tr><td>${h(when(row.at))}</td><td>${h(row.actor)}</td><td>${verb(row.type, t)} ${what}</td></tr>`;
      }).join("") + `</tbody></table>`
      + `<p>${t("Times are about an hour accurate: the game gives each line's age in hours. The same line uploaded by several members is shown once.",
        "Les heures sont précises à environ une heure près : le jeu donne l'âge de chaque ligne en heures. Une même ligne envoyée par plusieurs membres n'apparaît qu'une fois.")}</p>`);
  }
  return parts.join("");
}

export function createGuildBankPage(database: PrismaClient, access: GuildDashboardAccess): { route: WebRoute } {
  const route: WebRoute = async (ctx, kit) => {
    if (ctx.request.path !== "/me/guild-bank") return null;
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    const title = t("Guild bank", "Banque de guilde");
    const guildId = ctx.request.query.get("guild") ?? "";
    if (guildId.length > 64) return kit.page(400, title, t("Invalid filter.", "Filtre invalide."), { noindex: true });
    const days = Math.min(365, Math.max(7, Number(ctx.request.query.get("days")) || 30));
    try {
      if (!guildId) {
        const guilds = await access.guilds(ctx.account.discordUserId);
        return kit.page(200, title, `<h1>${title}</h1><p>${t("Choose a guild where you currently have officer access.", "Choisissez une guilde où vous avez actuellement accès comme officier.")}</p><ul>${guilds.map(g => `<li><a href="${h(link("/me/guild-bank", lang, { guild: g.id, edition: g.edition }))}">${h(g.name)} · ${h(g.edition)}</a></li>`).join("")}</ul>`, { noindex: true });
      }
      const guild = await access.authorize(ctx.account.discordUserId, guildId);
      if (!guild) return kit.page(403, title, t("These records are unavailable with your current membership and permissions.", "Ces données ne sont pas accessibles avec votre adhésion et vos permissions actuelles."), { noindex: true });
      const body = guildBankBody(await loadGuildBank(database, guildId, days), t);
      const style = `<style>.stat-chart{margin:1rem 0}.stat-chart figcaption{font-weight:600}.stat-key{display:inline-block;margin-right:1rem;font-size:.9em}.stat-key i{display:inline-block;width:.8em;height:.8em;margin-right:.3em;border-radius:2px}table{border-collapse:collapse;width:100%;margin:.5rem 0}td,th{text-align:left;padding:.2rem .5rem;border-bottom:1px solid rgba(127,127,127,.25)}details{margin:.4rem 0}</style>`;
      const header = `<h1>${title}</h1><p><strong>${h(guild.name)}</strong> · ${h(guild.edition)} · <a href="${h(link("/me/guild-bank", lang))}">${t("Choose another guild", "Choisir une autre guilde")}</a> · <a href="${h(link("/me/statistics", lang, { guild: guild.id, edition: guild.edition }))}">${t("Statistics", "Statistiques")}</a></p>`
        + `<p>${[7, 30, 90, 365].map(n => n === days ? `<strong>${n} ${t("days", "jours")}</strong>` : `<a href="${h(link("/me/guild-bank", lang, { guild: guild.id, edition: guild.edition, days: String(n) }))}">${n} ${t("days", "jours")}</a>`).join(" · ")}</p>`;
      return kit.page(200, title, style + header + body, { noindex: true, languageParams: { guild: guild.id, edition: guild.edition } });
    } catch {
      return kit.page(503, title, t("These records could not be loaded. Try again shortly; no data was changed.", "Impossible de charger ces données. Réessayez sous peu; aucune donnée n'a été modifiée."), { noindex: true });
    }
  };
  return { route };
}
