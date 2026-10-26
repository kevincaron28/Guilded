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
