import type { Lang } from "../i18n.js";
import { dungeonDisplayName } from "./dungeon-card.js";

// A dungeon's name in the page language. A run stores the name the UPLOADER's client reported (a French client says "Mortemines"), so a
// public table that shows run.dungeonName shows the first uploader's language. The canonical English name comes from the instance
// (and route) id (dungeon-name-table.ts), then the French table translates it when the page is French.

type Encounters = readonly { name?: string | undefined; success?: boolean | undefined }[];
interface NamedRun { instanceId: number; dungeonName: string; routeKey?: string | null | undefined; evidence?: { encounters?: readonly unknown[] | undefined } | null }

const asDisplay = (run: NamedRun) => ({ dungeonName: run.dungeonName, instanceId: run.instanceId, routeKey: run.routeKey, encounters: run.evidence?.encounters as Encounters });

/** The canonical English name of the dungeon (or route); the uploaded name only when the instance is unknown. */
export function englishDungeonName(run: NamedRun): string {
  return dungeonDisplayName(asDisplay(run), "en");
}

/** The dungeon's name in the page language, whichever language the uploader's client used. */
export function localDungeonName(run: NamedRun, lang: Lang): string {
  return dungeonDisplayName(asDisplay(run), lang);
}
