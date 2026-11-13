// The companion window's helpers, bundled for the browser (npm run companion:build): the language picker,
// the sign-in wording and the single window's status model.
import { createLanguageUI } from './language.js';
let storage;
try { storage = window.localStorage; } catch { /* language still works */ }
window.companionLanguage = createLanguageUI(document, storage, navigator.language, location.href);
import { timeLeftLine, signInOutcome, isUnreachable, retryDelaySeconds, SERVER_RESTARTING } from "../../companion/sign-in-flow.mjs";
window.guildedSignIn = { timeLeftLine, signInOutcome, isUnreachable, retryDelaySeconds, SERVER_RESTARTING };
import { mainStatus } from "../../companion/main-status.mjs";
window.guildedMainStatus = mainStatus;
