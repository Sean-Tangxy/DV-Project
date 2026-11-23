(function(root){
  'use strict';
  function sourceLines(diff){
    const lines=String(diff??'').split(/\r?\n/);
    const unified=lines.some(s=>/^@@|^\*\*\* (?:Begin|Update|Add)/.test(s));
    return lines.map((line,index)=>({line,index:index+1})).filter(x=>!unified||!/^---|^\+\+\+|^@@|^\*\*\*|^-/.test(x.line))
      .map(x=>({...x,line:unified?x.line.replace(/^[+ ]/,''):x.line}));
  }
  function extract(model){
    if(Array.isArray(model.data.references))return model.data.references.map(e=>({...e,
      evidence:e.evidence.map(ev=>({...ev,at:model.data.revision?.at,revision:model.data.revision?.id,type:'snapshot'}))
    }));
    const snippets=[],decls=new Map(),edges=new Map();
    const relative=p=>String(p??'').replace(/\\/g,'/').split('/'+model.data.project+'/').pop().replace(/^\.\//,'');
    for(const e of model.events)for(const f of e.files){
      const path=relative(f.path),file=model.files.get(path.toLowerCase());
      if(!file||!/\.(?:cs|js|ts|tsx|jsx|py)$/.test(path))continue;
      const lines=sourceLines(f.diff);
      // A local lexical approximation only: never claim resolved runtime dependencies.
      const clean=lines.map(x=>x.line).join('\n')
        .replace(/\/\*[\s\S]*?\*\//g,s=>s.replace(/[^\n]/g,' '))
        .replace(/\/\/[^\n]*/g,'')
        .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,s=>s.replace(/[^\n]/g,' '));
      const declarations=[...clean.matchAll(/\b(?:class|struct|interface|enum)\s+([A-Za-z_]\w*)/g)].map(m=>m[1]);
      for(const name of declarations){
        const item=decls.get(name)??new Map();if(!item.has(path))item.set(path,{event:e.id,path});decls.set(name,item);
      }
      snippets.push({event:e.id,path,lines,clean});
    }
    function add(a,b,evidence){
      if(a===b)return;
      const k=a.toLowerCase()+'→'+b.toLowerCase();
      if(!edges.has(k))edges.set(k,{id:'ref-'+edges.size,source:a,target:b,evidence:[]});
      const edge=edges.get(k);
      if(edge.evidence.length<24&&!edge.evidence.some(x=>x.event===evidence.event&&x.symbol===evidence.symbol))edge.evidence.push(evidence);
    }
    for(const sn of snippets){
      const codeLines=sn.clean.split('\n');
      codeLines.forEach((code,i)=>{
        const names=new Set([
          ...[...code.matchAll(/\b([A-Z][A-Za-z_0-9]*)\s*\./g)].map(m=>m[1]),
          ...[...code.matchAll(/\bnew\s+([A-Z][A-Za-z_0-9]*)\s*[(<{]/g)].map(m=>m[1]),
          ...[...code.matchAll(/\b(?:GetComponent|GetComponents|AddComponent|FindObjectsByType|FindFirstObjectByType)\s*<\s*([A-Z][A-Za-z_0-9]*)/g)].map(m=>m[1])
        ]);
        for(const name of names){
          const found=decls.get(name);
          if(found?.size!==1)continue;
          const def=[...found.values()][0];
          add(sn.path,def.path,{event:sn.event,declarationEvent:def.event,symbol:name,fragmentLine:sn.lines[i]?.index,
            excerpt:sn.lines[i]?.line.trim()??code.trim(),type:'symbol'});
        }
      });
      for(const line of sn.lines)for(const match of line.line.matchAll(/["']((?:Assets|src|tests?|work|Docs)\/[^"'\r\n]+\.[a-zA-Z0-9]+)["']/g)){
        const target=model.files.get(match[1].toLowerCase());
        if(target)add(sn.path,target.path,{event:sn.event,symbol:match[1],fragmentLine:line.index,excerpt:line.line.trim(),type:'literal'});
      }
    }
    return [...edges.values()];
  }
  function hexCells(n,r){
    const span=Math.ceil(Math.sqrt(n/3))+2,out=[];
    for(let q=-span;q<=span;q++)for(let t=-span;t<=span;t++)out.push({q,t,d:Math.max(Math.abs(q),Math.abs(t),Math.abs(q+t)),x:Math.sqrt(3)*r*(q+t/2),y:1.5*r*t});
    return out.sort((a,b)=>a.d-b.d||Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x)).slice(0,n);
  }
  function layout(model,edges){
    const grouped=new Map();
    for(const f of model.files.values()){const key=f.atlasGroup??f.group,row=grouped.get(key)??[];row.push(f);grouped.set(key,row);}
    const groups=[...grouped].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0])).map(([name,files],i)=>{
      files.sort((a,b)=>a.path.localeCompare(b.path));
      const cells=hexCells(files.length,14),radius=Math.max(...cells.map(c=>Math.hypot(c.x,c.y)))+26;
      return {name,label:files[0].group,side:files[0].side,files,cells,radius,index:i,x:380+Math.cos(i*2.39996)*180,y:320+Math.sin(i*2.39996)*180};
    });
    const byGroup=new Map(groups.map(g=>[g.name,g])),groupEdges=new Map();
    for(const e of edges){
      const fa=model.files.get(e.source.toLowerCase()),fb=model.files.get(e.target.toLowerCase());
      const a=fa?.atlasGroup??fa?.group,b=fb?.atlasGroup??fb?.group;
      if(!a||!b||a===b)continue;
      const pair=[a,b].sort(),key=pair.join('→');
      if(!groupEdges.has(key))groupEdges.set(key,{id:'island-'+groupEdges.size,source:pair[0],target:pair[1],edges:[]});
      groupEdges.get(key).edges.push(e);
    }
    const connected=new Set([...groupEdges.values()].flatMap(e=>[e.source,e.target]));
    for(let iter=0;iter<420;iter++){
      const delta=groups.map(()=>({x:0,y:0}));
      for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
        const a=groups[i],b=groups[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.1,min=a.radius+b.radius+27;
        const push=d<min?(min-d)*.22:900/(d*d);
        delta[i].x-=dx/d*push;delta[i].y-=dy/d*push;delta[j].x+=dx/d*push;delta[j].y+=dy/d*push;
      }
      for(const e of groupEdges.values()){
        const a=byGroup.get(e.source),b=byGroup.get(e.target),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
        const desired=a.radius+b.radius+35+100/(1+e.edges.length),pull=(d-desired)*.035;
        delta[a.index].x+=dx/d*pull;delta[a.index].y+=dy/d*pull;delta[b.index].x-=dx/d*pull;delta[b.index].y-=dy/d*pull;
      }
      for(const g of groups){
        const dx=g.x-380,dy=g.y-320,d=Math.hypot(dx,dy)||1;
        const desired=connected.has(g.name)?110:290;
        delta[g.index].x+=dx/d*(desired-d)*.008;
        delta[g.index].y+=dy/d*(desired-d)*.008;
        g.x+=Math.max(-12,Math.min(12,delta[g.index].x));g.y+=Math.max(-12,Math.min(12,delta[g.index].y));
      }
    }
    // Final collision pass retains reference-driven placement while separating islands.
    for(let k=0;k<100;k++)for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
      const a=groups[i],b=groups[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,min=a.radius+b.radius+15;
      if(d<min){const p=(min-d)*.52;a.x-=dx/d*p;a.y-=dy/d*p;b.x+=dx/d*p;b.y+=dy/d*p;}
    }
    // Pack each role in its own region; positions stay fixed during time playback.
    if(groups.some(g=>g.side==='test')){
      const test=groups.filter(g=>g.side==='test'),product=groups.filter(g=>g.side!=='test');
      const pack=(items,left)=>{
        const target=Math.max(280,Math.sqrt(items.reduce((n,g)=>n+(g.radius*2+24)**2,0))*1.2);
        let x=left,y=70,rowHeight=0,right=left;
        for(const g of items){const size=g.radius*2+28;if(x>left&&x+size>left+target){x=left;y+=rowHeight;rowHeight=0;}
          g.x=x+g.radius;g.y=y+g.radius;x+=size;rowHeight=Math.max(rowHeight,size+20);right=Math.max(right,x);
        }
        return right;
      };
      const boundary=pack(test,20);pack(product,boundary+100);
    }
    const minX=Math.min(...groups.map(g=>g.x-g.radius))-35,maxX=Math.max(...groups.map(g=>g.x+g.radius))+35;
    const minY=Math.min(...groups.map(g=>g.y-g.radius))-35,maxY=Math.max(...groups.map(g=>g.y+g.radius))+35;
    const positions=new Map();
    groups.forEach(g=>g.files.forEach((f,i)=>positions.set(f.path.toLowerCase(),{x:g.x+g.cells[i].x,y:g.y+g.cells[i].y})));
    return {groups,byGroup,groupEdges:[...groupEdges.values()],positions,box:[minX,minY,maxX-minX,maxY-minY]};
  }
  root.ReferenceAtlas={extract,layout};
})(globalThis);
