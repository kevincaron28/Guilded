import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { commands } from "../src/commands/index.js";
import { resolveCommand } from "../src/commands/router.js";

it("routes every registered slash command to a handler without starting the bot", () => {
  // main.ts has startup side effects. Inspect its fallback registrations without
  // importing it, then exercise the real resolver for every published route.
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const fallback = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === "handlers" && node.expression.name.text === "set"
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[1]) {
      fallback.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  type Option = { name: string; type: number; options?: Option[] };
  const missing: string[] = [];
  for (const command of commands) {
    const json = command.toJSON() as { name: string; options?: Option[] };
    const routes = (json.options ?? []).flatMap<{ group: string | null; sub: string | null }>(option => option.type === 2
      ? (option.options ?? []).map(sub => ({ group: option.name, sub: sub.name }))
      : option.type === 1 ? [{ group: null, sub: option.name }] : []);
    if (!routes.length) routes.push({ group: null, sub: null });
    for (const route of routes) {
      const found = resolveCommand(commands, {
        commandName: json.name,
        options: { getSubcommand: () => route.sub, getSubcommandGroup: () => route.group }
      });
      if (!found.handler && !fallback.has(found.legacy)) {
        missing.push([json.name, route.group, route.sub].filter(Boolean).join(" "));
      }
    }
  }
  expect(missing).toEqual([]);
});
