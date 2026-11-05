# Guilded 8.4.3 — WoW Forever launch fixes

Companion: "Find my saved data" no longer says "Already linked" when the watched file
is missing, from the beta client or stale; it switches to the live WoW Forever file.
With several editions' files on one PC, the only Forever file is picked automatically.
The status line warns when the Guilded addon in a game folder is built for another
edition (the client skips it silently). Website proxy: the standings "nothing changed"
answer (304) is passed through instead of becoming a 502 redirect error, which the
companion logged every two minutes. Release tooling: `npm run addon:verify-editions`
checks each edition zip before upload. Addon code and protocol (2) are unchanged from 8.4.2;
the addon TOC version only follows the shared product version.

The Microsoft Store requires increasing versions, so the companion ships as 8.4.3.0.
Status is tracked in [the acceptance checklist](V8_4_3_RELEASE_ACCEPTANCE.md).
