(function(root){
  'use strict';
  // Deterministic Euclidean Voronoi clipping, calculated once for the complete atlas.
  function clip(poly,nx,ny,c){
    if(!poly.length)return poly;const out=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=nx*a[0]+ny*a[1]-c,db=nx*b[0]+ny*b[1]-c;
      if(da<=1e-8)out.push(a);
      if((da<0&&db>0)||(da>0&&db<0)){
        const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
      }
    }
    return out;
  }
  function polygon(site,seeds,bounds){
    const [x,y,w,h]=bounds;let poly=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
    for(const other of seeds){if(other===site)continue;const dx=other.x-site.x,dy=other.y-site.y;
      if(dx*dx+dy*dy<1e-10)continue;
      poly=clip(poly,dx,dy,(other.x*other.x+other.y*other.y-site.x*site.x-site.y*site.y)/2);
      if(poly.length<3)break;
    }
    return poly;
  }
  const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
  const path=ps=>'M'+ps.map(p=>p.map(v=>v.toFixed(3)).join(',')).join('L')+'Z';
  function build(M){
    const atlas=M.atlas,cells=new Map(),boundaries=new Map(),lanes=[];
    for(const side of ['test','product']){
      const groups=atlas.groups.filter(g=>g.side===side);if(!groups.length)continue;
      const minX=Math.min(...groups.map(g=>g.x-g.radius))-12,maxX=Math.max(...groups.map(g=>g.x+g.radius))+12;
      const minY=65,maxY=atlas.box[3]-20,bounds=[minX,minY,maxX-minX,maxY-minY];
      const files=groups.flatMap(g=>g.files.map(f=>({...atlas.positions.get(f.path.toLowerCase()),key:f.path.toLowerCase(),group:g.name,side})));
      const ocean=[];let index=0;
      for(let x=minX-10;x<=maxX+32;x+=34)for(let y=minY-10;y<=maxY+32;y+=34){
        const p={x:x+(hash(++index)-.5)*12,y:y+(hash(index+997)-.5)*12,ocean:true};
        if(files.every(f=>(f.x-p.x)**2+(f.y-p.y)**2>35**2))ocean.push(p);
      }
      const seeds=[...files,...ocean];
      for(const site of files){
        const points=polygon(site,seeds,bounds);
        cells.set(site.key,{...site,points,path:path(points)});
      }
      lanes.push({side,bounds,sites:files.length,ocean:ocean.length});
    }
    // An edge shared by the same group is interior; all other edges form its coast/border.
    const edgeKey=(a,b)=>{const A=a.map(v=>v.toFixed(4)).join(','),B=b.map(v=>v.toFixed(4)).join(',');return A<B?A+'|'+B:B+'|'+A;};
    for(const cell of cells.values())for(let i=0;i<cell.points.length;i++){
      const a=cell.points[i],b=cell.points[(i+1)%cell.points.length],key=edgeKey(a,b);
      if(!boundaries.has(key))boundaries.set(key,{a,b,owners:[]});boundaries.get(key).owners.push({file:cell.key,group:cell.group});
    }
    for(const [key,e] of boundaries)if(e.owners.length===2&&e.owners[0].group===e.owners[1].group)boundaries.delete(key);
    return {cells,boundaries:[...boundaries.values()],lanes};
  }
  function inside(points,x,y){
    let positive=false,negative=false;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],c=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
      if(c>1e-7)positive=true;if(c<-1e-7)negative=true;
    }
    return points.length>=3&&!(positive&&negative);
  }
  root.ReviewMapTerrain={build,polygon,inside};
})(globalThis);
