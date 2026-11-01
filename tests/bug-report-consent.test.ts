import { describe, expect, it, vi, beforeEach } from "vitest";
import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
const service=vi.hoisted(()=>({destination:vi.fn(),report:vi.fn()}));
const notifier=vi.hoisted(()=>({notifyEmbed:vi.fn(),officerReportDestination:vi.fn()}));
vi.mock("../src/commands/context.js",()=>({errorReportService:service}));
vi.mock("../src/services/notify.js",()=>notifier);
import { bugCommand, executeBug } from "../src/commands/bugreport.js";

const SHOT="https://cdn.discordapp.com/ephemeral-attachments/1/2/shot.png?ex=1&is=2&hm=3";
type Attachment={url:string;name:string;contentType:string|null}|null;
function fixture(action="send",locale="en-US",attachment:Attachment=null) {
  const choice={user:{id:"member"},guildId:"guild",customId:`bugconfirm:request:${action}`,deferUpdate:vi.fn()};
  const collector=vi.fn(async(options:{filter:(c:typeof choice)=>boolean})=>{
    expect(service.report).not.toHaveBeenCalled();
    expect(notifier.notifyEmbed).not.toHaveBeenCalled();
    expect(options.filter({...choice,user:{id:"other"}})).toBe(false);
    expect(options.filter({...choice,guildId:"other"})).toBe(false);
    expect(options.filter({...choice,customId:"bugconfirm:stale:send"})).toBe(false);
    if(action==="timeout") throw new Error("expired");
    expect(options.filter(choice)).toBe(true);return choice;
  });
  const i={id:"request",locale,user:{id:"member"},guildId:"guild",channelId:"source",client:{},
    guild:{name:"Test",members:{fetch:vi.fn(async()=>({id:"member"}))}},
    options:{getString:vi.fn(()=>"Button failed token=topsecret https://private.invalid @everyone"),getAttachment:vi.fn(()=>attachment)},
    deferReply:vi.fn(),editReply:vi.fn(),fetchReply:vi.fn(async()=>({awaitMessageComponent:collector}))};
  return {i,run:()=>executeBug(i as unknown as ChatInputCommandInteraction),collector};
}
const officerEmbed=(lang:"en"|"fr")=>(notifier.notifyEmbed.mock.calls[0]![1] as (l:string)=>EmbedBuilder)(lang).toJSON();
beforeEach(()=>{vi.clearAllMocks();service.destination.mockResolvedValue({id:"private-intake",label:"#errors (Dev)"});service.report.mockResolvedValue("12345678");notifier.notifyEmbed.mockResolvedValue(true);notifier.officerReportDestination.mockResolvedValue({id:"officer-log",label:"#officers (Guild)"});});
describe("member bug report consent",()=>{
  it.each(["en-US","fr"])("previews sanitized text and recipients, then sends once on explicit consent (%s)",async locale=>{
    const s=fixture("send",locale);await s.run();
    expect(s.i.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});
    const preview=s.i.editReply.mock.calls[0]![0];
    expect(preview.content).toContain("#errors (Dev)");
    expect(preview.content).toMatch(locale==="fr" ? /officiers de ce serveur/ : /this server’s officers/);
    const rendered=JSON.stringify(preview);expect(rendered).not.toMatch(/topsecret|private.invalid|@everyone/);
    expect(preview.components).toHaveLength(1);
    expect(service.report).toHaveBeenCalledTimes(1);
    expect(service.report.mock.calls[0]![2]).toMatchObject({consented:true,notificationChannelId:"private-intake",userId:"member",screenshotUrl:null});
    expect(s.i.editReply.mock.calls.at(-1)![0].content).toContain("12345678");
  });
  it("shows the screenshot in the preview and shares the previewed report with officers after Send",async()=>{
    const s=fixture("send","en-US",{url:SHOT,name:"shot.png",contentType:"image/png"});await s.run();
    const preview=s.i.editReply.mock.calls[0]![0];
    expect(preview.content).toContain("Screenshot included: shot.png");
    expect(preview.embeds[0].toJSON().image?.url).toBe(SHOT);
    expect(service.report.mock.calls[0]![2]).toMatchObject({screenshotUrl:SHOT});
    expect(notifier.notifyEmbed).toHaveBeenCalledTimes(1);
    expect(notifier.notifyEmbed.mock.calls[0]![2]).toBe("officer");
    expect(notifier.notifyEmbed.mock.calls[0]![4]).toBe("officer-log");
    const embed=officerEmbed("en");
    expect(embed.description).toContain("Bug report `12345678` from <@member>");
    expect(embed.image?.url).toBe(SHOT);
    expect(JSON.stringify(embed)).not.toMatch(/topsecret|private.invalid|@everyone/);
    expect(officerEmbed("fr").description).toContain("Rapport de bug `12345678` de <@member>");
    expect(s.i.editReply.mock.calls.at(-1)![0].content).toContain("officers were notified");
  });
  it.each([
    ["a file that is not an image",{url:SHOT,name:"notes.txt",contentType:"text/plain"}],
    ["an image hosted outside Discord",{url:"https://evil.example/attachments/shot.png",name:"shot.png",contentType:"image/png"}]
  ])("never sends %s",async(_label,attachment)=>{
    const s=fixture("send","en-US",attachment);await s.run();
    expect(service.report.mock.calls[0]![2].screenshotUrl).toBeNull();
    expect(officerEmbed("en").image).toBeUndefined();
    expect(s.i.editReply.mock.calls[0]![0].embeds[0].toJSON().image).toBeUndefined();
  });
  it("says a non-image attachment will not be sent",async()=>{
    const s=fixture("send","en-US",{url:SHOT,name:"notes.txt",contentType:"text/plain"});await s.run();
    expect(s.i.editReply.mock.calls[0]![0].content).toContain("not an image");
  });
  it.each(["cancel","timeout"])("%s stores and sends nothing, officers included",async action=>{
    const s=fixture(action,"en-US",{url:SHOT,name:"shot.png",contentType:"image/png"});await s.run();
    expect(service.report).not.toHaveBeenCalled();expect(notifier.notifyEmbed).not.toHaveBeenCalled();
    expect(s.i.editReply.mock.calls.at(-1)![0]).toMatchObject({components:[],embeds:[]});
  });
  it("rechecks membership and denies a member who left during preview",async()=>{
    const s=fixture();s.i.guild.members.fetch.mockRejectedValue(new Error("left"));
    await s.run();expect(service.report).not.toHaveBeenCalled();expect(notifier.notifyEmbed).not.toHaveBeenCalled();
  });
  it("does not add an unpreviewed destination when the private channel is unavailable",async()=>{
    service.destination.mockResolvedValue(null);const s=fixture();await s.run();
    expect(service.report.mock.calls[0]![2].notificationChannelId).toBeNull();
    expect(s.i.editReply.mock.calls[0]![0].content).toContain("No Discord notification");
  });
  it("does not promise delivery when storage outcome is unconfirmed",async()=>{
    service.report.mockResolvedValue(null);notifier.notifyEmbed.mockResolvedValue(false);const s=fixture();await s.run();
    const reply=s.i.editReply.mock.calls.at(-1)![0].content;
    expect(reply).toContain("Could not confirm storage");expect(reply).not.toContain("officers were notified");
    expect(notifier.notifyEmbed).not.toHaveBeenCalled();
  });
  it("does not send an officer copy that was unavailable at preview",async()=>{
    notifier.officerReportDestination.mockResolvedValue(null);const s=fixture();await s.run();
    expect(s.i.editReply.mock.calls[0]![0].content).toContain("No officer copy");
    expect(notifier.notifyEmbed).not.toHaveBeenCalled();
    expect(service.report).toHaveBeenCalledOnce();
  });
  it("offers an optional screenshot",()=>{
    const options=bugCommand.toJSON().options ?? [];
    expect(options.map(o=>o.name)).toEqual(["description","screenshot"]);
    expect(options.find(o=>o.name==="screenshot")?.required).toBeFalsy();
  });
});
