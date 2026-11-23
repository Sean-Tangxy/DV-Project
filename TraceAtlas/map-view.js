(function(root){
  'use strict';
  const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors=['#a7b0c2','#6578cc','#a47bc5','#cd9659','#4d9e9b','#dce1eb'];
  const names=['D0 静态','D1 逻辑','D2 替身／进程','D3 引擎','D4 界面','未知'];
  const hex=(x,y,r,flat=1)=>Array.from({length:6},(_,i)=>{const a=(i*60-30)*Math.PI/180;return [x+r*Math.cos(a),y+r*Math.sin(a)*flat];});
  const pts=a=>a.map(p=>p.join(',')).join(' ');
  function hull(ps){
    ps.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=xs=>{const h=[];for(const p of xs){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h.slice(0,-1);};
    return half(ps).concat(half([...ps].reverse()));
  }
  function render(ctx){
    const {M,state,selectFile,render,stopMapPlayback,mapCutoffInfo,eventIndex}=ctx;
    const $=id=>document.getElementById(id),atlas=M.atlas,info=mapCutoffInfo();
    const {stats,activeRefs}=TestEvidence.metrics(M,info,eventIndex,state.session);
    const mode=state.mapMode??'structure',raised=mode==='depth',links=$('map-links')?.value||'bundle',show=$('show-refs').checked;
    const project=(x,y,z=0)=>[x+(raised?y*.10:0),y*(raised?.79:1)-z];
    const at=f=>{const p=atlas.positions.get(f.toLowerCase());return project(p.x,p.y);};
    const b=atlas.box,defaultBox=raised?[b[0]+b[1]*.1-10,b[1]*.79-40,b[2]+b[3]*.1+20,b[3]*.79+75]:[b[0],b[1]-28,b[2],b[3]+28];
    const fit=state.mapBox??defaultBox;
    const testStats=[...stats.values()].filter(s=>s.file.side==='test'),productStats=[...stats.values()].filter(s=>s.file.side!=='test');
    const selected=state.file,focused=selected?activeRefs.filter(e=>e.source.toLowerCase()===selected||e.target.toLowerCase()===selected):[];
    const relevant=new Set(focused.flatMap(e=>[e.source.toLowerCase(),e.target.toLowerCase()]));
    const groups=new Map();
    for(const edge of activeRefs){
      const source=M.files.get(edge.source.toLowerCase()).atlasGroup,target=M.files.get(edge.target.toLowerCase()).atlasGroup;
      const key=source+'→'+target;
      if(!groups.has(key))groups.set(key,{source,target,edges:[]});groups.get(key).edges.push(edge);
    }
    let svg='<svg viewBox="'+fit.join(' ')+'" preserveAspectRatio="xMidYMid meet" role="group" aria-label="文件群岛引用地图"><defs><marker id="map-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10" fill="#6876ad"/></marker><pattern id="depth-unknown" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#f2f4f8"/><path d="M0 4L4 0" stroke="#c3cad8" stroke-width="1"/></pattern></defs>';
    for(const side of ['test','product']){
      const gs=atlas.groups.filter(g=>g.side===side);if(!gs.length)continue;
      const left=Math.min(...gs.map(g=>g.x-g.radius)),right=Math.max(...gs.map(g=>g.x+g.radius)),y=Math.min(...gs.map(g=>g.y-g.radius))-35;
      const p=project((left+right)/2,y);
      svg+='<text class="map-region-label '+side+'" x="'+p[0]+'" y="'+p[1]+'" text-anchor="middle">'+(side==='test'?'测试文件 · '+testStats.length:'项目文件 · '+productStats.length)+'</text>';
    }
    // Coastlines under the bundles; file cells are painted last for legibility.
    for(const g of atlas.groups){
      const visible=g.files.filter(f=>stats.has(f.path.toLowerCase()));if(!visible.length)continue;
      const coastline=hull(visible.flatMap(f=>{const p=atlas.positions.get(f.path.toLowerCase());return hex(p.x,p.y,21).map(a=>project(...a));}));
      svg+='<polygon points="'+pts(coastline)+'" fill="'+(g.side==='test'?'#eff0fc':'#f0f3f7')+'" stroke="'+(g.side==='test'?'#d3d7ee':'#dce2ea')+'" stroke-linejoin="round" stroke-width="1.1"/>';
      const p=project(g.x,Math.min(...visible.map(f=>atlas.positions.get(f.path.toLowerCase()).y))-34);
      const label=g.label.length>20?'…/'+g.label.split('/').at(-1).slice(-17):g.label;
      svg+='<text class="island-label" text-anchor="middle" x="'+p[0]+'" y="'+p[1]+'"><title>'+E(g.label)+'</title>'+E(label)+'<tspan class="island-count"> '+visible.length+'</tspan></text>';
    }
    const curve=(a,b)=>{const dx=b[0]-a[0];return 'M'+a.join(',')+' C'+[a[0]+dx*.4,a[1],b[0]-dx*.4,b[1],...b].join(',');};
    const bundles=[...groups.values()];
    if(show&&links==='bundle')bundles.forEach((bundle,i)=>{
      const a=atlas.byGroup.get(bundle.source),b=atlas.byGroup.get(bundle.target);if(!a||!b)return;
      const p=project(a.x,a.y),q=project(b.x,b.y),dx=q[0]-p[0],dy=q[1]-p[1],distance=Math.hypot(dx,dy)||1;
      const start=[p[0]+dx/distance*a.radius*.77,p[1]+dy/distance*a.radius*.77],end=[q[0]-dx/distance*b.radius*.77,q[1]-dy/distance*b.radius*.77];
      svg+='<g class="click map-bundle" tabindex="0" role="button" data-bundle="'+i+'" data-island-edge="'+i+'"><title>'+E(a.label+' → '+b.label+'\n'+bundle.edges.length+' 个不同文件引用对；点击查看底层片段')+'</title><path d="'+curve(start,end)+'" fill="none" stroke="#93a0c4" stroke-width="'+Math.min(11,1.4+Math.log2(bundle.edges.length+1)*1.65)+'" opacity="'+(selected?.20:.48)+'"/><path d="'+curve(start,end)+'" fill="none" stroke="transparent" stroke-width="16"/></g>';
      if(!selected&&bundle.edges.length>1){const x=(start[0]+end[0])/2,y=(start[1]+end[1])/2;
        svg+='<g pointer-events="none"><rect x="'+(x-12)+'" y="'+(y-8)+'" width="24" height="16" rx="8" fill="#fcfcfe" stroke="#dce1eb"/><text x="'+x+'" y="'+(y+3.5)+'" class="bundle-count" text-anchor="middle">'+bundle.edges.length+'</text></g>';}
    });
    const detailed=links==='detail'?activeRefs:focused;
    if(show)for(const edge of detailed){
      const a=at(edge.source),b=at(edge.target),focus=focused.includes(edge);
      let d=curve(a,b);
      if(links==='bundle'){
        const ga=atlas.byGroup.get(M.files.get(edge.source.toLowerCase()).atlasGroup),gb=atlas.byGroup.get(M.files.get(edge.target.toLowerCase()).atlasGroup);
        const p=project(ga.x+ga.radius*.85,ga.y),q=project(gb.x-gb.radius*.85,gb.y);
        d='M'+a.join(',')+' Q'+p.join(',')+' '+[(p[0]+q[0])/2,(p[1]+q[1])/2].join(',')+' Q'+q.join(',')+' '+b.join(',');
      }
      svg+='<path class="click map-file-link" tabindex="0" role="button" data-file-edge="'+E(edge.id)+'" d="'+d+'" fill="none" stroke="'+(focus?'#5866bc':'#9aa5bf')+'" stroke-width="'+(focus?1.5:.7)+'" opacity="'+(focus?.85:.30)+'" marker-end="url(#map-arrow)"><title>'+E(edge.source+' → '+edge.target+'\n'+edge.evidence[0].excerpt)+'</title></path>';
    }
    const cells=[...stats].sort((a,b)=>at(a[0])[1]-at(b[0])[1]);
    for(const [key,s] of cells){
      const f=s.file,p=at(key),level=f.side==='test'?s.depth.level:s.max;
      const z=raised&&level!=null?3+level*6:0,top=[p[0],p[1]-z],r=10.3,flat=raised?.64:1;
      const fill=raised||mode==='count'?(level==null?'url(#depth-unknown)':colors[level]):f.side==='test'?($('show-types').checked&&s.depth.level!=null?colors[s.depth.level]:'#8995d0'):'#c8d5df';
      const edited=[...f.events].some(([id,roles])=>roles.has('edit')&&(eventIndex.get(id)??Infinity)<=info.index&&(state.session==='all'||M.byId.get(id)?.session===state.session));
      const run=M.runById.get(state.run),roles=run?.files.filter(x=>x.path.toLowerCase()===key).map(x=>x.role)??[];
      const stroke=selected===key?'#253563':roles.includes('diagnostic')?'#c78d3e':roles.includes('target')?'#4d54b6':edited?'#8a83b7':'#fff';
      const opacity=selected&&selected!==key&&!relevant.has(key)?.36:1;
      const title=f.path+'\n'+(f.side==='test'?'测试文件；'+s.count+' 个直接关联项目文件':'项目文件；'+s.count+' 个不同关联测试文件')+'\n'+(level==null?'深度未知':TestEvidence.labels[level])+'\n'+(f.side==='test'?s.depth.reason:'最高关联测试源码层级；不是覆盖率')+'\n可识别层级之和 '+s.sum+'（辅助统计）';
      svg+='<g class="click map-file" role="button" tabindex="0" data-file="'+E(key)+'" data-depth="'+(level??'unknown')+'" data-test-count="'+s.sources.size+'" opacity="'+opacity+'"><title>'+E(title)+'</title>';
      if(z){const base=hex(...p,r,flat),roof=hex(...top,r,flat);
        for(const [i,j] of [[0,1],[1,2],[2,3]])svg+='<polygon points="'+pts([roof[i],roof[j],base[j],base[i]])+'" fill="'+(f.side==='test'?'#7b8fc1':'#91b0bb')+'" opacity="'+(i===1?.75:.52)+'" stroke="#ffffff" stroke-width=".4"/>';
      }
      svg+='<polygon class="file-cell" points="'+pts(hex(...top,r,flat))+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+(selected===key?2.3:roles.length?1.7:.9)+'"/>';
      const pin=M.runById.get(state.pin);
      if(pin&&(eventIndex.get(pin.event.id)??Infinity)<=info.index&&pin.files.some(x=>x.path.toLowerCase()===key))svg+='<circle cx="'+top[0]+'" cy="'+top[1]+'" r="2.1" fill="#fff" stroke="#327da5"/>';
      // Six sectors show the distribution of distinct related test files.
      if(f.side!=='test'&&s.count){let start=-Math.PI/2;
        s.histogram.forEach((n,i)=>{if(!n)return;const angle=n/s.count*Math.PI*2,end=start+angle-.035,rad=13;
          const a=[top[0]+rad*Math.cos(start),top[1]+rad*Math.sin(start)*flat],b=[top[0]+rad*Math.cos(end),top[1]+rad*Math.sin(end)*flat];
          svg+='<path d="M'+a.join(',')+' A'+rad+','+(rad*flat)+' 0 '+(angle>Math.PI?1:0)+' 1 '+b.join(',')+'" fill="none" stroke="'+colors[i]+'" stroke-width="2.1"/>';start+=angle;});
      }
      if(mode==='count'&&s.count)svg+='<text x="'+top[0]+'" y="'+(top[1]+3)+'" text-anchor="middle" class="cell-count">'+s.count+'</text>';
      if(selected===key)svg+='<circle cx="'+top[0]+'" cy="'+(top[1]-17)+'" r="2.7" fill="#4758a2"/>';
      svg+='</g>';
    }
    svg+='</svg>';$('file-map').innerHTML=svg;
    $('map-caption').textContent=testStats.length+' 测试文件 · '+productStats.length+' 项目文件 · '+activeRefs.length+' 条引用';
    $('map-metric-caption').textContent=mode==='depth'?'高度：最高层级 · 外环：关联测试构成':mode==='count'?'数字：不同文件数 · 外环：深度构成':'左：测试 · 右：项目';
    $('map-legend').innerHTML=names.map((n,i)=>'<span class="key"><i class="swatch" style="background:'+colors[i]+'"></i>'+n+'</span>').join('');
    document.querySelectorAll('[data-map-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.mapMode===mode)));
    $('clear-file').hidden=!state.file&&!state.edge;
    const selectedStats=stats.get(selected),hist=selectedStats?.file.side==='product'?selectedStats.histogram:selectedStats?[0,1,2,3,4,5].map(i=>i===(selectedStats.depth.level??5)?1:0):testStats.reduce((a,s)=>{a[s.depth.level??5]++;return a;},[0,0,0,0,0,0]);
    const total=hist.reduce((a,b)=>a+b,0);
    $('map-profile').innerHTML='<div class="profile-label">'+E(selectedStats?selectedStats.file.path.split('/').at(-1):'测试源码层级构成')+'<strong>'+total+(selectedStats?.file.side==='product'?' 个关联测试文件':' 个测试文件')+'</strong></div><div class="depth-strip">'+hist.map((n,i)=>n?'<span style="flex:'+n+';background:'+colors[i]+'" title="'+names[i]+' · '+n+' 个文件">'+(n/total>.12?n:'')+'</span>':'').join('')+'</div>';
    const edgeClick=ids=>{stopMapPlayback();state.edge=ids;state.selected=null;state.file=null;render();};
    $('file-map').querySelectorAll('[data-file]').forEach(el=>el.onclick=e=>{if(state.dragged)return;e.stopPropagation();selectFile(el.dataset.file);});
    $('file-map').querySelectorAll('[data-bundle]').forEach(el=>el.onclick=()=>edgeClick(bundles[Number(el.dataset.bundle)].edges.map(e=>e.id)));
    $('file-map').querySelectorAll('[data-file-edge]').forEach(el=>el.onclick=e=>{e.stopPropagation();edgeClick([el.dataset.fileEdge]);});
    const svgEl=$('file-map').querySelector('svg');
    const view=box=>{state.mapBox=box;svgEl.setAttribute('viewBox',box.join(' '));};
    svgEl.addEventListener('wheel',e=>{e.preventDefault();const box=state.mapBox??defaultBox,k=e.deltaY>0?1.13:.885;if(box[2]*k<120||box[2]*k>defaultBox[2]*4)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svgEl.getScreenCTM().inverse());view([p.x+(box[0]-p.x)*k,p.y+(box[1]-p.y)*k,box[2]*k,box[3]*k]);},{passive:false});
    let drag;
    svgEl.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('[data-file],[data-bundle],[data-file-edge]'))return;drag={x:e.clientX,y:e.clientY,box:[...(state.mapBox??defaultBox)]};state.dragged=false;svgEl.setPointerCapture(e.pointerId);});
    svgEl.addEventListener('pointermove',e=>{if(!drag)return;const m=svgEl.getScreenCTM(),dx=(e.clientX-drag.x)/m.a,dy=(e.clientY-drag.y)/m.d;if(Math.abs(dx)+Math.abs(dy)>3)state.dragged=true;view([drag.box[0]-dx,drag.box[1]-dy,drag.box[2],drag.box[3]]);});
    svgEl.addEventListener('pointerup',()=>{drag=null;setTimeout(()=>{state.dragged=false;},0);});
  }
  root.TestMapView={render};
})(globalThis);
