import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const c=createContext({});
for(const name of ['dataset.js','dataset-sts2.js','pytest-depth-data.js','model.js','test-evidence.js','atlas.js','review-data.js','review-map-model.js','review-map-terrain.js','review-area-layout.js'])runInContext(readFileSync(new URL(name,import.meta.url),'utf8'),c,{filename:name});
const {VerificationModel:V,TestEvidence:T,ReferenceAtlas:A,ReviewData:R,ReviewMapModel:X}=c;
const tests=[],test=(name,fn)=>{fn();tests.push(name);};
function setup(raw,depth){const m=V.build(raw);T.attach(m);m.references=A.extract(m);m.mapScope={files:new Map(m.files),references:m.references};const d=R.build(m,depth);X.attach(m,d);m.atlas=X.layout(m,d);m.terrain=c.ReviewMapTerrain.build(m);m.areaLayout=c.ReviewAreaLayout.prepare(m,d);m.reviewScale=X.scale(m,d);return {m,d};}
const {m,d}=setup(c.STS2_DATA,c.PYTEST_DEPTH),view={range:[d.min,d.max],session:'all',runIds:[],turn:null,topic:null,level:null,basis:null,item:null};
const agg=R.aggregate(d,view),content=X.content(agg,null,m);
test('Original execution entries retained and browser test files are present in the map',()=>{
  assert.equal(agg.rows.length,41168);assert.equal(d.runs.length,888);
  const browser=[...m.files.values()].filter(f=>f.side==='test'&&/browser_/.test(f.path));assert.ok(browser.length>0);assert.ok(browser.every(f=>m.atlas.positions.has(f.path.toLowerCase())));
});
test('Topics match inspectable tokens, support multiple labels, and keep unmatched names unknown',()=>{
  assert.ok(X.classify('test_snapshot_restore_rejects_invalid_state').some(t=>t.id==='state'));
  assert.ok(X.classify('test_snapshot_restore_rejects_invalid_state').some(t=>t.id==='boundary'));
  assert.equal(X.classify('test_student_profile')[0].id,'other');
  assert.equal(X.classify('test_rewards')[0].id,'interaction');
  assert.equal(X.classify('test_native_engine_runtime')[0].id,'environment');
});
test('Each test file belongs to exactly one topic island; coordinates are unique and replay-stable',()=>{
  const files=m.atlas.groups.flatMap(g=>g.files);assert.equal(files.length,m.mapScope.files.size);assert.equal(new Set(files.map(f=>f.path)).size,files.length);
  assert.ok(m.atlas.groups.filter(g=>g.side==='test').length>3);
  assert.equal(new Set([...m.atlas.positions.values()].map(p=>p.x+','+p.y)).size,files.length);
  const second=X.layout(m,d);assert.equal(JSON.stringify([...second.positions]),JSON.stringify([...m.atlas.positions]));
  for(const g of m.atlas.groups)for(const f of g.files){const p=m.atlas.positions.get(f.path.toLowerCase());assert.ok(p.x>=m.atlas.box[0]&&p.x<=m.atlas.box[0]+m.atlas.box[2]&&p.y>=0&&p.y<=m.atlas.box[3]);}
});
test('Topic counts reconcile with their actual rows without assuming categories are exclusive',()=>{
  for(const t of content.entries.values()){
    assert.equal(t.histogram.reduce((a,b)=>a+b,0),t.count);
    assert.ok(t.rows.every(r=>r.item.topics.some(label=>label.id===t.id)));
  }
  assert.ok([...content.entries.values()].reduce((n,t)=>n+t.count,0)>agg.rows.length);
});
test('Bundled input and output paths only come from actual item-file-topic-target records',()=>{
  const incoming=new Set(),outgoing=new Set();for(const {item:i} of agg.filtered)for(const t of i.topics){
    if(m.files.get(i.file.toLowerCase())?.side==='test')incoming.add(i.file.toLowerCase()+'|'+t.id);
    for(const p of Object.keys(i.targets))outgoing.add(t.id+'|'+p.toLowerCase());
  }
  assert.ok(content.incoming.every(e=>incoming.has(e.file+'|'+e.topic)));
  assert.ok(content.outgoing.every(e=>outgoing.has(e.topic+'|'+e.file)));
});
test('Selecting one file never inherits other files targets through a shared topic',()=>{
  const file=content.incoming.find(e=>e.topic==='interaction').file,focused=X.content(agg,file,m,'interaction');
  assert.ok(focused.rows.length>0);assert.ok(focused.incoming.every(e=>e.file===file));
  const actual=new Set(focused.rows.flatMap(r=>Object.keys(r.item.targets).map(p=>p.toLowerCase())));
  assert.ok(focused.outgoing.every(e=>actual.has(e.file)&&e.topic==='interaction'));
});
test('Left matrix connects to test files and direct file pairs are counted once per execution entry',()=>{
  assert.ok(m.atlas.groups.every(g=>g.x-g.radius>m.atlas.rail.x+m.atlas.rail.width));
  const pairs=new Map();for(const {item:i} of agg.filtered)if(m.files.get(i.file.toLowerCase())?.side==='test')for(const p of Object.keys(i.targets)){
    const key=i.file.toLowerCase()+'→'+p.toLowerCase();pairs.set(key,(pairs.get(key)||0)+1);
  }
  assert.equal(content.fileLinks.length,pairs.size);
  assert.ok(content.fileLinks.every(e=>e.count===pairs.get(e.source+'→'+e.target)));
  const filtered=R.aggregate(d,{...view,topic:'state'}),paths=X.content(filtered,null,m,'state');
  assert.ok(paths.incoming.every(e=>e.topic==='state'));
  const actual=new Set(filtered.filtered.flatMap(r=>Object.keys(r.item.targets).map(p=>r.item.file.toLowerCase()+'→'+p.toLowerCase())));
  assert.ok(paths.fileLinks.every(e=>actual.has(e.source+'→'+e.target)));
});
test('Zero-run turns create no chains; repeated runs retain separate execution evidence',()=>{
  const empty=R.aggregate(d,{...view,turn:'empty',runIds:[]});const no=X.content(empty,null,m);
  assert.equal(no.incoming.length,0);assert.equal(no.outgoing.length,0);assert.equal(no.rows.length,0);
  const selected=R.aggregate(d,{...view,runIds:d.runs.slice(0,2).map(r=>r.id)});assert.equal(selected.rows.length,d.runs[0].items.length+d.runs[1].items.length);
});
test('Full-project size ceilings bound every per-run count and weighted sum',()=>{
  const events=[...m.events].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.index-b.index),eventIndex=new Map(events.map((e,i)=>[e.id,i]));
  const ctx={M:m,eventIndex,mapCutoffInfo:()=>({index:events.length-1,event:events.at(-1)})};
  for(const run of [d.runs[0],d.runs[Math.floor(d.runs.length/2)],d.runs.at(-1)]){
    const snapshot=R.mapStats(d,{...view,runIds:[run.id]},ctx);
    for(const s of snapshot.stats.values()){assert.ok(s.count<=m.reviewScale.count);assert.ok(s.sum<=m.reviewScale.sum);}
  }
});
test('Island bundles reconcile actual file pairs and execution counts without inventing connections',()=>{
  const groups=X.bundles(m,content),expected=content.fileLinks.filter(e=>m.files.get(e.source)?.atlasGroup&&m.files.get(e.target)?.atlasGroup&&m.files.get(e.source).atlasGroup!==m.files.get(e.target).atlasGroup);
  assert.equal(groups.files.reduce((n,b)=>n+b.pairs.length,0),expected.length);
  assert.equal(groups.files.reduce((n,b)=>n+b.count,0),expected.reduce((n,e)=>n+e.count,0));
  for(const b of groups.files){assert.equal(b.count,b.pairs.reduce((n,e)=>n+e.count,0));assert.ok(b.pairs.every(e=>m.files.get(e.source)?.atlasGroup===b.source&&m.files.get(e.target)?.atlasGroup===b.target));}
  assert.ok(groups.files.length<expected.length);
});
test('Every file has a finite clipped Voronoi cell containing its fixed seed',()=>{
  assert.equal(m.terrain.cells.size,m.atlas.positions.size);
  for(const cell of m.terrain.cells.values()){
    assert.ok(cell.points.length>=3);assert.ok(cell.points.flat().every(Number.isFinite));
    assert.ok(c.ReviewMapTerrain.inside(cell.points,cell.x,cell.y));
    const area=Math.abs(cell.points.reduce((sum,p,i)=>{const q=cell.points[(i+1)%cell.points.length];return sum+p[0]*q[1]-p[1]*q[0];},0)/2);
    assert.ok(area>25);
    for(const other of m.terrain.cells.values())if(other.side===cell.side&&other.key!==cell.key)for(const p of cell.points){
      const own=(p[0]-cell.x)**2+(p[1]-cell.y)**2,dist=(p[0]-other.x)**2+(p[1]-other.y)**2;
      assert.ok(own<=dist+.00001,'Voronoi vertices stay nearest to their own file seed');
    }
  }
});
test('Merged region boundaries omit same-group interior edges and stay stable across playback',()=>{
  assert.ok(m.terrain.boundaries.length>0);assert.ok(m.terrain.lanes.every(l=>l.ocean>0));
  assert.ok(m.terrain.boundaries.every(e=>e.owners.length===1||e.owners.some(o=>o.group!==e.owners[0].group)));
  const second=c.ReviewMapTerrain.build(m);assert.equal(JSON.stringify([...second.cells]),JSON.stringify([...m.terrain.cells]));
});
test('Weighted file polygons meet one common area scale, remain inside their islands and preserve zero-count files',()=>{
  const events=[...m.events].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.index-b.index),eventIndex=new Map(events.map((e,i)=>[e.id,i])),ctx={M:m,eventIndex,mapCutoffInfo:()=>({index:events.length-1,event:events.at(-1)})};
  for(const selection of [view,{...view,runIds:[d.runs[0].id]},{...view,turn:'empty',runIds:[]}]){
    const snapshot=R.mapStats(d,selection,ctx),map=c.ReviewAreaLayout.layout(m,snapshot.stats);
    assert.equal(map.cells.size,snapshot.stats.size);assert.ok(map.maxError<=.021);
    assert.equal(c.ReviewAreaLayout.layout(m,snapshot.stats),map,'Identical scopes reuse cached geometry');
    for(const cell of map.cells.values()){
      assert.ok(Math.abs(cell.targetArea-(map.minimum+map.unit*cell.count))<.00001);
      assert.ok(cell.points.length>=3&&cell.points.flat().every(Number.isFinite));
      assert.ok(c.ReviewMapTerrain.inside(cell.points,cell.x,cell.y));
      assert.ok(cell.points.every(p=>c.ReviewMapTerrain.inside(map.groups.get(cell.group).points,...p)));
    }
    for(const [id,g] of map.groups){const all=[...map.cells.values()].filter(c=>c.group===id);assert.ok(Math.abs(all.reduce((n,c)=>n+c.area,0)-g.area)<.001);}
  }
});
test('Power-area solver handles unequal synthetic areas and exact polygon fallback safely',()=>{
  const sites=[{x:20,y:20},{x:80,y:20},{x:20,y:80},{x:80,y:80}],domain=[[0,0],[100,0],[100,100],[0,100]],targets=[100,400,1600,7900],result=c.ReviewAreaLayout.solve(sites,targets,domain);
  assert.ok(result.error<=.021);assert.ok(result.polygons.every((p,i)=>Math.abs(c.ReviewAreaLayout.area(p)-targets[i])/targets[i]<=.021));
});
test('SSZX check-target records never become invented test-file sources',()=>{
  const {m:sm,d:sd}=setup(c.SSZX_DATA,null),a=R.aggregate(sd,{...view,range:[sd.min,sd.max]}),chains=X.content(a,null,sm);
  const projectSources=chains.incoming.filter(e=>sm.files.get(e.file)?.side!=='test');assert.equal(projectSources.length,0);
  assert.equal(sd.runs.length,41);assert.equal(sm.events.length,858);
});
console.log(JSON.stringify({tests,counts:{files:m.atlas.positions.size,testIslands:m.atlas.groups.filter(g=>g.side==='test').length,entries:agg.rows.length},scale:m.reviewScale},null,2));
