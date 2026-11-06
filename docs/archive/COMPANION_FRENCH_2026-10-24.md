# Companion French candidate — 24 October 2026

Public release remains on hold. These changes belong to draft PR #215 and do
not authorize a main merge, public download promotion or announcements.

## Implemented

- One English/French catalog for the Windows and browser companions, including
  setup, overview, WoW, PoE2, wishlist, core rules/prices/rosters, activity,
  privacy/help, accessibility labels and common sync/error messages.
- Language selector switches the interface in place and remembers the choice.
  Browser links support `?lang=fr`. Native menus, notifications and file dialogs
  use the same catalog. Unknown operating-system/server diagnostic details stay
  verbatim so support can still identify them.
- Windows stores the preference in `language.json`, separate from `config.json`.
  Switching language never submits the connection form, restarts tracking or
  replaces pairing. Unsaved setup and management form values are retained.
- Sync presentation preserves protocol values, character/item names, file paths,
  numbers and actionable commands. Held imports, conflicting character ownership
  and refused public scores remain visible in French.
- Signed-out wishlist/core pages now explain that Discord must be connected
  before requesting management data. Invalid upstream JSON produces an actionable
  service error rather than a raw parser exception.
- French labels wrap on mobile; the setup badge no longer overflows at 320 px.
  The French Features page uses the new labels and links to the French companion.
- Installer contents and release artifact verification include the native catalog.

## Verification and limits

Checked all eight browser companion pages, including signed-out management,
French/English switching with an unsaved realm, reload persistence and narrow
mobile navigation. Reviewed 320 px layouts and corrected the setup overflow.
This used the actual built interface on `127.0.0.1:8801` without a bot or database.
It does not substitute for authenticated real-account editing or game acceptance.

Automated checks cover translation key/placeholder parity, diagnostic matching,
unchanged names/paths, composed import outcomes, refused public scores, native
language storage isolation, French updater outcomes, signed-out management and
unreadable upstream responses. Full local suite: 268 files / 2,257 tests passed;
TypeScript, ESLint, both addon validators, site/Worker dry run and both dependency
audits passed (zero vulnerabilities). The final diagnostic additions also passed
the focused translation suite. See the AI handoff for package/install evidence.

Real French game-client acceptance and independent native-language review remain
separate. No new game evidence, route timings or loot values were invented.

## Cloudflare build investigation

**Resolved:** fix commit `5c9b8b7` passed hosted build
`fee77c0b-24bb-4db9-87d8-2315818fc6d0`; its log confirms npm 11.13.0, successful
dependency installation, site build and branch preview deployment. The GitHub
Workers Builds check also succeeded. See the AI handoff for exact evidence and
the preview's owner-KV limitation. Production and public release remain held.

Update after Kevin signed in: the dashboard log for `e4206bbb` establishes the
failure at dependency installation, before the build/preview commands. Cloudflare
selected npm 10.9.2, which rejects the lockfile's Miniflare Undici override:
`undici@7.30.1 does not satisfy undici@7.29.1`. The same error reproduces with npm
10.9.2 against a scratch copy of the two package manifests. Local npm is 11.13.0.

The repository now pins `packageManager: npm@11.13.0`. Workers Builds installs
that exact version before dependencies, per its
[build-image documentation](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
The dependency lockfile and Undici override remain intact. No dashboard settings,
credentials, production routes or deploy commands were changed. Hosted branch
verification is recorded in the AI handoff; the prior access-blocked record
below is retained as history, not the current diagnosis.

GitHub's Linux and Windows jobs both passed for `363ff60` in run 40130415634.
The external Cloudflare check still failed. Its build ID was
`2060a4b0-f580-4cd6-ba0e-377ff8585217` for Worker `guilded-wow`.

Local `npm run worker:build` succeeds, including site generation and Wrangler's
dry run. The existing Wrangler OAuth session can identify the account but the
Workers Builds log API returns HTTP 403, error 12004 (Forbidden). The dashboard
in the in-app browser is signed out. Trying the existing Chrome session also
failed to return a usable page. Kevin was asked to sign in to the dashboard;
no password/token was requested and no new permissions or credentials were made.

The remote cause is **not established or fixed**. Do not disable the check or
guess at production build/deploy settings. Next: read the failed build log after
dashboard sign-in, fix the evidenced cause, then verify the branch preview build.
Keep production routes, main and public release unchanged.
