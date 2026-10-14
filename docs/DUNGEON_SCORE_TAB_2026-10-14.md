# Finder season-score entry visibility

The owner reported no season-score tab in the Classic Looking for Group
window. The installed DungeonScorePanel.lua matched the source attachment
code: its Guilded scores button was anchored 26 pixels above the finder.
That puts the entry off-screen when the finder is flush with the screen top,
as in the supplied screenshot.

The first footer-button repair was installed and the owner's next screenshot
confirmed it opened the panel, but native controls overlapped the wide score
layout. The owner requested a fourth right-side tab and dungeon ordering by
level instead of name.

Forever now gets a fourth right-side tab using its native
LFGVanillaRightTabTemplate, below WhoListingTab. The score page has its own
portrait-frame border and a 440-pixel single-column layout, four dungeons per
page. Native pages hide while scores are selected; selecting a native page or
closing scores restores normal navigation without replacing native handlers
or changing queue state. Other client layouts retain the footer entry, opening
a centered score dialog. Attachment and clicks still defer during combat.

Dungeons sort by minimum level, then maximum level, then name; entries with
unknown levels come last. Current/past seasons and boss tooltips remain.

Client layout references: the Forever branch's
[finder frame](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_GroupFinder_VanillaStyle/Mainline/Blizzard_LFGVanilla_ParentFrame.xml)
and [tab handlers](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_GroupFinder_VanillaStyle/Blizzard_LFGVanilla_ParentFrame.lua).

Lua regression coverage exercises PVEFrame, LFGParentFrame and LFGFrame,
including delayed loading, combat deferral, duplicate attachment, native-page
restoration, compact rendering, level ordering and closing. Real-client
acceptance of the fourth tab after reload is still pending. No version or
protocol change is part of this fix (the checkout
already identifies itself as 6.1.0).

Initial footer repair validation passed: TypeScript, ESLint, addon static validation, and all 174
test files / 1,437 tests with two workers. Rebuilt dist/Guilded-v6.1.0.zip.
Installed and SHA256-verified DungeonScorePanel.lua in the local
`D:/Program Files (x86)/World of Warcraft/_classic_beta_/Interface/AddOns/Guilded`
folder. The original is in `backups/score-tab-20261014-045749`.
SavedVariables and companion-generated standings were untouched. Reload the
client to check the visible entry and panel; no live-client pass is claimed.

Fourth-tab follow-up: TypeScript, ESLint, addon validation and all 174 files /
1,439 tests passed. Rebuilt the addon ZIP and installed/hash-verified the new
DungeonScorePanel.lua in the same client folder. The previous footer patch is
backed up in `backups/score-side-tab-20261014-050949`. SavedVariables and
Standings.lua remain untouched. The fourth-tab layout needs an in-game reload
and visual acceptance; automated tests do not prove the rendered appearance.

## Subtle dungeon backgrounds, 14 October

The score cards now use low-opacity client-owned Encounter Journal artwork,
center-cropped to each row with a dark overlay. Names, scores, targets and the
gold progress bar stay above the artwork. Classic dungeons use matching art;
Hall of Thanes, Ruins of Lordaeron, Excavation Site: Wetlands and City of Dalaran
use thematic substitutes (Halls of Stone, Stratholme, Uldaman and Violet Hold).
Unknown dungeons use the client's default journal art. Failed texture loads
leave the existing solid background. Reused/empty cards clear or replace art.
No external images, additional addon dependencies, SavedVariables or version
changes. Actual texture availability and readability need an in-game check
on Forever after reload; offline tests cannot establish rendered appearance.

Background update validation passed: TypeScript, ESLint, addon validator, and all 174 test files / 1,439 tests. Rebuilt the addon ZIP and installed/hash-verified only DungeonScorePanel.lua locally. Previous panel backup: C:\Users\Kev\Desktop\Quebec Gold Bot\backups\dungeon-backgrounds-20261014-053249. In-game visual acceptance remains pending.
