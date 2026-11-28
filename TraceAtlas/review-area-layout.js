(function(root){
  'use strict';
  const area=ps=>Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p[0]*q[1]-p[1]*q[0];},0)/2);
  function centroid(ps){
    let sum=0,x=0,y=0;for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],cross=a[0]*b[1]-b[0]*a[1];sum+=cross;x+=(a[0]+b[0])*cross;y+=(a[1]+b[1])*cross;}
    return Math.abs(sum)>1e-9?[x/(3*sum),y/(3*sum)]:ps.reduce((p,q)=>[p[0]+q[0]/ps.length,p[1]+q[1]/ps.length],[0,0]);
  }
  function clip(poly,nx,ny,c){
    const result=[];for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=nx*a[0]+ny*a[1]-c,db=nx*b[0]+ny*b[1]-c;
      if(da<=1e-9)result.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
    }return result;
  }
  const polygonPath=ps=>'M'+ps.map(p=>p.map(v=>v.toFixed(3)).join(',')).join('L')+'Z';
  function powerCells(sites,weights,domain){
    return sites.map((s,i)=>{let poly=domain;
      for(let j=0;j<sites.length&&poly.length>=3;j++)if(i!==j){const t=sites[j];poly=clip(poly,t.x-s.x,t.y-s.y,(t.x*t.x+t.y*t.y-s.x*s.x-s.y*s.y+weights[i]-weights[j])/2);}
      return poly;
    });
  }
  function linearSolve(matrix,rhs){
    const n=rhs.length,a=matrix.map((row,i)=>[...row,rhs[i]]);
    for(let i=0;i<n;i++){
      let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
      if(Math.abs(a[pivot][i])<1e-12)return null;[a[i],a[pivot]]=[a[pivot],a[i]];
      for(let j=i+1;j<n;j++){const ratio=a[j][i]/a[i][i];for(let k=i;k<=n;k++)a[j][k]-=ratio*a[i][k];}
    }
    const x=Array(n).fill(0);for(let i=n-1;i>=0;i--){let sum=a[i][n];for(let j=i+1;j<n;j++)sum-=a[i][j]*x[j];x[i]=sum/a[i][i];}return x;
  }
  // Exact-area convex treemap fallback, used only if the power solver fails tolerance.
  function partition(sites,targets,domain,indices=sites.map((_,i)=>i),result=[]){
    if(indices.length===1){result[indices[0]]=domain;return result;}
    const xs=indices.map(i=>sites[i].x),ys=indices.map(i=>sites[i].y),axis=Math.max(...xs)-Math.min(...xs)>=Math.max(...ys)-Math.min(...ys)?0:1;
    indices.sort((a,b)=>(axis?sites[a].y-sites[b].y:sites[a].x-sites[b].x)||a-b);
    const split=Math.ceil(indices.length/2),left=indices.slice(0,split),right=indices.slice(split),ratio=left.reduce((n,i)=>n+targets[i],0)/indices.reduce((n,i)=>n+targets[i],0),wanted=area(domain)*ratio;
    let lo=Math.min(...domain.map(p=>p[axis])),hi=Math.max(...domain.map(p=>p[axis]));
    for(let i=0;i<42;i++){const mid=(lo+hi)/2;if(area(clip(domain,axis===0?1:0,axis===1?1:0,mid))<wanted)lo=mid;else hi=mid;}
    const cut=(lo+hi)/2;partition(sites,targets,clip(domain,axis===0?1:0,axis===1?1:0,cut),left,result);partition(sites,targets,clip(domain,axis===0?-1:0,axis===1?-1:0,-cut),right,result);return result;
  }
  function solve(sites,targets,domain){
    const n=sites.length;if(n===1)return {polygons:[domain],method:'power',error:0,iterations:0};
    const total=targets.reduce((a,b)=>a+b,0),weights=Array(n).fill(0);
    let polygons=powerCells(sites,weights,domain),areas=polygons.map(area),iterations=0;
    const error=a=>Math.max(...a.map((v,i)=>Math.abs(v-targets[i])/targets[i]));
    for(;iterations<40&&error(areas)>.012;iterations++){
      const H=Array.from({length:n},()=>Array(n).fill(0));
      for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
        const s=sites[i],t=sites[j],nx=t.x-s.x,ny=t.y-s.y,d=Math.hypot(nx,ny),c=(t.x*t.x+t.y*t.y-s.x*s.x-s.y*s.y+weights[i]-weights[j])/2;
        let length=0;const poly=polygons[i];
        for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length];if(Math.abs(nx*a[0]+ny*a[1]-c)/d<1e-5&&Math.abs(nx*b[0]+ny*b[1]-c)/d<1e-5)length+=Math.hypot(a[0]-b[0],a[1]-b[1]);}
        if(length){const value=length/(2*d);H[i][i]+=value;H[j][j]+=value;H[i][j]-=value;H[j][i]-=value;}
      }
      const rhs=targets.slice(0,-1).map((v,i)=>v-areas[i]),delta=linearSolve(H.slice(0,-1).map((r,i)=>r.slice(0,-1).map((v,j)=>v+(i===j?1e-9:0))),rhs);
      if(!delta)break;delta.push(0);
      const loss=areas.reduce((s,a,i)=>s+Math.abs(a-targets[i]),0)/total;
      let accepted=false;
      for(let damping=1;damping>1/8192;damping/=2){
        const candidate=weights.map((w,i)=>w+delta[i]*damping),next=powerCells(sites,candidate,domain),a=next.map(area),nextLoss=a.reduce((s,v,i)=>s+Math.abs(v-targets[i]),0)/total;
        if(a.every(v=>v>1e-6)&&nextLoss<loss){weights.splice(0,n,...candidate);polygons=next;areas=a;accepted=true;break;}
      }
      if(!accepted)break;
    }
    if(error(areas)>.02){polygons=partition(sites,targets,domain);return {polygons,method:'convex-treemap',error:error(polygons.map(area)),iterations};}
    return {polygons,method:'power',error:error(areas),iterations};
  }
  function prepare(M,data){
    const capacity=new Map([...M.atlas.positions.keys()].map(k=>[k,0]));
    const add=k=>{if(capacity.has(k))capacity.set(k,capacity.get(k)+1);};
    for(const r of data.runs)for(const item of r.items){const key=item.file.toLowerCase();if(!capacity.has(key))continue;add(key);for(const target of Object.keys(item.targets))add(target.toLowerCase());}
    const minimum=90,templates=new Map(),limits=[];
    for(const g of M.atlas.groups){
      const radius=g.radius-7,points=Array.from({length:12},(_,i)=>{const a=(i+.13)*Math.PI/6;return [g.x+Math.cos(a)*radius,g.y+Math.sin(a)*radius];}),total=area(points),count=g.files.reduce((n,f)=>n+capacity.get(f.path.toLowerCase()),0);
      templates.set(g.name,{points,area:total,count});if(count)limits.push((total-minimum*g.files.length)/count);
    }
    return {minimum,unit:Math.max(.01,Math.min(...limits)),templates,cache:new Map()};
  }
  function layout(M,stats,equal=false){
    const setup=M.areaLayout,keys=[...stats.keys()].sort(),key=(equal?'equal|':'count|')+keys.map(k=>k+':'+(equal?1:stats.get(k).count)).join('|');
    if(setup.cache.has(key))return setup.cache.get(key);
    const cells=new Map(),groups=new Map();let maxError=0,fallbacks=0;
    for(const g of M.atlas.groups){
      const files=g.files.filter(f=>stats.has(f.path.toLowerCase()));if(!files.length)continue;
      const template=setup.templates.get(g.name),targets=files.map(f=>setup.minimum+setup.unit*(equal?1:stats.get(f.path.toLowerCase()).count)),total=targets.reduce((a,b)=>a+b,0),factor=Math.sqrt(total/template.area);
      const domain=template.points.map(p=>[g.x+(p[0]-g.x)*factor,g.y+(p[1]-g.y)*factor]);
      const sites=files.map(f=>{const p=M.atlas.positions.get(f.path.toLowerCase());return {key:f.path.toLowerCase(),x:g.x+(p.x-g.x)*factor,y:g.y+(p.y-g.y)*factor};});
      const result=solve(sites,targets,domain);if(result.method!=='power')fallbacks++;maxError=Math.max(maxError,result.error);
      sites.forEach((site,i)=>{const points=result.polygons[i],[x,y]=centroid(points);cells.set(site.key,{key:site.key,group:g.name,side:g.side,x,y,points,path:polygonPath(points),area:area(points),targetArea:targets[i],count:stats.get(site.key).count});});
      groups.set(g.name,{...g,points:domain,path:polygonPath(domain),area:total,method:result.method,error:result.error});
    }
    const result={cells,groups,minimum:setup.minimum,unit:setup.unit,maxError,fallbacks,key};
    if(setup.cache.size>=30)setup.cache.delete(setup.cache.keys().next().value);setup.cache.set(key,result);return result;
  }
  root.ReviewAreaLayout={area,centroid,clip,solve,prepare,layout};
})(globalThis);
