(function(root){
  'use strict';
  const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const palette=['#5b99c5','#faa256','#badaba','#f0afaf','#c2bfd7','#cde0cc','#f7bfbf','#b1ddf0'];
  const colors=[palette[5],palette[0],palette[4],palette[1],palette[2],palette[7]];
  const names=['D0 静态','D1 逻辑','D2 替身／进程','D3 引擎','D4 界面','未知'];
  const failureColor=palette[3],ink='#6D8193';
  const curve=(a,b)=>'M'+a+'C'+[(a[0]+b[0])/2,a[1],(a[0]+b[0])/2,b[1],...b].join(',');
  const short=(s,n)=>s.length>n?'…'+s.slice(-(n-1)):s;
  function render(ctx){
    const {M,state,view,render,selectFile,selectTopic,selectBundle,stopMapPlayback,mapCutoffInfo,eventIndex}=ctx,$=id=>document.getElementById(id),atlas=M.atlas;
    const snapshot=root.PytestDepth.update(ctx),{stats}=snapshot,info=mapCutoffInfo(),agg=snapshot.aggregate;
    // Restrict paths to rows supporting the selected file, so the rail never invents a cross-product.
    const topic=view.topic,content=ReviewMapModel.content(agg,state.file,M,topic);
    const connections=ReviewMapModel.bundles(M,content),bundle=connections.files.find(b=>b.id===state.bundle);
    const bundleFiles=new Set(bundle?bundle.pairs.flatMap(p=>[p.source,p.target]):[]);
    const mode=state.mapMode,geometry=ReviewAreaLayout.layout(M,stats,mode==='structure');
    M.activeAreaGeometry=geometry;
    const position=key=>geometry.cells.get(key)??atlas.positions.get(key); 
    const rail=atlas.rail,rowH=48,top=Math.max(100,(atlas.box[3]-ReviewMapModel.topics.length*rowH)/2);
    const centers=new Map(ReviewMapModel.topics.map((t,i)=>[t.id,top+i*rowH+rowH/2]));
    const focused=Boolean(state.file||topic||bundle),relevant=bundle?bundleFiles:content.related;
    const host=$('file-map'),fit=state.mapBox??atlas.box,projection=Math.min(host.clientWidth/fit[2],host.clientHeight/fit[3]);
    const labelScale=Math.min(1.6,Math.max(1,8.5/(16*projection))); 
    let svg='<svg class="map-interaction review-map-flat" style="--map-label-scale:'+labelScale+'" viewBox="'+fit.join(' ')+'" role="group" aria-label="验证内容矩阵、测试文件与项目文件的关联地图"><defs><pattern id="review-unknown" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#F4F5F7"/><path d="M0 4L4 0" stroke="#C4CBD4"/></pattern></defs>';
    const sides=[['test','测试范围'],['product','项目文件']];
    for(const [side,title] of sides){const groups=atlas.groups.filter(g=>g.side===side);if(!groups.length)continue;
      const x=Math.min(...groups.map(g=>g.x-g.radius)),n=[...stats.values()].filter(s=>s.file.side===side).length;
      svg+='<text class="review-map-heading" x="'+x+'" y="33">'+title+'<tspan class="review-map-sub"> / '+n+'</tspan></text>';

    }
    svg+='<text class="review-map-heading" x="'+rail.x+'" y="33">文件索引</text>';
    // The whole file region now carries area and dominant-layer color; no node glyphs.
    const visibleCells=[...geometry.cells.values()],visibleKeys=new Set(visibleCells.map(c=>c.key));
    for(const c of visibleCells){
      const s=stats.get(c.key),h=s.histogram,dominant=h.some(Boolean)?h.indexOf(Math.max(...h)):null;
      const selected=state.file===c.key,dim=focused&&!relevant.has(c.key)&&!selected,fill=!s.count?'#F0F2F4':$('show-types').checked?colors[dominant]:palette[0];
      const bad=s.failures.reduce((a,b)=>a+b,0),title=s.file.path+'\n'+s.count+' 个关联条目（含推断）'+(dominant!=null?' · 主导层级 '+names[dominant]:' · 当前范围无已定位执行条目')+'\n面积 = 最小保留面积 + 次数 × 全局固定比例尺'+(bad?'\n'+bad+' 个失败／错误条目':'');
      svg+='<path class="review-territory" role="button" tabindex="0" data-file="'+E(c.key)+'" data-territory-file="'+E(c.key)+'" data-territory-group="'+E(c.group)+'" data-area-count="'+s.count+'" data-target-area="'+c.targetArea+'" data-actual-area="'+c.area+'" data-area-error="'+Math.abs(c.area-c.targetArea)/c.targetArea+'" d="'+c.path+'" fill="'+fill+'" fill-opacity="'+(dim?.18:s.count?.82:1)+'" stroke="'+(selected?'#365F7D':'#94AABD')+'" stroke-width="'+(selected?2:.65)+'" vector-effect="non-scaling-stroke"><title>'+E(title)+'</title></path>';
      if(bad)svg+='<path class="review-error-mark" d="M'+(c.x-3)+','+(c.y-3)+'l6,6m-6,0l6,-6" stroke="'+failureColor+'" stroke-width="1.6" vector-effect="non-scaling-stroke" pointer-events="none"><title>'+bad+' 个失败／错误条目</title></path>';
      if(mode==='count')svg+='<text class="review-count" x="'+c.x+'" y="'+(c.y+3)+'" text-anchor="middle" pointer-events="none">'+s.count+'</text>';
    }
    for(const g of geometry.groups.values()){
      svg+='<path class="review-area-island" d="'+g.path+'" fill="none" stroke="#94AABD" stroke-width=".65" vector-effect="non-scaling-stroke" pointer-events="none"/>';
      const y=Math.max(...g.points.map(p=>p[1]))+20;
      svg+='<text class="review-island-label" x="'+g.x+'" y="'+y+'" text-anchor="middle"><title>'+E(g.label)+' · '+g.method+' · 最大面积误差 '+(g.error*100).toFixed(2)+'%</title>'+E(g.side==='test'?g.label:short(g.label.split('/').at(-1),Math.max(10,Math.floor((g.radius*2+16)/(7*labelScale)))))+'</text>';
    }
    if($('show-refs').checked){
      // Overview: one connection per island pair. Detail: only a selected file's actual pairs.
      const port=(name,side)=>{const g=geometry.groups.get(name);if(!g)return [0,0];return [side>0?Math.max(...g.points.map(p=>p[0])):Math.min(...g.points.map(p=>p[0])),g.y];};
      if(state.file){
        for(const e of content.fileLinks){const a=position(e.source),b=position(e.target);if(!a||!b||!stats.has(e.source)||!stats.has(e.target))continue;
          svg+='<path class="review-file-link" data-file-link="'+E(e.source+'→'+e.target)+'" data-source-file="'+E(e.source)+'" data-target-file="'+E(e.target)+'" d="'+curve([a.x,a.y],[b.x,b.y])+'" fill="none" stroke="'+palette[0]+'" stroke-width="1.6" opacity=".7" pointer-events="none"/>';
        }
      }else{
        for(const e of connections.files){
          const a=port(e.source,1),b=port(e.target,-1),active=state.bundle===e.id,dim=bundle&&!active;
          const title=atlas.byGroup.get(e.source).label+' → '+atlas.byGroup.get(e.target).label+' · '+e.pairs.length+' 个文件对 · '+e.count+' 条关联（含重复执行及推断）';
          svg+='<g class="review-bundle" role="button" tabindex="0" data-pick-bundle="'+E(e.id)+'" aria-pressed="'+active+'"><title>'+E(title)+'</title><path class="review-bundle-stroke" d="'+curve(a,b)+'" fill="none" stroke="'+(active?'#4F789E':'#A9BAC7')+'" stroke-width="'+Math.min(5,.9+Math.log1p(e.pairs.length)*.9)+'" opacity="'+(dim?.1:active?.9:.36)+'"/><path d="'+curve(a,b)+'" fill="none" stroke="transparent" stroke-width="13"/></g>';
        }
      }
    }
    svg+='<g id="review-tree-links" pointer-events="none"></g>';
    svg+=fileTree(M,state,stats,rail,atlas.box[3],labelScale);
    svg+='</svg>';
    host.innerHTML=svg;
    $('map-legend').innerHTML=names.map((name,i)=>'<span class="key"><i class="swatch" style="background:'+colors[i]+'"></i>'+name+'</span>').join('')+'<span class="key"><i class="swatch" style="background:'+failureColor+'"></i>失败／错误</span>';
    $('map-size-key').hidden=mode==='structure';
    const sample=[25,100,400],areaScale=Math.min(1,18/Math.sqrt(geometry.minimum+geometry.unit*400));
    $('map-size-key').innerHTML='<svg viewBox="0 0 180 42" aria-label="面积比例尺">'+sample.map((n,i)=>{const size=Math.sqrt(geometry.minimum+geometry.unit*n)*areaScale;return '<rect x="'+(25+i*62-size/2)+'" y="'+(25-size)+'" width="'+size+'" height="'+size+'" fill="'+palette[0]+'"/><text x="'+(25+i*62)+'" y="39" text-anchor="middle">'+n+'</text>';}).join('')+'</svg>';
    $('map-size-key').title='地块面积 = 最小保留面积 '+geometry.minimum+' + 条目次数 × '+geometry.unit.toFixed(4)+'；不同岛和轮次使用同一尺度';
    $('map-caption').textContent=stats.size+' 文件';
    $('clear-file').hidden=!state.file&&!state.edge&&!state.bundle;
    document.querySelectorAll('[data-map-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.mapMode===mode)));
    const tree=host.querySelector('.review-file-tree');tree.scrollTop=state.treeScroll;
    const treeLinks=()=>updateTreeLinks(host,geometry,state);
    tree.onscroll=()=>{state.treeScroll=tree.scrollTop;requestAnimationFrame(treeLinks);};
    treeLinks();
    host.onclick=e=>{if(state.dragged)return;const toggle=e.target.closest('[data-toggle-class]');if(toggle){const key=toggle.dataset.toggleClass;if(state.openClasses.has(key))state.openClasses.delete(key);else state.openClasses.add(key);state.treeScroll=tree.scrollTop;render();return;}const expand=e.target.closest('[data-expand-tree]');if(expand){state.openClasses.clear();if(expand.dataset.expandTree==='all')for(const g of atlas.groups.filter(g=>g.side==='test'))state.openClasses.add(g.name);render();return;}const fileRow=e.target.closest('[data-tree-file]');if(fileRow){state.treeScroll=tree.scrollTop;selectFile(fileRow.dataset.treeFile);return;}const bundle=e.target.closest('[data-pick-bundle]');if(bundle){selectBundle(bundle.dataset.pickBundle);return;}const file=e.target.closest('[data-file],[data-territory-file]'),topic=e.target.closest('[data-pick-topic]');if(file)selectFile(file.dataset.file??file.dataset.territoryFile);else if(topic)selectTopic(topic.dataset.pickTopic);};
    const el=host.querySelector('svg'),setBox=box=>{state.mapBox=box;el.setAttribute('viewBox',box.join(' '));requestAnimationFrame(treeLinks);};
    el.addEventListener('wheel',e=>{if(e.target.closest('foreignObject'))return;e.preventDefault();const box=state.mapBox??atlas.box,k=e.deltaY>0?1.13:.885;if(box[2]*k<150||box[2]*k>atlas.box[2]*4)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(el.getScreenCTM().inverse());setBox([p.x+(box[0]-p.x)*k,p.y+(box[1]-p.y)*k,box[2]*k,box[3]*k]);},{passive:false});
    let drag=null;
    el.onpointerdown=e=>{if(e.button!==0||e.target.closest('[data-file],[data-territory-file],[data-pick-bundle],foreignObject'))return;stopMapPlayback();drag={x:e.clientX,y:e.clientY,box:[...(state.mapBox??atlas.box)]};state.dragged=false;el.setPointerCapture(e.pointerId);};
    el.onpointermove=e=>{if(!drag)return;const m=el.getScreenCTM(),dx=(e.clientX-drag.x)/m.a,dy=(e.clientY-drag.y)/m.d;if(Math.abs(dx)+Math.abs(dy)>3)state.dragged=true;setBox([drag.box[0]-dx,drag.box[1]-dy,drag.box[2],drag.box[3]]);};
    el.onpointerup=()=>{drag=null;setTimeout(()=>{state.dragged=false;},0);};el.onpointercancel=()=>{drag=null;state.dragged=false;};
  }
  function fileTree(M,state,stats,rail,height,labelScale){
    const groups=M.atlas.groups.filter(g=>g.side==='test'),max=Math.max(1,M.reviewScale.matrix);
    const cells=hist=>'<span class="tree-heat">'+hist.map((n,i)=>'<i data-tree-cell="'+i+'" data-cell-count="'+n+'" style="background:'+(n?'rgba(91,153,197,'+(.18+.82*Math.log1p(n)/Math.log1p(max))+')':'#EEF1F4')+'" title="'+E(names[i]+' · '+n)+'"></i>').join('')+'</span>';
    let html='<foreignObject x="'+rail.x+'" y="67" width="'+rail.width+'" height="'+(height-88)+'"><div xmlns="http://www.w3.org/1999/xhtml" class="review-tree-wrap" style="--tree-font:'+Math.max(17,15*labelScale)+'px"><div class="tree-toolbar"><span>文件</span><span class="tree-columns">'+['D0','D1','D2','D3','D4','?'].map(x=>'<b>'+x+'</b>').join('')+'</span><button data-expand-tree="all" title="展开全部">＋</button><button data-expand-tree="none" title="收起全部">−</button></div><div class="review-file-tree">';
    for(const g of groups){const h=[0,0,0,0,0,0];for(const f of g.files){const s=stats.get(f.path.toLowerCase());if(s)s.histogram.forEach((n,i)=>h[i]+=n);}
      const open=state.openClasses.has(g.name);html+='<div class="tree-class" data-tree-class="'+E(g.name)+'"><button class="tree-class-row" data-toggle-class="'+E(g.name)+'" aria-expanded="'+open+'"><span class="tree-file-name">'+(open?'▾ ':'▸ ')+E(g.label)+'<small>'+g.files.length+'</small></span>'+cells(h)+'</button>';
      if(open)for(const f of g.files){const key=f.path.toLowerCase(),s=stats.get(key),hist=s?.histogram??[0,0,0,0,0,0],count=s?.count??0;
        html+='<button class="tree-file-row'+(state.file===key?' is-selected':'')+(count?'':' no-evidence')+'" data-tree-file="'+E(key)+'" aria-pressed="'+(state.file===key)+'" title="'+E(f.path+' · '+count+' 个条目'+(!s?' · 当前时点／会话未显示此文件':!count?' · 当前范围无已定位执行条目':''))+'"><span class="tree-file-name">'+E(f.path.split('/').at(-1))+'</span>'+cells(hist)+'</button>';
      }html+='</div>';
    }
    return html+'</div></div></foreignObject>';
  }
  function updateTreeLinks(host,geometry,state){
    const pane=host.querySelector('.review-file-tree'),layer=host.querySelector('#review-tree-links'),svg=host.querySelector('svg'),rect=pane.getBoundingClientRect(),inverse=svg.getScreenCTM()?.inverse();if(!inverse)return;
    const rows=[...pane.querySelectorAll('[data-tree-file]')],chosen=state.file;
    let paths='';for(const row of rows){const key=row.dataset.treeFile,cell=geometry.cells.get(key);if(!cell||chosen&&key!==chosen)continue;
      const r=row.getBoundingClientRect();if(r.top<rect.top||r.bottom>rect.bottom)continue;
      const p=new DOMPoint(r.right+3,r.top+r.height/2).matrixTransform(inverse);
      paths+='<path data-tree-link="'+E(key)+'" d="'+curve([p.x,p.y],[cell.x,cell.y])+'" fill="none" stroke="'+palette[0]+'" stroke-width="'+(chosen?1.6:.8)+'" opacity="'+(chosen?.6:.15)+'"/>';
    }layer.innerHTML=paths;
  }
  root.TestMapView={render,colors,names,palette};
})(globalThis);
