import { describe, expect, it, vi } from "vitest";
import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";
import { diagnosticTarget } from "../src/services/diagnostic-target.js";

function fixture() {
  const visible=new Set<string>(["bot","admin"]);
  const roles=[{id:"everyone",permissions:{has:()=>false}},{id:"member",permissions:{has:()=>false}},
    {id:"admin",permissions:{has:()=>true}},{id:"bot-role",tags:{botId:"bot"},permissions:{has:()=>false}}];
  const overwrites=new Map<string,{id:string;type:number}>();
  const send=vi.fn();
  const channel={id:"intake",name:"errors",type:ChannelType.GuildText,send,
    guild:{name:"Dev",roles:{fetch:async()=>new Map(roles.map(r=>[r.id,r]))},members:{fetchMe:async()=>({id:"bot"}),fetch:vi.fn(async(id:string)=>({id,permissions:{has:()=>false}}))}},
    permissionOverwrites:{cache:overwrites},permissionsFor:(value:{id:string})=>({has:()=>visible.has(value.id)})};
  const client={user:{id:"bot"},channels:{fetch:vi.fn(async()=>channel)}} as unknown as Client;
  return {client,channel,visible,overwrites};
}
describe("diagnostic recipient authorization",()=>{
  it("accepts only a verifiably private administrator/bot destination",async()=>{
    const s=fixture();expect((await diagnosticTarget(s.client,"intake"))?.id).toBe("intake");
    expect(s.client.channels.fetch).toHaveBeenCalledWith("intake",{force:true});
    expect(s.channel.send).not.toHaveBeenCalled();
  });
  it.each(["everyone","member"])("denies %s visibility and rechecks changed permissions",async role=>{
    const s=fixture();expect(await diagnosticTarget(s.client,"intake")).not.toBeNull();
    s.visible.add(role);expect(await diagnosticTarget(s.client,"intake")).toBeNull();
  });
  it("denies a non-administrator member overwrite and unresolved recipient",async()=>{
    const s=fixture();s.overwrites.set("other",{id:"other",type:1});s.visible.add("other");
    expect(await diagnosticTarget(s.client,"intake")).toBeNull();
    s.channel.guild.members.fetch.mockRejectedValueOnce(new Error("not found"));
    expect(await diagnosticTarget(s.client,"intake")).toBeNull();
  });
  it("denies missing bot permissions, DMs and failed channel lookup",async()=>{
    const s=fixture();s.visible.delete("bot");expect(await diagnosticTarget(s.client,"intake")).toBeNull();
    s.channel.type=ChannelType.DM as typeof ChannelType.GuildText;expect(await diagnosticTarget(s.client,"intake")).toBeNull();
    vi.mocked(s.client.channels.fetch).mockRejectedValueOnce(new Error("denied"));expect(await diagnosticTarget(s.client,"intake")).toBeNull();
    expect(await diagnosticTarget(null,"intake")).toBeNull();
    expect(PermissionFlagsBits.Administrator).toBeDefined();
  });
});
