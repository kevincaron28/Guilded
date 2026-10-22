# Translating the addon

The addon speaks English and French in full, and German and Spanish for the most visible text
(7.4: sidebar, pages, buttons, gear check, standings, dungeon scores, about 150 lines each). Anything
not translated yet shows in English. A German client (`deDE`) or Spanish client (`esES`, `esMX`) picks
its language by itself; players can also type `/guilded lang de` or `/guilded lang es`.

## For translators (no Lua needed)

1. Ask for the CSV for your language, or run `npm run locale -- export de` (or `es`). It is written to
   `dist/locale-de.csv` with three columns: `english`, `french` (for context) and your language.
2. Open it in Excel, LibreOffice or Google Sheets and fill your language's column. Leave a cell empty
   to keep English for that line.
3. Keep codes as they are: `%s` and `%d` (same order as the English), `%%`, `|cff...` colour codes,
   `|r`, and slash commands such as `/guilded`.
4. Save as CSV (UTF-8) and send it back.

## For maintainers

```bash
npm run locale -- import de path/to/locale-de.csv
```

```bash
npm run dungeons:sync
```

`import` rewrites only the `-- BEGIN DE` / `-- END DE` block of `addon/Guilded/Locale.lua`, writes
accents as Lua byte escapes (the validator rejects non-ASCII), and refuses a line whose `%s`/`%d`
placeholders differ from the English. Then run the addon validator and the tests.
`npm run locale -- status` shows how many lines each language has. A new language needs a block and
an entry in `TABLES` / `CLIENT_LANGUAGES` in `Locale.lua`, plus its code in `scripts/addon-locale.mjs`.
