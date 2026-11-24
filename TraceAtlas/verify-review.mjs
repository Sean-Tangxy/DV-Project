import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext,runInContext } from 'node:vm';

const context=createContext({}),load=file=>runInContext(readFileSync(new URL(file,import.meta.url),'utf8'),context,{filename:file});
for(const file of ['dataset.js','dataset-sts2.js','pytest-depth-data.js','model.js','test-evidence.js','atlas.js','review-data.js'])load(file);
const {VerificationModel:V,TestEvidence:T,ReferenceAtlas:A,ReviewData:R}=context;
const report=[];const test=(name,fn)=>{fn();report.push(name);};
function model(raw){const m=V.build(raw);T.attach(m);m.references=A.extract(m);m.mapScope=T.mapScope(m);m.atlas=A.layout(m.mapScope,m.mapScope.references);return m;}
const m=model(context.STS2_DATA),d=R.build(m,context.PYTEST_DEPTH),v={range:[d.min,d.max],session:'all',runIds:[],claim:null,level:null,basis:null,item:null};
const events=[...m.events].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.index-b.index),index=new Map(events.map((e,i)=>[e.id,i]));
const ctx={M:m,eventIndex:index,mapCutoffInfo:()=>({index:events.length-1,event:events.at(-1)})};
test('All model events retained and pytest scope includes only known project turns',()=>{assert.equal(m.events.length,2234);assert.ok(d.runs.length>500);assert.ok(d.runs.every(r=>m.sessions.has(r.session)));});
test('All declarations in known project turns retained, including unlinked declarations',()=>{const known=new Set(m.events.map(e=>e.id.split(':')[0]));assert.equal(d.claims.length,context.PYTEST_DEPTH.claims.filter(c=>known.has(c.turn_id)).length);assert.ok(d.claims.some(c=>!c.candidates.length));});
const agg=R.aggregate(d,v);
test('Composition bins reconcile to every run identity entry without dropping unknown depth',()=>{assert.equal(agg.grid.flat().reduce((a,b)=>a+b,0),d.runs.reduce((n,r)=>n+r.items.length,0));assert.equal(agg.rows.length,agg.grid.flat().reduce((a,b)=>a+b,0));});
test('Source and nearby-version inference never count as observed per-case passes',()=>{assert.ok(agg.rows.some(x=>x.item.basis===1));assert.ok(agg.rows.filter(x=>x.item.basis>0).every(x=>x.item.result==='unknown'));});
test('Selecting a run produces only its entries; session and time range apply before aggregation',()=>{const r=d.runs.find(r=>r.items.length>30),a=R.aggregate(d,{...v,runIds:[r.id]});assert.equal(a.rows.length,r.items.length);assert.ok(a.rows.every(x=>x.run.id===r.id));const none=R.aggregate(d,{...v,runIds:[r.id],range:[r.time+1,r.time+2]});assert.equal(none.rows.length,0);});
test('Map instance counts are independent of the selected display mode and retain depth-unknown counts',()=>{const s=R.mapStats(d,v,ctx);assert.ok(s.stats.size>150);for(const x of s.stats.values()){assert.equal(x.count,x.histogram.reduce((a,b)=>a+b,0));assert.equal(x.sum,x.histogram.slice(0,5).reduce((n,k,i)=>n+k*i,0));}assert.ok(s.activeRefs.length>50);});
test('Composition cell filters and map links share the same selected evidence subset',()=>{const filtered={...v,level:1,basis:1},a=R.aggregate(d,filtered),s=R.mapStats(d,filtered,ctx);assert.ok(a.filtered.every(x=>x.item.level===1&&x.item.basis===1));for(const st of s.stats.values())assert.ok(st.items.every(i=>i.level===1&&i.basis===1));});
test('File focus includes only defining tests or tests referencing that project file',()=>{const s=R.mapStats(d,v,ctx),f=[...s.stats.values()].find(s=>s.file.side==='product'&&s.count>10);assert.ok(f);const a=R.aggregate(d,v,f.file.path.toLowerCase());assert.ok(a.rows.length);assert.ok(a.rows.every(x=>R.matchesFile(x.item,f.file.path.toLowerCase())));});
test('A/B set differences use unique identities and reconcile on both sides',()=>{const a=d.runs[0],b=d.runs[1],s=R.sets(a,b);assert.equal(s.a.length+s.both.length,new Set(a.items.map(i=>i.identity)).size);assert.equal(s.b.length+s.both.length,new Set(b.items.map(i=>i.identity)).size);assert.equal(s.a.some(x=>s.both.includes(x)),false);});
test('SSZX uses checks rather than inventing pytest identities or declarations',()=>{const sm=model(context.SSZX_DATA),sd=R.build(sm,null);assert.equal(sd.unit,'check');assert.equal(sd.runs.length,sm.checks.length);assert.equal(sd.claims.length,0);assert.equal(sm.events.length,858);});
console.log(JSON.stringify({tests:report,counts:{events:m.events.length,runs:d.runs.length,claims:d.claims.length,entries:agg.rows.length,unidentified:agg.missing},browser:'Not assessed by this data regression script'},null,2));
