import { itemProviderFromEnv } from "./services/blizzard-items.js";
import type { ItemDataProvider } from "./services/item-preview-data.js";

// The bot's one item data provider (docs/ITEM_PREVIEWS.md): Blizzard's Game Data API with the bot's Battle.net app,
// or the null provider when that app is not configured. Shared so chat previews, profession posts and Details and the
// gallery use one token and one cache. Built on first use from the environment (loaded by config.ts/database.ts by
// then), so importing this module never runs the environment check and stays safe in tests.
let provider: ItemDataProvider | undefined;
export const itemData: ItemDataProvider = {
  lookup: (item) => {
    provider ??= itemProviderFromEnv({ BATTLENET_CLIENT_ID: process.env["BATTLENET_CLIENT_ID"]?.trim(), BATTLENET_CLIENT_SECRET: process.env["BATTLENET_CLIENT_SECRET"]?.trim() });
    return provider.lookup(item);
  }
};
