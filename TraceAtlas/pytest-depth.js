(function(root){
  const navigationCache=new WeakMap();
  function navigation(model){
    if(navigationCache.has(model))return navigationCache.get(model);
    const data=root.PYTEST_DEPTH, result=new Map();
    const visible=new Set(Object.keys(data.runs).filter(id=>data.runs[id][2].some(([index])=>
      model.atlas.positions.has(data.catalog[index][0].split('::')[0].toLowerCase()))));
    data.claims.forEach((claim,index)=>{
      const same=claim.matching_same_turn_runs;
      const prior=claim.nearby_prior_run_candidates??[];
      const ids=same.length?same:prior.length===1?prior:[];
      const mapped=ids.filter(id=>visible.has(id)&&Date.parse(data.runs[id][4])<=Date.parse(claim.at));
      if(mapped.length)result.set(index,{ids:mapped,prior:!same.length,ambiguous:same.length>1});
    });
    navigationCache.set(model,result);
    return result;
  }
  const evidence={command_or_output:'命令或输出',fixture_and_summary:'临时目录与摘要',source_inferred:'历史源码推断',nearby_version_only:'邻近版本候选',failed:'记录失败',error:'记录错误'};
  let controls, scope, instance, selection, loading, status, lastFile, claimSelect, candidate, lastEvent, mode='turn';
  function update(ctx, enabled){
    if(controls){controls.hidden=!enabled;controls.style.display=enabled?'flex':'none';}
    if(!enabled)return null;
    if(!controls){
      controls=document.createElement('div');
      controls.className='map-encoding';controls.style.cssText='gap:6px;flex-wrap:wrap';
      controls.innerHTML='<div class="map-modes"><button data-depth-scope="turn">逐轮检验</button><button data-depth-scope="all">总览</button></div><button data-jump="-1">上一条声明</button><button data-jump="1">下一条声明</button><select aria-label="对话轮次"></select><select aria-label="本轮声明"></select><select aria-label="候选运行"></select><select aria-label="选中节点的 pytest 实例" hidden></select><span></span>';
      [scope,claimSelect,candidate,instance]=controls.querySelectorAll('select');
      scope.style.maxWidth='210px';instance.style.maxWidth='210px';
      status=controls.querySelector('span');
      document.querySelector('.map-encoding').after(controls);
      scope.onchange=()=>{selection=null;ctx.state.file=null;ctx.state.mapBox=null;ctx.render();};
      for(const button of controls.querySelectorAll('[data-depth-scope]'))button.onclick=()=>{mode=button.dataset.depthScope;scope.onchange();};
      claimSelect.onchange=()=>{candidate.replaceChildren();scope.onchange();};
      candidate.onchange=scope.onchange;
      instance.onchange=()=>{selection=instance.value;ctx.render();};
    }
    controls.style.display=enabled?'flex':'none';
    if(!root.PYTEST_DEPTH){
      if(!loading){
        loading=document.createElement('script');loading.src='pytest-depth-data.js';
        loading.onload=()=>ctx.render();loading.onerror=()=>{status.textContent='实例数据未能读取';};
        status.textContent='正在读取 pytest 实例';document.head.append(loading);
      }
      return null;
    }
    const data=root.PYTEST_DEPTH, rounds=new Map();
    const sessions=new Map(ctx.M.events.filter(e=>e.id.endsWith(':turn')).map(e=>[e.id.split(':')[0],e.session]));
    const session=ctx.state.session;
    const all=Object.entries(data.runs).filter(([,r])=>session==='all'||sessions.get(r[0])===session);
    for(const entry of all){
      const turn=entry[1][0];if(!rounds.has(turn))rounds.set(turn,[]);
      rounds.get(turn).push(entry);
    }
    const claims=new Map();
    for(const index of navigation(ctx.M).keys()){
      const c=data.claims[index];
      if(!claims.has(c.turn_id))claims.set(c.turn_id,[]);
      const list=claims.get(c.turn_id);
      if(!list.some(x=>x.reported_passes===c.reported_passes && String(x.matching_same_turn_runs)===String(c.matching_same_turn_runs)))list.push(c);
    }
    const events=new Map(ctx.M.events.filter(e=>e.id.endsWith(':turn')).map(e=>[e.id.split(':')[0],e]));
    if(scope.dataset.session!==session){
      scope.replaceChildren();
      const turns=[...new Set([...claims.keys(),...rounds.keys()].filter(t=>claims.has(t)||rounds.get(t)?.some(([,r])=>r[2].some(([i])=>ctx.M.atlas.positions.has(data.catalog[i][0].split('::')[0].toLowerCase())))))].filter(t=>session==='all'||sessions.get(t)===session);
      const date=t=>events.get(t)?.time??claims.get(t)?.[0].at??rounds.get(t)?.[0][1][1]??'';
      turns.sort((a,b)=>Date.parse(date(a))-Date.parse(date(b)));
      for(const [i,t] of turns.entries()){
        const c=claims.get(t)?.at(-1);
        const text=date(t).replace('T',' ').slice(5,16);
        scope.add(new Option('第 '+(i+1)+' 轮 · '+text+(c?' · '+c.reported_passes+' passed':''),t));
      }
      const first=turns.find(t=>claims.get(t)?.some(c=>c.reported_passes===171 && c.matching_same_turn_runs.length===1))??turns.find(t=>claims.has(t));
      if(first)scope.value=first;
      scope.dataset.session=session;
    }
    const info=ctx.mapCutoffInfo(), clock=Date.parse(info.event?.time);
    const current=info.event?.id.split(':')[0];
    scope.value=current??'';
    const perTurn=mode==='turn';
    const claim=info.event?.kind==='claim'?data.claims[info.event.index]:null;
    const link=claim?navigation(ctx.M).get(info.event.index):null;
    const ids=link?.ids??[];
    const refresh=()=>{selection=null;ctx.state.file=null;ctx.render();};
    const jump=pos=>{if(pos>=0){selection=null;mode='turn';ctx.seekMap(pos);}};
    scope.onchange=()=>{
      const turn=scope.value;
      const matching=e=>e.id.split(':')[0]===turn;
      let i=info.seq.findLastIndex(e=>matching(e)&&e.kind==='claim');
      if(i<0)i=info.seq.findLastIndex(e=>matching(e)&&e.kind==='pytest'&&data.runs[e.index]?.[2].length);
      if(i<0)i=info.seq.findLastIndex(matching);
      jump(i);
    };
    controls.querySelectorAll('[data-depth-scope]').forEach(b=>{
      b.onclick=()=>{mode=b.dataset.depthScope;refresh();};
      b.setAttribute('aria-pressed',String(b.dataset.depthScope===mode));
    });
    controls.querySelectorAll('[data-jump]').forEach(b=>{
      const previous=b.dataset.jump==='-1';
      const i=previous?info.seq.findLastIndex((e,j)=>j<info.cursor&&e.kind==='claim'):info.seq.findIndex((e,j)=>j>info.cursor&&e.kind==='claim');
      b.disabled=i<0;b.onclick=()=>jump(i);
    });
    scope.hidden=!perTurn;
    claimSelect.hidden=true;
    candidate.hidden=!perTurn||ids.length<2;
    if(candidate.dataset.ids!==ids.join(',')){
      candidate.replaceChildren(new Option('选择候选运行',''),...ids.map(id=>new Option(id,id)));
      candidate.dataset.ids=ids.join(',');
    }
    candidate.onchange=refresh;
    const completed=all.filter(([,r])=>Date.parse(r[4])<=clock);
    const inTurn=completed.filter(([,r])=>r[0]===current);
    const id=ids.length===1?ids[0]:candidate.value;
    const passOnly=perTurn&&ids.includes(id);
    const entries=!perTurn?completed:passOnly?[[id,data.runs[id]]]:inTurn;
    const note=!perTurn?'':claim?claim.reported_passes+' passed · '+(link?.prior?'同会话较早运行候选 · ':link?.ambiguous?'声明归属待核查 · ':'')+(passOnly?'':'本轮运行汇总 · '):'当前轮次 · ';
    const stats=new Map(),links=new Map(), selected=ctx.state.file;
    if(lastFile!==selected){lastFile=selected;selection=null;}
    let known=0,unknown=0,outside=0,failed=0,errors=0;
    function node(path){
      const key=path.toLowerCase();if(!ctx.M.atlas.positions.has(key))return null;
      if(!stats.has(key))stats.set(key,{file:ctx.M.files.get(key),histogram:[0,0,0,0,0,0],failures:[0,0,0,0,0,0],depth:{level:null},sum:0,count:0,sources:new Set(),items:[]});
      return stats.get(key);
    }
    function add(file,level,item){
      file.count++;file.histogram[level??5]++;file.sum+=level??0;
      if(item.tier==='failed'||item.tier==='error')file.failures[level??5]++;
      if(file.file.path.toLowerCase()===selected)file.items.push(item);
    }
    for(const [id,[turn,at,items,missing]] of entries){
      unknown+=missing;
      for(const [idx,tier] of items){
        const [name,level,targets]=data.catalog[idx],path=name.split('::')[0],src=node(path);
        if(!src){outside++;continue;}
        const item={key:id+'|'+idx,name,tier,at,targets};
        add(src,level,item);known++;
        if(tier==='failed')failed++;
        if(tier==='error')errors++;
        for(const [target,[line,symbol]] of Object.entries(targets)){
          const dst=node(target);if(!dst)continue;
          add(dst,level,item);dst.sources.add(path);
          if(selection && selected && item.key!==selection)continue;
          const key=path+'→'+target;
          if(!links.has(key))links.set(key,{source:path,target,id:key,count:0,evidence:[{excerpt:name+' · '+symbol+'() L'+line}]});
          links.get(key).count++;
        }
      }
    }
        for(const [key,file] of ctx.M.mapScope.files){
      if(TestEvidence.present(ctx.M,file,info,ctx.eventIndex,'all'))node(key);
    }
    // A recovered test execution also witnesses its defining file at that time.
    for(const [,r] of completed)for(const [idx] of r[2]){
      const [name,,targets]=data.catalog[idx];node(name.split('::')[0]);
      for(const path of Object.keys(targets))node(path);
    }
    const list=stats.get(selected)?.items??[];
    instance.hidden=!list.length;
    instance.replaceChildren(new Option('全部实例（'+list.length+'）',''));
    for(const item of list)instance.add(new Option(item.name+' · '+evidence[item.tier]+' · '+item.at,item.key));
    instance.value=selection??'';
    status.textContent=note+entries.length+' 次已记录运行 · '+known+' 项已定位（含推断） · '+unknown+' 项通过身份未定'+(outside?' · '+outside+' 项在现有地图外':'');
    if(failed||errors)status.textContent+=' · 其中 '+failed+' 项失败、'+errors+' 项错误';
    return {stats,activeRefs:[...links.values()],ceiling:Math.max(1,...[...stats.values()].map(s=>s.sum)),round:perTurn};
  }
  root.PytestDepth={update,navigation};
})(globalThis);
