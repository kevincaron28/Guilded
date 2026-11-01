// Presentation only: use the profile's explicit edition; never infer a game identity from a URL.
import { editionSection } from "../site/nav.mjs";
import { GAME_EDITIONS } from "./game-edition.mjs";

const explicitEdition = value => GAME_EDITIONS.includes(value) ? editionSection(value) : null;

export function profileEditionLabel(value, language = "en") {
  const edition = explicitEdition(value);
  return edition ? edition[language === "fr" ? "fr" : "en"] : String(value || "");
}

export function profileSiteHref(href, edition, language = "en") {
  const url = new URL(href);
  const selected = explicitEdition(edition);
  url.searchParams.set("lang", language === "fr" ? "fr" : "en");
  url.searchParams.delete("edition");
  if (selected && url.pathname === "/leaderboards/") url.pathname = `/${selected.slug}/leaderboards/`;
  if (selected && url.pathname === "/me/") url.searchParams.set("edition", selected.id);
  return url.href;
}
