// Pure aggregation for `npm run link:coverage` (scripts/link-coverage.ts): how many members of
// one guild scope are linked to WoW characters. No database access here, so it is unit-tested.
//
// Meaning of "linked": a Member row has at least one Character. A character is "provisional" when
// the member's own paired companion linked it from a /guilded verify code that no officer's
// upload has confirmed yet (CharacterVerifyClaim status PROVISIONAL, character-verify.ts); every
// other linked character (claim, officer link, autolink, officer-confirmed code) counts as verified.

export interface CoverageMember {
  memberId: string;
  discordUserId: string;
  displayName: string;
  characters: { name: string; realm: string; nameKey: string }[];
  /** Active (not revoked) companion pairing credentials, member-level or web-account-level. */
  companionDevices: number;
  /** nameKeys of this member's characters whose verify claim is still PROVISIONAL. */
  provisionalKeys: string[];
}

export interface CoverageUnclaimed { name: string; realm: string }

export interface GuildCoverage {
  members: number;
  linked: number;
  /** Linked members with every character verified. */
  fullyVerified: number;
  /** Linked members with at least one provisional character. */
  hasProvisional: number;
  unlinked: number;
  withCompanion: number;
  /** Linked but no companion pairing, and unlinked but with one. */
  linkedWithoutCompanion: number;
  companionWithoutLink: number;
  characters: number;
  provisionalCharacters: number;
  unclaimedCharacters: number;
}

export interface MemberRow {
  discordUserId: string;
  displayName: string;
  state: "verified" | "provisional" | "unlinked";
  characters: string[];
  companion: boolean;
}

export function summarizeCoverage(members: CoverageMember[], unclaimed: CoverageUnclaimed[]): { summary: GuildCoverage; rows: MemberRow[] } {
  const rows: MemberRow[] = [];
  const summary: GuildCoverage = {
    members: members.length, linked: 0, fullyVerified: 0, hasProvisional: 0, unlinked: 0, withCompanion: 0,
    linkedWithoutCompanion: 0, companionWithoutLink: 0, characters: 0, provisionalCharacters: 0, unclaimedCharacters: unclaimed.length
  };
  for (const member of members) {
    const provisional = new Set(member.provisionalKeys);
    const provisionalCount = member.characters.filter((c) => provisional.has(c.nameKey)).length;
    const companion = member.companionDevices > 0;
    summary.characters += member.characters.length;
    summary.provisionalCharacters += provisionalCount;
    if (companion) summary.withCompanion++;
    let state: MemberRow["state"];
    if (member.characters.length === 0) {
      state = "unlinked";
      summary.unlinked++;
      if (companion) summary.companionWithoutLink++;
    } else {
      summary.linked++;
      if (!companion) summary.linkedWithoutCompanion++;
      if (provisionalCount > 0) { state = "provisional"; summary.hasProvisional++; }
      else { state = "verified"; summary.fullyVerified++; }
    }
    rows.push({ discordUserId: member.discordUserId, displayName: member.displayName, state, characters: member.characters.map((c) => `${c.name}-${c.realm}${provisional.has(c.nameKey) ? " (provisional)" : ""}`), companion });
  }
  const order = { unlinked: 0, provisional: 1, verified: 2 };
  rows.sort((a, b) => order[a.state] - order[b.state] || a.displayName.localeCompare(b.displayName));
  return { summary, rows };
}
