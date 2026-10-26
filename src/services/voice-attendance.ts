// /lead attendance-voice: who to mark present from a voice channel. Pure, so it can be tested
// without Discord. Only this guild's active members are marked; records an officer already made
// (Late, Benched...) are kept; nobody is marked absent: signups missing from the channel are
// listed for the officer to record by hand.
export interface VoicePerson { discordUserId: string; displayName: string }
export interface KnownMember { id: string; discordUserId: string }
export interface VoiceSignup { discordUserId: string; name: string; status: string }

export function voiceAttendancePlan(input: { inVoice: VoicePerson[]; known: KnownMember[]; recorded: Set<string>; signups: VoiceSignup[] }) {
  const knownByUser = new Map(input.known.map((member) => [member.discordUserId, member]));
  const inVoice = new Set(input.inVoice.map((person) => person.discordUserId));
  const mark: string[] = [], kept: string[] = [], strangers: string[] = [];
  for (const person of input.inVoice) {
    const member = knownByUser.get(person.discordUserId);
    if (!member) strangers.push(person.displayName);
    else if (input.recorded.has(member.id)) kept.push(member.id);
    else mark.push(member.id);
  }
  const missing = input.signups.filter((signup) => signup.status === "SIGNED_UP" && !inVoice.has(signup.discordUserId)).map((signup) => signup.name);
  return { mark, kept, strangers, missing };
}

// The officer's reply: whole names only, each list held to a share of Discord's 2,000 characters.
export function nameList(names: string[], budget: number): string {
  let text = "";
  for (let i = 0; i < names.length; i++) {
    const next = text ? `${text}, ${names[i]}` : names[i]!;
    const more = ` +${names.length - i - 1}`;
    if (next.length + (i < names.length - 1 ? more.length : 0) > budget) return `${text || "…"} +${names.length - i}`;
    text = next;
  }
  return text;
}

export function voiceAttendanceSummary(input: { raid: string; channel: string; marked: number; kept: number; strangers: string[]; missing: string[] }): string {
  return [
    `Marked **${input.marked}** present from 🔊 ${input.channel.slice(0, 100)} for **${input.raid.slice(0, 100)}**.`,
    ...(input.kept ? [`Kept ${input.kept} attendance record(s) already made.`] : []),
    ...(input.strangers.length ? [`In the channel but not active members of this guild (not recorded): ${nameList(input.strangers, 700)}.`] : []),
    ...(input.missing.length ? [`Signed up but not in the channel: ${nameList(input.missing, 700)}. Record them with /lead attendance.`] : [])
  ].join("\n").slice(0, 2000);
}
