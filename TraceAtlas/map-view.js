(function(root){
  'use strict';
  const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors=['#a7b0c2','#6578cc','#a47bc5','#cd9659','#4d9e9b','#dce1eb'];
  const names=['D0 静态','D1 逻辑','D2 替身／进程','D3 引擎','D4 界面','未知'];
  const baseline=2.5;
  const failureColor='#d33d46';
  const testHeight=level=>4+(level??0)*12;
  const productHeight=(sum,ceiling)=>baseline+Map3D.maxHeight*sum/ceiling;
  const rgbHex=color=>'#'+color.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
  let renderer,createAttempted=false;
  const hex=(x,y,r,flat=1)=>Array.from({length:6},(_,i)=>{const a=(i*60-30)*Math.PI/180;return [x+r*Math.cos(a),y+r*Math.sin(a)*flat];});
  const pts=a=>a.map(p=>p.join(',')).join(' ');
  function hull(ps){
    ps.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=xs=>{const h=[];for(const p of xs){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h.slice(0,-1);};
    return half(ps).concat(half([...ps].reverse()));
  }
  const mean=points=>[0,1].map(axis=>points.reduce((sum,p)=>sum+p[axis],0)/points.length);
  function shore(polygon,center,toward){
    const [dx,dy]=toward.map((value,i)=>value-center[i]);
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      const ex=b[0]-a[0],ey=b[1]-a[1];
      const determinant=dx*ey-dy*ex;
      if(Math.abs(determinant)<1e-7)continue;
      const x=a[0]-center[0],y=a[1]-center[1];
      const t=(x*ey-y*ex)/determinant,u=(x*dy-y*dx)/determinant;
      if(t>=0&&u>=0&&u<=1)return [center[0]+t*dx,center[1]+t*dy];
    }
    return center;
  }
  function arrowPath(a,b){
    const lift=Math.max(14,Math.min(35,Math.abs(b[0]-a[0])*.16));
    const crest=Math.min(a[1],b[1])-lift;
    return 'M'+a+' C'+[a[0],crest,b[0],crest,...b].join(',');
  }
  function render(ctx){
    const {M,state,selectFile,render,stopMapPlayback,mapCutoffInfo,eventIndex,depthCeiling}=ctx;
    const $=id=>document.getElementById(id),atlas=M.atlas,info=mapCutoffInfo();
    const mode=state.mapMode??'structure',raised=mode==='depth',show=$('show-refs').checked;
    const instances=root.PytestDepth?.update(ctx,raised && M.data===root.STS2_DATA);
    const {stats,activeRefs}=instances??TestEvidence.metrics(M,info,eventIndex,state.session);
    const project=(x,y,z=0)=>raised?Map3D.project([x,y,z]):[x,y];
    const at=f=>{const p=atlas.positions.get(f.toLowerCase());return project(p.x,p.y);};
    const heights=new Map([...stats].map(([key,s])=>[key,!raised?0:instances?productHeight(s.sum,instances.ceiling):s.file.side==='test'?
      (s.depth.level==null?baseline:testHeight(s.depth.level)):productHeight(s.sum,depthCeiling)]));
    const topOf=f=>{const key=f.toLowerCase(),p=atlas.positions.get(key);return project(p.x,p.y,heights.get(key));};
    const b=atlas.box,headroom=(Map3D.maxHeight+baseline)*Map3D.vertical;
    const defaultBox=raised?[b[0],b[1]*Map3D.slope-headroom-20,b[2],b[3]*Map3D.slope+headroom+40]:[b[0],b[1]-28,b[2],b[3]+28];
    const fit=state.mapBox??defaultBox;
    const host=$('file-map');
    if(raised&&!createAttempted&&typeof document.createElement==='function'){
      createAttempted=true;
      try{renderer=Map3D.create(host);}catch(error){console.warn('TraceAtlas: WebGL initialization failed',error);}
      if(renderer)host.addEventListener('map3dcontextlost',()=>{renderer=null;render();});
    }
    const usingWebGL=raised&&Boolean(renderer),meshFaces=[],titles=new Map();
    const svgBox=' viewBox="'+fit.join(' ')+'" preserveAspectRatio="xMidYMid meet"';
    const islandFootprints=new Map();
    let ground='',groundLinks='',groundCounts='',groundHits='',islandLabels='',arrows='';
    const testStats=[...stats.values()].filter(s=>s.file.side==='test'),productStats=[...stats.values()].filter(s=>s.file.side!=='test');
    const selected=state.file,focused=selected?activeRefs.filter(e=>e.source.toLowerCase()===selected||e.target.toLowerCase()===selected):[];
    const relevant=new Set(focused.flatMap(e=>[e.source.toLowerCase(),e.target.toLowerCase()]));
    const groups=new Map();
    for(const edge of activeRefs){
      const source=M.files.get(edge.source.toLowerCase()).atlasGroup,target=M.files.get(edge.target.toLowerCase()).atlasGroup;
      if(source===target)continue;
      const key=source+'→'+target;
      if(!groups.has(key))groups.set(key,{source,target,edges:[]});groups.get(key).edges.push(edge);
    }
    let svg='<svg class="map-interaction'+(raised?' map-raised':'')+'"'+svgBox+' role="group" aria-label="文件群岛引用地图"><defs><marker id="map-arrow" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#6876ad"/></marker><pattern id="depth-unknown" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#f2f4f8"/><path d="M0 4L4 0" stroke="#c3cad8" stroke-width="1"/></pattern></defs>';
    for(const side of ['test','product']){
      const gs=atlas.groups.filter(g=>g.side===side);if(!gs.length)continue;
      const left=Math.min(...gs.map(g=>g.x-g.radius)),right=Math.max(...gs.map(g=>g.x+g.radius)),y=Math.min(...gs.map(g=>g.y-g.radius))-35;
      const p=project((left+right)/2,y);
      svg+='<text class="map-region-label '+side+'" x="'+p[0]+'" y="'+p[1]+'" text-anchor="middle">'+(side==='test'?'测试文件 · '+testStats.length:'项目文件 · '+productStats.length)+'</text>';
    }
    // Anchor island references to the currently visible ground footprints.
    for(const g of atlas.groups){
      const visible=g.files.filter(f=>stats.has(f.path.toLowerCase()));if(!visible.length)continue;
      const coastline=hull(visible.flatMap(f=>{const p=atlas.positions.get(f.path.toLowerCase());return hex(p.x,p.y,21).map(a=>project(...a));}));
      islandFootprints.set(g.name,{coastline,center:mean(coastline)});
      ground+='<polygon points="'+pts(coastline)+'" fill="'+(g.side==='test'?'#eff0fc':'#f0f3f7')+'" stroke="'+(g.side==='test'?'#d3d7ee':'#dce2ea')+'" stroke-linejoin="round" stroke-width="1.1"/>';
      const p=[g.x,Math.max(...coastline.map(point=>point[1]))+17];
      const label=g.label.length>20?'…/'+g.label.split('/').at(-1).slice(-17):g.label;
      islandLabels+='<text class="island-label" text-anchor="middle" x="'+p[0]+'" y="'+p[1]+'"><title>'+E(g.label)+'</title>'+E(label)+'<tspan class="island-count"> '+visible.length+'</tspan></text>';
    }
    const islandLinks=[...groups.values()];
    if(show&&!instances)islandLinks.forEach((link,i)=>{
      const source=islandFootprints.get(link.source),target=islandFootprints.get(link.target);
      const start=shore(source.coastline,source.center,target.center);
      const end=shore(target.coastline,target.center,source.center);
      const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy)||1;
      const crowded=islandLinks.some(other=>{
        if(other===link||other.source!==link.source)return false;
        const [ox,oy]=islandFootprints.get(other.target).center.map((value,axis)=>value-source.center[axis]);
        const [sx,sy]=target.center.map((value,axis)=>value-source.center[axis]);
        return Math.hypot(ox,oy)<Math.hypot(sx,sy)&&
          (ox*sx+oy*sy)/(Math.hypot(ox,oy)*Math.hypot(sx,sy))>.99;
      });
      const bend=crowded?-66:groups.has(link.target+'→'+link.source)?16:0;
      const control=[(start[0]+end[0])/2-dy/length*bend,(start[1]+end[1])/2+dx/length*bend];
      const [x,y]=start.map((value,axis)=>(value+2*control[axis]+end[axis])/4);
      const d='M'+start+' Q'+control+' '+end;
      const count=link.edges.length, width=Math.min(5,1.2+Math.log2(count+1)*.48);
      const title=E(atlas.byGroup.get(link.source).label+' → '+atlas.byGroup.get(link.target).label+' · '+count+' 个引用对');
      const labelWidth=14+String(count).length*7;
      groundLinks+='<path d="'+d+'" fill="none" stroke="#8999bd" stroke-width="'+width+'"'+(selected?' opacity=".48"':'')+'/>';
      groundCounts+='<g class="map-ground-link"'+(selected?' opacity=".6"':'')+'>'+
        '<rect x="'+(x-labelWidth/2)+'" y="'+(y-9)+'" width="'+labelWidth+'" height="18" rx="8" fill="#fcfcfe" stroke="#d6deee"/>'+
        '<text x="'+x+'" y="'+(y+4)+'" class="map-island-count" text-anchor="middle">'+count+'</text></g>';
      groundHits+='<g class="click map-island-link" tabindex="0" role="button" data-island-link="'+i+'" aria-label="'+title+'"><title>'+title+'</title>'+
        '<path d="'+d+'" fill="none" stroke="transparent" stroke-width="12"/>'+
        '<rect x="'+(x-labelWidth/2)+'" y="'+(y-9)+'" width="'+labelWidth+'" height="18" fill="transparent"/></g>';
    });
    if(!usingWebGL)svg+=ground+groundLinks+groundCounts;
    svg+=groundHits;
    if(show)for(const edge of instances&&!selected?activeRefs:focused){
      const d=arrowPath(topOf(edge.source),topOf(edge.target));
      const title=E(edge.source+' → '+edge.target+(instances?' · '+edge.count+' 条实例关联':'')+'\n'+edge.evidence[0].excerpt);
      arrows+='<g class="click map-file-link" tabindex="0" role="button" data-file-edge="'+E(edge.id)+'"><title>'+title+'</title>'+
        '<path class="map-link-stroke" d="'+d+'" fill="none" stroke="#5366ad" stroke-width="1.65" opacity="'+(instances&&!selected?.08:.86)+'" marker-end="url(#map-arrow)"/>'+
        '<path d="'+d+'" fill="none" stroke="transparent" stroke-width="8"/></g>';
    }
    const cells=[...stats].sort((a,b)=>at(a[0])[1]-at(b[0])[1]);
    for(const [key,s] of cells){
      const f=s.file,p=at(key),isTest=f.side==='test',level=s.depth.level;
      const height=heights.get(key);
      const world=atlas.positions.get(key),top=project(world.x,world.y,height),r=10.3,flat=raised?Map3D.slope:1;
      const fill=isTest?(mode==='count'?(colors[level]??'url(#depth-unknown)'):($('show-types').checked&&level!=null?colors[level]:'#8995d0')):'#c8d5df';
      const edited=[...f.events].some(([id,roles])=>roles.has('edit')&&(eventIndex.get(id)??Infinity)<=info.index&&(state.session==='all'||M.byId.get(id)?.session===state.session));
      const run=M.runById.get(state.run),roles=run?.files.filter(x=>x.path.toLowerCase()===key).map(x=>x.role)??[];
      const stroke=selected===key?'#253563':roles.includes('diagnostic')?'#c78d3e':roles.includes('target')?'#4d54b6':edited?'#8a83b7':'#fff';
      const opacity=selected&&selected!==key&&!relevant.has(key)?.36:1;
      const distribution=s.histogram.map((n,i)=>n?names[i]+' × '+n:'').filter(Boolean).join(' · ');
      const bad=instances?s.failures.reduce((a,b)=>a+b,0):0;
      const title=f.path+'\n'+(instances?s.count+' 个 pytest 实例 · 深度和 '+s.sum+(bad?' · 失败／错误 '+bad:'')+'\n'+distribution:isTest?
        '测试文件；'+s.count+' 个直接关联项目文件\n'+(TestEvidence.labels[level]??'深度未知')+'\n'+s.depth.reason:
        '项目文件；'+s.count+' 个不同关联测试文件\n深度和 '+s.sum+' / '+depthCeiling+(distribution?'\n'+distribution:'\n无可见关联测试'));
      titles.set(key,title);
      svg+='<g class="click map-file'+(usingWebGL?' map-file-mesh':'')+'" role="button" tabindex="0" data-file="'+E(key)+'" data-depth="'+(level??'unknown')+'" data-depth-sum="'+s.sum+'" data-test-count="'+s.sources.size+'" opacity="'+(usingWebGL?1:opacity)+'"><title>'+E(title)+'</title>';
      let topFill=fill;
      if(raised){
        let fraction=0;
        const segments=instances?[{color:s.histogram[0]?colors[0]:colors[5],top:baseline},...s.histogram.slice(1,5).flatMap((count,j)=>{
          const n=count-s.failures[j+1];
          if(!n)return [];
          fraction+=n*(j+1);
          return [{color:colors[j+1],top:productHeight(fraction,instances.ceiling)}];
        })]:isTest?[{color:colors[level]??colors[5],top:height}]:
          s.count?s.histogram.flatMap((n,i)=>{
            if(!n)return [];
            fraction+=n/s.count;
            return [{color:colors[i],top:height*fraction}];
          }):[{color:'#c8d5df',top:height}];
        if(bad)segments.push({color:failureColor,top:height});
        segments.at(-1).top=height;
        const faces=Map3D.columnFaces({key,x:world.x,y:world.y,segments,stroke,selected:selected===key,opacity:usingWebGL?opacity:1});
        meshFaces.push(...faces);
        topFill=usingWebGL?'transparent':segments.at(-1).color;
        for(const face of faces.filter(face=>face.front&&face.points.length===4)){
          svg+='<polygon points="'+pts(face.points.map(Map3D.project))+'" fill="'+(usingWebGL?'transparent':rgbHex(face.color))+'"/>';
        }
      }
      svg+='<polygon class="file-cell" points="'+pts(hex(...top,r,flat))+'" fill="'+topFill+'" stroke="'+(usingWebGL?'transparent':stroke)+'" stroke-width="'+(selected===key?2.3:roles.length?1.7:.9)+'"/>';
      const pin=M.runById.get(state.pin);
      if(pin&&(eventIndex.get(pin.event.id)??Infinity)<=info.index&&pin.files.some(x=>x.path.toLowerCase()===key))svg+='<circle cx="'+top[0]+'" cy="'+(top[1]-(usingWebGL?12:0))+'" r="2.1" fill="#fff" stroke="#327da5"/>';
      if(mode==='count'&&s.count)svg+='<text x="'+top[0]+'" y="'+(top[1]+3)+'" text-anchor="middle" class="cell-count">'+s.count+'</text>';
      if(selected===key&&!raised)svg+='<circle cx="'+top[0]+'" cy="'+(top[1]-17)+'" r="2.7" fill="#4758a2"/>';
      svg+='</g>';
    }
    svg+=arrows+islandLabels+'</svg>';
    const underlay=usingWebGL?'<svg class="map-ground"'+svgBox+' aria-hidden="true">'+ground+groundLinks+groundCounts+'</svg>':'';
    host.innerHTML=underlay+svg+(raised?'<div class="map-hover-label" hidden></div>':'');
    const scene=raised?Map3D.scene(meshFaces):null;
    if(usingWebGL){host.append(renderer.canvas);renderer.set(scene,fit);}
    $('map-caption').textContent=testStats.length+' 测试文件 · '+productStats.length+' 项目文件 · '+activeRefs.length+' 条引用';
    $('map-metric-caption').textContent=instances?'柱高：实例深度和 / '+instances.ceiling+' · 同层级合并着色':raised?
      (usingWebGL?'':'SVG 预览 · ')+'测试柱高：层级 · 项目柱高：深度和 / '+depthCeiling+' · 分段：测试文件占比':
      mode==='count'?'数字：不同文件数':'左：测试 · 右：项目';
    $('map-legend').innerHTML=names.map((n,i)=>'<span class="key"><i class="swatch" style="background:'+colors[i]+'"></i>'+n+'</span>').join('');
    if(instances)$('map-legend').innerHTML+='<span class="key"><i class="swatch" style="background:'+failureColor+'"></i>失败／错误</span>';
    document.querySelectorAll('[data-map-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.mapMode===mode)));
    $('clear-file').hidden=!state.file&&!state.edge;
    const selectedStats=stats.get(selected),hist=selectedStats?.file.side==='product'?selectedStats.histogram:selectedStats?[0,1,2,3,4,5].map(i=>i===(selectedStats.depth.level??5)?1:0):testStats.reduce((a,s)=>{a[s.depth.level??5]++;return a;},[0,0,0,0,0,0]);
    const total=hist.reduce((a,b)=>a+b,0);
    $('map-profile').innerHTML='<div class="profile-label">'+E(selectedStats?selectedStats.file.path.split('/').at(-1):'测试源码层级构成')+'<strong>'+total+(selectedStats?.file.side==='product'?' 个关联测试文件':' 个测试文件')+'</strong></div><div class="depth-strip">'+hist.map((n,i)=>n?'<span style="flex:'+n+';background:'+colors[i]+'" title="'+names[i]+' · '+n+' 个文件">'+(n/total>.12?n:'')+'</span>':'').join('')+'</div>';
    const edgeClick=ids=>{stopMapPlayback();state.edge=ids;state.selected=null;state.file=null;render();};
    if(instances){
      const h=selectedStats?.histogram??testStats.reduce((bins,s)=>bins.map((n,i)=>n+s.histogram[i]),[0,0,0,0,0,0]);
      $('map-profile').innerHTML='<div class="profile-label">'+E(selectedStats?.file.path??'pytest 实例深度分布')+'<strong>'+h.reduce((a,b)=>a+b,0)+' 个实例</strong></div><div class="depth-strip">'+h.map((n,i)=>n?'<span style="flex:'+n+';background:'+colors[i]+'" title="'+names[i]+' × '+n+'">'+n+'</span>':'').join('')+'</div>';
      $('map-caption').textContent=testStats.length+' 测试文件 · '+productStats.length+' 项目文件 · '+activeRefs.reduce((n,e)=>n+e.count,0)+' 条实例关联';
    }
    $('file-map').querySelectorAll('[data-file]').forEach(el=>el.onclick=e=>{if(state.dragged)return;e.stopPropagation();selectFile(el.dataset.file);});
    host.querySelectorAll('[data-island-link]').forEach(el=>el.onclick=()=>edgeClick(islandLinks[Number(el.dataset.islandLink)].edges.map(e=>e.id)));
    $('file-map').querySelectorAll('[data-file-edge]').forEach(el=>el.onclick=e=>{e.stopPropagation();if(instances)selectFile(activeRefs.find(edge=>edge.id===el.dataset.fileEdge).source.toLowerCase());else edgeClick([el.dataset.fileEdge]);});
    const svgEl=host.querySelector('.map-interaction'),groundEl=usingWebGL?host.querySelector('.map-ground'):null;
    const view=box=>{
      state.mapBox=box;
      svgEl.setAttribute('viewBox',box.join(' '));
      groundEl?.setAttribute('viewBox',box.join(' '));
      if(usingWebGL)renderer.view(box);
    };
    const pick=e=>{
      const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svgEl.getScreenCTM().inverse());
      return Map3D.pick(scene,p.x,p.y);
    };
    let hovered=null;
    const tooltip=raised?host.querySelector('.map-hover-label'):null;
    function hover(key,event){
      if(key!==hovered){
        if(usingWebGL)renderer.hover(hovered,key);
        hovered=key;
        svgEl.classList.toggle('over-column',Boolean(key));
        tooltip.hidden=!key;
        tooltip.textContent=titles.get(key)??'';
      }
      if(key&&event){
        const rect=host.getBoundingClientRect();
        tooltip.style.left=Math.max(4,Math.min(event.clientX-rect.left+13,rect.width-tooltip.offsetWidth-5))+'px';
        tooltip.style.top=Math.max(4,Math.min(event.clientY-rect.top+15,rect.height-tooltip.offsetHeight-5))+'px';
      }
    }
    if(scene)svgEl.addEventListener('click',e=>{
      if(!e.detail||state.dragged)return;
      const key=pick(e);
      if(key){e.stopPropagation();selectFile(key);}
    },true);
    if(scene)svgEl.addEventListener('pointerleave',()=>hover(null));
    svgEl.addEventListener('wheel',e=>{e.preventDefault();const box=state.mapBox??defaultBox,k=e.deltaY>0?1.13:.885;if(box[2]*k<120||box[2]*k>defaultBox[2]*4)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svgEl.getScreenCTM().inverse());view([p.x+(box[0]-p.x)*k,p.y+(box[1]-p.y)*k,box[2]*k,box[3]*k]);if(scene)hover(pick(e),e);},{passive:false});
    let drag;
    svgEl.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('[data-file],[data-island-link],[data-file-edge]')||(scene&&pick(e)))return;drag={x:e.clientX,y:e.clientY,box:[...(state.mapBox??defaultBox)]};state.dragged=false;svgEl.setPointerCapture(e.pointerId);});
    svgEl.addEventListener('pointermove',e=>{
      if(!drag){if(scene)hover(pick(e),e);return;}
      if(scene)hover(null);
      const m=svgEl.getScreenCTM(),dx=(e.clientX-drag.x)/m.a,dy=(e.clientY-drag.y)/m.d;
      if(Math.abs(dx)+Math.abs(dy)>3)state.dragged=true;
      view([drag.box[0]-dx,drag.box[1]-dy,drag.box[2],drag.box[3]]);
    });
    svgEl.addEventListener('pointercancel',()=>{drag=null;state.dragged=false;if(scene)hover(null);});
    svgEl.addEventListener('pointerup',()=>{drag=null;setTimeout(()=>{state.dragged=false;},0);});
  }
  root.TestMapView={render,colors,names};
})(globalThis);
