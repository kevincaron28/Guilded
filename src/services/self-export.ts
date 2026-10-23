import type { PrismaClient, ReadinessStatus } from "@prisma/client";
import { importCharacter, parseCharacterString, type ImportOutcome, type ParsedCharacter } from "./character-import.js";
import { deriveReadinessStatus } from "./readiness.js";
import { BRAND } from "../brand.js";

// `/guilded share` in game produces "QGEXP1:" + base64 of newline-separated lines:
//   QG1|name|realm|CLASS|race|level|spec|professions   (the character line)
//   R|STATUS|itemLevel            last gear check
//   F|code|severity|message       one per finding
//   C|CATEGORY|name               active consumables
//   A|name|1 or 0                 attunements
// It only ever describes the sender's own character, so members can apply it
// themselves with /character import, with no officer review.

export interface SelfExport {
  character: ParsedCharacter;
  status: string | null;
  itemLevel: number | null;
  findings: { code: string; severity: "INFO" | "WARNING" | "ERROR"; message: string }[];
  consumables: { category: string; name: string }[];
  attunements: { name: string; completed: boolean }[];
}

const MAX_LINES = 200;

export function parseSelfExport(input: string): SelfExport {
  const text = input.trim();
  if (!text.startsWith("QGEXP1:")) {
    // /character import dispatches to this function only once it already sees a
    // "QGEXP1:" prefix, so this only fires for a direct caller (e.g. a test) that
    // hands it /guilded character's QG1/QG2 line instead of a share code.
    if (/^QG[12][;|]/.test(text)) throw new Error(`That's the line from /guilded character, not a share code. Paste it with /character import, or run /guilded share in game for a code to use here.`);
    throw new Error(`That is not a ${BRAND.name} share code. In game, type /guilded share and copy the code it shows.`);
  }
  const encoded = text.slice("QGEXP1:".length).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length < 8) throw new Error("The share code looks damaged. Run /guilded share again and copy the whole code.");
  const lines = Buffer.from(encoded, "base64").toString("utf8").split("\n").slice(0, MAX_LINES);
  const first = lines[0];
  if (!first) throw new Error("The share code is empty.");
  const result: SelfExport = { character: parseCharacterString(first), status: null, itemLevel: null, findings: [], consumables: [], attunements: [] };
  for (const line of lines.slice(1)) {
    const [kind = "", a = "", b = "", ...rest] = line.split("|");
    if (kind === "R") {
      result.status = a || null;
      const level = Number(b);
      result.itemLevel = Number.isFinite(level) && level > 0 ? level : null;
    } else if (kind === "F" && a) {
      const severity = b === "ERROR" || b === "WARNING" ? b : "INFO";
      result.findings.push({ code: a.slice(0, 60), severity, message: (rest.join("|") || a).slice(0, 300) });
    } else if (kind === "C" && b) {
      result.consumables.push({ category: a.slice(0, 20), name: b.slice(0, 80) });
    } else if (kind === "A" && a) {
      result.attunements.push({ name: a.slice(0, 80), completed: b === "1" });
    }
  }
  return result;
}

export interface SyncOutcome extends ImportOutcome {
  status: string | null;
  attunements: number;
}

// Links or refreshes the character, stores the gear check and attunements.
export async function applySelfExport(database: PrismaClient, memberId: string, data: SelfExport, main?: boolean): Promise<SyncOutcome> {
  const outcome = await importCharacter(database, memberId, data.character, main);
  const character = await database.character.findFirst({
    where: { memberId, name: { equals: data.character.name, mode: "insensitive" } }
  });
  if (!character) throw new Error("The character could not be found after linking it.");
  let status: ReadinessStatus | null = null;
  if (data.status || data.findings.length) {
    status = deriveReadinessStatus(data.findings);
    await database.inspectedCharacterSnapshot.create({
      data: {
        characterId: character.id,
        memberId,
        source: "Guilded share",
        status,
        itemLevel: data.itemLevel,
        rawPayload: JSON.parse(JSON.stringify(data)),
        consumables: { create: data.consumables.map((row) => ({ name: row.name, quantity: 1, category: row.category || null })) },
        findings: { create: data.findings }
      }
    });
    await database.character.update({ where: { id: character.id }, data: { lastSeenAt: new Date() } });
  }
  for (const attunement of data.attunements) {
    await database.characterAttunement.upsert({
      where: { characterId_name: { characterId: character.id, name: attunement.name } },
      create: { characterId: character.id, name: attunement.name, completed: attunement.completed, source: "Guilded share", completedAt: new Date() },
      update: { completed: attunement.completed, source: "Guilded share", completedAt: new Date() }
    });
  }
  return { ...outcome, status, attunements: data.attunements.length };
}
