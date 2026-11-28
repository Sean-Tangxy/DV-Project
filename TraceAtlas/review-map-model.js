(function(root){
  'use strict';
  // Names supply an inspectable topic hypothesis, never an assertion or coverage verdict.
  const topics=[
    {id:'interface',name:'界面与展示',words:['browser','dashboard','ui','render','display','art','visual','界面','显示']},
    {id:'contract',name:'协议与接口',words:['protocol','contract','schema','encoding','unicode','utf8','cli','api','接口','协议','编码']},
    {id:'state',name:'状态与恢复',words:['state','snapshot','restore','save','load','storage','history','cache','persist','状态','恢复','存储']},
    {id:'interaction',name:'交互与流程',words:['interaction','select','selection','choice','action','event','flow','reward','turn','lifecycle','选择','交互','流程']},
    {id:'environment',name:'运行与环境',words:['engine','native','runtime','worker','process','subprocess','headless','sandbox','环境','引擎','进程']},
    {id:'boundary',name:'边界与异常',words:['invalid','missing','reject','failure','failures','error','exception','timeout','boundary','boundaries','limit','guard','guards','异常','边界','错误']},
    {id:'algorithm',name:'计算与策略',words:['search','scoring','score','policy','strategy','rng','parity','consistency','model','parallel','算法','策略','评分']},
    {id:'other',name:'未分类',words:[]}
  ];
  const byTopic=new Map(topics.map(t=>[t.id,t])),cache=new Map();
  function classify(text){
    const key=String(text??'');if(cache.has(key))return cache.get(key);
    const normalized=key.replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase(),tokens=new Set(normalized.split(/[^a-z0-9\u4e00-\u9fff]+/));
    for(const token of [...tokens])if(token.endsWith('s')&&token.length>4)tokens.add(token.slice(0,-1));
    const found=topics.filter(t=>t.words.length).map(t=>({id:t.id,hits:t.words.filter(word=>tokens.has(word)||(/[\u4e00-\u9fff]/.test(word)&&normalized.includes(word)))})).filter(t=>t.hits.length);
    const result=found.length?found:[{id:'other',hits:[]}];cache.set(key,result);return result;
  }
  function attach(M,data){
    for(const r of data.runs)for(const item of r.items)item.topics=classify(item.identity);
    for(const f of M.files.values())if(f.side==='test'){
      const base=f.path.split('/').at(-1),tag=classify(base)[0];
      f.reviewTopic=/(?:^|\/)fixtures?\//i.test(f.path)?'fixture':tag.id;
      f.reviewGroupLabel=f.reviewTopic==='fixture'?'辅助与夹具':byTopic.get(tag.id).name;
      // Keep product directories, but split the large test directory by a reproducible rule.
      f.atlasGroup='test::topic::'+f.reviewTopic;
    }
  }
  function fileSites(n){
    const points=Array.from({length:n},(_,i)=>{const r=18.5*Math.sqrt(i+.5),a=i*Math.PI*(3-Math.sqrt(5));return {x:r*Math.cos(a),y:r*Math.sin(a)};});
    const center=points.reduce((a,p)=>[a[0]+p.x/n,a[1]+p.y/n],[0,0]);
    return points.map(p=>({x:p.x-center[0],y:p.y-center[1]}));
  }
  function layout(M,data){
    const grouped=new Map();for(const f of M.mapScope.files.values()){
      const row=grouped.get(f.atlasGroup)||[];row.push(f);grouped.set(f.atlasGroup,row);
    }
    const groups=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([name,files])=>{
      files.sort((a,b)=>a.path.localeCompare(b.path));const cells=fileSites(files.length);
      return {name,label:files[0].side==='test'?files[0].reviewGroupLabel:files[0].group,side:files[0].side,files,cells,radius:Math.max(...cells.map(c=>Math.hypot(c.x,c.y)))+24};
    });
    const byGroup=new Map(groups.map(g=>[g.name,g])),pairs=new Map();
    const add=(source,target)=>{
      const a=M.files.get(source.toLowerCase())?.atlasGroup,b=M.files.get(target.toLowerCase())?.atlasGroup;
      if(!a||!b||a===b)return;const key=[a,b].sort().join('→');
      if(!pairs.has(key))pairs.set(key,{source:a,target:b,weight:0});pairs.get(key).weight++;
    };
    const seen=new Set();for(const r of data.runs)for(const i of r.items)for(const target of Object.keys(i.targets)){
      const key=i.file.toLowerCase()+'→'+target.toLowerCase();if(!seen.has(key)){seen.add(key);add(i.file,target);}
    }
    for(const e of M.references){const key=e.source.toLowerCase()+'→'+e.target.toLowerCase();if(!seen.has(key)){seen.add(key);add(e.source,e.target);}}
    const test=groups.filter(g=>g.side==='test'),product=groups.filter(g=>g.side!=='test');
    // A bipartite group graph orders the lanes; physical distances are not graph distances.
    for(let pass=0;pass<6;pass++)for(const side of [test,product]){
      const other=side===test?product:test,ranks=new Map(other.map((g,i)=>[g.name,i]));
      const bary=g=>{let sum=0,weight=0;for(const e of pairs.values()){
        const k=e.source===g.name?e.target:e.target===g.name?e.source:null;if(!ranks.has(k))continue;
        sum+=ranks.get(k)*e.weight;weight+=e.weight;
      }return weight?sum/weight:other.length+groups.indexOf(g)/groups.length;};
      side.sort((a,b)=>bary(a)-bary(b)||a.name.localeCompare(b.name));
    }
    const pack=(items,left,width)=>{
      let x=left,y=88,row=0;for(const g of items){const size=g.radius*2+22;
        if(x>left&&x+size>left+width){x=left;y+=row;row=0;}
        g.x=x+g.radius+8;g.y=y+g.radius;g.order=items.indexOf(g);x+=size;row=Math.max(row,size+26);
      }return y+row;
    };
    const laneWidth=Math.max(520,...groups.map(g=>g.radius*2+24)),rail={x:8,width:390};
    const testStart=rail.x+rail.width+95,productStart=testStart+laneWidth+125;
    const leftEnd=pack(test,testStart,laneWidth),rightEnd=pack(product,productStart,laneWidth+30);
    const height=Math.max(660,leftEnd+20,rightEnd+20),positions=new Map();
    groups.forEach(g=>g.files.forEach((f,i)=>positions.set(f.path.toLowerCase(),{x:g.x+g.cells[i].x,y:g.y+g.cells[i].y})));
    return {groups,byGroup,groupEdges:[...pairs.values()],positions,rail,box:[-10,0,productStart+laneWidth+65,height]};
  }
  function content(aggregation,selectedFile=null,M=null,topic=null){
    const rows=aggregation.filtered.filter(({item})=>ReviewData.matchesFile(item,selectedFile));
    const entries=new Map(topics.map(t=>[t.id,{...t,count:0,files:new Set(),targets:new Set(),rows:[],histogram:[0,0,0,0,0,0],unmapped:0}]));
    const incoming=new Map(),outgoing=new Map(),fileLinks=new Map(),related=new Set();
    const bump=(map,key,record)=>{if(!map.has(key))map.set(key,{...record,count:0});map.get(key).count++;};
    for(const row of rows){const i=row.item,source=i.file.toLowerCase(),targets=Object.keys(i.targets),labels=i.topics??classify(i.identity);
      if(!topic||labels.some(t=>t.id===topic))for(const target of targets){
        const key=target.toLowerCase();
        if(M?.files.get(source)?.side==='test')bump(fileLinks,source+'→'+key,{source,target:key});
      }
      for(const label of labels.filter(t=>!topic||t.id===topic)){const t=entries.get(label.id);t.count++;t.rows.push(row);if(!M||M.files.get(source)?.side==='test')t.files.add(source);t.histogram[i.level??5]++;
        const testSource=!M||M.files.get(source)?.side==='test';
        if(!targets.length&&testSource)t.unmapped++;related.add(source);
        if(testSource)bump(incoming,source+'|'+label.id,{file:source,topic:label.id});
        else{t.targets.add(source);bump(outgoing,label.id+'|'+source,{file:source,topic:label.id});}
        for(const target of targets){const key=target.toLowerCase();related.add(key);t.targets.add(key);bump(outgoing,label.id+'|'+key,{file:key,topic:label.id});}
      }
    }
    return {entries,incoming:[...incoming.values()],outgoing:[...outgoing.values()],fileLinks:[...fileLinks.values()],related,rows};
  }
  function bundles(M,content){
    const files=new Map(),topicsByIsland=new Map();
    for(const e of content.fileLinks){
      const source=M.files.get(e.source)?.atlasGroup,target=M.files.get(e.target)?.atlasGroup;
      if(!source||!target||source===target)continue;
      const id=source+'→'+target;
      if(!files.has(id))files.set(id,{id,source,target,count:0,pairs:[]});
      const bundle=files.get(id);bundle.count+=e.count;bundle.pairs.push(e);
    }
    for(const e of content.incoming){
      const target=M.files.get(e.file)?.atlasGroup;if(!target)continue;const id=e.topic+'→'+target;
      if(!topicsByIsland.has(id))topicsByIsland.set(id,{id,topic:e.topic,target,count:0,files:new Set()});
      const bundle=topicsByIsland.get(id);bundle.count+=e.count;bundle.files.add(e.file);
    }
    return {files:[...files.values()],topics:[...topicsByIsland.values()]};
  }
  function scale(M,data){
    const stats=new Map(),add=(file,item)=>{const key=file.toLowerCase();if(!M.atlas.positions.has(key))return;const value=stats.get(key)??{count:0,sum:0};value.count++;value.sum+=item.level??0;stats.set(key,value);};
    for(const r of data.runs)for(const i of r.items){if(!M.atlas.positions.has(i.file.toLowerCase()))continue;add(i.file,i);for(const file of Object.keys(i.targets))add(file,i);}
    const histogram=new Map(topics.map(t=>[t.id,[0,0,0,0,0,0]]));
    for(const run of data.runs)for(const item of run.items)for(const t of item.topics)histogram.get(t.id)[item.level??5]++;
    return {matrix:Math.max(1,...[...histogram.values()].flat()),count:Math.max(1,...[...stats.values()].map(s=>s.count)),sum:Math.max(1,...[...stats.values()].map(s=>s.sum))};
  }
  root.ReviewMapModel={topics,byTopic,classify,attach,layout,content,scale,bundles};
})(globalThis);
