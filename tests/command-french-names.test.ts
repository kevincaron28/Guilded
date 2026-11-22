import { describe, expect, it } from "vitest";
import { commands } from "../src/commands/index.js";
import { FRENCH_NAME } from "../src/commands/french-names.js";

type Node = { name: string; name_localizations?: Record<string, string>; description_localizations?: Record<string, string>; options?: Node[]; type?: number };
const json = commands.map((command) => command.toJSON() as unknown as Node);
const top = (name: string) => json.find((command) => command.name === name)!;
const find = (command: string, ...path: string[]) => path.reduce<Node | undefined>((node, name) => node?.options?.find((entry) => entry.name === name), top(command));

describe("French names for the member commands", () => {
  it("every member command has a French name", () => {
    const named: Array<[Node | undefined, string]> = [
      [top("help"), "aide"], [top("character"), "personnage"], [top("craft"), "artisanat"], [top("promotion"), "promotion"], [top("report"), "rapport"],
      [find("character", "profile"), "profil"], [find("character", "profession"), "metier"], [find("character", "wishlist"), "souhaits"],
      [find("character", "unlink"), "delier"],
      [find("craft", "request"), "demander"], [find("craft", "list"), "liste"], [find("craft", "who"), "qui"], [find("craft", "mine"), "mes-demandes"], [find("craft", "offer"), "proposer"],
      [find("promotion", "status"), "statut"], [find("report", "bug"), "bug"],
      [find("character", "profession", "set", "character"), "personnage"], [find("character", "profession", "set", "profession"), "metier"],
      [find("character", "wishlist", "add", "item"), "objet"], [find("craft", "request", "item"), "objet"]
    ];
    for (const [node, french] of named) expect(node?.name_localizations?.["fr"], node?.name).toBe(french);
  });

  it("follows Discord's name rules and keeps sibling names unique", () => {
    const problems: string[] = [];
    const visit = (node: Node, path: string) => {
      const french = node.name_localizations?.["fr"];
      if (french !== undefined && (!FRENCH_NAME.test(french) || french !== french.toLowerCase())) problems.push(`${path}: ${french}`);
      const seen = new Set<string>();
      for (const child of node.options ?? []) {
        const shown = child.name_localizations?.["fr"] ?? child.name;
        if (seen.has(shown)) problems.push(`${path}/${child.name}: duplicate French name ${shown}`);
        seen.add(shown);
        visit(child, `${path}/${child.name}`);
      }
    };
    for (const command of json) visit(command, command.name);
    expect(problems).toEqual([]);
  });

  // Discord (docs, 2026): 8000 characters per command, counting only the longest localization of each field.
  it("keeps each command's text under Discord's 8000-character cap, longest localization per field", () => {
    const longest = (base: string | undefined, loc: Record<string, string> | undefined) => Math.max(base?.length ?? 0, ...Object.values(loc ?? {}).map((text) => text.length));
    const size = (node: Node & { description?: string; value?: unknown; choices?: unknown[] }): number =>
      longest(node.name, node.name_localizations) + longest(node.description, node.description_localizations) + (typeof node.value === "string" ? node.value.length : 0)
      + [...(node.options ?? []), ...(node.choices ?? [])].reduce<number>((sum, child) => sum + size(child as never), 0);
    for (const name of ["help", "character", "craft", "promotion", "report"]) expect(size(top(name) as never), name).toBeLessThan(7500);
  });
});
