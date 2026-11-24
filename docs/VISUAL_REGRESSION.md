# Website visual regression (R2.7)

A Playwright check that screenshots the key static pages and compares them with baselines committed in the
repository. It runs in CI (`.github/workflows/visual.yml`) on every pull request that touches the site, the site build,
the Worker's language handling or the visual files themselves, and on pushes to `main` that change them.

## What is covered

At 390 px (`mobile-390`) and 1280 px (`desktop-1280`) wide, full page, English unless stated:

| Name | Path | Note |
|---|---|---|
| home | `/` | also asserts the kept headline "Less organizing. More playing." |
| download | `/download/` | |
| guide | `/guide/` | |
| reference | `/reference/` | |
| community | `/community/` | |
| forever-hub | `/forever/` | the static entry point to the leaderboards |
| download-fr | `/download/?lang=fr` | French copy, see below |

**Leaderboards are not screenshotted.** They are rendered by the bot from live data (`src/services/web-layout.ts`) and
are not part of the static site, so there is nothing deterministic to compare; the spec lists the page as skipped with that
reason. `forever-hub` stands in as the static page that links to them. No PoE2 or Diablo page is in the set (decision f).

**`/fr/download/`:** the Worker serves `/fr/<path>/` by taking the English file and localizing it with Cloudflare's
`HTMLRewriter`, which does not exist outside Cloudflare, so a local run cannot serve that exact address. The French page is
therefore shot as `/download/?lang=fr` (`site/language.js` shows the same French copy), and a separate test fails if the
built `download/index.html` loses its French copy or if `/fr/download` stops redirecting to `/fr/download/`
(`worker/localized-assets.mjs`). That is what catches a same-name `/fr/` slug miss.

## How it avoids false alarms

- The page only talks to the local preview server (`scripts/preview-site.mjs`); every other request (analytics, ads) is blocked.
- Fonts are the site's own files; animations are disabled and motion reduced; the browser's locale and time zone are fixed.
- Version numbers (`9.5.6`, `0.0.0`) and dates in the text are replaced by fixed tokens, so a release does not change a baseline. A changed
  layout or wording does.
- Tolerance (`playwright.config.ts`): a pixel counts as the same below a colour distance of 0.2 (absorbs anti-aliasing), and a page
  may differ in at most 0.2 % of its pixels. A changed heading, button, section or image is above that; font smoothing is below.

## When it fails

The job fails and uploads the `visual-diff` artifact: for each failing screenshot the expected image, the actual one and a
diff, plus the HTML report. If the change is intended, refresh the baselines (below) in the same pull request and review
the new images like code.

## Refreshing the baselines

Baselines must come from the Linux CI runner (fonts and anti-aliasing differ on Windows and macOS). Do not commit
baselines made on a PC.

1. GitHub → Actions → "Website visual regression" → Run workflow on your branch with "update" ticked. (A workflow can only be
   run by hand once it exists on the default branch; before that, the first failing pull-request run uploads the baselines
   it had to create in the `visual-diff` artifact.)
2. Download the `visual-baselines` artifact and copy its contents into `visual/baselines/`.
3. Commit `visual/baselines/`.

`npm run visual:update` is the same command the workflow runs (`playwright test --update-snapshots`). It works anywhere, but only
a Linux run (CI, or Docker with the `mcr.microsoft.com/playwright` image) should be committed.

## Running it locally

```powershell
npm run site:build
npx playwright install chromium   # once
npm run visual
```

Locally on Windows the comparison is expected to differ from the Linux baselines; use it to look at the pages, not as the verdict.
