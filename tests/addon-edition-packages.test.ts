import { describe,it,expect } from "vitest";
import { unzipSync } from "fflate";
import { packageEdition } from "../scripts/build-addon-editions.mjs";

describe("edition release archives",()=>{
  it("packages both addons for WoW Forever without guild records",()=>{
    const edition="forever";
    for(const addon of ["Guilded","GuildedDungeons"]){
      const built=packageEdition(addon,edition);
      const files=unzipSync(built.packed), decode=(path:string)=>new TextDecoder().decode(files[path]);
      expect(decode(`${addon}/${addon}.toc`)).toContain(`## X-Guilded-Edition: ${edition}`);
      expect(decode(`${addon}/${addon}.toc`)).toContain(`## Interface: ${built.interface}`);
      if(addon==="Guilded") expect(decode("Guilded/Standings.lua")).toContain("players = {}");
      expect(Object.keys(files).some(name=>name.includes("SavedVariables"))).toBe(false);
    }
  });
  it("packages no other WoW edition",()=>{
    expect(()=>packageEdition("Guilded","retail",16001)).toThrow();
    expect(()=>packageEdition("Guilded","classic-era",11509)).toThrow();
    expect(()=>packageEdition("Guilded","forever",11509)).toThrow();
  });
});
