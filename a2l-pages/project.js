import {archive} from './archive.js';
import {zipSync,unzipSync,strToU8,strFromU8} from './vendor/fflate.js';

export function projectArchive({profile,settings,stl,png,name,transform,matrix}) {
  // Reuse model/config packaging, then remove every sliced-output entry.
  const files=unzipSync(archive({gcode:'',stats:{filament_mm:0,time_estimate:0,layers:0},profile,settings,stl,png,name}).bytes);
  for(const key of Object.keys(files))if(/\.gcode(?:\.md5)?$/.test(key)||key==='Metadata/slice_info.config'||key==='Metadata/classroom-verification.json')delete files[key];
  let model=strFromU8(files['3D/3dmodel.model']);
  // Studio recognizes its project-settings dialect from this compatibility tag.
  model=model.replace('<model unit="millimeter"','<model xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" unit="millimeter"')
    .replace('<metadata name="Application">A2L Classroom browser edition</metadata>','<metadata name="Application">BambuStudio-02.08.02.61</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><metadata name="Description">Created by A2L Classroom; Bambu Studio compatible editable project</metadata>')
    .replace('<item objectid="1"/>',`<item objectid="1" transform="${matrix.map(v=>Number(v.toFixed(9))).join(' ')}" printable="1"/>`);
  files['3D/3dmodel.model']=strToU8(model);
  const config=JSON.parse(strFromU8(files['Metadata/project_settings.config']));
  config.filament_ids=['GFL99'];config.filament_colour=['#728D89'];
  files['Metadata/project_settings.config']=strToU8(JSON.stringify(config));
  files['Metadata/model_settings.config']=strToU8(strFromU8(files['Metadata/model_settings.config']).replace('<metadata key="gcode_file" value="Metadata/plate_1.gcode"/>',''));
  files['Metadata/classroom-project.json']=strToU8(JSON.stringify({format:'a2l-classroom-project',version:1,name,settings,transform}));
  files['3D/classroom-source.stl']=new Uint8Array(stl);
  // CLI and GUI can access the same thumbnail slots without generating them.
  for(const name of ['plate_no_light_1','top_1','pick_1'])files[`Metadata/${name}.png`]=files['Metadata/plate_1.png'];
  let metadata=strFromU8(files['Metadata/model_settings.config']);
  metadata=metadata.replace('<model_instance>','<metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/><metadata key="top_file" value="Metadata/top_1.png"/><metadata key="pick_file" value="Metadata/pick_1.png"/><model_instance>');
  files['Metadata/model_settings.config']=strToU8(metadata);
  return zipSync(files,{level:6});
}

export function readProject(bytes){
  const files=unzipSync(new Uint8Array(bytes),{filter:f=>['Metadata/classroom-project.json','3D/classroom-source.stl'].includes(f.name)&&f.originalSize<=20_000_000});
  if(!files['Metadata/classroom-project.json']||!files['3D/classroom-source.stl'])throw Error('此網頁目前只能續編由「儲存專案」產生的 3MF；其他 3MF 請在 Bambu Studio 開啟。');
  const p=JSON.parse(strFromU8(files['Metadata/classroom-project.json'])),s=p.settings,t=p.transform;
  if(p.format!=='a2l-classroom-project'||p.version!==1||!s||!t)throw Error('專案格式無效');
  if(![.12,.16,.2,.24,.28].includes(s.layer)||!Number.isInteger(s.infill)||s.infill<0||s.infill>80||!Number.isInteger(s.walls)||s.walls<2||s.walls>6||typeof s.support!=='boolean'||typeof s.brim!=='boolean')throw Error('專案列印參數無效');
  if(['scale','rx','ry','rz','px','py'].some(k=>!Number.isFinite(t[k]))||t.scale<=0||t.scale>2000)throw Error('專案位置或旋轉參數無效');
  const stl=files['3D/classroom-source.stl'],v=new DataView(stl.buffer,stl.byteOffset,stl.byteLength);
  if(stl.byteLength<84||v.getUint32(80,true)<4||v.getUint32(80,true)>300000||stl.byteLength!==84+v.getUint32(80,true)*50)throw Error('專案模型不完整');
  return {...p,name:typeof p.name==='string'?p.name:'模型.stl',stl:stl.buffer.slice(stl.byteOffset,stl.byteOffset+stl.byteLength)};
}
