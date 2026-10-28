# Guilded 8.0 accessibility review — 28 October 2026

Reviewed with the accessibility-review skill, axe-core 4.14.0 WCAG 2.0/2.1 A/AA
rules, the browser accessibility tree, keyboard controls and rendered mobile
layout. A local-only harness served the built website and actual companion
renderer; it started no bot and contacted no database. Raw reports are retained
privately in `backups/a11y/`.

## Findings and fixes

- Removed brand aria-labels that omitted their visible captions. Accessible names
  now contain the displayed brand and caption, in the selected language.
- Added an explicit, translated accessible name to the new-connection-name field.
- Filled untranslated creator headings, support links and navigation labels.
- Server-side French translation also covers titles, descriptions and labels.

## Verified states

No automated violations in the final English/French homepage scans, French
features/creator page, bilingual quick-start guide, or all eight signed-out
companion screens: overview, WoW, PoE2, wishlist, cores, setup, activity and help.
The initial English homepage failure was corrected and rescanned successfully.
These states do not exercise signed-in data-dependent forms.

The homepage, quick-start guide and companion help reflow at 390 CSS pixels with
no horizontal document overflow. The homepage also reflows at 640 CSS pixels,
equivalent in available layout width to a 1280-pixel viewport at 200% zoom. This
is a reflow check, not a native browser-zoom acceptance result. Phone companion
help was checked in light theme and French as well as English/dark desktop.

Tab reaches the visible skip link with a 2-pixel focus outline; Enter focuses
main content. Both mobile navigation menus open accessibly, update expanded
state, close with Escape and restore focus to their menu button. Companion page
changes focus their heading. Browser accessibility trees expose landmarks,
headings, form labels, selected language and button names. A phone screenshot
review found readable hero content, visible focus, wrapping links and no clipping.

## Limits and follow-up

Axe marked some contrast/background and inline-link checks for manual review;
they are retained as incomplete checks, not counted as passes. Automated scans
cannot establish full WCAG conformance. Native NVDA/VoiceOver, actual 200% browser
zoom, signed-in officer/member editing, Windows high contrast and live game
accessibility were not performed. Remaining manual acceptance was waived for
this release by the owner; keep these as post-release checks with bug reports.
No accessibility certification is claimed.
