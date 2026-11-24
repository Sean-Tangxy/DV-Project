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
  const colors=['#a7b0c2','#6578cc','#a47bc5','#cd9659','#4d9e9b','#dce1eb'],depthNames=['D0 静态','D1 逻辑','D2 替身／进程','D3 引擎','D4 界面','深度未知'];
  const statusColors={pass:'#64a18e',fail:'#c97f80',error:'#b5656f',unknown:'#c1c9d6',pending:'#a7bdd4',skipped:'#cdbf9e',mixed:'#bba478',blocked:'#c4976c'};
  const tierNames={command_or_output:'命令／输出定位',source_inferred:'历史源码推断',fixture_and_summary:'临时目录与摘要推断',nearby_version_only:'邻近版本候选',failed:'输出记录失败',error:'输出记录错误'};
  const resultNames={pass:'通过',fail:'失败',error:'错误',unknown:'逐项结果未确认',pending:'进行中',skipped:'跳过',mixed:'部分通过',blocked:'启动受阻'};
  const expanded=new Set();let mapSnapshot=null,playing=null,playbackGeneration=0,matrixScroll=[0,0],comparisonOpen=false,lastMatrix=null;
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
    stop();const r=data.runById.get(id);if(!r)return;
    if(r.time<view.range[0]||r.time>view.range[1])view.range=[Math.min(view.range[0],r.time),Math.max(view.range[1],r.time)];
    view.runIds=[id];if(!keepClaim)view.claim=null;view.clock=r.time;view.item=null;state.edge=null;state.selected=r.event;render();
  }
  function selectClaim(id){
    stop();const c=data.claims.find(c=>c.id===Number(id));if(!c)return;
    view.claim=c.id;view.runIds=c.candidates.filter(id=>data.runById.get(id)?.time<=c.time&&ReviewData.inRange(data.runById.get(id),view));
    view.clock=c.time;view.item=null;state.file=null;state.edge=null;render();
  }
  function setRange(a,b){stop();view.range=[Math.max(data.min,Math.min(a,b)),Math.min(data.max,Math.max(a,b))];if(view.range[1]-view.range[0]<1000)view.range[1]=Math.min(data.max,view.range[0]+1000);view.runIds=[];view.claim=null;view.clock=view.range[1];view.item=null;state.file=null;state.edge=null;matrixScroll=[0,0];render();}
  function active(){
    const agg=ReviewData.aggregate(data,view,state.file);
    // A selected declaration with no candidates supplies no execution set.
    if(view.claim!=null&&!view.runIds.length)return {...agg,selected:[],rows:[],filtered:[],grid:Array.from({length:6},()=>[0,0,0]),outcomes:agg.outcomes.map(()=>({pass:0,fail:0,error:0,unknown:0,skipped:0,other:0})),missing:0,outside:0};
    return agg;
  }
  function bindFiles(host){host.querySelectorAll('[data-pick-file]').forEach(el=>el.onclick=()=>selectFile(el.dataset.pickFile));}
  function tip(text,x,y){const el=$('chart-tooltip');el.textContent=text;el.hidden=false;el.style.left=Math.min(innerWidth-365,x+12)+'px';el.style.top=Math.min(innerHeight-120,y+12)+'px';}
  function hideTip(){$('chart-tooltip').hidden=true;}
  function render(){
    state.session=view.session;mapSnapshot=null;
    $('scope-label').textContent=view.runIds.length===1?runLabel(data.runById.get(view.runIds[0]))+' · '+time(view.clock):view.claim!=null?'声明 C'+String(view.claim+1).padStart(3,'0')+' · '+view.runIds.length+' 个运行候选':time(view.range[0])+' — '+time(view.range[1]);
    $('selection-label').textContent=state.file?M.files.get(state.file)?.path??state.file:view.item?view.item:'';
    $('clear-selection').hidden=!state.file&&!state.edge&&!view.runIds.length&&view.claim==null&&!view.item;
    $('unit-label').textContent='单位：'+units+(view.runIds.length?' · 当前运行':' · 当前时段');
    const agg=active();renderComposition(agg);renderMatrix();renderTimeline();
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
  function renderComposition(agg){
    const total=agg.rows.length,max=Math.max(1,...agg.grid.flat()),w=340,left=70,cw=65,right=272,top=42,rh=25;
    $('composition-total').textContent=total.toLocaleString()+' 条';
    $('clear-filter').hidden=view.level==null&&view.basis==null;
    let svg='<svg viewBox="0 0 '+w+' 214" role="group" aria-label="测试深度与身份依据构成矩阵">';
    ['输出定位','源码推断','版本候选'].forEach((s,i)=>{svg+='<text class="chart-subtitle" text-anchor="middle" x="'+(left+i*cw+cw/2)+'" y="21">'+s+'</text>';});
    svg+='<text class="chart-subtitle" x="'+(right+4)+'" y="21">结果</text>';
    for(let d=0;d<6;d++){
      const y=top+d*rh;svg+='<circle cx="8" cy="'+(y+6)+'" r="3" fill="'+colors[d]+'"/><text class="chart-label" x="17" y="'+(y+10)+'">'+depthNames[d].replace('D2 替身／进程','D2 替身')+'</text>';
      for(let b=0;b<3;b++){
        const x=left+b*cw,n=agg.grid[d][b],chosen=view.level===d&&(view.basis===b||view.basis==null);
        svg+='<g class="composition-cell" tabindex="0" role="button" data-depth-filter="'+d+'" data-basis-filter="'+b+'" aria-label="'+depthNames[d]+' '+ReviewData.tierNames[b]+' '+n+' 条"><title>'+depthNames[d]+' · '+ReviewData.tierNames[b]+'\n'+n+' 条'+units+'</title><rect class="cell-background" x="'+x+'" y="'+(y-4)+'" width="'+(cw-3)+'" height="22" fill="'+(chosen?'#edf0f8':'#f9fafc')+'" stroke="'+(chosen?'#909fc7':'none')+'"/><rect x="'+(x+4)+'" y="'+(y+2)+'" width="'+((cw-10)*n/max)+'" height="10" fill="'+colors[d]+'"/><text class="chart-value" x="'+(x+cw-7)+'" y="'+(y+10)+'" text-anchor="end" paint-order="stroke" stroke="#fff" stroke-width="2">'+n+'</text></g>';
      }
      const o=agg.outcomes[d],sum=Object.values(o).reduce((a,b)=>a+b,0);let x=right+3;
      for(const [s,n] of Object.entries(o)){if(!n)continue;const width=50*n/sum;svg+='<rect x="'+x+'" y="'+(y+2)+'" width="'+width+'" height="10" fill="'+(statusColors[s]??'#b9c2d0')+'"><title>'+E(resultNames[s]??s)+' · '+n+'</title></rect>';x+=width;}
    }
    svg+='<text class="chart-subtitle" x="'+left+'" y="207">条长：共同数量尺度 · '+max.toLocaleString()+'</text></svg>';$('composition').innerHTML=svg;
    $('composition').querySelectorAll('[data-depth-filter]').forEach(el=>el.onclick=()=>{const d=Number(el.dataset.depthFilter),b=Number(el.dataset.basisFilter);if(view.level===d&&view.basis===b){view.level=null;view.basis=null;}else{view.level=d;view.basis=b;}view.item=null;render();});
    const selectedClaim=data.claims.find(c=>c.id===view.claim);
    $('composition-note').innerHTML=(selectedClaim?'声明 '+selectedClaim.reported_passes+' passed · ':'')+agg.selected.length+' 次运行 · '+total.toLocaleString()+' 个身份条目（含推断）'+(agg.missing?' · '+agg.missing+' 个摘要通过身份未定':'')+'<br><span style="color:#64a18e">●</span> 逐项通过　<span style="color:#c97f80">●</span> 失败／错误　<span style="color:#bfc8d5">●</span> 逐项结果未确认'+(agg.outside?'<br>'+agg.outside+' 条定义文件在地图外':'');
  }
  function matrixModel(){
    const runs=ReviewData.scoped(data,view),groups=new Map();
    runs.forEach((run,col)=>{
      for(const item of run.items){
        if(!ReviewData.matchesFile(item,state.file)||!ReviewData.matches(item,{...view,item:null}))continue;
        let g=groups.get(item.file);if(!g){g={key:item.file,label:item.file.split('/').at(-1),kind:'file',cells:new Map(),children:new Map()};groups.set(item.file,g);}
        if(!g.cells.has(col))g.cells.set(col,[]);g.cells.get(col).push(item);
        let child=g.children.get(item.identity);if(!child){child={key:item.identity,label:item.identity.split('::').slice(1).join('::')||item.identity,kind:'item',file:item.file,cells:new Map()};g.children.set(item.identity,child);}
        if(!child.cells.has(col))child.cells.set(col,[]);child.cells.get(col).push(item);
      }
    });
    const rows=[];for(const g of [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key))){rows.push(g);if(expanded.has(g.key))rows.push(...g.children.values());}
    return {runs,rows};
  }
  function renderMatrix(){
    const host=$('evolution');matrixScroll=[host.scrollLeft,host.scrollTop];lastMatrix=matrixModel();
    const {runs,rows}=lastMatrix;$('evolution-count').textContent=runs.length+' 运行 · '+rows.filter(r=>r.kind==='file').length+' 文件';
    const left=153,cw=25,rh=22,top=38,width=Math.max(host.clientWidth,left+runs.length*cw+12),height=Math.max(host.clientHeight,top+rows.length*rh+10);
    host.innerHTML='<div class="matrix-stage" style="width:'+width+'px;height:'+height+'px"><canvas role="img" aria-label="测试文件与运行演变矩阵"></canvas></div>';
    const canvas=host.querySelector('canvas'),c=canvas.getContext('2d');
    const draw=()=>{
      const ww=host.clientWidth,hh=host.clientHeight,dpr=window.devicePixelRatio||1;
      canvas.width=ww*dpr;canvas.height=hh*dpr;canvas.style.width=ww+'px';canvas.style.height=hh+'px';c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#fff';c.fillRect(0,0,ww,hh);
      const sx=host.scrollLeft,sy=host.scrollTop,startCol=Math.max(0,Math.floor(sx/cw)),endCol=Math.min(runs.length,Math.ceil((sx+ww-left)/cw)+1),startRow=Math.max(0,Math.floor(sy/rh)),endRow=Math.min(rows.length,Math.ceil((sy+hh-top)/rh)+1);
      c.font='9px Segoe UI';c.textBaseline='middle';
      for(let ri=startRow;ri<endRow;ri++){
        const row=rows[ri],y=top+ri*rh-sy;
        if(ri%2===0){c.fillStyle='#fafbfc';c.fillRect(0,y,ww,rh);}
        for(let col=startCol;col<endCol;col++){
          const x=left+col*cw-sx,list=row.cells.get(col);if(x<left-1||y<top-1)continue;
          c.strokeStyle='#edf0f4';c.strokeRect(x+2,y+4,18,14);
          if(list){let xx=x+2;const grouped=new Map();for(const item of list){const key=item.result+'|'+(item.basis>0);grouped.set(key,(grouped.get(key)||0)+1);}for(const [key,n] of grouped){const [status,inferred]=key.split('|'),size=18*n/list.length;c.fillStyle=statusColors[status]??'#c1c9d6';c.fillRect(xx,y+4,size,14);
            if(inferred==='true'){c.save();c.beginPath();c.rect(xx,y+4,size,14);c.clip();c.strokeStyle='#7c8dac';c.lineWidth=.6;for(let dx=-14;dx<size+14;dx+=4){c.beginPath();c.moveTo(xx+dx,y+18);c.lineTo(xx+dx+14,y+4);c.stroke();}c.restore();}xx+=size;}}
          if(view.runIds.includes(runs[col].id)||view.pin===runs[col].id){c.strokeStyle=view.pin===runs[col].id?'#b18e65':'#687ab2';c.lineWidth=1.2;c.strokeRect(x+1,y+2,20,18);}
        }
      }
      c.fillStyle='#fff';c.fillRect(0,0,left,hh);c.fillRect(0,0,ww,top);c.strokeStyle='#e6eaf0';c.beginPath();c.moveTo(left,0);c.lineTo(left,hh);c.moveTo(0,top);c.lineTo(ww,top);c.stroke();
      c.fillStyle='#9da5b1';c.fillText('测试文件 / 函数',9,17);
      for(let ri=startRow;ri<endRow;ri++){
        const row=rows[ri],y=top+ri*rh-sy;if(y<top)continue;
        c.fillStyle=row.kind==='file'?'#68778e':'#929cab';c.fillText((row.kind==='file'?(expanded.has(row.key)?'− ':'+ '):'  ')+short(row.label,row.kind==='file'?23:22),8,y+11);
      }
      for(let col=startCol;col<endCol;col++){const x=left+col*cw-sx;if(x<left)continue;c.fillStyle=view.runIds.includes(runs[col].id)?'#4f659a':'#98a2b3';c.fillText(String(runs[col].order),x+3,15);if(view.pin===runs[col].id){c.fillStyle='#b18e65';c.fillText('A',x+8,29);}else if(view.runIds.includes(runs[col].id)){c.fillText('●',x+7,29);}}
      if(!rows.length){c.fillStyle='#a0a8b5';c.fillText('当前范围没有对应测试身份',14,top+22);}
    };
    host.scrollLeft=matrixScroll[0];host.scrollTop=matrixScroll[1];host.onscroll=draw;draw();
    const hit=e=>{const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return {x,y,col:Math.floor((x-left+host.scrollLeft)/cw),row:Math.floor((y-top+host.scrollTop)/rh)};};
    canvas.onmousemove=e=>{const h=hit(e),r=runs[h.col],row=rows[h.row];if(h.y<top&&h.x>left&&r)tip(runLabel(r)+' · '+time(r.time)+'\n'+r.items.length+' 个身份条目\n点击选择；Shift＋点击设为 A',e.clientX,e.clientY);else if(row&&h.y>=top){const list=row.cells.get(h.col);tip(row.key+(r?'\n'+runLabel(r):'')+'\n'+(h.x<left?'点击文件行展开；点击函数行定位':list?list.length+' 条记录 · '+[...new Set(list.map(i=>resultNames[i.result]??i.result))].join('、'):'未保存该身份的执行证据'),e.clientX,e.clientY);}else hideTip();};
    canvas.onmouseleave=hideTip;
    canvas.onclick=e=>{hideTip();const h=hit(e),r=runs[h.col],row=rows[h.row];if(h.y<top&&h.x>=left&&r){if(e.shiftKey){view.pin=r.id;comparisonOpen=true;render();}else selectRun(r.id);return;}if(h.y>=top&&h.x<left&&row){if(row.kind==='file'){expanded.has(row.key)?expanded.delete(row.key):expanded.add(row.key);renderMatrix();}else{view.item=row.key;state.file=row.file.toLowerCase();render();}return;}if(row&&r&&h.y>=top&&row.cells.has(h.col)){selectRun(r.id);state.file=(row.file??row.key).toLowerCase();if(row.kind==='item')view.item=row.key;render();}};
    renderComparison(runs);
  }
  function renderComparison(runs){
    $('comparison').hidden=!comparisonOpen;
    if(!comparisonOpen)return;
    const A=data.runById.get(view.pin),B=data.runById.get(view.runIds[0]);
    if(!A||!B||A.id===B.id){$('comparison').innerHTML='<p class="detail-note">Shift＋点击一列设为 A，再点击另一列选择 B。</p>';return;}
    const sets=ReviewData.sets(A,B),total=sets.a.length+sets.both.length+sets.b.length;
    const v=r=>[...new Set(r.items.map(i=>i.version).filter(Boolean))];
    const av=v(A),bv=v(B),versionsKnown=av.length&&bv.length;
    let html='<div class="compare-caption"><span>A '+runLabel(A)+' → B '+runLabel(B)+'</span><button class="quiet" id="unpin-a">取消 A</button></div><div class="set-strip">';
    [[sets.a,'#a6b5d0','仅 A 有身份记录'],[sets.both,'#6e82ac','两次都有身份记录'],[sets.b,'#a6bdb6','仅 B 有身份记录']].forEach(([set,color,label])=>{if(set.length)html+='<span style="flex:'+set.length+';background:'+color+'" title="'+label+' '+set.length+'">'+set.length+'</span>';});
    html+='</div><div class="compare-labels"><span>仅 A</span><span>共同身份</span><span>仅 B</span></div><div class="condition-row"><span>源码标识</span><span>'+(av.length?av.length+' 个':'未知')+'</span><span class="'+(versionsKnown&&av.join()!==bv.join()?'condition-changed':'')+'">'+(bv.length?bv.length+' 个':'未知')+'</span></div><div class="condition-row"><span>环境／参数</span><span>未保存</span><span>未保存</span></div><p class="detail-note">集合按测试名去重；共同身份不证明同版本或同条件。'+total+' 个不同身份。</p>';
    $('comparison').innerHTML=html;$('unpin-a').onclick=()=>{view.pin=null;render();};
  }
  function renderTimeline(){
    const w=Math.max(600,$('timeline').clientWidth-18),left=68,right=16,span=w-left-right,a=view.range[0],b=view.range[1],scale=t=>left+(t-a)/(b-a||1)*span;
    const runs=data.runs.filter(r=>ReviewData.inRange(r,view)),claims=data.claims.filter(c=>ReviewData.inRange(c,view));
    let svg='<svg viewBox="0 0 '+w+' 78" role="group" aria-label="共享时间轴上的声明、执行和修改"><defs><clipPath id="timeline-clip"><rect x="'+left+'" y="0" width="'+span+'" height="78"/></clipPath></defs>';
    [14,36,58].forEach((y,i)=>{svg+='<text x="4" y="'+(y+3)+'" class="chart-subtitle">'+['AI 声明','测试运行','文件修改'][i]+'</text><path d="M'+left+' '+y+'H'+(w-right)+'" stroke="#eef0f5"/>';});
    for(let i=0;i<6;i++){const x=left+i/5*span;svg+='<path d="M'+x+' 6V65" stroke="#f3f4f7"/><text x="'+x+'" y="76" text-anchor="'+(i===0?'start':i===5?'end':'middle')+'" class="chart-subtitle">'+time(a+(b-a)*i/5)+'</text>';}
    svg+='<g clip-path="url(#timeline-clip)">';
    const claim=data.claims.find(c=>c.id===view.claim);
    if(claim)for(const id of claim.candidates){const r=data.runById.get(id);if(!r)continue;const x=scale(r.time),xx=scale(claim.time);svg+='<path d="M'+x+' 36Q'+((x+xx)/2)+' 18 '+xx+' 14" fill="none" stroke="#889bc3" stroke-dasharray="3 2" stroke-width="1"/>';}
    for(const r of runs){const x=scale(r.time),active=view.runIds.includes(r.id);svg+='<circle class="time-event" role="button" tabindex="0" data-time-run="'+E(r.id)+'" cx="'+x+'" cy="36" r="'+(active?4:2.3)+'" fill="'+(active?'#526ca6':'#a9b5cb')+'"><title>'+runLabel(r)+' · '+time(r.time)+' · '+r.items.length+' 个身份条目</title></circle>';}
    for(const c of claims){const x=scale(c.time),active=view.claim===c.id;svg+='<path class="time-event" role="button" tabindex="0" data-time-claim="'+c.id+'" d="M'+x+' 9l4 5-4 5-4-5Z" fill="'+(active?'#7c82b8':'white')+'" stroke="'+(c.candidates.length?'#8f94bc':'#bdad94')+'"><title>C'+(c.id+1)+' · '+c.reported_passes+' passed · '+c.candidates.length+' 个运行候选\n'+time(c.time)+'</title></path>';}
    for(const e of M.events){const t=Date.parse(e.time);if(t<a||t>b||!e.files.length||(view.session!=='all'&&e.session!==view.session))continue;const test=e.files.some(f=>TestEvidence.testPath(f.path)),x=scale(t);svg+='<path d="M'+x+' '+(test?51:58)+'v6" stroke="'+(test?'#b4a5c5':'#a9bdbb')+'" stroke-width="1" opacity=".7"><title>'+time(t)+' · '+e.files.map(f=>f.path).join(', ')+'</title></path>';}
    const cursor=scale(view.clock);svg+='<path d="M'+cursor+' 4V65" stroke="#6578a6" stroke-width="1" opacity=".5"/></g></svg>';
    $('timeline').innerHTML=svg;
    $('timeline').querySelectorAll('[data-time-run]').forEach(el=>el.onclick=()=>selectRun(el.dataset.timeRun));
    $('timeline').querySelectorAll('[data-time-claim]').forEach(el=>el.onclick=()=>selectClaim(el.dataset.timeClaim));
    $('timeline-range').textContent=runs.length+' 次运行 · '+claims.length+' 条声明';
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
      for(const id of claim.candidates){const r=data.runById.get(id);html+='<button class="candidate-button" data-candidate="'+E(id)+'" aria-pressed="'+view.runIds.includes(id)+'">'+runLabel(r)+' · '+time(r.time)+'<br><span class="detail-note">'+r.items.length+' 个身份条目 · 未定位 '+r.missing+'</span></button>';}
      html+='</div><div class="inspector-section"><h3>原始定位</h3><p class="detail-path">'+E(claim.source?.source_id??'未提供')+'</p><p class="detail-note">第 '+E(claim.source?.line??'?')+' 行 · '+E(claim.turn_id)+'</p></div>';
      if(run)html+=runSummary(run);
    }else if(run){html+=runSummary(run)+instanceList(agg.filtered);}
    else if(state.edge?.length){
      const links=mapSnapshot?.activeRefs??TestEvidence.refs(M,info(),eventIndex,view.session);html+='<h3>引用依据</h3>';
      for(const e of links.filter(e=>state.edge.includes(e.id)))html+='<div class="inspector-section"><p class="detail-path">'+E(e.source)+' → '+E(e.target)+'</p>'+e.evidence.map(ev=>'<pre>'+E(ev.excerpt)+'</pre>').join('')+'</div>';
    }else{
      html+='<div class="selection-empty">选择声明、运行或文件<div class="mini-rule"></div><span>◇ 时间轴：声明与执行关系<br>▤ 构成矩阵：深度与身份依据<br>▦ 演变矩阵：测试前后变化</span></div><div class="inspector-section"><h3>当前数据范围</h3><p class="detail-note">'+agg.scope.length+' 次运行 · '+data.claims.filter(c=>ReviewData.inRange(c,view)).length+' 条声明<br>全部导出记录保留；空白表示未保存执行证据。</p></div>';
    }
    html+='</div>';$('detail').innerHTML=html;
    $('detail').querySelectorAll('[data-candidate]').forEach(el=>el.onclick=()=>selectRun(el.dataset.candidate,true));
    $('detail').querySelectorAll('[data-open-instance]').forEach(el=>el.onclick=()=>{view.item=el.dataset.openInstance;render();});
    $('detail').querySelectorAll('[data-pin-run]').forEach(el=>el.onclick=()=>{view.pin=el.dataset.pinRun;comparisonOpen=true;render();});
    bindFiles($('detail'));
  }
  function runSummary(r){
    let html='<div class="detail-path">'+runLabel(r)+' · '+time(r.time)+'</div><div class="detail-meta">'+E(r.id)+'</div><div class="inspector-numbers"><div><strong>'+r.items.length+'</strong><span>身份条目（含推断）</span></div><div><strong>'+r.missing+'</strong><span>摘要通过身份未定</span></div></div><button class="quiet" data-pin-run="'+E(r.id)+'">设为对照 A</button>';
    if(r.check){html+='<div class="inspector-section"><h3>'+E(r.check.label)+' · '+E(resultNames[r.check.status]??r.check.status)+'</h3><pre>'+E(r.check.proof)+'</pre></div>';}
    const e=M.byId.get(r.event);if(e)html+='<details><summary>原始输入 / 输出</summary><pre>'+E(VerificationModel.text(e.input))+'\n\n'+E(VerificationModel.text(e.output))+'</pre></details>';
    return html;
  }
  function instanceList(rows){
    const selected=view.item?rows.filter(x=>x.item.identity===view.item):rows;
    let html='<div class="inspector-section"><h3>实例与来源 · '+selected.length+'</h3><div class="evidence-list">';
    for(const {run:r,item:i} of selected.slice(0,60))html+='<button data-open-instance="'+E(i.identity)+'">'+E(i.identity)+'<small>'+runLabel(r)+' · '+E(tierNames[i.tier]??i.tier)+' · '+E(resultNames[i.result]??i.result)+'</small></button>';
    html+='</div>'+(selected.length>60?'<p class="detail-note">显示前 60 条；在演变矩阵中可继续定位全部身份。</p>':'');
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
  $('review-reset').onclick=()=>{stop();Object.assign(view,{session:'all',range:[data.min,data.max],runIds:[],claim:null,level:null,basis:null,item:null,pin:null,clock:data.max});state.file=null;state.edge=null;state.mapBox=null;expanded.clear();matrixScroll=[0,0];$('review-session').value='all';render();};
  $('clear-selection').onclick=()=>{view.runIds=[];view.claim=null;view.item=null;view.clock=view.range[1];state.file=null;state.edge=null;render();};
  $('clear-filter').onclick=()=>{view.level=null;view.basis=null;view.item=null;render();};
  $('clear-file').onclick=()=>{state.file=null;state.edge=null;view.item=null;render();};
  $('map-fit').onclick=()=>{state.mapBox=null;render();};
  ['show-refs','show-types'].forEach(id=>$(id).onchange=render);
  document.querySelectorAll('[data-map-mode]').forEach(el=>el.onclick=()=>{state.mapMode=el.dataset.mapMode;state.mapBox=null;render();});
  $('map-zoom').onclick=()=>{$('map-zoom').closest('.panel').classList.toggle('is-zoomed');render();};
  $('inspector-toggle').onclick=()=>{document.body.classList.toggle('inspector-collapsed');renderMatrix();};
  $('compare-toggle').onclick=()=>{comparisonOpen=!comparisonOpen;renderComparison(ReviewData.scoped(data,view));};
  $('time-all').onclick=()=>setRange(data.min,data.max);
  const jump=delta=>{const claims=data.claims.filter(c=>ReviewData.inRange(c,view));const current=claims.findIndex(c=>c.id===view.claim);const i=current<0?(delta>0?0:claims.length-1):current+delta;if(claims[i])selectClaim(claims[i].id);};
  $('time-previous').onclick=()=>jump(-1);$('time-next').onclick=()=>jump(1);
  $('map-play').onclick=()=>{
    if(playing){stop();return;}const runs=ReviewData.scoped(data,view);if(!runs.length)return;
    const selected=runs.findIndex(r=>r.id===view.runIds[0]);let i=selected<0||selected>=runs.length-1?0:selected+1;const generation=++playbackGeneration;
    const tick=()=>{if(generation!==playbackGeneration)return;const r=runs[i++];view.runIds=[r.id];view.claim=null;view.clock=r.time;view.item=null;render();$('map-play').textContent='Ⅱ';if(i<runs.length)playing=setTimeout(tick,800);else stop();};tick();
  };
  $('review-help').onclick=()=>$('review-guide').showModal();$('close-help').onclick=()=>$('review-guide').close();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){stop();document.querySelector('.map-panel.is-zoomed')?.classList.remove('is-zoomed');hideTip();}const target=e.target.closest?.('[role=button]');if(target&&['Enter',' '].includes(e.key)){e.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{renderTimeline();renderMatrix();},120);});
  root.researchWorkspace={model:M,data,view,state,render,selectRun,selectClaim,selectFile,setRange,ctx,aggregate:active};
  render();
})(globalThis);
