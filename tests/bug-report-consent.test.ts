import { describe, expect, it, vi, beforeEach } from "vitest";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
const service=vi.hoisted(()=>({destination:vi.fn(),report:vi.fn()}));
vi.mock("../src/commands/context.js",()=>({errorReportService:service}));
import { bugCommand, executeBug } from "../src/commands/bugreport.js";

function fixture(action="send",locale="en-US") {
  const choice={user:{id:"member"},guildId:"guild",customId:`bugconfirm:request:${action}`,deferUpdate:vi.fn()};
  const collector=vi.fn(async(options:{filter:(c:typeof choice)=>boolean})=>{
    expect(service.report).not.toHaveBeenCalled();
    expect(options.filter({...choice,user:{id:"other"}})).toBe(false);
    expect(options.filter({...choice,guildId:"other"})).toBe(false);
    expect(options.filter({...choice,customId:"bugconfirm:stale:send"})).toBe(false);
    if(action==="timeout") throw new Error("expired");
    expect(options.filter(choice)).toBe(true);return choice;
  });
  const i={id:"request",locale,user:{id:"member"},guildId:"guild",channelId:"source",client:{},
    guild:{name:"Test",members:{fetch:vi.fn(async()=>({id:"member"}))}},
    options:{getString:vi.fn(()=>"Button failed token=topsecret https://private.invalid @everyone"),getAttachment:vi.fn()},
    deferReply:vi.fn(),editReply:vi.fn(),fetchReply:vi.fn(async()=>({awaitMessageComponent:collector}))};
  return {i,run:()=>executeBug(i as unknown as ChatInputCommandInteraction),collector};
}
beforeEach(()=>{vi.clearAllMocks();service.destination.mockResolvedValue({id:"private-intake",label:"#errors (Dev)"});service.report.mockResolvedValue("12345678");});
describe("member bug report consent",()=>{
  it.each(["en-US","fr"])("previews sanitized text and destinations, then sends once on explicit consent (%s)",async locale=>{
    const s=fixture("send",locale);await s.run();
    expect(s.i.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});
    const preview=s.i.editReply.mock.calls[0]![0];
    expect(preview.content).toContain("#errors (Dev)");
    const rendered=JSON.stringify(preview);expect(rendered).not.toMatch(/topsecret|private.invalid|@everyone/);
    expect(preview.components).toHaveLength(1);
    expect(service.report).toHaveBeenCalledTimes(1);
    expect(service.report.mock.calls[0]![2]).toMatchObject({consented:true,notificationChannelId:"private-intake",userId:"member"});
    expect(s.i.options.getAttachment).not.toHaveBeenCalled();
    expect(s.i.editReply.mock.calls.at(-1)![0].content).toContain("12345678");
  });
  it.each(["cancel","timeout"])("%s stores and sends nothing",async action=>{
    const s=fixture(action);await s.run();expect(service.report).not.toHaveBeenCalled();
    expect(s.i.editReply.mock.calls.at(-1)![0]).toMatchObject({components:[],embeds:[]});
  });
  it("rechecks membership and denies a member who left during preview",async()=>{
    const s=fixture();s.i.guild.members.fetch.mockRejectedValue(new Error("left"));
    await s.run();expect(service.report).not.toHaveBeenCalled();
  });
  it("does not add an unpreviewed destination when the private channel is unavailable",async()=>{
    service.destination.mockResolvedValue(null);const s=fixture();await s.run();
    expect(service.report.mock.calls[0]![2].notificationChannelId).toBeNull();
    expect(s.i.editReply.mock.calls[0]![0].content).toContain("No Discord notification");
  });
  it("does not promise delivery when storage outcome is unconfirmed",async()=>{
    service.report.mockResolvedValue(null);const s=fixture();await s.run();
    expect(s.i.editReply.mock.calls.at(-1)![0].content).toContain("Could not confirm storage");
  });
  it("does not request screenshot/file uploads",()=>{
    expect(bugCommand.toJSON().options?.map(o=>o.name)).toEqual(["description"]);
  });
});
