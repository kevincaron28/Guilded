import { AsyncLocalStorage } from "node:async_hooks";
import { gameEditionOf, type GameEdition } from "./game-edition.js";
import { currentGuildScope } from "./guild-scope.js";

const context = new AsyncLocalStorage<GameEdition>();
export const currentEdition = (): GameEdition => context.getStore() ?? gameEditionOf(currentGuildScope()?.guild ?? {});
export const withEdition = <T>(edition: GameEdition, work: () => T): T => context.run(edition, work);
