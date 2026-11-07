# One name standard (ROADMAP item 15)

Every character name in Discord output goes through `src/services/character-display.ts`:

- `displayCharacterName(character, ...sources)`: the full "First Last" when known; never doubles the first name ("Xaldin Xaldin" becomes "Xaldin"); never uses a realm as a last name ("Shawir Forever" becomes "Shawir"). It also cleans an already-full stored name.
- `cleanCharacterName(name, realm?)`: only that cleanup, for a plain string with no row or book to resolve.
- `characterLabel(character, { sources, mention, member })`: the name plus " (<@id>)" where a mention is wanted, or " (@name)" from a Discord name. A Discord name is never shown alone for a character.

A name is never invented: a first name nothing else knows stays as stored.

Guard: `tests/name-standard.test.ts` scans `src/` for raw `${x.character}`, `${x.characterName}`, `${character.name}` interpolation. Sites not yet routed are counted in `tests/fixtures/raw-name-baseline.json`; the count may only go down (after fixing a site run `UPDATE_NAME_BASELINE=1 npx vitest run tests/name-standard.test.ts`). Helper and data-key files are allow-listed in the test. Web pages (HTML builders) and member/Discord display names (`member.displayName`) are outside this guard.
