// AGPL-3.0-or-later. Browser-only A2L adapter. No network upload or native process.
export function parameters(p,s){
 const number=(k,f)=>{let v=p[k];if(Array.isArray(v))v=v[0];let n=Number(v);return Number.isFinite(n)?n:f;};
 const out={auto_center:false,bed_width:330,bed_depth:320,bed_height:325,printable_height:325,layer_height:s.layer,first_layer_height:.2,wall_loops:s.walls,infill_density:s.infill/100,enable_support:s.support,brim_width:s.brim?5:0,skirt_loops:0,enable_arc_fitting:false,wall_generator:'classic',sparse_infill_pattern:'grid',support_style:'grid',nozzle_diameter:.4,bed_temp:55,first_layer_bed_temp:55,nozzle_temp:220,first_layer_nozzle_temp:220,filament_diameter:1.75,flow_ratio:.98,filament_density:[1.24],filament_type:['PLA'],filament_settings_id:['Generic PLA @BBL A2L'],enable_pressure_advance:false};
 const map={line_width:'line_width',initial_layer_line_width:'initial_layer_line_width',outer_wall_line_width:'outer_wall_line_width',inner_wall_line_width:'inner_wall_line_width',top_surface_line_width:'top_surface_line_width',top_shell_layers:'top_shell_layers',bottom_shell_layers:'bottom_shell_layers',retract_length:'retraction_length',retract_speed:'retraction_speed',z_hop:'z_hop',fan_speed:'fan_max_speed',close_fan_the_first_x_layers:'close_fan_the_first_x_layers',slow_down_layer_time:'slow_down_layer_time',print_speed:'outer_wall_speed',first_layer_speed:'initial_layer_speed',travel_speed:'travel_speed',bridge_speed:'bridge_speed',machine_accel_print:'default_acceleration',machine_accel_travel:'travel_acceleration'};
 for(const [k,v] of Object.entries(map)){const n=number(v,NaN);if(Number.isFinite(n))out[k]=n;}
 // Limit volumetric flow conservatively at all offered layer heights.
 out.print_speed=Math.min(out.print_speed||60,12/(Math.max(out.line_width,.45)*Math.max(s.layer,.2)));
 out.inner_wall_speed=out.print_speed;out.sparse_infill_speed=out.print_speed;out.top_surface_speed=Math.min(out.print_speed,60);out.first_layer_speed=Math.min(out.first_layer_speed||50,50);
 return out;
}
export function validateSTL(buffer){
 const v=new DataView(buffer);if(buffer.byteLength<84)throw Error('STL 不完整');const n=v.getUint32(80,true);if(n<4||n>300000||buffer.byteLength!==84+n*50)throw Error('STL 格式或大小無效');
 let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<n;i++)for(let j=0;j<3;j++)for(let a=0;a<3;a++){const off=84+i*50+12+j*12+a*4,x=v.getFloat32(off,true);if(!Number.isFinite(x))throw Error('模型座標無效');lo[a]=Math.min(lo[a],x);hi[a]=Math.max(hi[a],x);}
 if(lo.some((x,a)=>x<-.001||hi[a]>[330,320,324.5][a]+.001)||Math.abs(lo[2])>.01)throw Error('模型超出列印範圍，或未貼齊底板');
 // Kernel accepts XY about bed centre, while the UI stores physical bed coordinates.
 for(let i=0;i<n;i++)for(let j=0;j<3;j++)for(let a=0;a<2;a++){const off=84+i*50+12+j*12+a*4;v.setFloat32(off,v.getFloat32(off,true)-[165,160][a],true);}
 return {lo,hi,triangles:n};
}
export function preview(gcode,settings,sourceLayers=[]){
 // Match numeric role 5 (support) to emitted G-code with rounding tolerance.
 // Never infer extrusion roles from prose such as "unsupported bottom".
 const supports=new Map(),bucket=(x,y,z)=>[Math.floor(x/.02),Math.floor(y/.02),Math.round(z*100)].join(',');
 for(const l of sourceLayers){const p=l.paths;for(let k=0;k<p.length;k+=8)if((p[k+3]&15)===5){const segment=[p[k]+165,p[k+1]+160,p[k+4]+165,p[k+5]+160,p[k+6]],key=bucket(segment[2],segment[3],segment[4]);if(!supports.has(key))supports.set(key,[]);supports.get(key).push(segment);}}
 const isSupport=(x,y,x2,y2,z)=>{for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const candidates=supports.get([Math.floor(x2/.02)+dx,Math.floor(y2/.02)+dy,Math.round(z*100)].join(','))||[];if(candidates.some(s=>Math.abs(s[0]-x)<.002&&Math.abs(s[1]-y)<.002&&Math.abs(s[2]-x2)<.002&&Math.abs(s[3]-y2)<.002&&Math.abs(s[4]-z)<.002))return true;}return false;};

 let layers=[],layer=null,pos={X:0,Y:0,Z:0,E:0},relE=true,relXYZ=false,width=.42;
 for(const raw of gcode.split('\n')){
  const layerMatch=raw.match(/^; LAYER (\d+) Z([\d.]+)/);
  if(layerMatch){layer={z:+layerMatch[2],segments:[]};layers.push(layer);}
  const line=raw.split(';')[0].trim(),cmd=line.split(/\s+/)[0];if(cmd==='M83')relE=true;if(cmd==='M82')relE=false;if(cmd==='G90')relXYZ=false;if(cmd==='G91')relXYZ=true;
  if(!['G0','G1','G92'].includes(cmd))continue;
  const args=Object.fromEntries([...line.matchAll(/([XYZE])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g)].map(m=>[m[1],+m[2]]));
  if(cmd==='G92'){Object.assign(pos,args);continue;}const next={...pos};for(const [k,v] of Object.entries(args))next[k]=v+((k==='E'?relE:relXYZ)?pos[k]:0);
  const length=Math.hypot(next.X-pos.X,next.Y-pos.Y),de=next.E-pos.E,height=layers.length===1?.2:settings.layer;
  if(layer&&de>1e-7&&length>1e-5){
   // Recover bead cross-section from actual deposited volume: h*(w-h)+pi*h²/4.
   width=de*Math.PI*1.75**2/4/(length*.98*height)+height*(1-Math.PI/4);
   if(!Number.isFinite(width)||width<=0||width>3)throw Error('擠出線寬超出可驗證範圍');
   if([pos.X,next.X].some(x=>x<0||x>330)||[pos.Y,next.Y].some(y=>y<0||y>320)||next.Z>325)throw Error('擠出路徑超出 A2L 列印板');
   layer.segments.push([pos.X,pos.Y,next.X,next.Y,isSupport(pos.X,pos.Y,next.X,next.Y,next.Z)?'Support':'Model',width,height,pos.Z,next.Z]);
  }pos=next;
 }
 if(!layers.length||layers.some(l=>!l.segments.length))throw Error('切片含空層，無法匯出');return layers;
}
export function machineCode(raw,layers,program){
 const first=layers[0].segments;const xs=first.flatMap(s=>[s[0]-s[5]/2,s[2]+s[5]/2]),ys=first.flatMap(s=>[s[1]-s[5]/2,s[3]+s[5]/2]);
 const minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs),maxY=Math.max(...ys),endZ=layers.at(-1).z+.4;
 const values={MIN_X:minX,MIN_Y:minY,SIZE_X:maxX-minX,SIZE_Y:maxY-minY,END_Z:endZ};
 const render=t=>t.replace(/\{\{([A-Z_]+)\}\}/g,(_,k)=>{if(!Number.isFinite(values[k]))throw Error('啟動程序參數缺失');return values[k].toFixed(3);});
 // The WASM engine's generic heater/footer code is not the A2L machine procedure.
 let body=raw.slice(raw.indexOf('; LAYER 0 '));const footer=body.indexOf('; end');if(footer>=0)body=body.slice(0,footer);
 return '; A2L Classroom browser edition / three-slicer 0.3.5\n; A2L machine integration: experimental, not physically validated\n'+render(program.start)+'\nG21\nG90\nM83\nG92 E0\n'+body+'\n'+render(program.end);
}
