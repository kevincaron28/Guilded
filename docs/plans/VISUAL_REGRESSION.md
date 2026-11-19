# Visual regression in CI (R2.6/R2.7 follow-up, 19 Nov 2026)

Status: plan only. Not added to CI because card text is drawn with the host's fonts, so a Windows baseline and the Linux CI runner differ by more than any useful tolerance; a test that cannot be run on both would be flaky.

Plan, about ten lines:
1. Pick three cards that cover the layouts: a dungeon run card, a ladder card and the roster card (`src/services/score-card.ts`, `scoreCardPng`).
2. Render each with fixed, committed input data (no dates, no random ids) in a Vitest file, `tests/visual-cards.test.ts`.
3. Use the bundled card fonts only (the `font-src` files shipped with the bot), loaded explicitly, never system fonts, so Windows and Linux render alike.
4. Downscale each PNG with `sharp` to 64 x 34 greyscale and compare with a committed baseline in `tests/visual-baselines/` by mean absolute difference (tolerance about 3 of 255).
5. On a difference, write the new PNG next to the baseline as `*.actual.png` and fail; CI uploads it as an artifact.
6. Baselines are made on the Linux runner (a `workflow_dispatch` job with `UPDATE_VISUAL=1`), never on a PC.
7. No new dependency: `sharp` is already used by the cards.
8. Run it as a separate step in `.github/workflows/quality.yml` so a font change fails only that step.
9. Review each baseline change in the pull request like code.
10. Start with the three cards, then add one per new card family.
