# Guilded 8.4.2 — Companion startup fix

Fixes a Windows companion crash on launch: the window bound a button that 8.4.1
had removed, so the interface never finished initialising. Also polishes the
Link everything screen (empty panels are hidden while signed out). Bot, addon
and protocol (2) are unchanged from 8.4.1.

Microsoft Store 8.4.1.0 contains the crash; Store versions must increase, so the
fix ships as 8.4.2.0. Published 8.4.0 and 8.4.1 records are unchanged. Provider
status is tracked in [the release acceptance checklist](V8_4_2_RELEASE_ACCEPTANCE.md).
