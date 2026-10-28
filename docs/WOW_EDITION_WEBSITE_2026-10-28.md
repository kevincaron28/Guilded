# WoW edition download pages — 28 October 2026

The owner requested a more obvious game version and a separate experience for
each WoW client. The product keeps one domain, with dedicated pages:

- `/editions/`: choose a client, with guidance for identifying it.
- `/editions/forever/`: WoW Forever.
- `/editions/classic-era/`: Classic Era and Hardcore.
- `/editions/classic-tbc/`: Burning Crusade Classic.
- `/editions/classic-mists/`: Mists of Pandaria Classic.
- `/editions/retail/`: World of Warcraft Retail.

The primary home action now opens the edition chooser directly below the hero;
the shared site navigation has a WoW versions link. Every client page names the
selected edition, offers both matching addon ZIPs, explains installation and
links the optional online/Windows companion, Microsoft Store and Discord setup.
Game edition and addon release number are labelled separately. Existing design,
sanitized captures, private owner resources and runtime origin protection remain.

`site/editions.mjs` is the public content source. The build reads the verified
GitHub version in `site/releases.json`; changing a local candidate/package version
does not advertise unpublished downloads. No old release asset is overwritten.
CurseForge links retain explicit guidance to inspect that provider's actual file
version. After all ten 8.0 files were approved and downloaded with matching hashes,
each edition page gained direct links to its two approved CurseForge files.
These links are shown only when that provider matches the GitHub release version.
Microsoft Store 8.0.0.0 is also published; installed-client acceptance remains separate.

All six pages have EN/FR content, metadata, canonical/hreflang alternatives and
sitemap entries. The Worker runs first on `/editions` and `/editions/*` so French
content is rendered before JavaScript, using the existing localization boundary.

Verification: 337 files / 2,821 tests passed locally, TypeScript, ESLint and both
addon validators. Targeted edition tests prevent a missing client or a download
pointing to another edition. Local browser checks covered English home navigation,
French chooser/edition content, actual download URLs and 390/1024/1280 layouts.
The observed views had no horizontal overflow. These are website checks, not new
in-game acceptance. Private screenshots are in `backups/edition-site/`.

Publication: [PR #249](https://github.com/kevincaron28/Guilded/pull/249) passed
quality run `40728724003` and merged at `86b162e`. Cloudflare published the accepted
source. Twelve actual public EN/FR edition pages returned 200 with the correct
language, canonical and matching download links; the French home choice and
deployed navigation module also matched. Private evidence:
`backups/edition-site/public-verification.json` and `live-editions.png`.
