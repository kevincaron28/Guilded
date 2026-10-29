/* Offline UI acceptance fixture. Synthetic data; no credentials or network writes. */
(() => {
  const $=id=>document.getElementById(id);
  const member=new URLSearchParams(location.search).get('member')==='1';
  const slots=[['armorLarge','Head, chest and legs',100],['armorMedium','Shoulders, hands, waist and feet',75],['accessory','Wrist, neck, cloak and ring',50],['trinket','Trinket',100],['oneHand','One-hand weapon',100],['offHand','Shield or held off-hand',100],['twoHand','Two-hand weapon',200],['ranged','Bow, gun or crossbow',200],['relic','Wand, thrown weapon or relic',25],['utility','Bag or verified utility item',0],['legendary','Completed legendary',400],['unknown','Unknown item (confirmation required)',100]].map(([key,label,gp])=>({key,label,gp}));
  const policy={preset:'december-flat-v1',edition:'forever',slots:Object.fromEntries(slots.map(s=>[s.key,s.gp]))};
  const rules={attendanceEp:100,lateEp:50,bossEp:0,completionEp:0,baseGp:100,decayPercent:10,offspecPercent:50,minEp:0,separatePool:true,lootMode:'PRIORITY'};
  const data={updatedAt:new Date().toISOString(),edition:'forever',guildName:'December rehearsal · synthetic guild',me:{raidLeader:!member},pricingPreset:{policy,slots},coreLootOnly:true,guildPrices:[],
    dungeonLeaderboard:{available:true,board:{id:'season',season:'December preseason',provisionalTargets:true,rows:[{name:'Ann',points:300,bracket:'60'},{name:'Bob',points:300,bracket:'60'},{name:'Cy',points:250,bracket:'60'},{name:'Dee',points:125,bracket:'40–49'}],week:{rows:[{name:'Ann',points:75,bracket:'60'}]},history:[{id:'past',season:'October rehearsal',rows:[{name:'Cy',points:420,bracket:'60'}]}]}},
    cores:[{id:'core',name:'December progression',pricing:structuredClone(policy),pricingRevision:1,automaticDecay:true,effective:rules,prices:[{key:'#12345@ilvl:100',name:'Verified fixture token',id:12345,gp:100}],leaderboard:[{rank:1,name:'Ann',character:'Ann-Forever',ep:300,gp:100,pr:1.5,me:true},{rank:1,name:'Bob',character:'Bob-Forever',ep:150,gp:0,pr:1.5},{rank:3,name:'Cy',character:'Cy-Forever',ep:100,gp:0,pr:1}]},{id:'old',name:'Existing core · preview',pricing:null,pricingRevision:0,automaticDecay:false,effective:{...rules,baseGp:1000},prices:[],leaderboard:[]}]};
  const panel=document.createElement('aside');panel.className='panel';
  panel.innerHTML='<h2>OFFLINE REHEARSAL — synthetic data only</h2><label>Save result<select id="fixtureOutcome"><option value="success">Success</option><option value="fail">Refused</option><option value="throw">Disconnected</option><option value="hold">Hold until resolved</option></select></label><button id="fixtureResolve">Resolve held save</button><button id="fixtureSwitch">Switch to another guild</button><p id="fixtureCalls">0 save requests</p><output id="fixturePayload"></output>';
  document.querySelector('.workspace').prepend(panel);
  let calls=0,finish;
  window.companion={manageView:async()=>({ok:true,data:structuredClone(data)}),manageEdit:async change=>{
    $('fixtureCalls').textContent=`${++calls} save requests`;$('fixturePayload').textContent=JSON.stringify(change);
    const mode=$('fixtureOutcome').value;if(mode==='fail')return{ok:false,error:'Conflict: reload and review your draft.'};if(mode==='throw')throw Error('Disconnected');if(mode==='hold')return new Promise(resolve=>{finish=resolve;});
    const core=data.cores.find(c=>c.id===change.coreId);
    if(change.action==='pricing.update'){core.pricing.slots=change.slots;core.pricingRevision++;}
    if(change.action==='pricing.enable'){core.pricing=structuredClone(policy);core.pricingRevision++;}
    if(change.action==='pricing.create'){data.cores.push({...structuredClone(data.cores[0]),id:'new',name:change.name,prices:[],leaderboard:[]});}
    return{ok:true,data:{message:'Saved.',rosterCoreId:change.action==='pricing.create'?'new':change.coreId}};
  }};
  $('fixtureResolve').addEventListener('click',()=>{finish?.({ok:false,error:'Refused'});finish=null;});
  $('fixtureSwitch').addEventListener('click',()=>{document.dispatchEvent(new CustomEvent('companion-connection-changing'));data.guildName='Other synthetic guild';data.cores=[];document.dispatchEvent(new CustomEvent('companion-connection-changed'));});
  $('language').addEventListener('change',()=>window.companionLanguage.set($('language').value,false));
  function page(name){document.querySelectorAll('.page').forEach(p=>{p.hidden=p.id!=='page-'+name;});}
  document.querySelectorAll('.nav').forEach(b=>{b.disabled=!['pricing','leaderboards'].includes(b.dataset.page);if(!b.disabled)b.addEventListener('click',()=>page(b.dataset.page));});
  page(new URLSearchParams(location.search).get('tab')||'pricing');
})();
