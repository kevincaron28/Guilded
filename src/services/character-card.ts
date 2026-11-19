import { escapeHtml } from "./web-layout.js";

// The armory-style character card (9.4 T9) on the public player page and on /me/: our own painted class art (served from this
// site, /images/web/class-card-*.webp, 320 px), the class colour, race, level, in-game guild and rank where known, and a button to
// Blizzard's armory. Nothing of Blizzard's is fetched, framed or hotlinked: their armory refuses embedding and its images are
// not ours to copy, so the button opens it in a new tab.

const CLASS_COLOR: Record<string, string> = {
  warrior: "#c69b6d", paladin: "#f48cba", hunter: "#aad372", rogue: "#fff468", priest: "#ffffff", shaman: "#2a8cff",
  mage: "#3fc7eb", warlock: "#8788ee", druid: "#ff7c0a"
};
const slugOf = (className: string | null | undefined) => (className ?? "").toLowerCase().replace(/[^a-z]/g, "");

export const CHARACTER_CARD_CSS = `<style>.ccard{display:flex;gap:16px;align-items:stretch;margin:16px 0;border:1px solid var(--line,#333);border-left:4px solid var(--cc,#bfc9bd);border-radius:10px;background:var(--panel,transparent);overflow:hidden;max-width:640px}`
  + `.ccard img{width:160px;height:120px;object-fit:cover;flex:none;display:block}.ccard .cc-body{padding:12px 14px 12px 0;display:flex;flex-direction:column;gap:4px;min-width:0}`
  + `.ccard .cc-name{margin:0;font-size:1.15rem;font-weight:700;color:var(--cc,inherit);overflow-wrap:anywhere}.ccard .cc-line{margin:0}.ccard .cc-btn{align-self:flex-start;margin-top:6px;display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid var(--gold,#d4a017);border-radius:8px;color:var(--gold,#d4a017);text-decoration:none;font-weight:600}`
  + `@media(max-width:520px){.ccard{flex-direction:column;gap:0}.ccard img{width:100%;height:150px}.ccard .cc-body{padding:12px 14px}}</style>`;

export interface CharacterCardInput {
  name: string; className?: string | null; classLabel?: string | null; race?: string | null; level?: number | null;
  guild?: string | null; rank?: string | null; armoryUrl?: string | null;
}

/** The card, or "" with no name. The class art is shown only for a known class. Every value is escaped. */
export function characterCardHtml(input: CharacterCardInput, t: (en: string, fr: string) => string): string {
  if (!input.name.trim()) return "";
  const slug = slugOf(input.className);
  const color = CLASS_COLOR[slug];
  const art = color ? `<img src="/images/web/class-card-${slug}.webp" alt="" width="160" height="120" loading="lazy">` : "";
  const line = [input.race?.trim(), input.classLabel?.trim() || input.className?.trim(), input.level ? `${t("level", "niveau")} ${input.level}` : null].filter(Boolean).join(" · ");
  const guild = input.guild?.trim() ? `${t("Guild", "Guilde")}: ${escapeHtml(input.guild.trim())}${input.rank?.trim() ? ` · ${escapeHtml(input.rank.trim())}` : ""}` : "";
  const button = input.armoryUrl ? `<a class="cc-btn" href="${escapeHtml(input.armoryUrl)}" target="_blank" rel="noopener noreferrer">${t("View on the Blizzard armory ↗", "Voir sur l'armurerie Blizzard ↗")}</a>` : "";
  return `${CHARACTER_CARD_CSS}<div class="ccard"${color ? ` style="--cc:${color}"` : ""}>${art}<div class="cc-body"><p class="cc-name">${escapeHtml(input.name)}</p>`
    + (line ? `<p class="cc-line">${escapeHtml(line)}</p>` : "") + (guild ? `<p class="cc-line muted">${guild}</p>` : "") + button + `</div></div>`;
}
