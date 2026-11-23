import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import './dataset.js';
import './model.js';
import './atlas.js';
import './test-evidence.js';
import { verifyInteractions } from './verify-interactions.mjs';

const m=VerificationModel.build(SSZX_DATA), tests=[];
TestEvidence.attach(m);
m.references=ReferenceAtlas.extract(m);
m.atlas=ReferenceAtlas.layout(m,m.references);
function check(name,fn){fn();tests.push(name);}
check('Every exported record and session is retained',()=>{
  assert.equal(m.events.length,SSZX_DATA.events.length);
  assert.equal(m.sessions.size,SSZX_DATA.sessions.length);
  assert.equal([...m.sessions.values()].reduce((n,s)=>n+s.events.length,0),m.events.length);
  assert.equal(SSZX_DATA.raw.length,m.events.length);
});
const first=[...m.sessions.keys()][0], at=(sid,n)=>m.events.find(e=>e.session===sid&&e.ordinal===n);
check('Compilation does not inherit wrapper exit=0',()=>{
  assert.equal(at(first,409).checks[0].status,'blocked');
  assert.equal(at(first,416).checks[0].status,'pass');
});
check('One command can contain two independent compilation outcomes',()=>{
  assert.equal(at(first,553).checks.filter(r=>r.kind==='compile').length,2);
});
check('Pipeline nested success does not inherit outer success',()=>{
  const audit=m.checks.filter(r=>r.label==='MainMapTest0Audit.Run');
  assert.ok(audit.length>=5);
  assert.ok(audit.some(r=>r.event.exit_code===0&&r.status==='fail'));
  assert.ok(audit.some(r=>r.status==='pass'&&r.items.length>0));
});
check('A requested recompilation is not counted as passed',()=>{
  const requested=m.checks.filter(r=>r.label==='Unity 请求重新编译');
  assert.ok(requested.length>0);
  assert.ok(requested.every(r=>r.status!=='pass'));
});
check('Reading verification source does not execute a test',()=>{
  const e={id:'read-only',type:'commandExecution',input:'Get-Content Assets/Editor/Verification.cs',output:'PASS: example documentation',exit_code:0};
  assert.equal(VerificationModel.parseEvent(e).length,0);
});
check('Unknown versions never compare as equal',()=>{
  const a=m.checks[0],rows=VerificationModel.compare(a,a);
  assert.equal(rows.find(x=>x.label==='产品版本').mode,'unknown');
  assert.equal(rows.find(x=>x.label==='测试版本').mode,'unknown');
});
check('Every reference has source evidence and known endpoint files',()=>{
  assert.ok(m.references.length>0);
  for(const edge of m.references){
    assert.ok(m.files.has(edge.source.toLowerCase()));
    assert.ok(m.files.has(edge.target.toLowerCase()));
    assert.notEqual(edge.source,edge.target);
    assert.ok(edge.evidence.length);
    for(const ev of edge.evidence){
      assert.ok(m.byId.has(ev.event));
      assert.ok(ev.excerpt&&ev.symbol);
      if(ev.declarationEvent)assert.ok(m.byId.has(ev.declarationEvent));
    }
  }
  assert.equal(new Set(m.references.map(e=>e.source+'→'+e.target)).size,m.references.length);
});
check('Reference layout preserves every file without overlapping islands',()=>{
  assert.equal(m.atlas.positions.size,m.files.size);
  for(const p of m.atlas.positions.values())assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  for(let i=0;i<m.atlas.groups.length;i++)for(let j=i+1;j<m.atlas.groups.length;j++){
    const a=m.atlas.groups[i],b=m.atlas.groups[j];
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=a.radius+b.radius-1);
  }
});
tests.push(...verifyInteractions());
tests.push(...verifyInteractions('sts2').map(name=>'STS2: '+name));
const report={tests,counts:{events:m.events.length,sessions:m.sessions.size,checks:m.checks.length,files:m.files.size,references:m.references.length,islands:m.atlas.groups.length,islandLinks:m.atlas.groupEdges.length},browser:null};
if(!process.argv.includes('--browser')){
  writeFileSync(new URL('./validation.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  process.exit(0);
}

const profile=mkdtempSync(join(tmpdir(),'verification-lens-browser-'));
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const proc=spawn(chrome,['--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--window-size=1600,1100','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
let launchError;
proc.on('error',e=>{launchError=e;});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let port;
for(let i=0;i<120;i++){
  if(launchError)throw launchError;
  try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}
  await wait(100);
}
if(!port){proc.kill();throw new Error('Headless browser did not expose its test connection.');}
let socket;
try{
  const tabs=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());
  const tab=tabs.find(t=>t.type==='page');
  socket=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true});});
  let next=0;const pending=new Map(),errors=[];
  socket.addEventListener('message',e=>{
    const data=JSON.parse(e.data);
    if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(data.error):p.resolve(data.result);}}
    else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:pathToFileURL(resolve('v1/index.html')).href});
  let ready=false;
  for(let i=0;i<100;i++){ready=await evaluate('Boolean(globalThis.workbench && document.querySelector("#plot svg"))');if(ready)break;await wait(100);}
  assert.ok(ready,'App initialized offline');
  const layouts=[];
  for(const [width,height] of [[1920,1080],[1366,768],[1280,720]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await wait(180);
    const layout=await evaluate('('+function(){
      const bounds=[...document.querySelectorAll('main>.timeline-panel,.compare-panel,.map-panel,main>.detail-panel')].map(el=>{
        const r=el.getBoundingClientRect();return {name:el.querySelector('h2').textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height};
      });
      return {width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,bounds};
    }.toString()+')()');
    assert.ok(layout.scrollHeight<=height,'Page must not scroll vertically');
    assert.ok(layout.scrollWidth<=width,'Page must not scroll horizontally');
    for(const r of layout.bounds){assert.ok(r.bottom<=height&&r.right<=width&&r.x>=0&&r.height>100,JSON.stringify(r));}
    layouts.push(layout);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await wait(180);
  const initial=await evaluate('({events:workbench.model.events.length,rows:document.querySelectorAll("#plot [data-session]").length,files:document.querySelectorAll("#file-map [data-file]").length,selected:workbench.state.selected,hasNaN:!!document.querySelector(\'svg [points*="NaN"]\'),overflow:document.documentElement.scrollWidth>innerWidth})');
  assert.equal(initial.events,m.events.length);assert.equal(initial.rows,m.sessions.size);assert.equal(initial.files,m.files.size);assert.equal(initial.selected,null);assert.equal(initial.hasNaN,false);assert.equal(initial.overflow,false);
  tests.push('Browser opens all sessions without a preselected case');
  const helpZoom=await evaluate('('+function(){
    const p=document.querySelector('.map-panel');
    p.querySelector('[data-help]').click();
    const contextual=document.querySelector('#about').open&&document.querySelector('#guide-content').textContent.includes('每个小六边形');
    document.querySelector('[data-guide="compare"]').click();
    const guideNavigation=document.querySelector('#guide-content').textContent.includes('斜纹块');
    document.querySelector('#about').close();
    p.querySelector('[data-zoom]').click();
    const r=p.getBoundingClientRect(),zoomed=p.classList.contains('is-zoomed')&&r.width>innerWidth*.9;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    return {contextual,guideNavigation,zoomed,restored:!p.classList.contains('is-zoomed')};
  }.toString()+')()');
  Object.values(helpZoom).forEach(v=>assert.ok(v));
  await wait(180);
  const redesigned=await evaluate('('+function(){
    const matrix=document.querySelector('[aria-label="运行结果矩阵"]');
    const cell=matrix.querySelector('[data-heat-run]');
    cell.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const matrixSelect=workbench.state.run===cell.dataset.heatRun;
    const link=document.querySelector('[data-island-edge]');
    link.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const references=Boolean(workbench.state.edge?.length)&&document.querySelector('#detail').textContent.includes('片段中的引用');
    const input=document.getElementById('show-refs');
    input.checked=false;input.dispatchEvent(new Event('change'));
    const linksHidden=document.querySelectorAll('[data-island-edge]').length===0;
    input.checked=true;input.dispatchEvent(new Event('change'));
    const linksRestored=document.querySelectorAll('[data-island-edge]').length>0;
    const svg=document.querySelector('#file-map svg'),before=svg.getAttribute('viewBox');
    const box=svg.getBoundingClientRect();
    svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:box.x+box.width/2,clientY:box.y+box.height/2,bubbles:true,cancelable:true}));
    const zoom=svg.getAttribute('viewBox')!==before;
    document.getElementById('map-fit').click();
    const fit=workbench.state.mapBox===null;
    document.getElementById('reset').click();
    return {matrixSelect,references,linksHidden,linksRestored,zoom,fit};
  }.toString()+')()');
  Object.values(redesigned).forEach(v=>assert.ok(v));
  const png=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(new URL('./overview.png',import.meta.url),Buffer.from(png.data,'base64'));
  const actions=await evaluate('('+function(){
    const ui=(id)=>document.getElementById(id);
    const first=document.querySelector('#plot [data-run]');
    first.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const selected=Boolean(workbench.state.run&&ui('pin-run'));
    ui('pin-run').click();
    const pinned=Boolean(workbench.state.pin);
    const runGroup=[...workbench.model.subjects.values()].find(g=>g.length>2&&g.some(r=>r.items.length));
    workbench.activate(runGroup.at(-1).event.id,runGroup.at(-1).id);
    const compare=Boolean(ui('compare').textContent.includes('产品版本'));
    const file=document.querySelector('#file-map [data-file]');
    file.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const fileSelected=Boolean(workbench.state.file);
    ui('clear-file').click();ui('reset').click();
    const session=ui('session');session.value=[...workbench.model.sessions.keys()][0];session.dispatchEvent(new Event('change'));
    const expanded=document.querySelectorAll('#plot [data-session]').length>1;
    ui('axis').value='time';ui('axis').dispatchEvent(new Event('change'));
    const time=workbench.state.axis==='time';
    ui('reset').click();ui('records').open=true;ui('search').value='CSC_EXIT';
    ui('search').dispatchEvent(new Event('input'));
    return {selected,pinned,compare,fileSelected,expanded,time};
  }.toString()+')()');
  Object.entries(actions).forEach(([name,value])=>assert.ok(value,name));
  await wait(250);
  const search=await evaluate('document.getElementById("record-count").textContent');
  assert.ok(!search.includes('当前筛选 858'));
  const lazy=await evaluate('('+function(){
    const e=workbench.model.checks[0];workbench.activate(e.event.id,e.id);
    const raw=document.querySelector('.raw-detail');const before=raw.querySelectorAll('pre').length;raw.open=true;return before;
  }.toString()+')()');
  assert.equal(lazy,0);await wait(100);
  assert.equal(await evaluate("document.querySelectorAll('.raw-detail pre').length"),1);
  await evaluate('document.getElementById("reset").click();document.getElementById("records").open=false');
  const fingerprint=await evaluate('('+function(){
    const r=workbench.model.checks.find(r=>r.items.length>0);
    workbench.activate(r.event.id,r.id);
    return {graphic:!!document.querySelector('[aria-label="各次运行的条件指纹"]'),items:document.querySelectorAll('.observations tbody tr').length};
  }.toString()+')()');
  assert.ok(fingerprint.graphic);assert.ok(fingerprint.items>0);
  const interaction=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(new URL('./interaction.png',import.meta.url),Buffer.from(interaction.data,'base64'));
  await evaluate('document.getElementById("reset").click()');
  await call('Emulation.setDeviceMetricsOverride',{width:700,height:1000,deviceScaleFactor:1,mobile:false});
  await wait(150);
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  assert.equal(errors.length,0,JSON.stringify(errors));
  report.browser={initial,layouts,helpZoom,redesigned,actions,search,fingerprint,lazyRaw:true,responsiveOverflow:false,runtimeErrors:errors};
  writeFileSync(new URL('./validation.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{
  if(socket)socket.close();
  proc.kill();
}
