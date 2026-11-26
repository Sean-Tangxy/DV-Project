import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const target=resolve(process.argv[2]??fileURLToPath(new URL('.',import.meta.url))),profile=mkdtempSync(join(tmpdir(),'traceatlas-review-'));
const proc=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--window-size=1600,1000','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
 let port;for(let i=0;i<100;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await wait(100);}
 assert.ok(port,'Browser testing connection available');
 const tabs=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((yes,no)=>{socket.addEventListener('open',yes,{once:true});socket.addEventListener('error',no,{once:true});});
 let next=0;const pending=new Map(),errors=[];
 socket.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(d.error):p.resolve(d.result);}else if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails);});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:pathToFileURL(join(target,'review.html')).href});
 for(let i=0;i<150;i++){if(await evaluate('Boolean(globalThis.researchWorkspace&&document.querySelector("#timeline svg"))'))break;await wait(100);}
 assert.ok(await evaluate('Boolean(globalThis.researchWorkspace&&document.querySelector("#timeline svg"))'),'Workspace initialized');
 const tests=[];
 const layouts=[];
 for(const [width,height]of [[1600,1000],[1440,900],[1366,768],[1280,720]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await wait(170);
  assert.ok(await evaluate(`(()=>{const w=researchWorkspace, counts=new Map();for(const r of w.data.runs)counts.set(r.turn,(counts.get(r.turn)||0)+1);const c=w.data.claims.reduce((a,b)=>(counts.get(a.turn_id)||0)>(counts.get(b.turn_id)||0)?a:b);w.selectClaim(c.id);const host=document.querySelector('#turn-detail'),box=host.getBoundingClientRect(),pies=[...host.querySelectorAll('.cycle-pie')];return pies.length===counts.get(c.turn_id)&&pies.every(p=>{const r=p.getBoundingClientRect();return r.width>=6&&r.bottom<=box.bottom+1&&r.right<=box.right+1})&&host.scrollHeight<=host.clientHeight+1})()`),'Largest test turn fits the panel');
  const layout=await evaluate(`({width:innerWidth,height:innerHeight,overflowX:document.documentElement.scrollWidth>innerWidth,overflowY:document.documentElement.scrollHeight>innerHeight,panels:[...document.querySelectorAll('.research-grid>.panel')].map(p=>{const r=p.getBoundingClientRect();return {name:p.querySelector('h2').textContent,x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};})})`);
  assert.equal(layout.overflowX,false);assert.equal(layout.overflowY,false);for(const p of layout.panels){assert.ok(p.width>0&&p.height>0);assert.ok(p.right<=width+1&&p.bottom<=height+1,p.name+' stays in viewport');}layouts.push(layout);
 }
 tests.push('Five analysis regions remain within landscape viewport at four desktop sizes');
 await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await wait(180);
 const capture=async name=>{const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(target,name),Buffer.from(shot.data,'base64'));};
 await evaluate(`document.getElementById('review-reset').click()`);
 await capture('review-overview.png');
 const initial=await evaluate(`({runs:researchWorkspace.data.runs.length,claims:researchWorkspace.data.claims.length,entries:researchWorkspace.aggregate().rows.length,files:document.querySelectorAll('#file-map [data-file]').length})`);
 assert.equal(initial.claims,235);assert.equal(initial.entries,41168);
 tests.push('Entire project dataset loads without a preselected case');
 const turnLink=await evaluate(`(()=>{
   const w=researchWorkspace,groups=new Map();
   for(const r of w.data.runs){const a=groups.get(r.turn)||[];a.push(r);groups.set(r.turn,a);}
   const claim=w.data.claims.find(c=>(groups.get(c.turn_id)?.length||0)>1);
   const selector=document.getElementById('turn-choice');selector.value=claim.turn_id;selector.dispatchEvent(new Event('change'));
   const expected=groups.get(claim.turn_id),agg=w.aggregate();
   return {key:claim.turn_id,selected:w.view.turn,ids:[...w.view.runIds].sort(),expected:expected.map(r=>r.id).sort(),count:agg.rows.length,expectedCount:expected.reduce((n,r)=>n+r.items.length,0),caption:document.getElementById('map-metric-caption').textContent,kind:document.getElementById('detail-kind').textContent,clock:w.view.clock,lastRun:Math.max(...expected.map(r=>r.time))};
 })()`);
 assert.equal(turnLink.selected,turnLink.key);assert.deepEqual(turnLink.ids,turnLink.expected);assert.equal(turnLink.count,turnLink.expectedCount);assert.ok(turnLink.caption.includes('当前轮次'));assert.equal(turnLink.kind,'对话轮次');assert.ok(turnLink.clock>=turnLink.lastRun);
 for(const mode of ['structure','depth','count']){
   await evaluate(`document.querySelector('[data-map-mode="${mode}"]').click()`);
   assert.equal(await evaluate('researchWorkspace.view.turn'),turnLink.key);
   assert.equal(await evaluate('researchWorkspace.aggregate().rows.length'),turnLink.expectedCount);
 }
 tests.push('Selecting a dialogue turn links all its runs, map modes, cutoff time and inspector');
 assert.ok(await evaluate(`(()=>{
   const w=researchWorkspace,timeline=document.querySelector('#timeline svg'),overview=document.querySelector('#time-overview svg'),option=document.querySelector('#turn-choice option:nth-child(2)'),cursor=document.querySelector('#time-cursor').getAttribute('d');
   const t=[...w.turns.values()].find(t=>t.key!==w.view.turn&&t.end>=w.view.range[0]&&t.end<=w.view.range[1]);
   w.selectTurn(t.key);
   return timeline===document.querySelector('#timeline svg')&&overview===document.querySelector('#time-overview svg')&&option===document.querySelector('#turn-choice option:nth-child(2)')&&cursor!==document.querySelector('#time-cursor').getAttribute('d')&&document.querySelectorAll('#timeline circle[r="4"]').length===t.runs.length;
 })()`));
 tests.push('Turn navigation retains static timeline, overview and dropdown nodes while updating cursor and highlights');
 await evaluate(`researchWorkspace.selectTurn(${JSON.stringify(turnLink.key)})`);

 await evaluate(`document.querySelector('[data-turn-run]').click()`);
 assert.equal(await evaluate('researchWorkspace.view.turn'),null);assert.equal(await evaluate('researchWorkspace.aggregate().selected.length'),1);
 tests.push('A cycle click drills from turn aggregation into one run');
 const emptyTurn=await evaluate(`(()=>{const w=researchWorkspace,runTurns=new Set(w.data.runs.map(r=>r.turn)),c=w.data.claims.find(c=>!runTurns.has(c.turn_id));if(!c)return null;w.selectTurn(c.turn_id);return {rows:w.aggregate().rows.length,selected:w.aggregate().selected.length,caption:document.getElementById('detail').textContent};})()`);
 if(emptyTurn){assert.equal(emptyTurn.rows,0);assert.equal(emptyTurn.selected,0);assert.ok(emptyTurn.caption.includes('没有定位到测试运行'));tests.push('Turn without runs keeps execution evidence empty');}
 await evaluate(`researchWorkspace.selectTurn(${JSON.stringify(turnLink.key)});document.getElementById('clear-selection').click()`);
 assert.equal(await evaluate('researchWorkspace.view.turn'),null);assert.equal(await evaluate('researchWorkspace.aggregate().selected.length'),initial.runs);
 tests.push('Clearing turn selection restores the previous time-range overview');
 await evaluate(`researchWorkspace.selectTurn(${JSON.stringify(turnLink.key)});document.getElementById('map-play').click();document.getElementById('map-play').click()`);
 assert.ok(await evaluate(`(()=>{const w=researchWorkspace,t=w.turns.get(w.view.turn);return !!t&&w.view.cumulative===false&&JSON.stringify([...w.view.runIds].sort())===JSON.stringify(t.runs.filter(r=>ReviewData.inRange(r,w.view)).map(r=>r.id).sort())&&document.getElementById('detail-kind').textContent==='对话轮次'})()`));
 tests.push('Per-turn playback aggregates every run of the active turn and coordinates the inspector');
 await evaluate(`researchWorkspace.selectClaim(researchWorkspace.data.claims.find(c=>c.reported_passes===171).id)`);
 assert.ok(await evaluate(`document.querySelector('#turn-detail').textContent.includes('171 passed')`));
 tests.push('Turn details retain the selected declaration and reported count');
 assert.ok(await evaluate(`(()=>{const w=researchWorkspace,options=[...document.querySelector('#turn-choice').options].filter(o=>o.value);return options.length===w.turns.size&&options.some(o=>!w.data.claims.some(c=>c.turn_id===o.value));})()`));
 const cycle=await evaluate(`document.querySelector('[data-turn-run]').dataset.turnRun`);
 await evaluate(`document.querySelector('[data-turn-run]').click()`);
 assert.deepEqual(await evaluate('researchWorkspace.view.runIds'),[cycle]);
 assert.ok(await evaluate(`document.querySelector('.cycle-card[aria-pressed=true] .cycle-pie')!==null`));
 const nav=await evaluate(`(()=>{const w=researchWorkspace,t=w.turns.get(document.getElementById('turn-choice').value),list=[...w.turns.values()].filter(x=>x.session===t.session),i=list.indexOf(t);return {key:t.key,previous:list[i-1]?.key,next:list[i+1]?.key,first:list[0].key,last:list.at(-1).key};})()`);
 if(nav.previous){
   await evaluate(`document.querySelector('#previous-dialogue').click()`);
   assert.equal(await evaluate('researchWorkspace.view.turn'),nav.previous);
   assert.equal(await evaluate('document.getElementById("turn-choice").value'),nav.previous);
   assert.ok(await evaluate(`(()=>{const w=researchWorkspace,t=w.turns.get(w.view.turn);return w.view.clock===t.end&&w.aggregate().rows.length===t.runs.reduce((n,r)=>n+r.items.length,0)&&document.querySelectorAll('.turn-disclosure:not([open])').length===2})()`));
   await evaluate(`document.querySelector('#next-dialogue').click()`);
   assert.equal(await evaluate('researchWorkspace.view.turn'),nav.key);
 }
 assert.equal(await evaluate('document.getElementById("return-dialogue")'),null);
 for(const id of ['turn-prompt','turn-reply']){
   assert.ok(await evaluate(`(()=>{const section=document.getElementById('${id}');section.querySelector('summary').click();return section.open&&section.querySelector('p').innerText.trim().length>0})()`));
   await evaluate(`document.querySelector('#${id} summary').click()`);
 }
 await evaluate(`researchWorkspace.selectTurn(${JSON.stringify(nav.first)})`);
 assert.equal(await evaluate('document.getElementById("previous-dialogue").disabled'),true);
 await evaluate(`researchWorkspace.selectTurn(${JSON.stringify(nav.last)})`);
 assert.equal(await evaluate('document.getElementById("next-dialogue").disabled'),true);
 await evaluate(`researchWorkspace.selectTurn([...researchWorkspace.turns.values()].find(t=>!t.runs.length&&!t.claims.length).key)`);
 assert.equal(await evaluate('researchWorkspace.aggregate().rows.length'),0);
 assert.equal(await evaluate('document.getElementById("turn-choice").value===researchWorkspace.view.turn'),true);
 tests.push('All conversation turns support previous/next navigation, including no-test turns, with bounded endpoints');
 await evaluate(`researchWorkspace.selectRun(researchWorkspace.data.runs.find(r=>r.items.length>15).id)`);
 assert.ok(await evaluate(`researchWorkspace.aggregate().selected.length===1&&document.getElementById('detail').textContent.includes('身份条目')`));
 await evaluate(`document.querySelector('[data-map-mode="depth"]').click()`);await wait(150);
 assert.ok(await evaluate(`Boolean(document.querySelector('#file-map svg'))`));
 await capture('review-run.png');
 tests.push('Selecting a run and switching to 3D renders coordinated map and inspector');
 await evaluate(`researchWorkspace.selectClaim(researchWorkspace.data.claims.find(c=>!c.candidates.length).id)`);
 assert.equal(await evaluate('researchWorkspace.aggregate().rows.length'),0);
 assert.ok(await evaluate(`document.getElementById('detail').textContent.includes('未找到可关联候选')`));
 tests.push('Declaration without candidates stays visible and does not display all runs as its evidence');
 await evaluate(`document.getElementById('review-reset').click();researchWorkspace.setRange(researchWorkspace.data.min,researchWorkspace.data.min+(researchWorkspace.data.max-researchWorkspace.data.min)/3)`);
 assert.ok(await evaluate('researchWorkspace.aggregate().scope.length<researchWorkspace.data.runs.length'));
 tests.push('Time range selection reduces linked run scope');
 assert.ok(await evaluate(`(()=>{const w=researchWorkspace,svg=document.querySelector('#timeline svg');w.setRange(w.data.min,w.data.max);return svg!==document.querySelector('#timeline svg')&&document.querySelectorAll('[data-time-run]').length===w.data.runs.length;})()`));
 const timelineClick=await evaluate(`(()=>{const w=researchWorkspace,node=document.querySelector('[data-time-run]');node.dispatchEvent(new MouseEvent('click',{bubbles:true}));return w.view.runIds[0]===node.dataset.timeRun&&w.aggregate().selected.length===1;})()`);
 assert.equal(timelineClick,true);
 tests.push('Cached timeline rebuilds after range changes and delegated run clicks preserve selection');

 await evaluate(`document.getElementById('review-reset').click();document.getElementById('map-play').click()`);await wait(1200);
 const playOne=await evaluate('researchWorkspace.view.turn');await evaluate(`document.getElementById('map-play').click()`);await wait(1200);
 assert.equal(await evaluate('researchWorkspace.view.turn'),playOne);
 assert.equal(await evaluate('document.getElementById("map-play").getAttribute("aria-pressed")'),'false');
 tests.push('Playback advances through conversation turns and pause cancels pending advance');
 await evaluate(`researchWorkspace.selectTurn(${JSON.stringify(turnLink.key)});var mode=document.getElementById('play-mode');mode.value='cumulative';mode.dispatchEvent(new Event('change'))`);
 const accumulated=await evaluate(`(()=>{const w=researchWorkspace,expected=w.data.runs.filter(r=>ReviewData.inRange(r,w.view)&&r.time<=w.view.clock);return {actual:[...w.view.runIds].sort(),expected:expected.map(r=>r.id).sort(),rows:w.aggregate().rows.length,expectedRows:expected.reduce((n,r)=>n+r.items.length,0),caption:document.getElementById('map-metric-caption').textContent,kind:document.getElementById('detail-kind').textContent}})()`);
 assert.deepEqual(accumulated.actual,accumulated.expected);assert.equal(accumulated.rows,accumulated.expectedRows);assert.ok(accumulated.caption.includes('累积'));assert.equal(accumulated.kind,'累积播放');
 await evaluate(`document.getElementById('map-play').click()`);await wait(1200);
 assert.ok(await evaluate(`(()=>{const w=researchWorkspace;return w.view.cumulative&&w.view.runIds.length===ReviewData.scoped(w.data,w.view).filter(r=>r.time<=w.view.clock).length})()`));
 await evaluate(`var mode=document.getElementById('play-mode');mode.value='turn';mode.dispatchEvent(new Event('change'))`);
 const switched=await evaluate('researchWorkspace.view.turn');await wait(1200);
 assert.equal(await evaluate('researchWorkspace.view.turn'),switched);
 assert.ok(await evaluate(`(()=>{const w=researchWorkspace,t=w.turns.get(w.view.turn);return !w.view.cumulative&&w.aggregate().selected.length===t.runs.filter(r=>ReviewData.inRange(r,w.view)).length})()`));
 tests.push('Cumulative mode contains exactly prior runs in the selected range; switching modes pauses and restores per-turn scope');
 await evaluate(`(()=>{const w=researchWorkspace,t=[...w.turns.values()].find(t=>!t.runs.length&&w.data.runs.some(r=>r.time<t.end));w.selectTurn(t.key);var mode=document.getElementById('play-mode');mode.value='cumulative';mode.dispatchEvent(new Event('change'));})()`);
 assert.ok(await evaluate('researchWorkspace.aggregate().selected.length>0'));
 await evaluate(`var mode=document.getElementById('play-mode');mode.value='turn';mode.dispatchEvent(new Event('change'))`);
 assert.equal(await evaluate('researchWorkspace.aggregate().selected.length'),0);
 tests.push('No-test turns stay empty in per-turn mode and retain only prior evidence in cumulative mode');
 await evaluate(`document.getElementById('review-reset').click()`);
 await evaluate(`researchWorkspace.selectRun(researchWorkspace.data.runs.find(r=>r.items.length>15).id)`);
 const file=await evaluate(`researchWorkspace.aggregate().rows.find(x=>researchWorkspace.model.atlas.positions.has(x.item.file.toLowerCase()))?.item.file.toLowerCase()`);
 if(file){await evaluate('researchWorkspace.selectFile('+JSON.stringify(file)+')');assert.ok(await evaluate(`document.getElementById('detail-kind').textContent==='文件'`));tests.push('File selection updates the same-unit evidence inspector');}
 await evaluate(`document.getElementById('review-reset').click();document.querySelector('[data-map-mode="structure"]').click()`);
 await evaluate(`const w=researchWorkspace;const key=w.model.atlas.positions.keys().next().value;w.selectFile(key);document.querySelector('#agent-input').value='草稿'`);
 assert.ok(await evaluate(`document.querySelector('.file-chip').textContent.includes(researchWorkspace.state.file.split('/').pop())||document.querySelector('.file-chip').textContent.toLowerCase().includes(researchWorkspace.state.file)`));
 await evaluate(`document.querySelector('.file-chip').click()`);
 assert.ok(await evaluate(`!researchWorkspace.state.file&&document.querySelector('#agent-input').value==='草稿'`));
 tests.push('File context bubble follows map selection and clearing it preserves the draft');
 const brush=await evaluate(`(()=>{const r=document.getElementById('time-overview').getBoundingClientRect();return {x:r.x+r.width*.25,end:r.x+r.width*.6,y:r.y+r.height*.5};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',x:brush.x,y:brush.y,button:'left',clickCount:1});
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:brush.end,y:brush.y,button:'left',buttons:1});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:brush.end,y:brush.y,button:'left',clickCount:1});
 assert.ok(await evaluate('researchWorkspace.view.range[0]>researchWorkspace.data.min&&researchWorkspace.view.range[1]<researchWorkspace.data.max'));
 tests.push('Dragging the actual overview applies a shared time interval');
 await call('Page.navigate',{url:pathToFileURL(join(target,'review.html')).href+'?dataset=sszx'});
 for(let i=0;i<150;i++){if(await evaluate('Boolean(globalThis.researchWorkspace&&researchWorkspace.data.unit==="check"&&document.querySelector("#timeline svg"))'))break;await wait(100);}
 assert.ok(await evaluate('researchWorkspace.model.events.length===858&&researchWorkspace.data.runs.length===41'));
 assert.ok(await evaluate('document.getElementById("unit-label").textContent.includes("检查目标条目")'));
 await evaluate(`researchWorkspace.selectRun(researchWorkspace.data.runs[0].id)`);
 assert.ok(await evaluate('document.getElementById("detail").textContent.includes("身份条目")'));
 tests.push('SSZX opens all 858 records and 41 checks with its own units and working selection');
 assert.equal(errors.length,0,JSON.stringify(errors));
 writeFileSync(join(target,'review-browser-validation.json'),JSON.stringify({tests,initial,layouts,errors},null,2));
 console.log(JSON.stringify({tests,initial,layouts,errors},null,2));
}finally{socket?.close();proc.kill();}
