# Translating the addon

The addon has English, French, German and Spanish translations for all **1,052**
catalogued strings in 8.0.1. German (`deDE`) and Spanish (`esES`, `esMX`) clients
select their language automatically. Use `/guilded lang en|fr|de|es|auto` to choose.
Unknown runtime text, player names, item links and external diagnostics stay unchanged.
The companion, website and bot support English/French; the addon language catalogue
does not claim German/Spanish support for those separate surfaces.

The 28 October pass includes a model-assisted linguistic review, complete catalogue
and formatting checks, and offline Lua/window tests. It is not an external native
speaker certification or an in-game API/visual acceptance claim.

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
