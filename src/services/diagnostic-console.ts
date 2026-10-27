import { installDiagnosticConsole } from "./diagnostic-privacy.js";

// Install before bot startup/handlers can log raw exception objects.
installDiagnosticConsole();
