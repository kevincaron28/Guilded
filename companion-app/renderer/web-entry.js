import { profileEditionLabel, profileSiteHref } from "../../companion/presentation.mjs";
window.guildedProfileEditionLabel = profileEditionLabel;
window.guildedProfileSiteHref = profileSiteHref;
import { companionOverview } from "../../companion/overview.mjs";
import { syncStatus, syncDiagnosticPreview } from "../../companion/sync-status.mjs";
window.guildedSyncStatus = syncStatus;
window.guildedSyncDiagnosticPreview = syncDiagnosticPreview;
import { createLanguageUI } from './language.js';
let storage;
try { storage = window.localStorage; } catch { /* language still works */ }
window.companionLanguage = createLanguageUI(document, storage, navigator.language, location.href);
window.guildedOverview = companionOverview;
import { createBrowserCompanion } from "../../companion/browser-client.mjs";
if (!window.companion) window.companion = createBrowserCompanion();
