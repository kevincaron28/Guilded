import { ChannelType, Collection, PermissionFlagsBits as P, PermissionsBitField, type Guild, type GuildBasedChannel, type GuildMember } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { canViewParticipationChannel, participationChannelCoverage, participationChannelEnabled } from "../src/services/participation-channels.js";
import { participationRules } from "../src/services/participation-rules.js";

describe("participation channel visibility", () => {
  it("does not confuse parent permission with private-thread membership", async () => {
    const actor = { id: "actor" } as GuildMember;
    const permissions = new PermissionsBitField([P.ViewChannel]);
    const fetch = vi.fn(async () => { throw new Error("Not a member"); });
    const channel = { type: ChannelType.PrivateThread, permissionsFor: () => permissions, members: { fetch } } as unknown as GuildBasedChannel;
    expect(await canViewParticipationChannel(channel, actor)).toBe(false);
    permissions.add(P.ManageThreads);
    expect(await canViewParticipationChannel(channel, actor)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    permissions.remove(P.ViewChannel);
    expect(await canViewParticipationChannel(channel, actor)).toBe(false);
  });
  it("excludes DMs, categories and forum parents from direct message earning", () => {
    const rules = participationRules.parse({ allText: true });
    for (const type of [ChannelType.DM, ChannelType.GroupDM, ChannelType.GuildCategory, ChannelType.GuildForum, ChannelType.GuildMedia]) {
      expect(participationChannelEnabled({ id: "channel", type }, rules)).toBe(false);
    }
  });
  it("reports inaccessible bot channels while omitting channels hidden from the officer", async () => {
    const actor = { id: "actor" } as GuildMember, bot = { id: "bot" } as GuildMember;
    const makeChannel = (id: string, type: ChannelType) => ({ id, type, permissionsFor: (member: GuildMember) => new PermissionsBitField(member.id === (id === "hidden" ? "actor" : "bot") && ["hidden", "blocked"].includes(id) ? [] : [P.ViewChannel, P.ReadMessageHistory]) });
    const channels = new Collection([makeChannel("text", ChannelType.GuildText), makeChannel("hidden", ChannelType.GuildText), makeChannel("blocked", ChannelType.GuildAnnouncement), makeChannel("forum", ChannelType.GuildForum)].map(channel => [channel.id, channel]));
    const guild = { channels: { fetch: vi.fn(async () => channels) }, members: { me: bot } } as unknown as Guild;
    const rows = await participationChannelCoverage(guild, actor, participationRules.parse({}), true);
    expect(rows.map(row => [row.id, row.state, row.posts])).toEqual([["text", "enabled", false], ["blocked", "unavailable", false], ["forum", "enabled", true]]);
    expect((await participationChannelCoverage(guild, actor, participationRules.parse({}), false))[0]?.state).toBe("paused");
    expect((await participationChannelCoverage(guild, actor, participationRules.parse({ allText: false }), true))[0]?.state).toBe("excluded");
  });
});
