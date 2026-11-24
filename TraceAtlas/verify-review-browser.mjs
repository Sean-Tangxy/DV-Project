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
 await evaluate(`researchWorkspace.selectClaim(researchWorkspace.data.claims.find(c=>c.reported_passes===171).id)`);
 assert.ok(await evaluate(`document.querySelector('#turn-detail').textContent.includes('171 passed')`));
 tests.push('Turn details retain the selected declaration and reported count');
 assert.ok(await evaluate(`[...document.querySelector('#turn-choice').options].filter(o=>o.value).every(o=>researchWorkspace.data.claims.some(c=>c.turn_id===o.value))`));
 const cycle=await evaluate(`document.querySelector('[data-turn-run]').dataset.turnRun`);
 await evaluate(`document.querySelector('[data-turn-run]').click()`);
 assert.deepEqual(await evaluate('researchWorkspace.view.runIds'),[cycle]);
 assert.ok(await evaluate(`document.querySelector('.cycle-card[aria-pressed=true] .cycle-pie')!==null`));
 await evaluate(`document.querySelector('#previous-dialogue').click()`);
 assert.ok(await evaluate(`document.querySelector('#return-dialogue')&&document.querySelectorAll('.turn-disclosure:not([open])').length===2`));
 for(const id of ['turn-prompt','turn-reply']){
   assert.ok(await evaluate(`(()=>{const section=document.getElementById('${id}');section.querySelector('summary').click();return section.open&&section.querySelector('p').innerText.trim().length>0})()`));
   await evaluate(`document.querySelector('#${id} summary').click()`);
 }
 await evaluate(`while(!document.querySelector('#previous-dialogue').disabled)document.querySelector('#previous-dialogue').click();document.querySelector('#return-dialogue').click()`);
 assert.deepEqual(await evaluate('researchWorkspace.view.runIds'),[cycle]);
 tests.push('Declaration-only selector, cycle pie navigation and bounded conversation history');
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
 await evaluate(`document.getElementById('review-reset').click();document.getElementById('map-play').click()`);await wait(900);
 const playOne=await evaluate('researchWorkspace.view.runIds[0]');await evaluate(`document.getElementById('map-play').click()`);await wait(900);
 assert.equal(await evaluate('researchWorkspace.view.runIds[0]'),playOne);
 tests.push('Playback advances through runs and pause cancels pending advance');
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
