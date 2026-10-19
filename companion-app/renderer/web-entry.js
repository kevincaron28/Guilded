import { companionOverview } from "../../companion/overview.mjs";
window.guildedOverview = companionOverview;
import { createBrowserCompanion } from "../../companion/browser-client.mjs";
if (!window.companion) window.companion = createBrowserCompanion();
