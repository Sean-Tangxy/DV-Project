(function(root){
  'use strict';
  const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cut=(s,n=24)=>String(s??'').length>n?String(s).slice(0,n-1)+'…':String(s??'');
  const V=()=>root.VerificationModel, colors={pass:'#0d8466',fail:'#bf3c49',blocked:'#b5650b',pending:'#3573bb',mixed:'#996014',unknown:'#788294',skipped:'#737283'};
  const ref=(M,e)=>M.sessions.get(e.session).code+' #'+e.ordinal;
  function heatmap(ctx){
    const {M,state,activate,render,visibleChecks,fingerprint}=ctx, container=document.getElementById('compare'),run=M.runById.get(state.run),pin=M.runById.get(state.pin);
    const groups=new Map();
    for(const r of visibleChecks()){const g=groups.get(r.group)??[];g.push(r);groups.set(r.group,g);}
    const max=Math.max(1,...[...groups.values()].map(g=>g.length)),left=153,cw=28,rowH=23,top=25;
    const width=Math.max(350,left+max*cw+22),height=top+groups.size*rowH+8;
    let html='<div class="heatmap-wrap"><svg viewBox="0 0 '+width+' '+height+'" style="min-width:'+width+'px;width:100%" aria-label="运行结果矩阵"><defs><pattern id="heat-unknown" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#f4f6fa"/><path d="M0 5L5 0" stroke="#d2d9e7" stroke-width="1"/></pattern></defs>';
    html+='<text x="10" y="16" class="heat-axis">检查目标</text>';
    for(let n=0;n<max;n++)html+='<text x="'+(left+n*cw+10)+'" y="16" text-anchor="middle" class="heat-axis">'+(n+1)+'</text>';
    let i=0;
    for(const group of groups.values()){
      const r=group[0],y=top+i++*rowH,s=M.sessions.get(r.event.session);
      html+='<g><title>'+E(s.code+' · '+r.label+'\n各列为此目标的第几次可见尝试；列位置不代表共同时间')+'</title><text x="10" y="'+(y+14)+'" class="heat-label">'+E(s.code+' · '+cut(r.label,19))+'</text></g>';
      for(let n=0;n<max;n++){
        const r=group[n],x=left+n*cw;
        if(!r){html+='<rect x="'+x+'" y="'+y+'" width="21" height="17" rx="2" fill="#edf0f5"><title>没有第 '+(n+1)+' 次记录</title></rect>';continue;}
        html+='<g role="button" tabindex="0" class="click" data-heat-run="'+E(r.id)+'"><title>'+E(ref(M,r.event)+' · '+r.label+'\n'+V().states[r.status]+'\n'+cut(r.proof,210))+'</title><rect class="heat-cell" x="'+x+'" y="'+y+'" width="21" height="17" rx="2" fill="'+(r.status==='unknown'?'url(#heat-unknown)':colors[r.status])+'"/>';
        if(r.id===state.run)html+='<rect x="'+(x-2)+'" y="'+(y-2)+'" width="25" height="21" rx="3" fill="none" stroke="#454bb2" stroke-width="1.5"/>';
        if(r.id===state.pin)html+='<circle cx="'+(x+17)+'" cy="'+(y+4)+'" r="2.8" fill="#fff" stroke="#327da5"/>';
        html+='</g>';
      }
    }
    html+='</svg></div>';
    if(!groups.size)html='<div class="empty">此范围没有已识别的检查。</div>';
    html+='<div class="heat-legend">'+Object.entries(colors).filter(([s])=>['pass','fail','blocked','unknown'].includes(s)).map(([s,c])=>'<span><i style="background:'+c+'"></i>'+E(V().states[s])+'</span>').join('')+'</div>';
    if(run){
      const group=M.subjects.get(run.group),a=pin&&pin.id!==run.id?pin:group.filter(r=>r.event.seq<run.event.seq).at(-1);
      html+='<div class="selection-bar"><strong>'+E(ref(M,run.event))+'</strong><span class="status '+run.status+'">'+E(V().states[run.status])+'</span><button id="pin-run">设为 A</button>'+(pin?'<button id="unpin-run">取消 A</button>':'')+'</div>';
      html+='<details class="compare-drill"><summary>条件对照</summary>'+fingerprint(pin&&pin.id!==run.id?[pin,run]:group);
      if(a){
        html+='<table class="compact-table"><thead><tr><th>条件</th><th>A '+E(ref(M,a.event))+'</th><th>B '+E(ref(M,run.event))+'</th></tr></thead><tbody>';
        for(const d of V().compare(a,run))html+='<tr><th>'+E(d.label)+'</th><td class="cell-value">'+E(cut(d.left??'未知',60))+'</td><td class="cell-value"><span class="change '+d.mode+'">'+E(cut(d.right??'未知',60))+'</span></td></tr>';
        html+='</tbody></table>';
      }
      html+='</details>';
      const runs=a?[a,run]:[run],names=[...new Set(runs.flatMap(r=>r.items.map(x=>x.name)))];
      if(names.length){
        html+='<details class="compare-drill" open><summary>逐项观测</summary><table class="observations compact-table"><thead><tr><th>观测</th>'+runs.map(r=>'<th>'+E(ref(M,r.event))+'</th>').join('')+'</tr></thead><tbody>';
        for(const name of names)html+='<tr><td>'+E(name)+'</td>'+runs.map(r=>{const item=r.items.find(x=>x.name===name);return '<td>'+(item?'<i class="observation-cell" style="background:'+colors[item.status]+'" title="'+E(V().states[item.status])+'"></i>':'<span class="change unknown" title="没有同名观测">?</span>')+'</td>';}).join('')+'</tr>';
        html+='</tbody></table></details>';
      }
    }
    container.innerHTML=html;
    document.getElementById('compare-caption').textContent='';
    document.getElementById('clear-compare').hidden=!run&&!pin;
    container.querySelectorAll('[data-heat-run]').forEach(el=>el.onclick=()=>{const r=M.runById.get(el.dataset.heatRun);activate(r.event.id,r.id);});
    container.querySelectorAll('[data-open-run]').forEach(el=>el.onclick=()=>{const r=M.runById.get(el.dataset.openRun);activate(r.event.id,r.id);});
    if(document.getElementById('pin-run'))document.getElementById('pin-run').onclick=()=>{state.pin=run.id;render();};
    if(document.getElementById('unpin-run'))document.getElementById('unpin-run').onclick=()=>{state.pin=null;render();};
  }
  function renderMap(ctx){return TestMapView.render(ctx);}
  root.AtlasViews={heatmap,renderMap};
})(globalThis);
