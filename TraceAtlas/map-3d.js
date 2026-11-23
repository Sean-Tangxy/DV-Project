(function(root){
  'use strict';
  const slope=.76,vertical=Math.sqrt(1-slope*slope);
  const maxHeight=104;
  const project=([x,y,z])=>[x,y*slope-z*vertical];
  const distance=([,y,z])=>y*vertical+z*slope;
  const rgb=hex=>{
    const digits=hex.slice(1);
    const expanded=digits.length===3?[...digits].map(d=>d+d).join(''):digits;
    return [0,2,4].map(i=>parseInt(expanded.slice(i,i+2),16)/255);
  };
  const background=rgb('#fcfcfe');
  const shade=(color,light,opacity)=>rgb(color).map((value,i)=>
    value*light*opacity+background[i]*(1-opacity));
  const accent=rgb('#4358ae');
  const corners=(x,y,z,r)=>Array.from({length:6},(_,i)=>{
    const a=(i*60-30)*Math.PI/180;
    return [x+r*Math.cos(a),y+r*Math.sin(a),z];
  });

  function columnFaces(file){
    const {key,x,y,segments,stroke,opacity,selected}=file;
    const tint=(color,light)=>{
      const base=shade(color,light,opacity);
      return selected?base.map((value,i)=>value*.66+accent[i]*.34):base;
    };
    const faces=[];
    let bottom=0;
    for(const {top,color} of segments){
      const base=corners(x,y,bottom,10.3),rim=corners(x,y,top,10.3);
      for(let i=0;i<6;i++){
        const j=(i+1)%6, light=[.83,.68,.78,.91,.87,.94][i];
        faces.push({key,points:[base[i],base[j],rim[j],rim[i]],color:tint(color,light),
          front:base[i][0]>base[j][0]+.001});
      }
      bottom=top;
    }
    const color=segments.at(-1).color;
    faces.push({key,points:corners(x,y,bottom,10.3),color:shade(stroke,1,opacity),front:true});
    faces.push({key,points:corners(x,y,bottom+.03,9.25),color:tint(color,1),front:true});
    return faces;
  }

  function scene(faces){
    const vertices=[],hits=[],ranges=new Map();
    let far=1;
    for(const {key,points,color,front} of faces){
      if(!ranges.has(key))ranges.set(key,{start:vertices.length,end:0});
      for(let i=1;i<points.length-1;i++){
        const triangle=[points[0],points[i],points[i+1]];
        for(const point of triangle){
          far=Math.max(far,Math.abs(distance(point))+1);
          vertices.push(...point,...color);
        }
        if(front)hits.push({key,points:triangle.map(p=>[...project(p),distance(p)])});
      }
      ranges.get(key).end=vertices.length;
    }
    return {vertices:new Float32Array(vertices),hits,far,ranges};
  }

  // Resolve overlapping columns using the same orthographic depth as WebGL.
  function pick({hits},x,y){
    let key=null, nearest=-Infinity;
    for(const {key:file,points:[a,b,c]} of hits){
      const dx=x-a[0],dy=y-a[1],bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1];
      const area=bx*cy-by*cx;
      if(Math.abs(area)<1e-7)continue;
      const u=(dx*cy-dy*cx)/area,v=(bx*dy-by*dx)/area;
      if(u<0||v<0||u+v>1)continue;
      const depth=a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
      if(depth>nearest){key=file;nearest=depth;}
    }
    return key;
  }

  function shader(gl,type,source){
    const compiled=gl.createShader(type);
    gl.shaderSource(compiled,source);
    gl.compileShader(compiled);
    if(!gl.getShaderParameter(compiled,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(compiled));
    return compiled;
  }

  function create(host){
    const canvas=document.createElement('canvas');
    canvas.className='map-3d-canvas';
    canvas.setAttribute('aria-hidden','true');
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true});
    if(!gl)return null;
    const program=gl.createProgram();
    gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,`
      attribute vec3 point;
      attribute vec3 color;
      uniform vec4 view;
      uniform vec3 camera;
      varying vec3 tint;
      void main(){
        vec2 projected=vec2(point.x,point.y*camera.x-point.z*camera.y);
        vec2 screen=(projected-view.xy)/view.zw;
        float depth=-(point.y*camera.y+point.z*camera.x)/camera.z;
        gl_Position=vec4(screen.x*2.0-1.0,1.0-screen.y*2.0,depth,1.0);
        tint=color;
      }`));
    gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,`
      precision mediump float;
      varying vec3 tint;
      void main(){gl_FragColor=vec4(tint,1.0);}`));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    const buffer=gl.createBuffer();
    const point=gl.getAttribLocation(program,'point'),color=gl.getAttribLocation(program,'color');
    const view=gl.getUniformLocation(program,'view'),camera=gl.getUniformLocation(program,'camera');
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(point);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(point,3,gl.FLOAT,false,24,0);
    gl.vertexAttribPointer(color,3,gl.FLOAT,false,24,12);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0,0,0,0);
    let data,box;
    function draw(){
      if(!canvas.isConnected||!data||!box||gl.isContextLost())return;
      const {width,height}=canvas.getBoundingClientRect(),ratio=globalThis.devicePixelRatio||1;
      if(width<1||height<1)return;
      const pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);
      if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
      if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
      const scale=Math.min(pixelWidth/box[2],pixelHeight/box[3]);
      const w=pixelWidth/scale,h=pixelHeight/scale;
      gl.viewport(0,0,pixelWidth,pixelHeight);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniform4f(view,box[0]-(w-box[2])/2,box[1]-(h-box[3])/2,w,h);
      gl.uniform3f(camera,slope,vertical,data.far);
      gl.drawArrays(gl.TRIANGLES,0,data.vertices.length/6);
    }
    if(typeof ResizeObserver==='function')new ResizeObserver(draw).observe(host);
    canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      host.dispatchEvent(new Event('map3dcontextlost'));
    });
    return {
      canvas,
      set(next,fit){
        data=next;
        gl.bufferData(gl.ARRAY_BUFFER,data.vertices,gl.STATIC_DRAW);
        this.view(fit);
      },
      hover(previous,next){
        const restore=data.ranges.get(previous);
        if(restore)gl.bufferSubData(gl.ARRAY_BUFFER,restore.start*4,data.vertices.subarray(restore.start,restore.end));
        const range=data.ranges.get(next);
        if(range){
          const tinted=data.vertices.slice(range.start,range.end);
          for(let i=0;i<tinted.length;i+=6){
            for(let j=0;j<3;j++)tinted[i+3+j]=tinted[i+3+j]*.77+accent[j]*.23;
          }
          gl.bufferSubData(gl.ARRAY_BUFFER,range.start*4,tinted);
        }
        draw();
      },
      view(fit){box=fit;draw();}
    };
  }

  root.Map3D={slope,vertical,maxHeight,project,columnFaces,scene,pick,create};
})(globalThis);
