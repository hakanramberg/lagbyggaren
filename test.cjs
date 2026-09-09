'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Store = require('./store.js');
const Engine = require('./engine.js');
const { createApp } = require('./server.cjs');
const slots = ['MV','V6','V9','M9','H9','H6','M6'];
const roster = Array.from({length:21}, (_,i)=>({id:'p'+i,name:'Spelare '+i,first:slots[i%7],second:'',level:1+Math.floor(i/7)}));
const rng = () => {let n=712; return ()=>{n=(n*1664525+1013904223)>>>0;return n/4294967296;};};
const proposal = teams => ({name:'Vikingaspelen 2026',kind:'Turnering',date:'2026-09-20',teams,slots,mode:'balanced',targets:[],variation:true});
test('allocation: unique participants, coverage, balance and target levels',()=>{
  for(const count of [1,2,3]){
    const teams=Engine.build(roster,count,slots,'balanced',[],[],true,rng());
    assert.equal(new Set(teams.flat().map(p=>p.id)).size,21);
    assert(Math.max(...teams.map(t=>t.length))-Math.min(...teams.map(t=>t.length))<=1);
    if(count===3)for(const t of teams){assert.equal(Engine.assign(t,slots).cost,0);assert.equal(Engine.average(t),2);}
  }
  Engine.build(roster,3,slots,'tiered',[1,2,3],[],true,rng()).forEach((t,i)=>assert.equal(Engine.average(t),i+1));
  assert.equal(Engine.assign([roster[0]],slots).cost,120);
});
test('accepted history reduces repeated teammates without losing position coverage',()=>{
  const equal=roster.map(p=>({...p,level:2}));
  const first=Engine.build(equal,3,slots,'balanced',[],[],true,rng());
  const history=[{...proposal(first),status:'accepted',acceptedAt:'2026-09-01'}];
  const next=Engine.build(equal,3,slots,'balanced',[],history,true,rng());
  assert(Engine.repetition(next,Engine.pairCounts(history))<Engine.repetition(first,Engine.pairCounts(history)));
  next.forEach(t=>assert.equal(Engine.assign(t,slots).cost,0));
  assert.equal(Engine.pairCounts([{...history[0],status:'review'}]).size,0);
  const renamed=equal.map(p=>({...p,name:'Nytt namn'}));
  assert.deepEqual(Engine.pairCounts(history),Engine.pairCounts([{...history[0],teams:first.map(t=>t.map(p=>renamed.find(x=>x.id===p.id)))}]));
});
test('shared workflow, auth, conflicts, invalid input and persistence',async()=>{
  const dir=fs.mkdtempSync(path.join(__dirname,'.test-data-'));
  const ownerToken='a'.repeat(64);let server=createApp({dataDir:dir,ownerToken});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let base='http://127.0.0.1:'+server.address().port;
  async function call(route,token=ownerToken,body){const res=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,...await res.json()};}
  try{
    assert.equal((await call('state','bad')).status,401);
    assert.equal((await fetch(base+'/.data/workspace.json')).status,404);
    let current=await call('state'); const owner=current.me;
    let result=await call('action',ownerToken,{version:current.state.version,action:{type:'players.replace',data:roster}}); assert.equal(result.status,200); current=result;
    assert.equal((await call('action',ownerToken,{version:0,action:{type:'players.replace',data:[]}})).status,409);
    result=await call('invite',ownerToken,{version:current.state.version,name:'Kollega'});assert.equal(result.status,200);current=result;const colleague=result.invitation;
    assert.equal((await call('invite',colleague,{version:current.state.version,name:'Ej tillåten'})).status,403);
    const data=proposal([roster.slice(0,7),roster.slice(7,14),roster.slice(14)]);
    result=await call('action',ownerToken,{version:current.state.version,action:{type:'proposal.save',data}});assert.equal(result.status,200);current=result;
    const id=current.state.proposals[0].id;
    async function action(type,data,token=ownerToken){const r=await call('action',token,{version:current.state.version,action:{type,data}});if(r.state)current=r;return r;}
    assert.equal((await action('proposal.accept',{id,revision:1})).status,400);
    assert.equal((await action('proposal.vote',{id,revision:1,choice:'approve',comment:''})).status,200);
    assert.equal((await action('proposal.vote',{id,revision:1,choice:'adjust',comment:''},colleague)).status,400);
    assert.equal((await action('proposal.vote',{id,revision:1,choice:'adjust',comment:'Byt två spelare'},colleague)).status,200);
    assert.equal((await action('proposal.accept',{id,revision:1})).status,400);
    assert.equal((await action('proposal.save',{...data,id,revision:1})).status,200);
    assert.deepEqual(current.state.proposals[0].votes,{});
    assert.equal((await action('proposal.vote',{id,revision:1,choice:'approve',comment:''})).status,400);
    await action('proposal.vote',{id,revision:2,choice:'approve',comment:''});
    await action('proposal.vote',{id,revision:2,choice:'approve',comment:''},colleague);
    assert.equal((await action('proposal.accept',{id,revision:2})).status,200);
    const accepted=structuredClone(current.state.proposals[0]);
    assert.equal(accepted.reviewers.length,2);
    assert.equal((await action('proposal.save',{...data,id,revision:2})).status,400);
    assert.equal((await action('player.save',{...roster[0],name:'Nytt namn',previous:roster[0]})).status,200);
    assert.equal((await action('player.save',{...roster[0],name:'Gammalt formulär',previous:roster[0]})).status,400);
    assert.deepEqual(current.state.proposals[0],accepted);
    assert.equal((await action('players.replace',[roster[0],roster[0]])).status,400);
    result=await call('revoke',ownerToken,{version:current.state.version,id:current.state.coaches.find(c=>c.id!==owner).id});current=result;
    assert.equal((await call('state',colleague)).status,401);
    await new Promise(r=>server.close(r));server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
    result=await call('state');assert.deepEqual(result.state.proposals[0],accepted);assert.equal(result.state.players[0].name,'Nytt namn');
  }finally{await new Promise(r=>server.close(r));}
});

test('team coaches are versioned, validated, retained in accepted snapshots and exported without private fields', () => {
  const Image = require('./team-image.js');
  let s = Store.initial(); s.players = roster;
  s = Store.apply(s, {type:'proposal.save', data:proposal([roster.slice(0,7),roster.slice(7)])}, 'local', 'plan');
  assert.deepEqual(s.proposals[0].teamCoaches, ['', '']);
  s = Store.apply(s, {type:'proposal.vote', data:{id:'plan',revision:1,choice:'approve',comment:''}}, 'local');
  const staff = {id:'plan',revision:1,teamCoaches:[' Håkan och Anna ', 'Johan'],teamMeetings:[{time:'09:30',place:' Hall A '},{time:'10:15',place:'Hall B'}]};
  assert.throws(()=>Store.apply(s,{type:'proposal.staff',data:{...staff,teamCoaches:['x']}},'local'));
  assert.throws(()=>Store.apply(s,{type:'proposal.staff',data:{...staff,teamCoaches:['x'.repeat(201),'']}},'local'));
  s = Store.apply(s,{type:'proposal.staff',data:staff},'local');
  assert.equal(s.proposals[0].revision,2); assert.deepEqual(s.proposals[0].votes,{});
  assert.deepEqual(s.proposals[0].teamCoaches,['Håkan och Anna','Johan']);
  assert.throws(()=>Store.apply(s,{type:'proposal.staff',data:staff},'local'));
  s = Store.apply(s,{type:'proposal.vote',data:{id:'plan',revision:2,choice:'approve',comment:''}},'local');
  s = Store.apply(s,{type:'proposal.accept',data:{id:'plan',revision:2}},'local');
  assert.throws(()=>Store.apply(s,{type:'proposal.staff',data:{...staff,revision:2}},'local'));
  const output = Image.publicData(s.proposals[0]);
  assert.deepEqual(Object.keys(output).sort(),['date','subtitle','teams','title']);
  assert.equal(output.subtitle,'Lagindelning');
  assert.deepEqual(output.teams[0].meeting,{time:'09:30',place:'Hall A'});
  assert.throws(()=>Store.proposalData({...proposal([roster]),teamMeetings:[{time:'25:99',place:'X'}]}));
  assert.throws(()=>Store.proposalData({...proposal([roster]),teamMeetings:[{time:'09:30',place:'x'.repeat(201)}]}));
  assert.deepEqual(Object.keys(output.teams[0]).sort(),['coaches','meeting','name','players']);
  assert.equal(output.teams.flatMap(t=>t.players).length,roster.length);
  assert(output.teams.every(t=>t.players.every(p=>typeof p==='string')));
  assert.deepEqual(output.teams[0].players,[...output.teams[0].players].sort((a,b)=>a.localeCompare(b,'sv')));
});
