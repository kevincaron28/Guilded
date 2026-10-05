# Online companion verification — 5 October 2026

**Current status, 5 October: Oracle and the unified public companion now serve
6.0.0 / protocol 2. The website-to-companion flow and unpaired connection check
passed in the live browser. Authenticated upload and in-game return at the new
origin remain pending.** See [the finalization checklist](V6_0_FINALIZATION_CHECKLIST.md).

Read-only checks with the existing desktop credential now also pass for
standings, management and PoE status through the unified origin (HTTP 200,
no-store). Without credentials, these routes in the initialized guild return
401, also no-store. No pairing or saved companion settings were changed.

## Earlier predeployment findings (historical)

The Quebec Gold companion at https://guildedqc.duckdns.org/companion/ loaded and
reported **5.0.0**. Connection & setup and Help & privacy were usable. On an empty,
unpaired profile, Test connection incorrectly reported “Guild is not initialized”:
the old check used the PoE status endpoint even before a guild had been entered.
Direct navigation to the health URL was blocked by the browser environment;
no production health or database success is inferred from the page loading.

The source fix checks public server health first. Before pairing it explicitly
says the server is online but the account is not linked. After pairing it checks
authorization against WoW standings or PoE status according to the selected
profile. A revoked credential remains a failure. It does not weaken upload auth.
Regression coverage lives in `tests/browser-client.test.ts`.

The rebuilt local 6.0.0 page loaded, including the WoW and Wishlist screens.
The static preview correctly reports that no bot is connected. It is not a
simulation of a successful account link. No real pairing was replaced, no
production file was uploaded, and no second bot was started.

An automated browser file-picker attempt with synthetic `Guilded.lua` failed
with a browser-control “No node found” error. It is not counted as a successful
file-selection or sync test. The offline parser tests pass, but this does not
replace the real browser flow below.

The complete local release check passed: **151 test files / 1,219 tests**,
TypeScript, ESLint, addon validation, both dependency audits (zero vulnerabilities),
addon ZIP, browser bundle, Windows installer and static website build.
The landing page's HTTPS address validation and guild-link generation were
checked in the browser. All seven walkthrough images loaded, and a command-copy
button copied the expected text. No public website was deployed.

## Acceptance after deployment

Use a separate test member in an initialized test guild and matching release:

1. Open that guild's HTTPS companion address and verify the intended version.
2. Before pairing, Test connection must report server availability and explain
   that the account is not linked yet.
3. Run `/character pair` in that guild. Enter its server ID and that member's code.
   This replaces the member's previous companion pairing; use a test account.
4. Connect, then Test connection must confirm authenticated access.
5. Select the test account's saved `Guilded.lua` after logging out or `/reload`.
   Save preferences, Sync now, and confirm the intended character/data in Discord.
6. Download standings, put the generated file in the addon folder, `/reload`, and
   compare the in-game data with Discord.
7. Revoke the test link. Further authenticated actions must fail. Re-pair once
   to confirm recovery. Check a normal member cannot perform officer-only actions.

For member instructions see [Member installation](MEMBER_INSTALL.md). Other
guilds need their own bot address; Quebec Gold's URL is not a shared hosting
service. Public website deployment and bot deployment are separate operations.
