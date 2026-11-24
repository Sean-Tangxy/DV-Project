(function(root){
  'use strict';
  const $=id=>document.getElementById(id),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const params=new URLSearchParams(location.search),dataset=params.get('dataset')==='sszx'?'sszx':'sts2';
  const M=VerificationModel.build(dataset==='sts2'?STS2_DATA:SSZX_DATA);
  TestEvidence.attach(M);M.references=ReferenceAtlas.extract(M);M.mapScope=TestEvidence.mapScope(M);M.atlas=ReferenceAtlas.layout(M.mapScope,M.mapScope.references);
  const depthCeiling=TestEvidence.depthCeiling(M.mapScope),data=ReviewData.build(M,dataset==='sts2'?PYTEST_DEPTH:null);
  const chronological=[...M.events].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.index-b.index),eventIndex=new Map(chronological.map((e,i)=>[e.id,i]));
  const state={session:'all',kind:'all',file:null,selected:null,run:null,pin:null,edge:null,mapBox:null,mapMode:'structure'};
  const view={session:'all',range:[data.min,data.max],runIds:[],claim:null,level:null,basis:null,item:null,pin:null,clock:data.max};
  const tierNames={command_or_output:'命令／输出定位',source_inferred:'历史源码推断',fixture_and_summary:'临时目录与摘要推断',nearby_version_only:'邻近版本候选',failed:'输出记录失败',error:'输出记录错误'};
  const resultNames={pass:'通过',fail:'失败',error:'错误',unknown:'逐项结果未确认',pending:'进行中',skipped:'跳过',mixed:'部分通过',blocked:'启动受阻'};
  let mapSnapshot=null,playing=null,playbackGeneration=0;
  const time=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const short=(s,n=30)=>s.length>n?s.slice(0,n-1)+'…':s;
  const runLabel=r=>'R'+String(r.order).padStart(3,'0');
  const units=data.unit==='instance'?'测试执行实例':'检查目标条目';
  function info(){const index=chronological.findLastIndex(e=>Date.parse(e.time)<=view.clock);return {index,event:{time:new Date(view.clock).toISOString()},seq:chronological,cursor:index,label:time(view.clock)};}
  function ctx(){return {M,state,render,selectFile,stopMapPlayback:stop,mapCutoffInfo:info,eventIndex,depthCeiling,mapCutoff:()=>info().index,mapDate:()=>time(view.clock),chronological};}
  function stop(){if(playing)clearTimeout(playing);playing=null;playbackGeneration++;$('map-play').textContent='▷';}
  root.PytestDepth={update(context){
    if(data.unit!=='instance')return null;
    mapSnapshot=ReviewData.mapStats(data,view,context);return mapSnapshot;
  }};
  function selectFile(key){stop();state.file=key;state.edge=null;view.item=null;state.selected=null;render();}
  function selectRun(id,keepClaim=false){
    manualTurn=null;historyTurn=null;stop();const r=data.runById.get(id);if(!r)return;
    if(r.time<view.range[0]||r.time>view.range[1])view.range=[Math.min(view.range[0],r.time),Math.max(view.range[1],r.time)];
    view.runIds=[id];if(!keepClaim)view.claim=null;view.clock=r.time;view.item=null;state.edge=null;state.selected=r.event;render();
  }
  function selectClaim(id){
    manualTurn=null;historyTurn=null;stop();const c=data.claims.find(c=>c.id===Number(id));if(!c)return;
    view.claim=c.id;view.runIds=c.candidates.filter(id=>data.runById.get(id)?.time<=c.time&&ReviewData.inRange(data.runById.get(id),view));
    view.clock=c.time;view.item=null;state.file=null;state.edge=null;render();
  }
  function setRange(a,b){manualTurn=null;historyTurn=null;stop();view.range=[Math.max(data.min,Math.min(a,b)),Math.min(data.max,Math.max(a,b))];if(view.range[1]-view.range[0]<1000)view.range[1]=Math.min(data.max,view.range[0]+1000);manualTurn=null;view.runIds=[];view.claim=null;view.clock=view.range[1];view.item=null;state.file=null;state.edge=null;render();}
  function active(){
    const agg=ReviewData.aggregate(data,view,state.file);
    // A selected declaration with no candidates supplies no execution set.
    if(view.claim!=null&&!view.runIds.length)return {...agg,selected:[],rows:[],filtered:[],grid:Array.from({length:6},()=>[0,0,0]),outcomes:agg.outcomes.map(()=>({pass:0,fail:0,error:0,unknown:0,skipped:0,other:0})),missing:0,outside:0};
    return agg;
  }
  function bindFiles(host){host.querySelectorAll('[data-pick-file]').forEach(el=>el.onclick=()=>selectFile(el.dataset.pickFile));}
  function hideTip(){$('chart-tooltip').hidden=true;}
  function render(){
    state.session=view.session;mapSnapshot=null;
    $('scope-label').textContent=view.runIds.length===1?runLabel(data.runById.get(view.runIds[0]))+' · '+time(view.clock):view.claim!=null?'声明 C'+String(view.claim+1).padStart(3,'0')+' · '+view.runIds.length+' 个运行候选':time(view.range[0])+' — '+time(view.range[1]);
    $('selection-label').textContent=state.file?M.files.get(state.file)?.path??state.file:view.item?view.item:'';
    $('clear-selection').hidden=!state.file&&!state.edge&&!view.runIds.length&&view.claim==null&&!view.item;
    $('unit-label').textContent='单位：'+units+(view.runIds.length?' · 当前运行':' · 当前时段');
    const agg=active();renderTurn();renderAgent();renderTimeline();
    AtlasViewsRender();renderDetail(agg);
  }
  function AtlasViewsRender(){
    const context=ctx();
    // Preserve empty execution scope for declarations without candidates.
    if(data.unit==='instance'&&view.claim!=null&&!view.runIds.length){
      const empty={...view,range:[view.clock+1,view.clock]};mapSnapshot=ReviewData.mapStats(data,empty,context);
      const update=PytestDepth.update;PytestDepth.update=()=>mapSnapshot;try{TestMapView.render(context);}finally{PytestDepth.update=update;}
    }else TestMapView.render(context);
    $('map-metric-caption').textContent=data.unit==='instance'?(view.runIds.length?'当前运行':'当前时段')+' · '+(state.mapMode==='depth'?'柱高：实例深度和（辅助量）':state.mapMode==='count'?'数字：关联实例次数':'颜色：源码层级'):'源码引用 · 不代表执行覆盖';
  }
  const turnMap=new Map(), sessionNumbers=new Map();
  const turnKey=e=>e.turn||e.id.split(':')[0];
  for(const e of chronological){
    const key=turnKey(e);
    if(!turnMap.has(key)){
      const number=(sessionNumbers.get(e.session)||0)+1;
      sessionNumbers.set(e.session,number);
      turnMap.set(key,{key,number,session:e.session,start:Date.parse(e.time),end:Date.parse(e.time),events:[],runs:[],claims:[]});
    }
    const turn=turnMap.get(key);
    turn.events.push(e);turn.end=Math.max(turn.end,Date.parse(e.time));
    if(e.type==='userMessage'&&!turn.promptEvent)turn.promptEvent=e;
  }
  const runTurn=r=>r.event?turnKey(M.byId.get(r.event)):r.turn;
  for(const r of data.runs){
    const turn=turnMap.get(runTurn(r));
    if(turn){turn.runs.push(r);turn.end=Math.max(turn.end,r.time);}
  }
  for(const c of data.claims){
    const turn=turnMap.get(c.turn_id);
    if(turn){turn.claims.push(c);turn.end=Math.max(turn.end,c.time);}
  }
  const cycleLabels=new Map();
  for(const turn of turnMap.values()){
    turn.runs.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    turn.runs.forEach((r,i)=>cycleLabels.set(r.id,M.sessions.get(turn.session).code+' · 第 '+turn.number+' 轮 · 循环 '+(i+1)));
  }
  let manualTurn=null;
  function promptOf(turn){
    const e=turn.promptEvent;
    const input=VerificationModel.text(e?.input).replace(/<(environment_context|recommended_plugins|permissions instructions)>[\s\S]*?<\/\1>/gi,'').trim();
    if(input)return input;
    if(e?.input||!e?.summary||e.summary==='轮次开始')return '未记录用户提问正文';
    return e.summary;
  }
  function summaryOf(turn,run){
    const counts=Object.entries(run.reported??{});
    if(counts.length)return counts.map(([status,n])=>n+' '+status).join(', ');
    const commands=turn.events.filter(e=>e.type==='commandExecution'&&(run.event?e.id===run.event:Date.parse(e.time)===Date.parse(run.start)));
    if(commands.length!==1)return '';
    const lines=VerificationModel.text(commands[0].output).split(/\r?\n/);
    const summaries=lines.filter(s=>/^\s*=*\s*\d+\s+(passed|failed|skipped|errors?|warnings?|xfailed|xpassed)\b/i.test(s)&&/\bin\s+[\d.]+s\b/.test(s));
    return summaries.map(s=>s.trim().replace(/^=+\s*|\s*=+$/g,'')).join(' · ');
  }
  const histories=new Map();
  for(const t of turnMap.values()){
    if(!histories.has(t.session))histories.set(t.session,[]);
    histories.get(t.session).push(t);
  }
  let historyTurn=null,anchorKey=null;
  function cycleButton(turn,r,index,paths){
    const counts=[0,0,0,0,0,r.missing];
    for(const item of r.items)counts[item.level??5]++;
    const {colors,names}=TestMapView;
    const total=counts.reduce((sum,n)=>sum+n,0),segments=[],description=[];
    let angle=0;
    counts.forEach((n,i)=>{
      if(!n)return;
      const end=angle+n/total*360;
      segments.push(colors[i]+' '+angle+'deg '+end+'deg');
      description.push(names[i]+' '+n+' 项');
      angle=end;
    });
    const outcome=summaryOf(turn,r)||resultNames[r.check?.status]||'结果未记录';
    const details=['循环 '+(index+1),runLabel(r),outcome,...description,...paths].join(' · ');
    const fill=segments.length===1?colors[counts.findIndex(n=>n>0)]:'conic-gradient('+segments.join(',')+')';
    const background=total?'background:'+fill:'';
    return '<button class="cycle-card" data-turn-run="'+E(r.id)+'" aria-label="'+E(details)+'" aria-pressed="'+view.runIds.includes(r.id)+'" title="'+E(details)+'"><small>循环 '+(index+1)+'</small><i class="cycle-pie" style="'+background+'"></i><span>'+E(outcome)+'</span><b class="dense-result">'+E(r.reported?.passed??'–')+'</b></button>';
  }
  function fitCycles(grid){
    const n=grid.childElementCount,w=grid.clientWidth,h=grid.clientHeight;
    let best=-Infinity,cols=1,dense=false;
    for(let c=1;c<=n;c++){
      const rows=Math.ceil(n/c),width=(w-3*(c-1))/c,height=(h-3*(rows-1))/rows;
      const compact=height<48||width<57;
      const score=compact?Math.min(width-22,height-4,26)-16:Math.min(width-6,height-32,64);
      if(score>best){best=score;cols=c;dense=compact;}
    }
    grid.classList.toggle('dense',dense);
    grid.style.gridTemplateColumns='repeat('+cols+',minmax(0,1fr))';
    grid.style.gridTemplateRows='repeat('+Math.ceil(n/cols)+',minmax(0,1fr))';
    grid.style.setProperty('--pie',Math.max(6,best+(dense?16:0))+'px');
  }
  const gridObserver=new ResizeObserver(entries=>entries.forEach(({target})=>fitCycles(target)));
  function renderTurn(){
    const claim=data.claims.find(c=>c.id===view.claim),run=data.runById.get(view.runIds[0]);
    const focused=claim?.turn_id||(run&&runTurn(run));
    const choices=[...turnMap.values()].filter(t=>t.claims.length&&(view.session==='all'||t.session===view.session)&&t.start<=view.range[1]&&t.end>=view.range[0]);
    const turn=turnMap.get(manualTurn||focused)||choices[0];
    const selector=$('turn-choice'),host=$('turn-detail');
    const title=t=>M.sessions.get(t.session).code+' · 第 '+t.number+' 轮';
    selector.replaceChildren(new Option(choices.length?'选择测试轮次':'当前范围无测试声明',''),...choices.map(t=>new Option(title(t)+' · '+time(t.start),t.key)));
    selector.value=turn?.claims.length?turn.key:'';
    if(anchorKey!==turn?.key){historyTurn=null;anchorKey=turn?.key;host.scrollTop=0;}
    if(!turn){host.textContent='当前范围没有带测试声明的对话。可从时间轴查看单次运行。';return;}
    const shown=historyTurn||turn,list=histories.get(turn.session);
    const previous=list[list.indexOf(shown)-1];
    const canBack=previous&&(!historyTurn||!shown.claims.length);
    const record=dataset==='sts2'?root.REVIEW_DIALOGUES[shown.key]:null;
    const reply=record?.reply||shown.events.filter(e=>e.type==='agentMessage').map(e=>VerificationModel.text(e.output)||e.summary).filter(Boolean).join('\n\n');
    gridObserver.disconnect();
    const openSections=new Set(host.dataset.shown===shown.key?
      [...host.querySelectorAll('.turn-disclosure[open]')].map(section=>section.id):[]);
    host.dataset.shown=shown.key;
    let html='<div class="turn-nav"><span>'+E(title(shown))+' · '+time(shown.start)+'</span><button id="previous-dialogue" '+(canBack?'':'disabled')+'>上一轮对话</button>'+(historyTurn?'<button id="return-dialogue">返回测试轮次</button>':'')+'</div>';
    const prompt=record?.prompt||promptOf(shown);
    const answer=(reply&&record&&!record.explicitFinal?'最后一条可见回复\n':'')+(reply||'未记录回复正文');
    for(const [id,label,content] of [['turn-prompt','用户提问',prompt],['turn-reply','Agent 回答',answer]]){
      html+='<details class="turn-disclosure" id="'+id+'"'+(openSections.has(id)?' open':'')+'><summary>'+label+'</summary><p>'+E(content)+'</p></details>';
    }
    if(!historyTurn){
      const runs=turn.runs;
      html+='<h3>修改与测试循环</h3>';
      if(runs.length){
        const edits=turn.events.filter(e=>e.type==='fileChange').flatMap(e=>e.editPaths.map(path=>[e.time,path]));
        if(dataset==='sts2')edits.push(...(root.REVIEW_WRITES[turn.key]??[]));
        edits.sort((a,b)=>Date.parse(a[0])-Date.parse(b[0]));
        let cursor=0;
        html+='<div class="cycle-legend">'+TestMapView.names.map((label,i)=>'<span title="'+label+'"><i style="background:'+TestMapView.colors[i]+'"></i>'+label.split(' ')[0]+'</span>').join('')+'</div><div class="cycle-grid">';
        runs.forEach((r,i)=>{
          const paths=new Set();
          while(cursor<edits.length&&Date.parse(edits[cursor][0])<=Date.parse(r.start))paths.add(edits[cursor++][1]);
          html+=cycleButton(turn,r,i,paths);
        });
        html+='</div>';
      }else html+='<p>本轮未定位到对应运行。</p>';
    }
    host.innerHTML=html;
    const grid=host.querySelector('.cycle-grid');
    if(grid){fitCycles(grid);gridObserver.observe(grid);}
    $('previous-dialogue').onclick=()=>{historyTurn=previous;host.scrollTop=0;renderTurn();};
    if(historyTurn)$('return-dialogue').onclick=()=>{historyTurn=null;host.scrollTop=0;renderTurn();};
    host.querySelectorAll('[data-turn-run]').forEach(b=>b.onclick=()=>{state.file=null;selectRun(b.dataset.turnRun);});
  }
  $('turn-choice').onchange=e=>{stop();historyTurn=null;manualTurn=e.target.value;renderTurn();};
  function renderAgent(){
    const host=$('agent-context');
    if(!state.file){host.textContent='未选择文件';return;}
    const chip=document.createElement('button');
    const path=M.files.get(state.file)?.path||state.file;
    chip.className='file-chip';chip.textContent=path+' ×';chip.title='取消选择 '+path;
    chip.onclick=()=>$('clear-file').click();host.replaceChildren(chip);
  }
  function renderTimeline(){
    const w=Math.max(600,$('timeline').clientWidth-18),left=68,right=16,span=w-left-right,a=view.range[0],b=view.range[1],scale=t=>left+(t-a)/(b-a||1)*span;
    const runs=data.runs.filter(r=>ReviewData.inRange(r,view)),claims=data.claims.filter(c=>ReviewData.inRange(c,view));
    let svg='<svg viewBox="0 0 '+w+' 78" role="group" aria-label="共享时间轴上的声明、执行和修改"><defs><clipPath id="timeline-clip"><rect x="'+left+'" y="0" width="'+span+'" height="78"/></clipPath></defs>';
    [14,36,58].forEach((y,i)=>{svg+='<text x="4" y="'+(y+3)+'" class="chart-subtitle">'+['AI 声明','测试循环','文件修改'][i]+'</text><path d="M'+left+' '+y+'H'+(w-right)+'" stroke="#eef0f5"/>';});
    for(let i=0;i<6;i++){const x=left+i/5*span;svg+='<path d="M'+x+' 6V65" stroke="#f3f4f7"/><text x="'+x+'" y="76" text-anchor="'+(i===0?'start':i===5?'end':'middle')+'" class="chart-subtitle">'+time(a+(b-a)*i/5)+'</text>';}
    svg+='<g clip-path="url(#timeline-clip)">';
    const claim=data.claims.find(c=>c.id===view.claim);
    const selectedRuns=new Set(view.runIds);
    const linkedClaims=claim?[claim]:claims.filter(c=>c.candidates.some(id=>selectedRuns.has(id)));
    const highlighted=new Set(linkedClaims.map(c=>c.id));
    for(const c of linkedClaims)for(const id of c.candidates){
      const r=data.runById.get(id);
      if(!r||!ReviewData.inRange(r,view)||(!claim&&!selectedRuns.has(id)))continue;
      const x=scale(r.time),xx=scale(c.time);
      svg+='<path d="M'+x+' 36Q'+((x+xx)/2)+' 18 '+xx+' 14" fill="none" stroke="#889bc3" stroke-dasharray="3 2" pointer-events="none"/>';
    }
    for(const r of [...runs.filter(r=>!selectedRuns.has(r.id)),...runs.filter(r=>selectedRuns.has(r.id))]){const x=scale(r.time),active=view.runIds.includes(r.id);svg+='<circle class="time-event" role="button" tabindex="0" data-time-run="'+E(r.id)+'" cx="'+x+'" cy="36" r="'+(active?4:2.3)+'" fill="'+(active?'#526ca6':'#a9b5cb')+'"><title>'+E(cycleLabels.get(r.id))+' · '+runLabel(r)+' · '+time(r.time)+' · '+r.items.length+' 个身份条目</title></circle>';}
    for(const c of claims){const x=scale(c.time),active=highlighted.has(c.id);svg+='<path class="time-event" role="button" tabindex="0" data-time-claim="'+c.id+'" d="M'+x+' 9l4 5-4 5-4-5Z" fill="'+(active?'#7c82b8':'white')+'" stroke="'+(c.candidates.length?'#8f94bc':'#bdad94')+'"><title>C'+(c.id+1)+' · '+c.reported_passes+' passed · '+c.candidates.length+' 个运行候选 · '+E(c.candidates.map(id=>cycleLabels.get(id)).join(' / '))+'\n'+time(c.time)+'</title></path>';}
    for(const e of M.events){const t=Date.parse(e.time);if(t<a||t>b||!e.files.length||(view.session!=='all'&&e.session!==view.session))continue;const test=e.files.some(f=>TestEvidence.testPath(f.path)),x=scale(t);svg+='<path d="M'+x+' '+(test?51:58)+'v6" stroke="'+(test?'#b4a5c5':'#a9bdbb')+'" stroke-width="1" opacity=".7"><title>'+time(t)+' · '+e.files.map(f=>f.path).join(', ')+'</title></path>';}
    const cursor=scale(view.clock);svg+='<path d="M'+cursor+' 4V65" stroke="#6578a6" stroke-width="1" opacity=".5"/></g></svg>';
    $('timeline').innerHTML=svg;
    $('timeline').querySelectorAll('[data-time-run]').forEach(el=>el.onclick=()=>selectRun(el.dataset.timeRun));
    $('timeline').querySelectorAll('[data-time-claim]').forEach(el=>el.onclick=()=>selectClaim(el.dataset.timeClaim));
    const selectedRun=view.runIds.length===1&&data.runById.get(view.runIds[0]);
    $('timeline-range').textContent=(selectedRun?cycleLabels.get(selectedRun.id)+' · ':'')+runs.length+' 次运行 · '+claims.length+' 条声明';
    const fullSpan=data.max-data.min||1,bins=Array(100).fill(0);
    for(const r of data.runs)if(view.session==='all'||r.session===view.session)bins[Math.min(99,Math.floor((r.time-data.min)/fullSpan*100))]++;
    const max=Math.max(1,...bins),xa=left+(a-data.min)/fullSpan*span,xb=left+(b-data.min)/fullSpan*span;
    $('time-overview').innerHTML='<svg viewBox="0 0 '+w+' 20" aria-label="全时段运行密度与刷选范围"><text x="4" y="13" class="chart-subtitle">概览</text>'+bins.map((n,i)=>'<rect x="'+(left+i*span/100)+'" y="'+(17-n/max*14)+'" width="'+Math.max(.5,span/100-1)+'" height="'+(n/max*14)+'" fill="#d7deeb"/>').join('')+'<rect x="'+xa+'" y="1" width="'+Math.max(2,xb-xa)+'" height="17" fill="#7186b51c" stroke="#a6b5d0"/><path d="M'+xa+' 1v17M'+xb+' 1v17" stroke="#6b80b0" stroke-width="2"/></svg>';
    const overview=$('time-overview');let drag=null;
    const position=e=>{const box=overview.getBoundingClientRect(),x=(e.clientX-box.left-9)/(box.width-18)*w;return Math.max(data.min,Math.min(data.max,data.min+(x-left)/span*fullSpan));};
    overview.onpointerdown=e=>{drag=position(e);overview.setPointerCapture(e.pointerId);};
    overview.onpointermove=e=>{if(drag==null)return;const end=position(e);$('timeline-range').textContent=time(Math.min(drag,end))+' — '+time(Math.max(drag,end));};
    overview.onpointerup=e=>{if(drag==null)return;const start=drag;drag=null;const end=position(e);if(Math.abs(end-start)>fullSpan/200)setRange(start,end);};
    overview.onpointercancel=()=>{drag=null;};overview.ondblclick=()=>setRange(data.min,data.max);
  }
  function renderDetail(agg){
    const claim=data.claims.find(c=>c.id===view.claim),run=view.runIds.length===1?data.runById.get(view.runIds[0]):null;
    let html='<div class="detail">';
    $('detail-kind').textContent=state.file?'文件':claim?'声明':run?'运行':'';
    if(state.file){
      const f=M.files.get(state.file),s=mapSnapshot?.stats.get(state.file);
      html+='<div class="detail-path">'+E(f?.path??state.file)+'</div><div class="detail-meta">'+(f?.side==='test'?'测试文件':'项目文件')+' · 与左侧相同运行范围</div><div class="inspector-numbers"><div><strong>'+agg.filtered.length+'</strong><span>'+units+'（含推断）</span></div><div><strong>'+new Set(agg.filtered.map(r=>r.run.id)).size+'</strong><span>关联运行</span></div></div>';
      if(s)html+='<p class="detail-note">源码层级分布：'+s.histogram.map((n,i)=>n?(i===5?'未知':'D'+i)+' × '+n:'').filter(Boolean).join(' · ')+'</p>';
      if(data.unit==='instance')html+='<p class="detail-note">关联来自源码调用，不表示动态覆盖。相同测试在不同运行中会重复计数。</p>';
      html+=instanceList(agg.filtered);
      if(data.unit!=='instance'&&f){const d=TestEvidence.depth(f,info(),eventIndex,view.session,M);html+='<div class="inspector-section"><h3>源码层级依据</h3><p class="detail-note">'+E(d.reason)+'</p><pre>'+E(d.hits.join('\n'))+'</pre></div>';}
    }else if(claim){
      html+='<div class="detail-meta">C'+String(claim.id+1).padStart(3,'0')+' · '+time(claim.time)+'</div><h3 class="detail-claim">'+claim.reported_passes+' passed</h3><p class="detail-note">从 AI 回复提取的通过数量；以下关系为候选。</p><div class="inspector-section"><h3>'+claim.relation+' · '+claim.candidates.length+'</h3>';
      if(!claim.candidates.length)html+='<p class="detail-note">未找到可关联候选；不回退为全部运行。</p>';
      for(const id of claim.candidates){const r=data.runById.get(id);html+='<button class="candidate-button" data-candidate="'+E(id)+'" aria-pressed="'+view.runIds.includes(id)+'">'+E(cycleLabels.get(id))+' · '+runLabel(r)+' · '+time(r.time)+'<br><span class="detail-note">'+r.items.length+' 个身份条目 · 未定位 '+r.missing+'</span></button>';}
      html+='</div><div class="inspector-section"><h3>原始定位</h3><p class="detail-path">'+E(claim.source?.source_id??'未提供')+'</p><p class="detail-note">第 '+E(claim.source?.line??'?')+' 行 · '+E(claim.turn_id)+'</p></div>';
      if(run)html+=runSummary(run);
    }else if(run){html+=runSummary(run)+instanceList(agg.filtered);}
    else if(state.edge?.length){
      const links=mapSnapshot?.activeRefs??TestEvidence.refs(M,info(),eventIndex,view.session);html+='<h3>引用依据</h3>';
      for(const e of links.filter(e=>state.edge.includes(e.id)))html+='<div class="inspector-section"><p class="detail-path">'+E(e.source)+' → '+E(e.target)+'</p>'+e.evidence.map(ev=>'<pre>'+E(ev.excerpt)+'</pre>').join('')+'</div>';
    }else{
      html+='<div class="selection-empty">选择声明、运行或文件<div class="mini-rule"></div><span>◇ 时间轴：声明与执行关系<br>对话轮次详情：修改与测试循环</span></div><div class="inspector-section"><h3>当前数据范围</h3><p class="detail-note">'+agg.scope.length+' 次运行 · '+data.claims.filter(c=>ReviewData.inRange(c,view)).length+' 条声明<br>全部导出记录保留；空白表示未保存执行证据。</p></div>';
    }
    html+='</div>';$('detail').innerHTML=html;
    $('detail').querySelectorAll('[data-candidate]').forEach(el=>el.onclick=()=>selectRun(el.dataset.candidate,true));
    $('detail').querySelectorAll('[data-open-instance]').forEach(el=>el.onclick=()=>{view.item=el.dataset.openInstance;render();});
    bindFiles($('detail'));
  }
  function runSummary(r){
    let html='<div class="detail-path">'+runLabel(r)+' · '+time(r.time)+'</div><div class="detail-meta">'+E(r.id)+'</div><div class="inspector-numbers"><div><strong>'+r.items.length+'</strong><span>身份条目（含推断）</span></div><div><strong>'+r.missing+'</strong><span>摘要通过身份未定</span></div></div>';
    if(r.check){html+='<div class="inspector-section"><h3>'+E(r.check.label)+' · '+E(resultNames[r.check.status]??r.check.status)+'</h3><pre>'+E(r.check.proof)+'</pre></div>';}
    const e=M.byId.get(r.event);if(e)html+='<details><summary>原始输入 / 输出</summary><pre>'+E(VerificationModel.text(e.input))+'\n\n'+E(VerificationModel.text(e.output))+'</pre></details>';
    return html;
  }
  function instanceList(rows){
    const selected=view.item?rows.filter(x=>x.item.identity===view.item):rows;
    let html='<div class="inspector-section"><h3>实例与来源 · '+selected.length+'</h3><div class="evidence-list">';
    for(const {run:r,item:i} of selected.slice(0,60))html+='<button data-open-instance="'+E(i.identity)+'">'+E(i.identity)+'<small>'+runLabel(r)+' · '+E(tierNames[i.tier]??i.tier)+' · '+E(resultNames[i.result]??i.result)+'</small></button>';
    html+='</div>'+(selected.length>60?'<p class="detail-note">显示前 60 条。</p>':'');
    if(view.item&&selected[0]){
      const i=selected[0].item;html+='<p class="detail-meta">源码标识 '+E(i.version??'未知')+'</p>';
      for(const [target,[line,symbol]] of Object.entries(i.targets))html+='<button data-pick-file="'+E(target.toLowerCase())+'">'+E(target)+'</button><pre>'+E(symbol)+' · L'+line+'</pre>';
    }
    return html+'</div>';
  }
  $('review-dataset').value=dataset;$('review-dataset').onchange=e=>{const url=new URL(location.href);url.searchParams.set('dataset',e.target.value);location.href=url.href;};
  $('original-link').href='index.html?dataset='+dataset;
  $('review-session').innerHTML='<option value="all">全部会话</option>'+[...M.sessions.values()].map(s=>'<option value="'+E(s.id)+'">'+s.code+'</option>').join('');
  $('review-session').onchange=e=>{view.session=e.target.value;setRange(data.min,data.max);};
  $('data-counts').textContent=M.events.length.toLocaleString()+' 记录 / '+M.sessions.size+' 会话';
  $('review-reset').onclick=()=>{manualTurn=null;historyTurn=null;stop();Object.assign(view,{session:'all',range:[data.min,data.max],runIds:[],claim:null,level:null,basis:null,item:null,pin:null,clock:data.max});state.file=null;state.edge=null;state.mapBox=null;$('review-session').value='all';render();};
  $('clear-selection').onclick=()=>{view.runIds=[];view.claim=null;view.item=null;view.clock=view.range[1];state.file=null;state.edge=null;render();};
  $('clear-file').onclick=()=>{state.file=null;state.edge=null;view.item=null;render();};
  $('map-fit').onclick=()=>{state.mapBox=null;render();};
  ['show-refs','show-types'].forEach(id=>$(id).onchange=render);
  document.querySelectorAll('[data-map-mode]').forEach(el=>el.onclick=()=>{state.mapMode=el.dataset.mapMode;state.mapBox=null;render();});
  $('map-zoom').onclick=()=>{$('map-zoom').closest('.panel').classList.toggle('is-zoomed');render();};
  $('inspector-toggle').onclick=()=>{document.body.classList.toggle('inspector-collapsed');};
  $('time-all').onclick=()=>setRange(data.min,data.max);
  const jump=delta=>{const claims=data.claims.filter(c=>ReviewData.inRange(c,view));const current=claims.findIndex(c=>c.id===view.claim);const i=current<0?(delta>0?0:claims.length-1):current+delta;if(claims[i])selectClaim(claims[i].id);};
  $('time-previous').onclick=()=>jump(-1);$('time-next').onclick=()=>jump(1);
  $('map-play').onclick=()=>{
    if(playing){stop();return;}const runs=ReviewData.scoped(data,view);if(!runs.length)return;
    const selected=runs.findIndex(r=>r.id===view.runIds[0]);let i=selected<0||selected>=runs.length-1?0:selected+1;const generation=++playbackGeneration;
    const tick=()=>{if(generation!==playbackGeneration)return;const r=runs[i++];manualTurn=null;view.runIds=[r.id];view.claim=null;view.clock=r.time;view.item=null;render();$('map-play').textContent='Ⅱ';if(i<runs.length)playing=setTimeout(tick,800);else stop();};tick();
  };
  $('review-help').onclick=()=>$('review-guide').showModal();$('close-help').onclick=()=>$('review-guide').close();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){stop();document.querySelector('.map-panel.is-zoomed')?.classList.remove('is-zoomed');hideTip();}const target=e.target.closest?.('[role=button]');if(target&&['Enter',' '].includes(e.key)){e.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{renderTimeline();},120);});
  root.researchWorkspace={model:M,data,view,state,render,selectRun,selectClaim,selectFile,setRange,ctx,aggregate:active};
  render();
})(globalThis);
