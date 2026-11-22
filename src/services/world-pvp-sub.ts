/**
 * The world PvP line under a recap card's row (22 Nov 2026 audit): only the parts that happened, so it fits the card's column
 * ("3 victoires" rather than "3 victoires · 0 défenses · 0 app…").
 */
export function pvpSub(pvp: { kills: number; defends: number; helped: number }, t: (en: string, fr: string) => string): string {
  const parts = [
    pvp.kills ? t(`${pvp.kills} kill${pvp.kills > 1 ? "s" : ""}`, `${pvp.kills} victoire${pvp.kills > 1 ? "s" : ""}`) : "",
    pvp.defends ? t(`${pvp.defends} defend${pvp.defends > 1 ? "s" : ""}`, `${pvp.defends} défense${pvp.defends > 1 ? "s" : ""}`) : "",
    pvp.helped ? t(`${pvp.helped} call${pvp.helped > 1 ? "s" : ""} answered`, `${pvp.helped} appel${pvp.helped > 1 ? "s" : ""} répondu${pvp.helped > 1 ? "s" : ""}`) : ""
  ].filter(Boolean);
  return parts.join(" · ") || t("No fights yet", "Aucun combat encore");
}
