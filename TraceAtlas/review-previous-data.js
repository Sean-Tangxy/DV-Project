(function(root){
  'use strict';
  const tierNames=['输出定位','源码推断','版本候选'];
  const tierIndex=t=>t==='source_inferred'?1:t==='nearby_version_only'?2:t==='fixture_and_summary'?1:0;
  const result=t=>t==='failed'?'fail':t==='error'?'error':t==='command_or_output'?'pass':'unknown';
  function build(M,raw){
    const turns=new Map(M.events.filter(e=>e.id.endsWith(':turn')).map(e=>[e.id.slice(0,-5),e]));
    const sessions=new Map(M.events.map(e=>[e.id.split(':')[0],e.session]));
    const runs=[],claims=[],items=new Map();
    if(raw){
      for(const [id,r] of Object.entries(raw.runs)){
        if(!sessions.has(r[0]))continue;
        const entries=r[2].map(([index,tier])=>{
          const c=raw.catalog[index],identity=c[0],file=identity.split('::')[0],key=identity+'|'+(c[3]??'');
          const item={key,identity,file,level:Number.isInteger(c[1])?c[1]:null,targets:c[2]??{},version:c[3]??null,tier,basis:tierIndex(tier),result:result(tier),index};
          items.set(key,item);return item;
        });
        runs.push({id,turn:r[0],session:sessions.get(r[0]),start:r[1],at:r[4]??r[1],time:Date.parse(r[4]??r[1]),missing:r[3]??0,reported:r[5],items:entries,unit:'instance',event:null});
      }
      const known=new Set(runs.map(r=>r.id));
      raw.claims.forEach((c,i)=>{
        if(!sessions.has(c.turn_id))return;
        const same=(c.matching_same_turn_runs??[]).filter(id=>known.has(id));
        const prior=(c.nearby_prior_run_candidates??[]).filter(id=>known.has(id));
        claims.push({...c,id:i,time:Date.parse(c.at),session:sessions.get(c.turn_id),candidates:same.length?same:prior,relation:same.length?'同轮候选':'较早运行候选'});
      });
    }else{
      for(const check of M.checks){
        const e=check.event,files=check.files.filter(f=>f.role==='target');
        const entries=(files.length?files:[{path:'未定位文件'}]).map(f=>{
          const file=M.files.get(f.path.toLowerCase()),identity=check.label+' · '+f.path;
          const item={key:identity,identity,file:f.path,level:null,targets:{},version:null,tier:'command_or_output',basis:0,result:check.status,index:check.id};
          items.set(identity,item);return item;
        });
        runs.push({id:check.id,turn:e.id,session:e.session,start:e.time,at:e.time,time:Date.parse(e.time),missing:0,items:entries,unit:'check',event:e.id,check});
      }
    }
    runs.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));runs.forEach((r,i)=>r.order=i+1);
    const runById=new Map(runs.map(r=>[r.id,r]));
    claims.sort((a,b)=>a.time-b.time);
    const times=M.events.map(e=>Date.parse(e.time)).filter(Number.isFinite);
    return {M,runs,claims,items,runById,turns,min:Math.min(...times),max:Math.max(...times),unit:raw?'instance':'check'};
  }
  function inRange(r,view){return r.time>=view.range[0]&&r.time<=view.range[1]&&(view.session==='all'||r.session===view.session);}
  function scoped(data,view){return data.runs.filter(r=>inRange(r,view));}
  function matchesFile(item,file){return !file||item.file.toLowerCase()===file||Object.keys(item.targets).some(p=>p.toLowerCase()===file);}
  function matches(item,view){return (view.level==null||(item.level??5)===view.level)&&(view.basis==null||item.basis===view.basis)&&(!view.item||item.identity===view.item);}
  function aggregate(data,view,file=null){
    const scope=scoped(data,view),ids=new Set(view.runIds),selected=ids.size||view.turn?scope.filter(r=>ids.has(r.id)):scope;
    const grid=Array.from({length:6},()=>[0,0,0]),outcomes=Array.from({length:6},()=>({pass:0,fail:0,error:0,unknown:0,skipped:0,other:0}));
    const rows=[],filtered=[];let outside=0,missing=0;
    for(const r of selected){
      missing+=r.missing;
      for(const item of r.items){
        if(!matchesFile(item,file))continue;
        grid[item.level??5][item.basis]++;const o=outcomes[item.level??5];o[item.result in o?item.result:'other']++;
        rows.push({run:r,item});
        if(matches(item,view))filtered.push({run:r,item});
        if(!data.M.atlas.positions.has(item.file.toLowerCase()))outside++;
      }
    }
    return {scope,selected,grid,outcomes,rows,filtered,missing,outside};
  }
  function mapStats(data,view,ctx,aggregation=null){
    const {M,eventIndex}=ctx,info=ctx.mapCutoffInfo(),stats=new Map(),links=new Map();
    const ensure=path=>{
      const key=path.toLowerCase(),f=M.files.get(key);if(!f||!M.atlas.positions.has(key))return null;
      if(!stats.has(key))stats.set(key,{file:f,histogram:[0,0,0,0,0,0],failures:[0,0,0,0,0,0],depth:{level:null},sum:0,count:0,sources:new Set(),targets:new Set(),items:[]});
      return stats.get(key);
    };
    for(const [,f] of M.mapScope.files)if(TestEvidence.present(M,f,info,eventIndex,view.session))ensure(f.path);
    const add=(s,item)=>{const d=item.level??5;s.count++;s.histogram[d]++;s.sum+=item.level??0;if(['fail','error'].includes(item.result))s.failures[d]++;s.items.push(item);};
    const agg=aggregation??aggregate(data,view);
    for(const {item} of agg.filtered){
      const src=ensure(item.file);if(!src)continue;add(src,item);
      for(const [path,reference] of Object.entries(item.targets)){
        const dst=ensure(path);if(!dst)continue;add(dst,item);dst.sources.add(item.file.toLowerCase());src.targets.add(path.toLowerCase());
        const key=item.file+'→'+path;if(!links.has(key))links.set(key,{id:key,source:item.file,target:path,count:0,evidence:[]});
        const link=links.get(key);link.count++;if(link.evidence.length<12)link.evidence.push({excerpt:item.identity+' · '+reference[1]+' L'+reference[0],tier:item.tier});
      }
    }
    return {stats,activeRefs:[...links.values()],ceiling:Math.max(1,...[...stats.values()].map(s=>s.sum)),round:!!view.runIds?.length,aggregate:agg};
  }
  function sets(a,b){
    const A=new Set(a.items.map(i=>i.identity)),B=new Set(b.items.map(i=>i.identity));
    return {a:[...A].filter(i=>!B.has(i)),both:[...A].filter(i=>B.has(i)),b:[...B].filter(i=>!A.has(i))};
  }
  root.ReviewData={build,scoped,inRange,matchesFile,matches,aggregate,mapStats,sets,tierNames};
})(globalThis);
