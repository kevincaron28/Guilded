# Guilded 8.0.2 Release

Safety and reliability corrections from the final 8.0.1 audit. All agreed 8.0
features and the complete FR/DE/ES addon catalogues are retained. Protocol stays 2.

- In-game `/guilded sheet` protects formula-like text in spreadsheet cells,
  including raid titles and loot fields. Numbers and formatted decimal values
  stay numeric. Exporting does not alter SavedVariables or original field values.
- `/participation status` calculates season/weekly totals in PostgreSQL and
  returns at most six rows. Old helper awards reversed this week, season/guild
  scope, caps and financial history keep their existing behavior.
- Historical development notes now point to the published feature inventory.

This is a new patch release; published 8.0 and 8.0.1 files are preserved. Keep
SavedVariables and connection profiles when updating. The companion, bot and site
remain English/French; the addons also include German and Spanish.

The free [Microsoft Store companion](https://apps.microsoft.com/detail/9N680XX3QFL9)
uses Store signing and Store updates. The optional GitHub EXE remains unsigned.
No paid signing service or license change is introduced.

Validation/publication: [release completion](V8_0_2_RELEASE_COMPLETION.md).
Forever game data and live calibration remain dependent on game availability;
the owner's earlier manual testing waiver remains recorded.
