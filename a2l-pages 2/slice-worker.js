import {createSlicer} from './vendor/engine/index.js';
import {parameters,validateSTL,preview,machineCode} from './slice-core.js?v=color2';
self.onmessage=async({data})=>{
 try{
  const {stl,settings}=data;validateSTL(stl);
  const [profile,program,slicer]=await Promise.all([fetch('./a2l-profile.json').then(r=>r.json()),fetch('./machine-program.json').then(r=>r.json()),createSlicer()]);
  const result=slicer.slice(stl,parameters(profile,settings),{onProgress:(done,total)=>self.postMessage({type:'progress',value:Math.max(5,Math.round(done/total*90))})});
  if(result.error)throw Error(result.error);if(result.warnings?.length)throw Error(result.warnings.join(', '));
  const layers=preview(result.gcode,settings,result.layers),gcode=machineCode(result.gcode,layers,program);
  if(/[{}]|\[[A-Za-z_]/.test(gcode.split('\n').filter(l=>!l.trim().startsWith(';')).join('\n')))throw Error('機器程序仍有未解析參數');
  self.postMessage({type:'done',layers,gcode,stats:result.stats,profile});
 }catch(e){self.postMessage({type:'error',message:e.message||String(e)});}
};
