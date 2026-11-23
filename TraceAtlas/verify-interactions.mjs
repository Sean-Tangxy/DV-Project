import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Execute the real app handlers with a minimal DOM and deterministic timers.
// These checks validate interactions and evidence, not browser layout.
export function verifyInteractions(dataset='sszx') {
  const elements=new Map(), timers=new Map();
  let nextTimer=0, mapInfo, columns=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      innerHTML:'',textContent:'',value:'',checked:true,clientWidth:600,clientHeight:280,
      setAttribute(){},querySelectorAll(){return [];},querySelector(){return element(id+':svg');},addEventListener(){}
    });
    return elements.get(id);
  };
  const context=createContext({
    URL,URLSearchParams,location:{search:dataset==='sts2'?'?dataset=sts2':''},
    document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},
    window:{addEventListener(){},setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}},
    setTimeout(){},clearTimeout(){},requestAnimationFrame(){}
  });
  for(const file of ['dataset.js','dataset-sts2.js','model.js','test-evidence.js','atlas.js','map-3d.js','map-view.js','views.js'])
    runInContext(readFileSync(new URL(file,import.meta.url),'utf8'),context,{filename:file});
  const renderMap=context.AtlasViews.renderMap;
  context.AtlasViews.renderMap=ctx=>{mapInfo=ctx.mapCutoffInfo();columns=new Map();renderMap(ctx);};
  const columnFaces=context.Map3D.columnFaces;
  context.Map3D.columnFaces=column=>{columns.set(column.key,column);return columnFaces(column);};
  runInContext(readFileSync(new URL('app.js',import.meta.url),'utf8'),context,{filename:'app.js'});
  const {state,model,selectFile,activate}=context.workbench;
  const click=id=>element(id).onclick();
  const seek=n=>element('map-time').oninput({target:{value:String(n)}});
  const advance=()=>{
    assert.equal(timers.size,1,'Only one playback timer may exist');
    const [id,fn]=timers.entries().next().value;timers.delete(id);fn();
  };
  const expectCurrentEvidence=()=>{
    assert.equal(state.selected,mapInfo.event.id);
    assert.equal(state.run,mapInfo.event.checks[0]?.id??null);
    const session=model.sessions.get(mapInfo.event.session);
    assert.ok(element('detail-caption').textContent.startsWith(session.code+' #'+mapInfo.event.ordinal));
  };
  const results=[];
  assert.ok(element('file-map').innerHTML.includes('文件群岛引用地图'));
  assert.ok(element('map-caption').textContent.includes('项目文件'));
  results.push('Real map and matrix renderers initialize without missing time formatters');
  state.mapMode='depth';context.workbench.render();
  assert.ok(element('file-map').innerHTML.includes('data-depth='));
  const ceiling=Number(element('map-metric-caption').textContent.match(/深度和 \/ (\d+)/)?.[1]);
  const depthColumns=columns;
  const faces=[...depthColumns.values()].flatMap(columnFaces);
  const mesh=context.Map3D.scene(faces);
  assert.equal(mesh.vertices.length,faces.reduce((length,face)=>length+(face.points.length-2)*18,0));
  assert.ok(mesh.vertices.every(Number.isFinite));
  const {Map3D}=context;
  const nearHeight=20+16*Map3D.slope/Map3D.vertical;
  const makeColumn=(key,y,top)=>columnFaces({key,x:0,y,segments:[{top,color:'#6578cc'}],stroke:'#fff',opacity:1});
  const overlap=Map3D.scene([...makeColumn('front',16,nearHeight),...makeColumn('behind',0,20)]);
  assert.equal(Map3D.pick(overlap,...Map3D.project([0,0,20])),'front');
  state.mapMode='count';context.workbench.render();
  assert.ok(element('map-metric-caption').textContent.includes('不同文件数'));
  state.mapMode='structure';context.workbench.render();
  results.push('Structure, depth and count map modes render against the complete dataset');
  const ordered=[...model.events].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.index-b.index);
  const indices=new Map(ordered.map((e,i)=>[e.id,i]));
  const metrics=context.TestEvidence.metrics(model,{event:ordered.at(-1),index:ordered.length-1},indices);
  if(dataset==='sts2'){
    assert.equal(model.events.length,2234);assert.equal(model.files.size,199);
    const excluded=[...model.files.keys()].filter(path=>/^tests\/browser_/.test(path));
    assert.equal(excluded.length,14);
    assert.ok(excluded.every(path=>!model.atlas.positions.has(path)&&!metrics.stats.has(path)));
    const testIslands=model.atlas.groups.filter(g=>g.side==='test');
    for(const island of testIslands){
      const packed=context.ReferenceAtlas.layout({files:new Map(island.files.map(f=>[f.path.toLowerCase(),f]))},[]).groups[0];
      assert.deepEqual(island.cells,packed.cells);
      assert.equal(island.radius,packed.radius);
    }
    assert.equal(metrics.activeRefs.length,193);
    assert.equal(context.TestEvidence.refs(model,{event:ordered[0],index:0},indices,'all').length,0);
    assert.ok(element('file-map').innerHTML.includes('data-island-link='));
    assert.ok(!element('file-map').innerHTML.includes('data-file-edge='));
    const target=[...metrics.stats.values()].sort((a,b)=>b.sources.size-a.sources.size)[0];
    assert.equal(target.sources.size,27);assert.ok(target.max<=4);assert.ok(target.sum>target.max);
    const segments=depthColumns.get(target.file.path.toLowerCase()).segments;
    const fullHeight=segments.at(-1).top;
    assert.ok(Math.abs((fullHeight-2.5)/context.Map3D.maxHeight-target.sum/ceiling)<1e-9);
    const counts=target.histogram.filter(Boolean);
    segments.forEach(({top},i)=>{
      const below=segments[i-1]?.top??0;
      assert.ok(Math.abs((top-below)/fullHeight-counts[i]/target.count)<1e-9);
    });
    selectFile(target.file.path.toLowerCase());
    const ids=metrics.activeRefs.filter(edge=>[edge.source,edge.target].some(path=>path.toLowerCase()===target.file.path.toLowerCase())).map(edge=>edge.id);
    const arrowIds=[...element('file-map').innerHTML.matchAll(/data-file-edge="([^"]+)"/g)].map(match=>match[1]);
    assert.deepEqual(arrowIds,[...ids]);
    assert.ok(element('detail').innerHTML.includes('关联测试文件（去重）'));
    click('reset');
    results.push('STS2 retains raw history, repacks islands without 14 browser tests, and uses the normalized depth sum and count-based bands for the 27-test product file');
  }
  seek(0);expectCurrentEvidence();
  seek(Number(element('map-time').max));expectCurrentEvidence();
  results.push('Dragging map time follows the current event in evidence details');
  click('map-play');assert.equal(state.mapCursor,0);assert.equal(state.mapPlaying,true);expectCurrentEvidence();
  advance();assert.equal(state.mapCursor,1);expectCurrentEvidence();
  advance();assert.equal(state.mapCursor,2);expectCurrentEvidence();
  click('map-play');assert.equal(state.mapPlaying,false);assert.equal(timers.size,0);
  click('map-play');assert.equal(state.mapCursor,2);advance();assert.equal(state.mapCursor,3);
  assert.equal(timers.size,1);
  results.push('Playback restarts from the end, advances evidence, pauses and resumes with one timer');
  seek(0);assert.equal(timers.size,0);assert.equal(state.mapPlaying,false);
  click('map-play');element('map-step').onchange({target:{value:'session'}});
  assert.equal(timers.size,0);assert.equal(state.mapPlaying,false);expectCurrentEvidence();
  click('map-play');
  const count=mapInfo.seq.length;
  for(let i=1;i<count;i++)advance();
  assert.equal(state.mapCursor,count-1);assert.equal(state.mapPlaying,false);assert.equal(timers.size,0);
  results.push('Dragging or changing granularity cancels playback; reaching the end stops cleanly');
  click('reset');
  const file=[...model.files.values()].sort((a,b)=>b.events.size-a.events.size)[0];
  selectFile(file.path.toLowerCase());
  const finalDetail=element('detail').innerHTML;
  seek(0);
  assert.equal(state.selected,null);assert.equal(state.file,file.path.toLowerCase());
  assert.notEqual(element('detail').innerHTML,finalDetail);
  results.push('File evidence stays focused and updates to the chosen historical cutoff');
  state.edge=[model.references[0].id];selectFile(file.path.toLowerCase());
  assert.equal(state.edge,null);assert.ok(element('detail-caption').textContent.startsWith(file.path));
  click('map-play');
  const check=model.checks[0];activate(check.event.id,check.id);
  assert.equal(timers.size,0);assert.equal(state.mapPlaying,false);assert.equal(state.selected,check.event.id);
  results.push('Selecting a file clears reference focus; selecting a record stops playback');
  return results;
}
