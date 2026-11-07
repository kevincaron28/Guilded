import { config } from "./config.js";
import { itemProviderFromEnv } from "./services/blizzard-items.js";

// The bot's one item data provider (docs/ITEM_PREVIEWS.md): Blizzard's Game Data API with the bot's Battle.net app,
// or the null provider when that app is not configured. Shared so chat previews, profession Details and the gallery
// use one token and one cache.
export const itemData = itemProviderFromEnv(config);
