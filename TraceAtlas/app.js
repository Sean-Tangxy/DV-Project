(function () {
  'use strict';
  const datasetKey=new URLSearchParams(globalThis.location?.search??'').get('dataset')==='sts2'?'sts2':'sszx';
  const V = VerificationModel, M = V.build(datasetKey==='sts2'?STS2_DATA:SSZX_DATA), $ = id => document.getElementById(id);
  TestEvidence.attach(M);
  M.references=ReferenceAtlas.extract(M);
  M.atlas=ReferenceAtlas.layout(M,M.references);
  // The map timeline uses recorded event order as the finest reproducible unit.
  // Timestamps are shown as context, but may be cache anchors rather than execution bounds.
  const chronological=[...M.events].sort((a,b)=>{
    const ta=Date.parse(a.time),tb=Date.parse(b.time);
    return (Number.isFinite(ta)?ta:Infinity)-(Number.isFinite(tb)?tb:Infinity)||a.index-b.index;
  });
  const eventIndex=new Map(chronological.map((e,i)=>[e.id,i]));
  // Include parsed test events even when the command did not expose a file
  // path. They are meaningful milestones for the map timeline.
  const mapEvents=chronological.filter(e=>e.files.length||e.checks.length||e.checks.some(r=>r.files.length)||e.type==='fileChange');
  // Include the final record so the cumulative overview reaches later Git
  // snapshot evidence even when no command/edit occurs after that snapshot.
  if(chronological.length&&mapEvents.at(-1)!==chronological.at(-1))mapEvents.push(chronological.at(-1));
  const mapSteps={all:chronological,activity:mapEvents,session:[...M.sessions.values()].sort((a,b)=>{
    const aa=eventIndex.get(a.events[0]?.id)??0,bb=eventIndex.get(b.events[0]?.id)??0;return aa-bb;
  }).map(s=>s.events.at(-1)).filter(Boolean)};
  const C = {pass:'#0d8466',fail:'#bf3c49',blocked:'#b5650b',pending:'#3573bb',mixed:'#996014',unknown:'#788294',skipped:'#737283'};
  const T = {userMessage:'用户',agentMessage:'回复',commandExecution:'命令',mcpToolCall:'工具',fileChange:'文件编辑',imageView:'图片',subAgentActivity:'子 Agent',collabAgentToolCall:'协作',contextCompaction:'压缩',sleep:'等待'};
  const state = {session:'all',kind:'all',axis:'order',selected:null,run:null,pin:null,file:null,page:0,query:'',edge:null,mapBox:null,mapStep:'activity',mapCursor:mapSteps.activity.length-1,mapPlaying:false,mapMode:'structure'};
  const E = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cut = (s,n=50) => String(s??'').length > n ? String(s).slice(0,n-1)+'…' : String(s??'');
  const status = s => '<span class="status '+E(s)+'">'+E(V.states[s]??s)+'</span>';
  const ref = e => M.sessions.get(e.session).code+' #'+e.ordinal;
  const label = s => {
    const name = s.relation?.agent?.replace(/^\/root\//,'').replaceAll('_',' ');
    if (name) return name;
    const first = s.events.find(e=>e.type==='userMessage');
    const raw = M.data.raw[M.data.links[first?.index]]?.item?.content;
    const title=s.title&&s.title!==s.id?s.title:null;
    const t = title ?? (Array.isArray(raw) ? raw.map(x=>x.text??'').join('\n') : typeof raw === 'string' ? raw : first?.summary ?? s.title);
    return cut(t.split(/## My request:/i).pop()?.replace(/[#\r\n]/g,' ').trim()||s.role,62);
  };
  const shownSessions = () => [...M.sessions.values()].filter(s=>state.session==='all'||s.id===state.session);
  const eventVisible = e => (state.session==='all'||state.session===e.session) &&
    (state.kind==='all'||e.checks.some(r=>r.kind===state.kind)) &&
    (!state.file||M.files.get(state.file)?.events.has(e.id));
  const visibleChecks = () => M.checks.filter(r=>eventVisible(r.event)&&(state.kind==='all'||r.kind===state.kind));
  const activeRun = () => M.runById.get(state.run);
  const fileOf = p => M.files.get(p.toLowerCase());
  const mapSequence = () => mapSteps[state.mapStep]??mapSteps.activity;
  const mapCutoff = () => {
    const seq=mapSequence();
    if (!seq.length) return chronological.length-1;
    const event=seq[Math.max(0,Math.min(state.mapCursor,seq.length-1))];
    return eventIndex.get(event.id)??chronological.length-1;
  };
  const mapDate = index => {
    const e=chronological[Math.max(0,Math.min(index,chronological.length-1))];
    return e?.time&&Number.isFinite(Date.parse(e.time)) ? new Date(e.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '记录顺序';
  };
  const mapCutoffInfo = () => {
    const seq=mapSequence(), cursor=Math.max(0,Math.min(state.mapCursor,Math.max(0,seq.length-1))), index=mapCutoff();
    return {seq,cursor,index,event:chronological[index],label:seq.length?`${cursor+1} / ${seq.length}`:'无地图事件'};
  };
  function renderSummary() {
    const es = M.events.filter(e=>state.session==='all'||state.session===e.session), checks = visibleChecks();
    const cards = [
      [es.length, '记录'],
      [shownSessions().length, '会话'],
      [checks.length, '检查'],
      [es.filter(e=>e.type==='fileChange').length, '编辑'],
      [M.files.size, '文件']
    ];
    $('summary').innerHTML=cards.map(([n,t])=>'<div class="metric"><strong>'+n+'</strong><span>'+E(t)+'</span></div>').join('');
  }
  function activate(eid,rid=null) {
    stopMapPlayback();
    state.selected=eid;state.run=rid;state.page=0;state.edge=null;
    const index=eventIndex.get(eid);
    if(Number.isInteger(index)){
      const seq=mapSequence(), cursor=seq.findIndex(e=>(eventIndex.get(e.id)??-1)>=index);
      if(cursor>=0)state.mapCursor=cursor;
    }
    render();
  }
  function selectFile(key) {
    stopMapPlayback();
    state.file=key;state.page=0;state.selected=null;state.edge=null;
    render();
  }
  function renderTimeline() {
    const sessions=shownSessions(), expanded=state.session!=='all';
    const width=Math.max(360,$('plot').clientWidth||440),left=122,right=12,span=width-left-right,margin=23;
    const rows=[];
    for(const s of sessions){
      if(expanded){
        rows.push({s,lane:'other',title:'其他记录'});
        rows.push({s,lane:'edit',title:'文件编辑'});
        for(const kind of Object.keys(V.kinds))if(s.events.some(e=>e.checks.some(r=>r.kind===kind))) rows.push({s,lane:kind,title:V.kinds[kind]});
      }else rows.push({s,lane:'all'});
    }
    const available=$('plot').clientHeight||265;
    const unit=Math.max(expanded?24:12,Math.min(expanded?43:25,(available-margin-20)/rows.length));
    const height=margin+rows.length*unit+20;
    let svg='<svg viewBox="0 0 '+width+' '+height+'" aria-label="全量会话的检查与修改演变" role="group"><defs><clipPath id="row-label-clip"><rect x="9" y="0" width="103" height="'+height+'"/></clipPath></defs>';
    const timestamps=M.events.map(e=>Date.parse(e.time)).filter(Number.isFinite), tMin=Math.min(...timestamps), tMax=Math.max(...timestamps);
    function x(e,s) {
      if(state.axis==='time') {
        const val=Date.parse(e.time);
        return Number.isFinite(val) ? left+(val-tMin)/(tMax-tMin||1)*span : left;
      }
      return left+(s.events.length<2?0.5:e.seq/(s.events.length-1))*span;
    }
    for(let n=0;n<=5;n++){
      const xx=left+span*n/5;
      svg+='<path d="M '+xx+' 23 V '+(height-18)+'" stroke="#e4e8f1"/>';
      const tick=state.axis==='time'?new Date(tMin+(tMax-tMin)*n/5).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):n*20+'%';
      svg+='<text class="axis" x="'+xx+'" y="19" text-anchor="'+(n===0?'start':n===5?'end':'middle')+'">'+E(tick)+'</text>';
    }
    const selectedEvent=M.byId.get(state.selected);
    const pin=M.runById.get(state.pin);
    rows.forEach(({s,lane,title},i)=>{
      const y=margin+i*unit+unit/2;
      svg+='<rect x="0" y="'+(y-unit/2)+'" width="'+width+'" height="'+unit+'" fill="'+(i%2?'#f7f8fc':'#fcfcfe')+'"/>';
      const rowTitle=expanded?title:s.code+' · '+cut(label(s),13);
      svg+='<g class="click" role="button" tabindex="0" data-session="'+E(expanded?'all':s.id)+'"><title>'+E(s.code+' · '+label(s)+' · '+s.events.length+' 条记录；'+(expanded?'返回全项目':'点击展开'))+'</title><text class="row-name" clip-path="url(#row-label-clip)" x="14" y="'+(y+4)+'">'+E(rowTitle)+'</text></g>';
      svg+='<path d="M '+left+' '+y+' H '+(width-right)+'" stroke="#dfe4ee" stroke-width="1"/>';
      let groupLast=new Map();
      if(lane!=='other'&&lane!=='edit'){
        for(const e of s.events)for(const r of e.checks){
          if(lane!=='all'&&r.kind!==lane)continue;
          const prev=groupLast.get(r.group);
          if(prev)svg+='<path d="M '+x(prev.event,s)+' '+(y-8)+' H '+x(e,s)+'" stroke="#b5bed4" stroke-width="1.2" stroke-dasharray="2 3"/>';
          groupLast.set(r.group,r);
        }
      }
      for(const e of s.events){
        const checks=e.checks.filter(r=>lane==='all'||r.kind===lane);
        const isEdit=e.type==='fileChange';
        const ordinary=!isEdit&&!e.checks.length;
        if(expanded&&!((lane==='other'&&ordinary)||(lane==='edit'&&isEdit)||checks.length))continue;
        const xx=x(e,s), dim=!eventVisible(e), selected=e.id===state.selected, pinned=e.id===pin?.event.id;
        const tip=ref(e)+' · '+(T[e.type]??e.type)+'\n'+cut(e.summary,210);
        if(checks.length){
          checks.forEach((r,j)=>{
            const yy=y+(checks.length>1?(j-(checks.length-1)/2)*Math.min(10,unit*.52):0), rr=expanded?6:Math.min(5,unit*.28);
            const visible=(state.kind==='all'||state.kind===r.kind)&&!dim, circle=r.status==='unknown'?'white':C[r.status];
            svg+='<g class="click" tabindex="0" role="button" data-event="'+e.id+'" data-run="'+E(r.id)+'" opacity="'+(visible?1:.16)+'"><title>'+E(ref(e)+' · '+r.label+' · '+V.states[r.status]+'\n'+cut(r.proof,280))+'</title>';
            if(selected&&state.run===r.id||pinned)svg+='<circle cx="'+xx+'" cy="'+yy+'" r="'+(rr+4)+'" fill="none" stroke="'+(pinned?'#327da5':'#424aad')+'" stroke-width="2"/>';
            svg+='<circle class="mark" cx="'+xx+'" cy="'+yy+'" r="'+rr+'" fill="'+circle+'" stroke="'+C[r.status]+'" stroke-width="1.7"/>';
            if(r.status==='fail')svg+='<path d="M '+(xx-2.3)+' '+(yy-2.3)+' l 4.6 4.6 M '+(xx-2.3)+' '+(yy+2.3)+' l 4.6 -4.6" stroke="white" stroke-width="1.2"/>';
            if(r.status==='blocked')svg+='<text x="'+xx+'" y="'+(yy+3.5)+'" text-anchor="middle" style="fill:white;font-size:10px">!</text>';
            if(r.status==='pass')svg+='<path d="M '+(xx-2.6)+' '+yy+' l 1.8 2 3.7 -4" fill="none" stroke="white" stroke-width="1.1"/>';
            svg+='</g>';
          });
        }else {
          svg+='<g class="click" tabindex="0" role="button" data-event="'+e.id+'" opacity="'+(dim?.13:1)+'"><title>'+E(tip)+'</title>';
          if(selected)svg+='<circle cx="'+xx+'" cy="'+y+'" r="8" fill="none" stroke="#454bb2" stroke-width="2"/>';
          svg+=isEdit?'<rect class="mark" x="'+(xx-1.6)+'" y="'+(y-Math.min(6,unit*.34))+'" width="3.2" height="'+Math.min(12,unit*.68)+'" rx="1" fill="#7955c4"/>':
            '<circle class="mark" cx="'+xx+'" cy="'+y+'" r="'+(expanded?3:2)+'" fill="'+(e.type==='agentMessage'?'#8490a8':'#aeb8ca')+'"/>';
          svg+='</g>';
        }
      }
    });
    svg+='</svg>';
    $('plot').innerHTML=svg;
    $('timeline-caption').textContent='';
    $('timeline-legend').innerHTML=['pass','fail','blocked','unknown'].map(s=>'<span class="key" title="'+E(V.states[s])+'"><i class="legend-mark '+s+'">'+({pass:'✓',fail:'×',blocked:'!'}[s]??'')+'</i>'+E(V.states[s])+'</span>').join('')+
      '<span class="key"><i class="swatch edit"></i>编辑</span>';
    $('plot').querySelectorAll('[data-session]').forEach(el=>el.addEventListener('click',()=>{state.session=el.dataset.session;state.page=0;render();}));
    $('plot').querySelectorAll('[data-event]').forEach(el=>el.addEventListener('click',()=>activate(el.dataset.event,el.dataset.run??null)));
  }
  function fingerprint(runs) {
    const dims=[['产品版本',r=>r.version],['测试版本',r=>r.testVersion],['可见参数',r=>r.options],['已知环境',r=>r.env],['检查结果',r=>r.status]];
    const width=Math.max(580,Math.min(runs.length,15)*54+110),left=95,cw=(width-left-10)/runs.length,h=192;
    let svg='<div class="matrix-scroll"><svg viewBox="0 0 '+width+' '+h+'" style="min-width:'+width+'px;width:100%" aria-label="各次运行的条件指纹"><defs><pattern id="fingerprint-unknown" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="#f4f6fa"/><path d="M0 6L6 0" stroke="#d2d9e7" stroke-width="1"/></pattern></defs>';
    const colors=['#8791d6','#d2a65b','#55a797','#b77db3','#7f9eb4','#c37f75'];
    dims.forEach(([name,get],row)=>{
      const yy=34+row*28,values=[...new Set(runs.map(get).filter(Boolean))];
      svg+='<text x="0" y="'+(yy+16)+'">'+name+'</text>';
      runs.forEach((r,i)=>{
        const val=get(r),xx=left+i*cw,w=Math.max(8,Math.min(cw-7,54));
        const fill=row===4?C[r.status]:val?colors[values.indexOf(val)%colors.length]:'url(#fingerprint-unknown)';
        svg+='<g class="click" tabindex="0" role="button" data-open-run="'+E(r.id)+'"><title>'+E(ref(r.event)+' · '+name+'\n'+(row===4?V.states[r.status]:val||'未知'))+'</title>';
        svg+='<rect x="'+xx+'" y="'+yy+'" width="'+w+'" height="21" rx="3" fill="'+fill+'"/>';
        if(r.id===state.run)svg+='<rect x="'+(xx-2)+'" y="'+(yy-2)+'" width="'+(w+4)+'" height="25" rx="4" fill="none" stroke="#242e4e" stroke-width="1.3"/>';
        svg+='</g>';
        if(row===0)svg+='<text class="axis" x="'+xx+'" y="22">'+E('#'+r.event.ordinal)+'</text>';
      });
    });
    svg+='</svg></div>';
    return svg;
  }
  function viewContext() {return {M,state,activate,render,visibleChecks,fingerprint,selectFile,stopMapPlayback,mapCutoff,mapCutoffInfo,mapDate,chronological,eventIndex};}
  function renderCompare() {AtlasViews.heatmap(viewContext());}
  function syncMapTimeline() {
    const range=$('map-time'),step=$('map-step'),labelEl=$('map-time-label'),hint=$('map-time-hint'),play=$('map-play'),ticks=$('map-time-ticks');
    if(!range||!step)return;
    const seq=mapSequence(), max=Math.max(0,seq.length-1), info=mapCutoffInfo();
    step.value=state.mapStep;range.max=String(max);range.value=String(Math.min(state.mapCursor,max));
    play.disabled=seq.length<2;
    if(ticks){
      const hasTest=e=>e.checks.length>0 || state.mapStep==='session' && (M.sessions.get(e.session)?.events.some(x=>x.checks.length)??false);
      const marks=seq.map((e,i)=>({e,i})).filter(x=>hasTest(x.e));
      ticks.innerHTML=marks.map(({e,i})=>'<span class="map-time-tick" style="left:'+((max?i/max*100:0).toFixed(3))+'%" title="'+E(ref(e)+' · '+e.checks.length+' 项检查')+'" aria-label="'+E(ref(e)+' · 测试事件')+'"></span>').join('');
      ticks.setAttribute('aria-label','时间轴上的测试事件节点，共 '+marks.length+' 个');
    }
    labelEl.textContent=info.label+(info.event?' · '+mapDate(info.index):'');
    hint.textContent=info.event?'拖动查看累计出现过程；蓝色刻度表示发生了可识别测试的记录；当前点对应 '+ref(info.event):'没有可用的地图事件';
    play.textContent=state.mapPlaying?'暂停':'播放';
    play.title=state.mapPlaying?'暂停地图变化':'播放地图变化';
  }
  function renderMap() {syncMapTimeline();AtlasViews.renderMap(viewContext());}
  let mapPlaybackTimer=null;
  function stopMapPlayback() {
    state.mapPlaying=false;
    window.clearTimeout(mapPlaybackTimer);
    mapPlaybackTimer=null;
  }
  function renderMapTime() {
    // Keep a selected file/reference as the detail focus; otherwise follow
    // the event at the current time instead of leaving stale evidence open.
    const event=mapCutoffInfo().event;
    state.selected=state.file||state.edge?.length?null:event?.id??null;
    state.run=event?.checks[0]?.id??null;
    renderTimeline();renderCompare();renderMap();renderRecords();renderDetail();
  }
  function playMapTick() {
    mapPlaybackTimer=null;
    if(!state.mapPlaying)return;
    const last=mapSequence().length-1;
    if(state.mapCursor<last)state.mapCursor+=1;
    if(state.mapCursor>=last)stopMapPlayback();
    renderMapTime();
    if(state.mapPlaying)mapPlaybackTimer=window.setTimeout(playMapTick,450);
  }
  function asRoles(f,ids) {
    return [...new Set(ids.flatMap(id=>[...f.events.get(id)]))].map(x=>V.fileRoles[x]).join('、')||'无范围内关联';
  }
  function renderRecords() {
    const q=state.query.trim().toLowerCase();
    const rows=M.events.filter(e=>eventVisible(e)&&(!q||[ref(e),e.type,e.tool,e.summary,V.text(e.input),V.text(e.output),...e.editPaths].join('\n').toLowerCase().includes(q)));
    const pageSize=24,max=Math.max(0,Math.ceil(rows.length/pageSize)-1);state.page=Math.min(state.page,max);
    $('record-count').textContent=' · 当前筛选 '+rows.length+' / 全包 '+M.events.length;
    $('page').textContent=(state.page+1)+' / '+(max+1);
    $('prev-page').disabled=state.page===0;$('next-page').disabled=state.page===max;
    $('event-list').innerHTML='<div class="records-list">'+rows.slice(state.page*pageSize,(state.page+1)*pageSize).map(e=>'<button class="record '+(e.id===state.selected?'selected':'')+'" data-event="'+e.id+'"><span class="rec-key">'+E(ref(e))+'</span><span>'+E(T[e.type]??e.type)+'</span><span>'+E(e.checks.length?e.checks.map(r=>r.label+' · '+V.states[r.status]).join(' / '):e.summary)+'</span></button>').join('')+'</div>';
    $('event-list').querySelectorAll('[data-event]').forEach(el=>el.onclick=()=>{const e=M.byId.get(el.dataset.event);activate(e.id,e.checks[0]?.id??null);});
  }
  function sourceDetails(e) {
    const raw=M.data.raw[M.data.links[e.index]];
    return '<details><summary>原始输入 / 命令</summary><pre>'+E(V.text(e.input)||'该记录无工具输入。')+'</pre></details>'+
      '<details><summary>原始输出'+(e.truncated?' · 源标记截断':'')+'</summary><pre>'+E(V.text(e.output)||'未保存输出；不能根据空内容判定检查通过。')+'</pre></details>'+
      (e.files.length?'<details><summary>原始文件差异 · '+e.files.length+' 项</summary><pre>'+E(JSON.stringify(e.files,null,2))+'</pre></details>':'')+
      '<details class="raw-detail"><summary>原始公开历史项 / 定位信息</summary><div class="raw-content" data-raw="'+e.index+'"></div></details>';
  }
  function renderDetail() {
    const e=M.byId.get(state.selected),run=activeRun(),file=M.files.get(state.file);
    const cutoff=mapCutoff(), before=id=>(eventIndex.get(id)??Infinity)<=cutoff;
    if(state.edge?.length){
      const refs=TestEvidence.refs(M,mapCutoffInfo(),eventIndex,state.session).filter(r=>state.edge.includes(r.id));
      $('detail-caption').textContent='引用依据 · '+mapDate(cutoff);
      $('detail').innerHTML='<div class="detail reference-detail"><h3>片段中的引用</h3><p class="section-note">源码直接引用；不等于运行覆盖。Git 快照关系仅在快照时间之后显示。</p>'+refs.map(r=>'<div class="reference-entry"><strong>'+E(r.source)+'</strong><span class="ref-arrow"> → </span><strong>'+E(r.target)+'</strong>'+r.evidence.map(ev=>'<p>'+(ev.event?'<button data-detail-event="'+ev.event+'">'+E(ref(M.byId.get(ev.event)))+'</button>':'<span>Git '+E(ev.revision?.slice(0,10))+' · 第 '+E(ev.line??'?')+' 行</span>')+' '+E(ev.symbol)+'</p><pre>'+E(ev.excerpt)+(ev.calls?.length?'\n'+E(ev.calls.map(c=>'L'+c.line+' '+c.excerpt).join('\n')):'')+'</pre>').join('')+'</div>').join('')+'</div>';
    }else if(file&&!e){
      const metrics=TestEvidence.metrics(M,mapCutoffInfo(),eventIndex,state.session),s=metrics.stats.get(state.file);
      const related=s?[...(file.side==='test'?s.targets:s.sources)]:[];
      const depth=s?.depth;
      const metricsHtml='<div class="file-metrics"><h3>'+E(file.side==='test'?'测试文件':'项目文件')+'</h3>'+(s?'<div class="detail-grid"><div class="fact"><span>'+(file.side==='test'?'直接关联项目文件':'关联测试文件（去重）')+'</span>'+s.count+'</div><div class="fact"><span>最高可识别源码层级</span>'+(s.max==null?'未知':'D'+s.max)+'</div></div>':'<p>当前时间尚无此文件的可见证据。</p>')+(file.side==='product'&&s?'<p>深度分布：'+s.histogram.map((n,i)=>n?(i===5?'未知':'D'+i)+' × '+n:'').filter(Boolean).join(' · ')+'</p><p class="section-note">层级和 '+s.sum+' 仅作辅助统计；不表示测试质量、断言覆盖或通过数量。</p>':'')+(file.side==='test'&&depth?'<p>'+E(depth.reason)+'</p><pre>'+E(depth.hits.join('\n')||'缺少可识别源码')+'</pre><p class="section-note">'+E(depth.source??'无来源')+(depth.revision?' · Git '+E(depth.revision.slice(0,10)):'')+'</p>':'')+'<div class="file-list">'+related.map(key=>'<button data-detail-file="'+E(key)+'">'+E(M.files.get(key).path)+'</button>').join('')+'</div></div>';
      const linked=[...file.events.keys()].map(id=>M.byId.get(id)).filter(x=>before(x.id)&&(state.session==='all'||x.session===state.session));
      $('detail-caption').textContent=file.path+' · '+(M.fileClasses[file.classification]??'类型未判定');
      $('detail').innerHTML='<div class="detail">'+metricsHtml+'<p>'+E(asRoles(file,linked.map(e=>e.id)))+' · '+linked.length+' 条关联记录</p><div class="file-list">'+linked.map(x=>'<button data-detail-event="'+x.id+'">'+E(ref(x))+' · '+E(cut(x.checks.map(r=>r.label).join(' / ')||x.summary,100))+'</button> ').join('')+'</div></div>';
    }else if(e){
      const s=M.sessions.get(e.session);
      $('detail-caption').textContent=ref(e)+' · '+(T[e.type]??e.type)+' · '+s.role;
      const raw=M.data.raw[M.data.links[e.index]];
      let body='<div class="detail">';
      if(run){
        body+='<div class="controls"><h3>'+E(run.label)+'</h3>'+status(run.status)+'<span class="muted">规则 '+E(run.rule)+'</span></div>';
        body+='<p class="section-note">'+E(run.scope)+'</p><pre>'+E(run.proof)+'</pre>';
      }else{
        let message=raw?.item?.content;
        if(Array.isArray(message))message=message.map(x=>x.text??'').filter(Boolean).join('\n');
        if(typeof message!=='string')message=e.summary;
        body+='<pre>'+E(message)+'</pre>';
      }
      body+='<div class="detail-grid"><div class="fact"><span>记录时间 / 来源</span>'+E(new Date(e.time).toLocaleString('zh-CN',{hour12:false}))+'<br><small>历史缓存锚点；不保证精确执行起止</small></div><div class="fact"><span>外层执行 / 退出码</span>'+E(e.status)+' / '+E(e.exit_code??'未记录')+'</div><div class="fact"><span>产品版本 / 测试版本</span>均未保存完整快照</div></div>';
      if(e.checks.length>1)body+='<div class="controls">同一调用内的检查：'+e.checks.map(r=>'<button data-detail-run="'+E(r.id)+'">'+E(r.label)+' · '+E(V.states[r.status])+'</button>').join('')+'</div>';
      if(run?.files.length)body+='<p class="section-note">检查关联文件（有证据的部分）</p><div class="controls">'+run.files.map(f=>'<button data-detail-file="'+E(f.path.toLowerCase())+'">'+E(f.path)+' · '+E(V.fileRoles[f.role])+'</button>').join('')+'</div>';
      if(file){
        const roles=file.events.get(e.id);
        body+='<p class="section-note">已选文件：'+E(file.path)+' · 本条记录'+(roles?'关联为 '+E([...roles].map(r=>V.fileRoles[r]).join('、')):'未建立直接关联')+'</p>';
      }
      body+=sourceDetails(e)+'</div>';
      $('detail').innerHTML=body;
      $('detail').querySelectorAll('.raw-detail').forEach(el=>el.addEventListener('toggle',()=>{
        if(el.open&&!el.querySelector('pre')){
          const pre=document.createElement('pre');pre.textContent=JSON.stringify(raw,null,2);
          el.querySelector('.raw-content').append(pre);
        }
      }));
    }else{
      $('detail-caption').textContent='选择记录、运行或文件后查看来源';
      $('detail').innerHTML='<div class="empty"><h3>查看执行依据</h3><p>选择矩阵单元格、文件或引用线。</p></div>';
    }
    $('detail').querySelectorAll('[data-detail-event]').forEach(el=>el.onclick=()=>{const e=M.byId.get(el.dataset.detailEvent);activate(e.id,e.checks[0]?.id??null);});
    $('detail').querySelectorAll('[data-detail-run]').forEach(el=>el.onclick=()=>{const r=M.runById.get(el.dataset.detailRun);activate(r.event.id,r.id);});
    $('detail').querySelectorAll('[data-detail-file]').forEach(el=>el.onclick=()=>selectFile(el.dataset.detailFile));
  }
  function render() {
    $('session').value=state.session;$('axis').value=state.axis;$('kind').value=state.kind;
    renderSummary();renderTimeline();renderCompare();renderMap();renderRecords();renderDetail();
  }
  $('project').textContent=M.data.project;
  $('dataset-select').value=datasetKey;
  $('dataset-select').onchange=e=>{const url=new URL(location.href);url.searchParams.set('dataset',e.target.value);location.href=url.href;};
  $('map-links').onchange=renderMap;
  document.querySelectorAll('[data-map-mode]').forEach(el=>el.onclick=()=>{state.mapMode=el.dataset.mapMode;state.mapBox=null;renderMap();});
  $('session').innerHTML='<option value="all">全项目 · '+M.sessions.size+' 个会话</option>'+[...M.sessions.values()].map(s=>'<option value="'+E(s.id)+'">'+E(s.code+' · '+cut(label(s),22))+'</option>').join('');
  $('kind').innerHTML='<option value="all">全部</option>'+Object.entries(V.kinds).map(([key,label])=>'<option value="'+key+'">'+E(label)+'</option>').join('');
  $('session').onchange=e=>{state.session=e.target.value;state.page=0;render();};
  $('kind').onchange=e=>{state.kind=e.target.value;state.page=0;render();};
  $('axis').onchange=e=>{state.axis=e.target.value;render();};
  $('clear-file').onclick=()=>{state.file=null;state.edge=null;render();};
  $('show-refs').onchange=renderMap;
  $('show-types').onchange=renderMap;
  $('map-step').onchange=e=>{stopMapPlayback();state.mapStep=e.target.value;state.mapCursor=mapSequence().length-1;renderMapTime();};
  $('map-time').oninput=e=>{stopMapPlayback();state.mapCursor=Number(e.target.value);renderMapTime();};
  $('map-play').onclick=()=>{
    if(state.mapPlaying){stopMapPlayback();syncMapTimeline();return;}
    const seq=mapSequence();
    if(seq.length<2)return;
    // The initial view is the final cumulative state. Starting playback from
    // there should replay the sequence from its first event.
    stopMapPlayback();
    if(state.mapCursor>=seq.length-1)state.mapCursor=0;
    state.mapPlaying=true;
    renderMapTime();
    mapPlaybackTimer=window.setTimeout(playMapTick,450);
  };
  $('map-fit').onclick=()=>{state.mapBox=null;renderMap();};
  $('clear-compare').onclick=()=>{state.selected=null;state.run=null;state.pin=null;render();};
  $('reset').onclick=()=>{stopMapPlayback();Object.assign(state,{session:'all',kind:'all',axis:'order',selected:null,run:null,pin:null,file:null,page:0,query:'',edge:null,mapBox:null,mapStep:'activity',mapCursor:mapSteps.activity.length-1,mapPlaying:false});$('search').value='';render();};
  let timeout;
  $('search').addEventListener('input',()=>{clearTimeout(timeout);timeout=setTimeout(()=>{state.query=$('search').value;state.page=0;renderRecords();},180);});
  $('prev-page').onclick=()=>{state.page--;renderRecords();};
  $('next-page').onclick=()=>{state.page++;renderRecords();};
  const helpTable=(rows)=>'<table><thead><tr><th>标记 / 内容</th><th>含义与读法</th></tr></thead><tbody>'+rows.map(([a,b])=>'<tr><td>'+a+'</td><td>'+b+'</td></tr>').join('')+'</tbody></table>';
  const guide={
    overview:'<h3>从全项目到一条具体证据</h3><p>上方是项目演变，下方从左到右依次是运行对照、文件岛图和证据详情。页面固定在当前窗口，各面板内部独立滚动。每个面板右上角的 <strong>⤢</strong> 可放大，<strong>?</strong> 可打开对应图例。</p><ol><li><strong>先看检查演变。</strong>悬停看记录，点会话名展开该会话，点任意检查圆点进入分析。</li><li><strong>再看运行对照。</strong>从左向右看同目标的历次尝试；条件指纹帮助区分已记录值的相同、变化和未知。</li><li><strong>联动文件岛图。</strong>看选中检查的明确目标和诊断位置；点一个文件反查相关记录。</li><li><strong>最后核查证据。</strong>在右下角展开输入、输出或文件差异。没有预先推荐的案例和问题结论。</li></ol>'+helpTable([
      ['可见记录','导出中保留的消息、命令、工具活动和编辑等，不是测试数量。'],
      ['主会话与子 Agent','包括主聊天和子 Agent 会话，不是独立任务数。'],
      ['规则识别的检查项','按可解析的命令、内部状态和结果拆出的检查；一条调用可含多项检查。不是断言数或用例数。'],
      ['文件编辑事件','包含文件差异的记录数，一条记录可能改多个文件。'],
      ['可见路径','从记录识别的去重路径，不是完整仓库文件清单。']
    ])+'<p class="guide-note">此数据包包含全部 858 条已导出记录，但原历史可能有缺失。顶部计数和视图会随会话、检查类型或文件筛选发生变化；路径总数是全包的固定总数。</p>',
    timeline:'<h3>检查演变：先看分布，再选一个点</h3><p>默认每行是一个会话。S01、S02 等只是显示编号；悬停可查看会话的记录数。点行名可展开为其他记录、文件编辑和各类检查轨道；再点轨道名返回全项目。</p>'+helpTable([
      ['横轴 0%—100%','会话内记录的相对顺序：0% 为最早记录，100% 为最晚记录。点间距不表示实际耗时；不同会话的同一横坐标不代表同时发生。'],
      ['横轴「记录时间」','使用历史缓存时间锚点；不能当作校准过的执行开始和结束时间。'],
      ['<span class="legend-mark pass">✓</span>绿色勾','检查在已识别的范围内通过。例如编译通过只表示编译层。'],
      ['<span class="legend-mark fail">×</span>红色叉','内部检查或脚本明确失败；从详情核对失败层次和消息。'],
      ['<span class="legend-mark blocked">!</span>橙色叹号','检查启动受阻，例如编译器没有成功启动。'],
      ['<span class="legend-mark pending"></span>蓝色圆','这条记录显示当时还在运行或编译中。它不是现在仍在运行的实时状态。'],
      ['<span class="legend-mark mixed"></span>棕色圆','同一可识别检查中包含通过和失败的观测。'],
      ['<span class="legend-mark unknown"></span>灰色空心圆','当前数据不足以判定检查结果，不等于通过或失败。'],
      ['<span class="legend-mark skipped"></span>灰色圆','检查被明确跳过。图例可能列出本次数据里没有出现的状态。'],
      ['<span class="legend-edit"></span>紫色短线','文件编辑事件，不是一次测试，也不表示改动行数。'],
      ['<span class="legend-other"></span>小灰点','其余公开记录，如消息、普通命令、图片或子 Agent 活动。可以点击查看。'],
      ['<span class="legend-link"></span>虚线','同会话、同已知检查目标的顺序连接，不是依赖或因果。'],
      ['圆点外的深色圈 / 蓝色圈','深色圈是当前选中的检查 B；蓝色圈是固定的对照 A。'],
      ['上下紧邻的多个圆点','同一调用中拆出的多项检查，例如一次命令包含两项编译。']
    ])+'<p>在检查类型或文件筛选后，不匹配的记录会淡化，保留项目背景。悬停可读检查名、记录号和简短依据。要找一条文字或命令，展开面板底部的「查找原始记录」。</p>',
    compare:'<h3>运行对照：哪些结果可以放在一起读？</h3><p>没有选择检查时，每行是一组同会话、同目标的检查。彩色短条按运行顺序排列，每条代表一次检查，旁边数字是尝试次数；短条不是通过率。</p><p>点任意检查后，上方卡片显示同目标历次运行。S07 #277 的意思是「S07 会话中原始序号为 277 的记录」；277 不是第 277 次测试。</p>'+helpTable([
      ['条件指纹：列','每列一次运行；点击列中的方块可切换当前 B。'],
      ['条件指纹：行','分别是产品版本、测试版本、可见参数、已知环境和检查结果。'],
      ['前四行的同色块','仅在同一行内表示已保存的记录值相同。不同颜色表示该值不同；紫色本身不代表好坏，色块宽度不表示数量或耗时。'],
      ['斜纹块','这一维度未知。两个斜纹不能当作版本或条件相同。'],
      ['结果行','使用时间轴的状态色。结果变化不等于条件固定下的改善。'],
      ['深色外框','当前 B 对应的列。'],
      ['「设为 A」与卡片底部蓝线','固定一个参照运行 A，再选其他运行作为 B。取消 A 后默认与同目标上一次运行比较。'],
      ['A/B 维度表','逐项列出记录值和相同、不同、未知。可见参数相同仍不表示所有输入、断言或环境完全相同。'],
      ['逐项观测表','只展示脚本实际输出的 PASS、FAIL、SKIP 条目。某次没见到同名条目时显示未知，不能推断它未执行或已被删除。']
    ])+'<p class="guide-note">检查名相同只用于目标分组。本包没有完整的产品和测试版本，所以不能自动证明同条件复测。PASS 条目是脚本自报观测，不等于独立测试用例。</p>',
    map:'<h3>文件岛图：范围在哪里？</h3><p>每个小六边形是一个观察到的文件路径；浅色岛屿按目录分组。地图时间轴默认使用“地图变化”粒度：每个滑块位置都对应至少新增一个文件、编辑、检查关联或诊断的记录，因此比 858 条全部记录更容易读；切换“全部记录”可以查看最细的事件级变化，切换“会话节点”看粗粒度阶段。</p>'+helpTable([
      ['地图时间轴','拖动查看累计出现的文件、目标、诊断和引用；滑块下方的蓝色刻度表示该记录解析出了至少一项检查。回退时只保留该时间点以前的证据。时间戳是历史缓存锚点，细粒度的可复现单位是记录顺序。'],
      ['代码／断言色','文件路径、片段、命令或输出出现 assert、expect、verify、test、lint 等信号，倾向于检查代码逻辑或断言。'],
      ['模拟环境色','出现 mock、fake、stub、fixture、sandbox、simulation、in-memory 等信号，表示可能使用测试替身或假环境。'],
      ['真实引擎／场景色','出现 Unity、Editor、Scene、Prefab、GameObject、PlayMode、AssetDatabase、Physics 等信号，表示可能把真实引擎或场景作为输入。'],
      ['混合／灰色','同一文件同时出现多类信号，或没有足够关键词。分类是可解释的词法线索，不等于运行时证明。'],
      ['目标／诊断描边','蓝色描边为明确检查目标，黄色描边为编译诊断位置；填充色现在用于测试类型，角色用描边区分。'],
      ['紫色描边','当前时间截面以前见到该文件的编辑差异。'],
      ['岛间曲线','当前时间截面以前跨目录引用的汇总；曲线宽度是不同文件引用对数量，不是执行路径。'],
      ['淡化／未出现','淡化表示当前检查没有直接关联；滑块回退后完全未出现的文件会从岛中暂时消失。'],
      ['位置、距离与大小','位置用于稳定组织目录，几何距离不表示代码依赖距离，岛屿面积不是测试质量。']
    ])+'<p>悬停看完整路径、测试类型和角色；点击文件看右侧当前时间截面的关联记录。点击引用线查看来源代码片段。</p><p class="guide-note">关键词分类用于提出“验证环境可能偏向哪里”的线索，不能替代原始命令、输出和运行覆盖率。没有关键词或证据不足时保留为“类型未判定”。</p>',
    detail:'<h3>证据详情：核对这次判断来自哪里</h3>'+helpTable([
      ['检查标题与状态','当前选中的检查，以及确定性解析规则得到的状态。'],
      ['规则编号','生成状态的适配规则，例如 CSC 为独立 C# 编译，PIPE-SCRIPT 为 Unity 管线脚本。它不是质量评分。'],
      ['依据输出','该规则引用的真实标记或结构化结果，可继续向下核对完整输出。'],
      ['外层执行 / 退出码','包装命令本身的状态。exit 0 不能覆盖内部脚本失败或编译器启动失败。'],
      ['产品版本 / 测试版本','当前包没保存完整历史快照，保持未知。'],
      ['原始输入、输出、文件差异','点击三角形展开。只有当前记录有相应内容时才出现对应部分。'],
      ['原始公开历史项','包内完整原始记录与定位字段，展开时才渲染。'],
      ['点击文件后的关联列表','列出提及、编辑、检查目标或诊断关联记录；点击其中一项再查看原文。'],
      ['⤢ / 还原','放大当前面板。再次点按钮或按 Esc 返回横屏布局。'],
      ['重置视图','清除会话、类型、文件、当前选项和 A/B 对照，回到全量入口。']
    ])+'<p>默认探索路径：<strong>演变分布 → 选一项检查 → 比较历次运行 → 联动文件 → 核查原文</strong>。你也可以从任意文件或搜索结果反向进入。</p>'
  };
  Object.assign(guide,{
    overview:'<h3>TraceAtlas · 验证图谱</h3><p>左上是检查演变，左下是运行结果矩阵，中间是同一画布上的文件群岛，右侧为证据。点检查、矩阵单元格、文件或引用线，都可以进入核查。</p><ol><li>从演变分布或结果矩阵选择一项运行。</li><li>看群岛上高亮的目标和诊断位置；点文件反查记录。</li><li>展开矩阵下方的「条件对照」或「逐项观测」。</li><li>在右侧核查命令、输出及片段引用。</li></ol><p>顶部依次为记录、会话、检查项、编辑事件、可见文件数。每个面板的 ? 打开完整图例，⤢ 放大，Esc 还原。</p><p class="guide-note">所有视图来自全部已导出的记录。引用线来自历史代码片段，不代表最新完整依赖或运行覆盖。</p>',
    compare:'<h3>结果矩阵</h3><p>一行是同会话、同检查目标的一组运行，列 1、2、3 表示该行目标的第几次可见尝试，不是共同的时间列。点有颜色或斜纹的单元格选择一次运行；右侧显示证据。</p>'+helpTable([
      ['绿色 / 红色 / 橙色','分别表示通过、失败、启动受阻；蓝色表示记录当时仍在运行。'],
      ['斜纹单元格','识别到检查，但结果未知。'],
      ['浅色空格','该行没有第 n 次记录；不同于未知结果。'],
      ['深色边框','当前运行 B。白色小点是固定的 A。'],
      ['条件对照','点单元格后可展开。列为运行，行为产品版本、测试版本、参数、环境和结果。前四行同色只表示记录值相同；斜纹块表示未知。'],
      ['逐项观测','展示脚本输出的检查内容和结果。小格为观测结果，? 表示当前未见同名观测。'],
      ['设为 A','固定一个运行，再点其他单元格选择 B；不能把缺失版本当作相同版本。']
    ]),
    map:'<h3>文件群岛：测试如何关联项目</h3><p>每个小六边形是一个文件。左侧为测试文件，右侧为项目文件，各自按目录聚岛。滚轮缩放、拖动平移，⤢ 放大；地图时间轴控制证据可见的时间截面。</p>'+helpTable([
      ['结构','二维文件布局。测试源码按可识别层级着色，项目文件使用浅灰蓝。'],
      ['深度 2.5D','测试柱高表示当前最新可见源码的层级 D0—D4；项目柱高表示直接关联测试文件的最高层级。未知用斜纹；D0 有低平台，区别于未知。高度不累加测试数量。'],
      ['数量','测试文件内的数字是直接关联项目文件数；项目文件内的数字是不同关联测试文件数。重复引用、重复运行均不重复计数。'],
      ['外环与底部条带','项目文件外环表示 D0—D4 与未知测试文件的数量占比。底部条带显示全体测试，点项目文件后切换为该文件的关联测试构成。'],
      ['捆绑连线','同一有向目录对的文件引用合为一束。线宽与数字表示不同文件对数；点击查看原始片段。点文件后展开其细线，也可切到逐条连线或仅选中。'],
      ['D0／D1／D2','D0 源码／静态读取断言；D1 本地逻辑断言；D2 替身设置或子进程调用和断言。子进程本身不证明是真实引擎。'],
      ['D3／D4','D3 引擎接口、启动／动作调用和断言同时可见；D4 界面自动化调用和断言。D4 可能测试开发仪表盘，不能自动解释为游戏端到端。'],
      ['时间与快照','历史片段按记录时间进入；Git 源码和引用按快照时间进入。不能用最新快照回填早期测试深度。'],
      ['边框','紫边为可见编辑；蓝紫粗边为当前检查的明确目标；黄色边为诊断位置；深色粗边为当前选中文件。'],
      ['右侧证据','文件数量、关联文件、深度规则命中的源码、Git 版本或历史记录；选择连线核查调用片段。']
    ])+'<p class="guide-note">深度是可解释的源码层级线索，不保证实际执行、质量或通过；静态引用不等于动态覆盖。深度之和仅保留在详情作为辅助指标。</p>'
  });
  function openGuide(key='overview') {
    $('guide-content').innerHTML=guide[key]??guide.overview;
    document.querySelectorAll('[data-guide]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.guide===key)));
    $('guide-content').scrollTop=0;
    if(!$('about').open)$('about').showModal();
  }
  $('about-button').onclick=()=>openGuide();
  document.querySelectorAll('[data-help]').forEach(el=>el.onclick=()=>openGuide(el.dataset.help));
  document.querySelectorAll('[data-guide]').forEach(el=>el.onclick=()=>openGuide(el.dataset.guide));
  function zoom(panel) {
    const enlarge=!panel.classList.contains('is-zoomed');
    document.querySelectorAll('.panel.is-zoomed').forEach(el=>{el.classList.remove('is-zoomed');el.querySelector('[data-zoom]').textContent='⤢';el.querySelector('[data-zoom]').setAttribute('aria-expanded','false');});
    panel.classList.toggle('is-zoomed',enlarge);document.body.classList.toggle('panel-focused',enlarge);
    const button=panel.querySelector('[data-zoom]');
    button.textContent=enlarge?'还原':'⤢';button.style.width=enlarge?'auto':'';
    button.setAttribute('aria-expanded',String(enlarge));button.setAttribute('aria-label',(enlarge?'还原':'放大')+panel.querySelector('h2').textContent);
    requestAnimationFrame(renderTimeline);
  }
  document.querySelectorAll('[data-zoom]').forEach(el=>{el.setAttribute('aria-expanded','false');el.onclick=()=>zoom(el.closest('.panel'));});
  let resizeTimeout;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimeout);resizeTimeout=setTimeout(renderTimeline,100);});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!$('about').open){const panel=document.querySelector('.panel.is-zoomed');if(panel){zoom(panel);return;}}
    const target=e.target.closest('[role=button]');
    if(target&&['Enter',' '].includes(e.key)){e.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
  });
  $('footer').textContent=M.data.source+' · 版本与覆盖率未记录';
  globalThis.workbench={model:M,state,render,activate,selectFile,visibleChecks};
  render();
})();
