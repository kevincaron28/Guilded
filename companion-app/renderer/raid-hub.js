(() => {
  const api = window.companion;
  if (!api?.manageView) return;
  const $ = id => document.getElementById(id);
  const T = (key, ...args) => window.companionLanguage.t(key, ...args);
  let data = null, loading = false, saving = false, coreId = '', boardType = 'epgp', seasonId = '', bracket = '', search = '';
  let generation = 0, switching = false;
  const drafts = new Map();
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key,value] of Object.entries(props)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key in node) node[key] = value;
      else node.setAttribute(key,value);
    }
    node.append(...children.filter(c => c != null)); return node;
  };
  const text = (value, cls = 'micro') => el('p', {class:cls,text:value});
  const button = (label, action, cls = '') => { const b = el('button',{type:'button',text:T(label),class:cls}); b.addEventListener('click',action); return b; };
  function select(label, rows, value, onChange) {
    const input = el('select',{'aria-label':T(label)},...rows.map(([id,name])=>el('option',{value:id,text:name})));
    input.value = value; input.addEventListener('change',()=>onChange(input.value)); return el('label',{},T(label),input);
  }
  const current = () => data?.cores.find(c=>c.id===coreId);
  function notices(message, error = false) {
    for (const id of ['pricingNotice','boardsNotice']) { $(id).textContent=message; $(id).className=error?'result bad':'micro'; }
  }
  async function load(afterSave = false) {
    if (loading || switching || (saving && afterSave !== true)) return; loading=true;
    const request = generation;
    $('pricingReload').disabled=true; $('boardsReload').disabled=true;
    try {
      const result=await api.manageView();
      if(request!==generation)return;
      if(!result.ok)throw Error(result.error || T('Connect a guild account to see raid prices and leaderboards.'));
      data=result.data;
      if(!data.pricingPreset)throw Error(T('Update your guild bot to use raid pricing and leaderboards.'));
      if(!data.cores.some(c=>c.id===coreId))coreId=data.cores[0]?.id||'';
      notices(T('Updated {0} · {1} · {2}',new Date(data.updatedAt).toLocaleString(),data.guildName||'',data.edition));
      renderPrices();renderBoards();
    }catch(error){if(request===generation){data=null;$('pricingContent').replaceChildren();$('boardsContent').replaceChildren();notices(error.message,true);}}
    finally{if(request===generation){loading=false;$('pricingReload').disabled=false;$('boardsReload').disabled=false;}}
  }
  async function save(change) {
    if(saving||loading||switching)return;
    const request=generation;
    saving=true;$('pricingContent').inert=true;
    try{
      const result=await api.manageEdit(change);
      if(request!==generation)return;
      if(!result.ok)throw Error(result.error||T('That change was not saved.'));
      drafts.delete(change.coreId);
      if(change.action==='pricing.create')coreId=result.data.rosterCoreId||coreId;
      await load(true);notices(window.companionLanguage.message(result.data.message));
    }catch(error){if(request===generation)notices(error.message,true);}
    finally{if(request===generation){saving=false;$('pricingContent').inert=false;}}
  }
  function corePicker(render) { return select('Raid core',data.cores.map(c=>[c.id,c.name]),coreId,v=>{coreId=v;render();}); }
  function table(headers, rows) {
    return el('div',{class:'raid-table-wrap'},el('table',{class:'raid-table'},
      el('thead',{},el('tr',{},...headers.map(h=>el('th',{scope:'col',text:T(h)})))),el('tbody',{},...rows)));
  }
  function renderPrices() {
    const host=$('pricingContent');host.replaceChildren();
    if(data.me.raidLeader){
      const name=el('input',{required:true,minLength:2,maxLength:60,placeholder:T('New raid core name'),'aria-label':T('New raid core name')});
      const form=el('form',{class:'edit-row'},name,el('button',{type:'submit',class:'primary',text:T('Create December-ready core')}));
      form.addEventListener('submit',e=>{e.preventDefault();if(form.reportValidity())void save({action:'pricing.create',name:name.value.trim()});});
      host.append(el('details',{class:'panel'},el('summary',{text:T('Start a new core with recommended defaults')}),
        text(T('Creates a separate empty point pool: 100 attendance EP, 100 base GP, 10% weekly decay and 50% off-spec. Existing cores and balances stay intact.')),form));
    }
    if(!data.cores.length){host.append(text(T('No raid core yet. Ask a Raid Leader to create one.')));return;}
    const c=current();
    const policy=c.pricing||data.pricingPreset.policy;
    const draft=drafts.get(c.id);
    host.append(el('article',{class:'panel'},corePicker(renderPrices),text(c.pricing?T('Active preset · revision {0} · {1}',c.pricingRevision,policy.edition):T('Preview only — this core has not enabled the preset.')),
      text(T('Item overrides win over slot prices. New prices apply to the next started raid; quoted awards keep their price.')),
      text(T('Loot mode: {0}',c.effective.lootMode)),
      text(c.automaticDecay?T('Automatic decay is on: Tuesday at 15:00 UTC, after any active connected raid finishes.'):T('Automatic decay is off. Enable it with /officer epgp decay core:<name> weekly:true.'))));
    const stats=[['Attendance EP',c.effective.attendanceEp],['Base GP',c.effective.baseGp],['Weekly decay',c.effective.decayPercent+'%'],['Off-spec',c.effective.offspecPercent+'%']];
    host.append(el('div',{class:'raid-rule-summary'},...stats.map(([label,value])=>el('article',{class:'panel'},el('span',{class:'label',text:T(label)}),el('strong',{text:String(value)})))));
    if(!c.pricing&&data.me.raidLeader){
      host.append(el('article',{class:'panel'},text(T('Enable prices only to preserve this core’s point rules. Apply all defaults only to an empty pool.')),
        el('div',{class:'actions'},button('Enable prices only',()=>save({action:'pricing.enable',coreId:c.id,revision:c.pricingRevision,applyRules:false})),
          button('Apply preset to empty pool',()=>save({action:'pricing.enable',coreId:c.id,revision:c.pricingRevision,applyRules:true})))));
    }
    const inputs={};
    const rows=data.pricingPreset.slots.map(slot=>{
      const amount=draft?.slots[slot.key]??policy.slots[slot.key];
      const input=el('input',{type:'number',min:0,max:100000,step:1,value:String(amount),required:true,disabled:!data.me.raidLeader||!c.pricing,'aria-label':T('Price of {0}',T(slot.label)),class:'number'});
      inputs[slot.key]=input;
      const os=el('td',{text:String(Math.round(amount*c.effective.offspecPercent/100))});
      input.addEventListener('input',()=>{drafts.set(c.id,{revision:draft?.revision??c.pricingRevision,slots:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))});os.textContent=input.validity.valid&&input.value!==''?String(Math.round(Number(input.value)*c.effective.offspecPercent/100)):'—';});
      return el('tr',{},el('th',{scope:'row',text:T(slot.label)}),el('td',{},input),os,el('td',{text:String(slot.gp)}));
    });
    const form=el('form',{},table(['Equipment','Main spec GP','Off spec GP','Recommended'],rows));
    if(data.me.raidLeader&&c.pricing)form.append(el('div',{class:'actions'},el('button',{class:'primary',type:'submit',text:T('Save slot prices')})));
    if(draft)form.append(button('Discard draft',()=>{drafts.delete(c.id);renderPrices();}));
    form.addEventListener('submit',e=>{e.preventDefault();if(form.reportValidity())void save({action:'pricing.update',coreId:c.id,revision:drafts.get(c.id)?.revision??c.pricingRevision,slots:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,Number(v.value)]))});});
    host.append(el('article',{class:'panel'},el('h2',{text:T('Slot prices')}),form));
    const merged=new Map();
    if(!data.coreLootOnly)for(const p of data.guildPrices)merged.set(p.key||p.name,{...p,source:'Guild override'});
    for(const p of c.prices)merged.set(p.key||p.name,{...p,source:'Core override'});
    const priceRows=[...merged.values()].map(p=>el('tr',{},el('th',{scope:'row',text:p.name}),el('td',{text:p.key||String(p.id||'')}),el('td',{text:String(p.gp)}),el('td',{text:T(p.source)})));
    host.append(el('article',{class:'panel'},el('h2',{text:T('Item overrides')}),
      priceRows.length?table(['Item','Identity','GP','Source'],priceRows):text(T('No item overrides. Equipment uses the slot table.')),
      text(T('Edit individual items in Cores & prices. Use id:12345 for every copy, or id:12345@ilvl:100 for that item level. Named overrides remain supported.'))));
    const mine=c.leaderboard?.find(row=>row.me);
    const ep=el('input',{type:'number',min:0,step:1,value:String(mine?.ep??100),'aria-label':'EP'});
    const gp=el('input',{type:'number',min:0,step:1,value:String(mine?.gp??0),'aria-label':'GP'});
    const price=el('input',{type:'number',min:0,max:100000,step:1,value:'100','aria-label':T('Price in GP')});
    const result=el('output',{'aria-live':'polite',class:'raid-quote'});
    const calc=()=>{const values=[ep,gp,price];if(values.some(n=>!n.validity.valid||n.value==='')){result.textContent=T('Enter non-negative whole numbers.');return;}const denominator=Number(gp.value)+c.effective.baseGp;result.textContent=T('PR {0} → {1} after {2} GP',(Number(ep.value)/Math.max(1,denominator)).toFixed(3),(Number(ep.value)/Math.max(1,denominator+Number(price.value))).toFixed(3),price.value);};
    for(const n of[ep,gp,price])n.addEventListener('input',calc);calc();
    host.append(el('article',{class:'panel'},el('h2',{text:T('What happens to my priority?')}),el('div',{class:'form-grid'},el('label',{},'EP',ep),el('label',{},'GP',gp),el('label',{},T('Price in GP'),price)),result,
      text(T('Main spec before off-spec. Highest PR wins; exact ties use a visible roll. Preview only — this calculator changes no points.'))));
    host.append(el('article',{class:'panel'},el('h2',{text:T('Raid-night rules')}),
      text(T('One attendance award per scheduled session, even across several raids. Approved standby earns the same credit. Alts share their member’s points.')),
      text(T('Tokens and quest rewards are charged once at the highest verified reward-slot price. Fragments are free; the completed legendary is charged once. Configure verified item exceptions before the raid.')),
      text(T('Unknown items require an explicit provisional quote. Unrevealed Forever loot is not a verified catalog. Check that loot is usable and tradable before confirming its winner.')),
      text(T('Finish and sync offline raids before the weekly reset. The server cannot detect a raid that has not been uploaded.'))));
  }
  function renderBoards(){
    const host=$('boardsContent');host.replaceChildren();
    host.append(el('article',{class:'panel'},select('Leaderboard',[['epgp',T('Raid priority')],['dungeon',T('Dungeon scores')]],boardType,v=>{boardType=v;search='';renderBoards();}),
      text(T('Scores are read from your connected guild. Ties share a rank. No Battle.net private character list is published here.'))));
    if(boardType==='epgp'){
      if(!current()){host.append(text(T('No raid core yet. Ask a Raid Leader to create one.')));return;}
      const c=current();host.append(el('article',{class:'panel'},corePicker(renderBoards),
        text(T('PR = EP ÷ (earned GP + {0} base GP). Minimum EP: {1}.',c.effective.baseGp,c.effective.minEp)),
        text(c.effective.separatePool?T('This core has its own point pool.'):T('This core uses the shared guild point pool.'))));
      const input=el('input',{type:'search',placeholder:T('Find a player'),value:search,'aria-label':T('Find a player')});
      const list=el('div',{});const render=()=>{
        const rows=(c.leaderboard||[]).filter(r=>(r.name+' '+r.character).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
        list.replaceChildren(rows.length?table(['Rank','Player','Character','EP','GP','PR'],rows.map(r=>el('tr',{class:r.me?'raid-me':''},el('td',{text:String(r.rank)}),el('th',{scope:'row',text:r.name+(r.me?' · '+T('You'):'')+(r.belowMin?' · '+T('Below minimum EP'):'')}),el('td',{text:r.character}),el('td',{text:String(r.ep)}),el('td',{text:String(r.gp)}),el('td',{text:r.pr.toFixed(3)})))):text(T('No matching players.')));
      };input.addEventListener('input',()=>{search=input.value;render();});render();host.append(el('article',{class:'panel'},input,list));
    }else{
      const source=data.dungeonLeaderboard;
      if(!source?.available){host.append(text(T('Dungeon scores are temporarily unavailable. Refresh to retry.')));return;}
      if(!source.board){host.append(text(T('No dungeon season yet. Scores will appear after a season starts.')));return;}
      const base=source.board;const seasons=[{...base,selection:'current'},...(base.week?[{...base.week,season:T('This week'),selection:'week'}]:[]),...(base.history||[]).map(s=>({...s,selection:s.id}))];
      if(!seasons.some(s=>s.selection===seasonId))seasonId='current';const selected=seasons.find(s=>s.selection===seasonId);
      const brackets=[...new Set(selected.rows.map(r=>r.bracket||''))];if(!brackets.includes(bracket))bracket=brackets[0]||'';
      const rows=selected.rows.filter(r=>(r.bracket||'')===bracket);
      host.append(el('article',{class:'panel'},select('Season',seasons.map(s=>[s.selection,s.season]),seasonId,v=>{seasonId=v;renderBoards();}),
        ...(brackets.length>1?[select('Level bracket',brackets.map(b=>[b,b]),bracket,v=>{bracket=v;renderBoards();})]:[]),
        text(T('Top 50 reported scores per board. Level brackets are ranked separately.')),
        rows.length?table(['Rank','Player','Points'],rows.map(r=>el('tr',{},el('td',{text:String(1+rows.filter(other=>other.points>r.points).length)}),el('th',{scope:'row',text:r.name}),el('td',{text:String(r.points)})))):text(T('No scores in this selection.')),
        ...((seasonId==='week'?base.provisionalTargets:selected.provisionalTargets)?[text(T('This season uses provisional timing targets.'))]:[])));
    }
  }
  $('pricingReload').addEventListener('click',load);$('boardsReload').addEventListener('click',load);
  document.querySelectorAll('[data-page="pricing"],[data-page="leaderboards"]').forEach(b=>b.addEventListener('click',load));
  document.addEventListener('companion-language',()=>{if(data&&!saving){renderPrices();renderBoards();}});
  document.addEventListener('companion-connection-changing',()=>{generation++;switching=true;loading=false;saving=false;data=null;coreId='';drafts.clear();$('pricingContent').replaceChildren();$('boardsContent').replaceChildren();notices('');});
  document.addEventListener('companion-connection-changed',()=>{switching=false;$('pricingContent').inert=false;void load();});
  if(['pricing','leaderboards'].includes(new URLSearchParams(location.search).get('tab')))void load();
})();
