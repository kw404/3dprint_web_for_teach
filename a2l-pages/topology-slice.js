// Cut on shared mesh edges, rather than joining rounded XY endpoint buckets.
// A broken chain must never be silently closed across an empty cavity.
export function topologySlice(slicer,stl,params,options={}){
 const m=slicer.module;
 try{
  m.contour_phase_mode(3);const captured=slicer.slice(stl,params);
  if(captured.error)throw Error(captured.error);
  const mesh=m.contour_mesh(),tris=mesh.tris.slice(),planes=mesh.planes.slice();
  if(!planes.length)throw Error('模型沒有可切片的層');
  const vertexMap=new Map(),vertices=[],indices=new Uint32Array(tris.length/3);
  for(let i=0;i<tris.length;i+=3){const key=`${tris[i]},${tris[i+1]},${tris[i+2]}`;let id=vertexMap.get(key);if(id===undefined){id=vertices.length;vertexMap.set(key,id);vertices.push([tris[i],tris[i+1],tris[i+2]]);}indices[i/3]=id;}
  const all=[];let count=0;
  for(let li=0;li<planes.length;li++){
   const z=planes[li],segments=[],nodes=new Map();
   for(let ti=0;ti<indices.length;ti+=3){
    const ids=[indices[ti],indices[ti+1],indices[ti+2]],v=ids.map(i=>vertices[i]);
    if(z<Math.min(v[0][2],v[1][2],v[2][2])||z>=Math.max(v[0][2],v[1][2],v[2][2]))continue;
    const cuts=[];
    for(let j=0;j<3;j++){const a=v[j],b=v[(j+1)%3],ia=ids[j],ib=ids[(j+1)%3];if((a[2]<z&&b[2]>=z)||(b[2]<z&&a[2]>=z)){
     const t=(z-a[2])/(b[2]-a[2]);cuts.push({key:t===0?`v${ia}`:t===1?`v${ib}`:`e${Math.min(ia,ib)}:${Math.max(ia,ib)}`,x:a[0]+t*(b[0]-a[0]),y:a[1]+t*(b[1]-a[1])});
    }}
    if(cuts.length!==2||cuts[0].key===cuts[1].key)continue;
    const u=v[1].map((x,k)=>x-v[0][k]),w=v[2].map((x,k)=>x-v[0][k]),nx=u[1]*w[2]-u[2]*w[1],ny=u[2]*w[0]-u[0]*w[2];
    if((cuts[1].y-cuts[0].y)*nx-(cuts[1].x-cuts[0].x)*ny<0)cuts.reverse();
    const index=segments.length;segments.push(cuts);for(const p of cuts){if(!nodes.has(p.key))nodes.set(p.key,[]);nodes.get(p.key).push(index);}
   }
   const used=new Uint8Array(segments.length),loops=[];
   for(let si=0;si<segments.length;si++)if(!used[si]){
    const first=segments[si][0],loop=[first];let end=segments[si][1];used[si]=1;let steps=0;
    while(end.key!==first.key){loop.push(end);const choices=(nodes.get(end.key)||[]).filter(i=>!used[i]);
     if(choices.length!==1||steps++>segments.length)throw Error(`第 ${li+1} 層輪廓未閉合或有分岔，已停止輸出；請先在 Bambu Studio 檢查網格。`);
     const next=choices.find(i=>segments[i][0].key===end.key)??choices[0];used[next]=1;end=segments[next][segments[next][0].key===end.key?1:0];
    }
    if(loop.length>=3){loops.push(loop);count+=loop.length;}
   }
   all.push(loops);options.onProgress?.(li+1,planes.length*2);
  }
  m.contour_origin_buffer(planes.length).fill(0);const out=m.contour_result_buffer(count);let at=0;
  all.forEach((loops,li)=>{for(const loop of loops){const start=at;loop.forEach((p,i)=>{out[at*4]=Math.round(p.x*1e6);out[at*4+1]=Math.round(p.y*1e6);out[at*4+2]=i===loop.length-1?start:at+1;out[at*4+3]=li;at++;});}});
  const assembled=m.contour_assemble();if(assembled.unavailable||assembled.fallbackLayers?.length)throw Error('輪廓重建失敗，已停止輸出');
  const result=slicer.slice(stl,params,options);
  // A sub-nozzle tip can yield a final planned layer with no emitted paths.
  // Remove only an empty suffix, never an empty layer inside the model.
  let trimmed=0;while(result.layers?.length&&result.layers.at(-1).paths.length===0){result.layers.pop();trimmed++;}
  if(trimmed){const stop=result.gcode.indexOf(`; LAYER ${result.layers.length} `),footer=result.gcode.indexOf('; end',stop);
   if(stop>=0)result.gcode=result.gcode.slice(0,stop)+(footer>=0?result.gcode.slice(footer):'');
   result.stats.layers=result.layers.length;result.stats.model_layers=Math.max(0,result.stats.model_layers-trimmed);result.stats.empty_tail_layers_removed=trimmed;
  }
  return result;
 }finally{m.contour_phase_mode(0);}
}
