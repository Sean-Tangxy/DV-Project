(function(root){
  'use strict';
  const labels=['D0 源码／静态','D1 本地逻辑','D2 替身／进程','D3 真实引擎','D4 界面交互'];
  const testPath=p=>/(?:^|\/)(?:tests?|__tests__|fixtures)(?:\/|$)|(?:^|[\/_.-])(?:test|verify|audit|probe)[_.-]|(?:Test|Verification|Audit|Probe)(?:[A-Z_.]|$)|\.(?:test|spec)\./.test(p);
  function classify(text){
    // Classify source only. Comments, result logs and filenames are not setup evidence.
    const lines=String(text??'').split(/\r?\n/).filter(x=>!/^\s*(?:#|\/\/|\*|-|\+\+\+|@@)/.test(x)).map(x=>x.replace(/^\+/,'').trim());
    const code=lines.join('\n'),hits=[];
    const has=(rule)=>{const line=lines.find(x=>rule.test(x));if(line)hits.push(line.slice(0,240));return !!line;};
    const assertion=has(/\bassert\b|\bAssert\.|\bexpect\s*\(|pytest\.raises|\bRequire\s*\(/);
    const mock=has(/monkeypatch\.|MagicMock\s*\(|mock\.patch|\b(?:Fake|Stub|Dummy)\w*\s*\(|class\s+(?:Fake|Stub|Dummy)\w*/);
    const engine=has(/(?:Sts2CliAdapter|UnityEngine|Godot|SceneTree|EditorSceneManager|SceneManager|PlayModeTest|UnityTest)\b/);
    const action=has(/\.(?:start|action|load_save|import_combat_snapshot|restore_combat_snapshot|LoadScene|OpenScene|Instantiate)\s*\(|\[UnityTest\]/);
    const ui=has(/(?:page|browser|driver)\.(?:goto|click|locator|find_element|new_page|newPage)\s*\(/);
    const process=has(/subprocess\.(?:Popen|run|check_output)\s*\(|new\s+Process\b|proc\.stdin/);
    const staticRead=has(/read_text\s*\(|readFileSync\s*\(|File\.ReadAllText\s*\(/);
    let level=null,reason='缺少可识别的断言或执行设置';
    if(ui&&assertion){level=4;reason='界面自动化调用及断言；被测界面需核查';}
    else if(engine&&action&&assertion&&!mock){level=3;reason='引擎接口、启动／动作调用与断言同时可见';}
    else if(assertion&&(mock||process)){level=2;reason=mock?'替身设置与断言同时可见':'子进程调用与断言同时可见；进程真实性未知';}
    else if(assertion&&staticRead&&!engine&&!action){level=0;reason='读取源码／文本并检查；局部片段可能不完整';}
    else if(assertion&&!engine&&!ui){level=1;reason='本地断言可见；外部辅助函数可能缺失';}
    else if(/\[Test\]|\bdef test_|\btest\s*\(/.test(code)){reason='识别到测试入口，但环境证据不足';}
    return {level,reason,hits:[...new Set(hits)].slice(0,7)};
  }
  function attach(M){
    for(const f of M.files.values()){
      f.side=f.side??(testPath(f.path)?'test':'product');
      f.atlasGroup=f.side+'::'+f.group;
      f.depthEvidence=[];
    }
    for(const e of M.events)for(const raw of e.files){
      const norm=String(raw.path??'').replace(/\\/g,'/');
      const f=M.files.get(norm.toLowerCase())??[...M.files.values()].find(f=>norm.endsWith('/'+f.path));
      if(!f||f.side!=='test'||!raw.diff)continue;
      f.depthEvidence.push({...classify(raw.diff),event:e.id,at:e.time,source:'历史源码片段'});
    }
    for(const [path,source] of Object.entries(M.data.testSources??{})){
      const f=M.files.get(path.toLowerCase());if(!f)continue;
      f.depthEvidence.push({...classify(source.text),at:source.at,revision:source.revision,blob:source.blob,source:'Git 源码快照'});
    }
  }
  function present(M,f,info,eventIndex,session='all'){
    const eventSeen=[...f.events.keys()].some(id=>(eventIndex.get(id)??Infinity)<=info.index&&(session==='all'||M.byId.get(id)?.session===session));
    const life=M.data.fileLifetimes?.[f.path];
    if(life&&session==='all'){
      const past=life.filter(x=>Date.parse(x.at)<=Date.parse(info.event?.time)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
      if(past.length)return past.at(-1).present;
    }
    return eventSeen;
  }
  function depth(f,info,eventIndex,session,M){
    const observations=f.depthEvidence.filter(d=>d.event?(eventIndex.get(d.event)??Infinity)<=info.index&&(session==='all'||M.byId.get(d.event)?.session===session):session==='all'&&Date.parse(d.at)<=Date.parse(info.event?.time));
    // Latest observed setup, rather than the deepest setup ever seen.
    return observations.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1)??{level:null,reason:'当前时间无可用测试源码',hits:[]};
  }
  function refs(M,info,eventIndex,session){
    return M.references.map(r=>({...r,evidence:r.evidence.filter(ev=>ev.event?(eventIndex.get(ev.event)??Infinity)<=info.index&&(session==='all'||M.byId.get(ev.event)?.session===session):session==='all'&&Date.parse(ev.at)<=Date.parse(info.event?.time))})).filter(r=>r.evidence.length);
  }
  function metrics(M,info,eventIndex,session='all'){
    const visible=new Map([...M.files].filter(([,f])=>present(M,f,info,eventIndex,session)));
    const activeRefs=refs(M,info,eventIndex,session).filter(e=>visible.has(e.source.toLowerCase())&&visible.has(e.target.toLowerCase()));
    const stats=new Map([...visible].map(([key,f])=>[key,{file:f,depth:depth(f,info,eventIndex,session,M),sources:new Set(),targets:new Set(),histogram:[0,0,0,0,0,0],count:0,sum:0,max:null}]));
    for(const edge of activeRefs){
      const a=stats.get(edge.source.toLowerCase()),b=stats.get(edge.target.toLowerCase());
      if(a.file.side!=='test'||b.file.side==='test')continue;
      a.targets.add(edge.target.toLowerCase());b.sources.add(edge.source.toLowerCase());
    }
    for(const s of stats.values()){
      if(s.file.side==='test'){s.max=s.depth.level;s.count=s.targets.size;continue;}
      for(const key of s.sources){const d=stats.get(key).depth.level;s.histogram[d??5]++;if(d!=null){s.sum+=d;s.max=Math.max(s.max??0,d);}}
      s.count=s.sources.size;
    }
    return {stats,activeRefs,visible};
  }
  root.TestEvidence={labels,testPath,classify,attach,present,depth,refs,metrics};
})(globalThis);
