import { companionOverview } from "../../companion/overview.mjs";
import { createLanguageUI } from './language.js';
let storage;
try { storage = window.localStorage; } catch { /* language still works */ }
window.companionLanguage = createLanguageUI(document, storage, navigator.language, location.href);
window.guildedOverview = companionOverview;
import { createBrowserCompanion } from "../../companion/browser-client.mjs";
if (!window.companion) window.companion = createBrowserCompanion();
