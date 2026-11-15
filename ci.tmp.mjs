const [tok,run]=process.argv.slice(2);
await new Promise(r=>setTimeout(r,30000));
for(let i=0;i<60;i++){
  const j=await fetch(`https://api.github.com/repos/kevincaron28/Guilded/actions/runs/${run}`,{headers:{Authorization:"Bearer "+tok,"User-Agent":"c"}}).then(r=>r.json());
  if(j.status==="completed"){console.log(j.conclusion);process.exit(0)}
  await new Promise(r=>setTimeout(r,20000));
}
console.log("timeout");
