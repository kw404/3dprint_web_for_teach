import {archive} from './archive.js';
import {projectArchive,readProject} from './project.js?v=project2';
import {overhangSummary} from './geometry-check.js';
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {STLLoader} from './vendor/STLLoader.js';
const $=id=>document.getElementById(id), loader=new STLLoader();
const saveButton=document.createElement('button');saveButton.id='saveProject';saveButton.textContent='儲存專案 .3mf';saveButton.title='不必先切片；保存模型、方向與設定，日後繼續調整';$('slice').before(saveButton);
$('file').accept='.stl,.3mf';document.querySelector('label[for="file"]').title='開啟 STL 或本網站儲存的 3MF 專案';
document.querySelector('#bedTool small').textContent='選面貼底';$('bedTool').title='點選外側平面或斜面，將該面旋轉朝向列印板';
const warningBox=document.createElement('div');warningBox.id='overhangNotice';warningBox.hidden=true;warningBox.setAttribute('role','status');
warningBox.innerHTML='<strong>可能懸空</strong><p id="overhangText"></p><button id="enableSupport">啟用支撐</button><button id="pickBottom">選一面貼底</button>';
$('viewport').append(warningBox);
// Keep the title visible so a collapsed panel can always be reopened.
function collapsiblePanel(panel,heading,label){
 const button=document.createElement('button');button.className='panel-toggle';button.type='button';
 let collapsed=false;const update=()=>{panel.classList.toggle('panel-collapsed',collapsed);button.textContent=collapsed?'展開':'收合';button.setAttribute('aria-expanded',String(!collapsed));button.setAttribute('aria-label',(collapsed?'展開':'收合')+label);};
 button.onclick=()=>{collapsed=!collapsed;update();};heading.classList.add('panel-heading');heading.append(button);update();
}
collapsiblePanel($('result'),$('result').querySelector('.result-title'),'切片結果');
const warningHeading=document.createElement('div');warningHeading.append(warningBox.querySelector('strong'));warningBox.prepend(warningHeading);
collapsiblePanel(warningBox,warningHeading,'懸空警告');
const faceHint=document.createElement('div');faceHint.id='faceHint';faceHint.hidden=true;faceHint.innerHTML='點選要貼底的外側平面或斜面；黃色面會旋轉成水平朝下。<button id="cancelFace">取消</button>';$('viewport').append(faceHint);
const viewport=$('viewport'), scene=new THREE.Scene();scene.background=new THREE.Color('#535359');
const camera=new THREE.PerspectiveCamera(38,1,.1,3000);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch(e){$('status').textContent='瀏覽器無法啟動 3D 顯示，請使用啟用硬體加速的 Chrome 或 Safari。';throw e;}
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));viewport.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=30;controls.maxDistance=1400;controls.maxPolarAngle=Math.PI/2-.02;
scene.add(new THREE.HemisphereLight(0xffffff,0x697077,1.8));const sun=new THREE.DirectionalLight(0xffffff,1.2);sun.position.set(0,400,300);scene.add(sun);
const stage=new THREE.Group();stage.rotation.x=-Math.PI/2;scene.add(stage);
const bed=new THREE.Mesh(new THREE.BoxGeometry(330,320,2),new THREE.MeshStandardMaterial({color:'#303037',roughness:1}));bed.position.set(165,160,-1.3);stage.add(bed);
let grid=[];for(let x=0;x<=330;x+=10)grid.push(x,0,.01,x,320,.01);for(let y=0;y<=320;y+=10)grid.push(0,y,.01,330,y,.01);
const gridGeometry=new THREE.BufferGeometry();gridGeometry.setAttribute('position',new THREE.Float32BufferAttribute(grid,3));stage.add(new THREE.LineSegments(gridGeometry,new THREE.LineBasicMaterial({color:'#61616c',transparent:true,opacity:.55})));
const outline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,.1),new THREE.Vector3(330,0,.1),new THREE.Vector3(330,320,.1),new THREE.Vector3(0,320,.1)]),new THREE.LineBasicMaterial({color:'#777781'}));stage.add(outline);
const mat=new THREE.MeshLambertMaterial({color:'#728d89',side:THREE.DoubleSide});
let mesh=null, bounds=null, valid=true, ready=false,busy=false,mode='prepare',layers=[],job=null,lastResult=null,playTimer=null,previewLines=null,modelName='',sampleIndex=0;
let selectingFace=false,faceOverlay=null,lastHoverFace=-1,overhang=null;
function status(t){$('status').textContent=t;}
function disposePreview(){if(previewLines){stage.remove(previewLines);previewLines.geometry.dispose();previewLines.material.dispose();previewLines=null;}}
function iso(){camera.up.set(0,1,0);camera.position.set(480,370,230);controls.target.set(165,0,-160);controls.update();}
iso();
const resize=()=>{let w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(viewport);
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();
function lockInputs(value){for(const id of ['layer','infill','walls','support','brim','scale','rx','ry','rz','px','py','file','sample','delete','reset','center','moveTool','rotateTool','scaleTool','bedTool','enableSupport','pickBottom'])$(id).disabled=value;}
function updateButton(){$('slice').disabled=!ready||!mesh||!valid||busy;$('saveProject').disabled=!mesh||!valid||busy;}
function stopPlay(){clearInterval(playTimer);playTimer=null;$('play').textContent='▶ 播放';}
function switchMode(next){if(next==='preview'&&!layers.length)return;mode=next;stopPlay();$('prepare').classList.toggle('active',next==='prepare');$('preview').classList.toggle('active',next==='preview');$('transform').hidden=next!=='prepare';$('layerPanel').hidden=next!=='preview';if(mesh)mesh.visible=next==='prepare';if(next==='preview')drawLayer();else disposePreview();}
let downloadURL=null;
function invalidate(){if(downloadURL){URL.revokeObjectURL(downloadURL);downloadURL=null;}for(const id of ['retrySupport','retryWarnings']){const retry=document.getElementById(id);if(retry)retry.remove();}job=null;$('download').removeAttribute('href');$('download').classList.add('disabled');$('download').setAttribute('aria-disabled','true');layers=[];$('preview').disabled=true;$('result').hidden=true;switchMode('prepare');$('transform').hidden=true;$('task3').classList.remove('done');$('task4').classList.remove('done');updateButton();}
function localGeometry(){mesh.updateMatrix();let g=mesh.geometry.clone();g.applyMatrix4(mesh.matrix);return g;}
function transform(){if(!mesh)return;const panelWasOpen=!$('transform').hidden;const ids=['scale','rx','ry','rz','px','py'];if(ids.some(id=>!Number.isFinite(+$ (id).value)||$(id).value==='')){valid=false;invalidate();return;}
 const s=+$('scale').value/100;if(s<=0||s>20){valid=false;invalidate();status('縮放範圍是 1–2000%。');return;}
 mesh.scale.setScalar(s);mesh.rotation.set(...['rx','ry','rz'].map(id=>THREE.MathUtils.degToRad(+$(id).value)));mesh.position.set(0,0,0);let g=localGeometry();g.computeBoundingBox();let b=g.boundingBox;mesh.position.set(+$('px').value-(b.min.x+b.max.x)/2,+$('py').value-(b.min.y+b.max.y)/2,-b.min.z);g.dispose();g=localGeometry();g.computeBoundingBox();bounds=g.boundingBox.clone();g.dispose();
 const size=bounds.getSize(new THREE.Vector3());$('dimensions').textContent=`${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
 valid=bounds.min.x>=-.001&&bounds.min.y>=-.001&&bounds.max.x<=330.001&&bounds.max.y<=320.001&&bounds.max.z<=324.501;mat.color.set(valid?'#728d89':'#ae7e79');$('boundsWarning').hidden=valid;invalidate();$('transform').hidden=!panelWasOpen;status(valid?'模型已貼齊底板。準備好後，按「切片單盤」。':'模型超出 A2L 範圍，請縮小或置中。');}
function setModel(g,name){if(busy)return;if(mesh){stage.remove(mesh);mesh.geometry.dispose();}if(g.index){const old=g;g=g.toNonIndexed();old.dispose();}g.computeBoundingBox();const b=g.boundingBox;g.translate(-(b.min.x+b.max.x)/2,-(b.min.y+b.max.y)/2,-b.min.z);g.computeVertexNormals();mesh=new THREE.Mesh(g,mat);stage.add(mesh);modelName=name;$('modelName').textContent=name;$('objectCount').textContent='1 個';for(const [id,v] of Object.entries({scale:100,rx:0,ry:0,rz:0,px:165,py:160}))$(id).value=v;transform();$('task1').classList.add('done');$('task2').classList.remove('done');}
function sample(){sampleIndex=(sampleIndex+1)%2;if(sampleIndex===1){setModel(new THREE.BoxGeometry(20,20,20),'練習方塊.stl');}else{const geometries=[new THREE.BoxGeometry(10,20,35),new THREE.BoxGeometry(10,20,35),new THREE.BoxGeometry(50,20,10)];geometries[0].translate(-20,0,17.5);geometries[1].translate(20,0,17.5);geometries[2].translate(0,0,40);const a=[];for(let g of geometries){const n=g.toNonIndexed();a.push(...n.attributes.position.array);g.dispose();n.dispose();}let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));setModel(g,'橋樑支撐練習.stl');}iso();}
sample();$('transform').hidden=true;
async function importFile(file){if(!file||busy)return;try{if(!/\.stl$/i.test(file.name))throw Error('目前支援 STL 模型，請先匯出為 STL。');if(file.size>20_000_000)throw Error('檔案超過 20 MB，請先降低模型精細度。');let data=await file.arrayBuffer();let g=loader.parse(data);if(g.attributes.position.count>900000||g.attributes.position.count<12)throw Error('模型需有 4–300,000 個三角形。');if(!g.attributes.position.array.every(Number.isFinite))throw Error('模型包含無效座標。');setModel(g,file.name);status('已匯入 STL，以毫米解讀。請確認尺寸。');}catch(e){status(e.message);}finally{$('file').value='';}}
$('file').onchange=e=>importFile(e.target.files[0]);viewport.ondragover=e=>{e.preventDefault();};viewport.ondrop=e=>{e.preventDefault();importFile(e.dataTransfer.files[0]);};
$('sample').onclick=sample;$('delete').onclick=()=>{if(busy)return;if(mesh){stage.remove(mesh);mesh.geometry.dispose();mesh=null;}$('modelName').textContent='尚未匯入模型';$('objectCount').textContent='0 個';$('dimensions').textContent='—';$('boundsWarning').hidden=true;$('task1').classList.remove('done');invalidate();status('請匯入 STL 或選擇練習模型。');};
for(const id of ['scale','rx','ry','rz','px','py'])$(id).onchange=()=>{transform();$('task2').classList.add('done');};
$('center').onclick=()=>{$('px').value=165;$('py').value=160;transform();$('task2').classList.add('done');};
$('iso').onclick=iso;$('top').onclick=()=>{camera.position.set(165,550,-159.9);controls.target.set(165,0,-160);controls.update();};
$('fit').onclick=()=>{if(!bounds)return;const center=bounds.getCenter(new THREE.Vector3());const size=bounds.getSize(new THREE.Vector3());const distance=Math.max(45,Math.max(size.x,size.y,size.z)*2.4);controls.target.set(center.x,center.z,-center.y);camera.position.copy(controls.target).add(new THREE.Vector3(distance,distance*.8,distance));controls.update();};
for(const id of ['layer','infill','walls','support','brim'])$(id).onchange=()=>{invalidate();status('列印參數已更新，請重新切片。');};
$('reset').onclick=()=>{if(busy)return;$('layer').value=.2;$('infill').value=15;$('walls').value=2;$('support').checked=false;$('brim').checked=false;invalidate();status('已還原標準參數。');};
$('prepare').onclick=()=>switchMode('prepare');$('preview').onclick=()=>switchMode('preview');$('help').onclick=()=>$('guide').showModal();$('closeGuide').onclick=()=>$('guide').close();
const featureColor=kind=>/support/i.test(kind)?'#b6a18e':'#8baba7';
function beadGeometry(){
 const points=[];for(let side=0;side<2;side++)for(let i=0;i<=6;i++){const a=-Math.PI/2+i*Math.PI/6+side*Math.PI;points.push([Math.cos(a)*.24+(side===0?.26:-.26),Math.sin(a)*.5]);}
 const positions=[],indices=[];for(const x of [-.5,.5])for(const [y,z] of points)positions.push(x,y,z);
 const n=points.length;for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,i+n,j,j+n,i+n);}for(let i=1;i<n-1;i++)indices.push(0,i+1,i,n,n+i,n+i+1);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function drawLayer(){
 disposePreview();if(!layers.length)return;
 const n=+$('layerSlider').value-1,layer=layers[n];
 $('layerReadout').textContent=`第 ${n+1} / ${layers.length} 層 · Z ${layer.z.toFixed(2)} mm`;
 const range=$('singleLayer').checked?[layer]:layers.slice(0,n+1);
 const count=range.reduce((s,l)=>s+l.segments.length,0);
 previewLines=new THREE.InstancedMesh(beadGeometry(),new THREE.MeshLambertMaterial({color:0xffffff}),count);
 const matrix=new THREE.Matrix4(),color=new THREE.Color();let index=0;
 for(const l of range)for(const [x,y,x2,y2,kind,width=.4,height=.2,z=l.z,z2=l.z] of l.segments){
  const dx=x2-x,dy=y2-y,length=Math.hypot(dx,dy);if(length<.00001)continue;
  // Extrusion width and layer height are in millimetres, from the actual G-code.
  matrix.set(dx,-dy/length*width,0,(x+x2)/2,dy,dx/length*width,0,(y+y2)/2,z2-z,0,height,(z+z2-height)/2,0,0,0,1);
  previewLines.setMatrixAt(index,matrix);previewLines.setColorAt(index,color.set(featureColor(kind)));index++;
 }
 previewLines.count=index;previewLines.instanceMatrix.needsUpdate=true;if(previewLines.instanceColor)previewLines.instanceColor.needsUpdate=true;
 stage.add(previewLines);$('task4').classList.add('done');
}
$('layerSlider').oninput=drawLayer;$('singleLayer').onchange=drawLayer;$('play').onclick=()=>{if(playTimer){stopPlay();return;}if(+$('layerSlider').value>=layers.length)$('layerSlider').value=1;$('play').textContent='Ⅱ 暫停';playTimer=setInterval(()=>{let v=+$('layerSlider').value;if(v>=layers.length){stopPlay();return;}$('layerSlider').value=v+1;drawLayer();},130);};
function binarySTL(transformed=true){const g=transformed?localGeometry():mesh.geometry.clone(),a=g.attributes.position.array,n=a.length/9,buf=new ArrayBuffer(84+n*50),v=new DataView(buf);v.setUint32(80,n,true);for(let i=0;i<n;i++)for(let j=0;j<9;j++)v.setFloat32(84+i*50+12+j*4,a[i*9+j],true);g.dispose();return buf;}
function b64(buffer){const bytes=new Uint8Array(buffer);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
function thumbnail(){renderer.render(scene,camera);const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');ctx.fillStyle='#535359';ctx.fillRect(0,0,512,512);const aspect=renderer.domElement.width/renderer.domElement.height;ctx.drawImage(renderer.domElement,0,(512-512/aspect)/2,512,512/aspect);return c.toDataURL('image/png').split(',')[1];}
function timeLabel(seconds){const minutes=Math.round(seconds/60);return minutes>=60?`${Math.floor(minutes/60)} 時 ${minutes%60} 分`:`${minutes} 分`;}
$('slice').onclick=async()=>{
 if(busy||!mesh||!valid)return;
 const settings={layer:+$('layer').value,infill:+$('infill').value,walls:+$('walls').value,support:$('support').checked,brim:$('brim').checked};
 if(!Number.isInteger(settings.infill)||settings.infill<0||settings.infill>80||!Number.isInteger(settings.walls)||settings.walls<2||settings.walls>6){status('填充率需為 0–80；牆壁圈數需為 2–6。');return;}
 invalidate();busy=true;lockInputs(true);updateButton();$('progress').hidden=false;$('progress').value=1;status('在你的瀏覽器內切片，模型不會上傳…');
 const stl=binarySTL(),png=thumbnail(),worker=new Worker(new URL('./slice-worker.js?v=color2',import.meta.url),{type:'module'});
 $('slice').textContent='瀏覽器切片中…';$('cancel').hidden=false;let timer;
 try{
  const result=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('切片超過 3 分鐘，請減少模型細節。')),180000);
   $('cancel').onclick=()=>reject(Error('已取消切片'));
   worker.onerror=e=>reject(Error(e.message||'瀏覽器引擎載入失敗'));
   worker.onmessage=({data})=>{if(data.type==='progress'){$('progress').value=data.value;status('瀏覽器正在計算列印路徑… '+data.value+'%');}else if(data.type==='error')reject(Error(data.message));else if(data.type==='done')resolve(data);};
   worker.postMessage({stl:stl.slice(0),settings});
  });
  layers=result.layers;const packed=archive({...result,settings,stl,png,name:modelName});
  downloadURL=URL.createObjectURL(new Blob([packed.bytes],{type:'application/octet-stream'}));
  $('download').href=downloadURL;$('download').download=modelName.replace(/\.stl$/i,'')+'_A2L_browser.gcode.3mf';$('download').classList.remove('disabled');$('download').setAttribute('aria-disabled','false');
  $('preview').disabled=false;$('layerSlider').max=layers.length;$('layerSlider').value=layers.length;$('result').hidden=false;
  $('time').textContent=timeLabel(result.stats.time_estimate);$('weight').textContent=packed.grams.toFixed(1)+' g';
  $('comparison').textContent='瀏覽器獨立切片完成；估時未含完整機器準備程序。';
  $('engineWarning').textContent=(overhang?.hasOverhang?(settings.support?'模型有懸空面，已啟用支撐；請逐層確認是否覆蓋所有懸空區域。':'注意：模型有可能懸空的面，目前未啟用支撐。請調整方向或啟用支撐後重新切片。')+' ':'')+'A2L 輸出測試版：尚未經實機列印驗證。';
  $('task3').classList.add('done');switchMode('preview');$('fit').click();status('切片完成：'+layers.length+' 層，模型未離開這台電腦。');
 }catch(e){status('切片未完成：'+e.message);layers=[];$('preview').disabled=true;}
 finally{clearTimeout(timer);worker.terminate();busy=false;lockInputs(false);$('cancel').hidden=true;$('progress').hidden=true;$('slice').textContent='切片單盤';updateButton();}
};
ready=typeof WebAssembly==='object'&&typeof Worker==='function';$('engineStatus').textContent=ready?'瀏覽器切片 · 無需伺服器':'此瀏覽器不支援 WebAssembly';updateButton();

for(const button of document.querySelectorAll('[data-panel]'))button.onclick=()=>{for(const b of document.querySelectorAll('[data-panel]')){b.classList.toggle('selected',b===button);b.setAttribute('aria-selected',String(b===button));$('panel-'+b.dataset.panel).hidden=b!==button;}};
for(const [id,focus] of [['moveTool','px'],['rotateTool','rx'],['scaleTool','scale']])$(id).onclick=()=>{if(mode!=='prepare'||!mesh)return;$('transform').hidden=false;$(focus).focus();};
$('closeTransform').onclick=()=>{$('transform').hidden=true;};
for(const id of ['layer','infill','walls','support','brim'])$(id).addEventListener('change',()=>{$('presetName').textContent='0.20mm · A2L 瀏覽器版 • 已修改';});
$('reset').addEventListener('click',()=>{$('presetName').textContent='0.20mm · A2L 瀏覽器版';});

for(const id of ["scale","rx","ry","rz","px","py"])$(id).oninput=$(id).onchange;
for(const id of ["infill","walls"])$(id).oninput=()=>{invalidate();$("presetName").textContent="0.20mm · A2L 瀏覽器版 • 已修改";status("列印參數已更新，請重新切片。");};

function updateOverhang(){
 if(!mesh){overhang=null;warningBox.hidden=true;return;}
 const g=localGeometry();overhang=overhangSummary(g.attributes.position.array);g.dispose();
 warningBox.hidden=!overhang.hasOverhang;
 if(overhang.hasOverhang)$('overhangText').textContent=`偵測到約 ${overhang.area.toFixed(0)} mm² 朝下且超過 45° 的表面（Z ${overhang.low.toFixed(1)}–${overhang.high.toFixed(1)} mm）。`+($('support').checked?'已啟用支撐，仍需檢查生成結果。':'目前未啟用支撐，請調整方向或啟用支撐。')+' 此為幾何提醒，橋接或下方已有模型的區域也可能被標示。';
 $('enableSupport').hidden=$('support').checked;
}
const originalTransform=transform;transform=function(){originalTransform();updateOverhang();};
for(const id of ['support','layer'])$(id).addEventListener('change',updateOverhang);
const originalDelete=$('delete').onclick;$('delete').onclick=()=>{cancelFace();originalDelete();updateOverhang();};
$('enableSupport').onclick=()=>{if(busy)return;$('support').checked=true;$('support').dispatchEvent(new Event('change'));status('已啟用支撐，請重新切片並檢查懸空位置。');};
$('reset').addEventListener('click',updateOverhang);
function clearFaceOverlay(){if(faceOverlay){stage.remove(faceOverlay);faceOverlay.geometry.dispose();faceOverlay.material.dispose();faceOverlay=null;}lastHoverFace=-1;}
function cancelFace(){selectingFace=false;clearFaceOverlay();$('bedTool').classList.remove('selected');faceHint.hidden=true;renderer.domElement.style.cursor='';}
function startFace(){if(!mesh||busy)return;if(selectingFace){cancelFace();return;}switchMode('prepare');$('transform').hidden=true;selectingFace=true;faceHint.hidden=false;$('bedTool').classList.add('selected');renderer.domElement.style.cursor='crosshair';status('點選要朝向底板的模型表面；Esc 可取消。');}
$('bedTool').onclick=startFace;$('pickBottom').onclick=startFace;$('cancelFace').onclick=cancelFace;
window.addEventListener('keydown',e=>{if(e.key==='Escape')cancelFace();});
const raycaster=new THREE.Raycaster();
function hitFace(event){const r=renderer.domElement.getBoundingClientRect();scene.updateMatrixWorld(true);raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);return raycaster.intersectObject(mesh,false)[0];}
function highlightFace(hit){
 if(!hit){clearFaceOverlay();return;}if(hit.faceIndex===lastHoverFace)return;clearFaceOverlay();lastHoverFace=hit.faceIndex;
 const pos=mesh.geometry.attributes.position,normal=hit.face.normal.clone(),anchor=new THREE.Vector3().fromBufferAttribute(pos,hit.face.a),picked=[];
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3(),u=new THREE.Vector3();
 for(let i=0;i<pos.count;i+=3){a.fromBufferAttribute(pos,i);b.fromBufferAttribute(pos,i+1);c.fromBufferAttribute(pos,i+2);n.subVectors(b,a).cross(u.subVectors(c,a)).normalize();if(n.dot(normal)>.9999&&Math.abs(u.subVectors(a,anchor).dot(normal))<.01)picked.push(...a,...b,...c);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(picked,3));faceOverlay=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:'#d3b878',transparent:true,opacity:.7,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));faceOverlay.matrixAutoUpdate=false;faceOverlay.matrix.copy(mesh.matrix);stage.add(faceOverlay);
}
let pointerStart=null;
renderer.domElement.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY];});
renderer.domElement.addEventListener('pointermove',e=>{if(selectingFace&&mesh&&!busy)highlightFace(hitFace(e));});
renderer.domElement.addEventListener('pointerup',e=>{
 if(!selectingFace||!mesh||busy||!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
 const hit=hitFace(e);if(!hit)return;
 mesh.updateMatrix();const normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrix)).normalize();
 const rotation=new THREE.Quaternion().setFromUnitVectors(normal,new THREE.Vector3(0,0,-1)).multiply(mesh.quaternion);
 const angles=new THREE.Euler().setFromQuaternion(rotation,'XYZ');
 ['rx','ry','rz'].forEach((id,i)=>$(id).value=THREE.MathUtils.radToDeg([angles.x,angles.y,angles.z][i]).toFixed(5));
 cancelFace();transform();$('task2').classList.add('done');status('已將選取面轉向並貼齊底板；原切片已清除，請重新切片。');
});
const originalSetModel=setModel;setModel=function(g,name){cancelFace();originalSetModel(g,name);};
const originalSlice=$('slice').onclick;$('slice').onclick=()=>{cancelFace();updateOverhang();return originalSlice();};
const originalImport=importFile;
importFile=async function(file){
 if(!file||busy)return;if(!/\.3mf$/i.test(file.name))return originalImport(file);
 try{if(file.size>30_000_000)throw Error('專案超過 30 MB');const p=readProject(await file.arrayBuffer()),g=loader.parse(p.stl);if(!g.attributes.position.array.every(Number.isFinite))throw Error('模型座標無效');setModel(g,p.name);
  for(const [id,v] of Object.entries(p.transform))if(['scale','rx','ry','rz','px','py'].includes(id))$(id).value=v;
  for(const id of ['layer','infill','walls'])$(id).value=p.settings[id];for(const id of ['support','brim'])$(id).checked=p.settings[id];transform();$('presetName').textContent='已還原 3MF 專案設定';status('專案已開啟：模型、位置、方向及列印設定已還原，可以繼續調整。');
 }catch(e){status(e.message);}finally{$('file').value='';}
};
$('saveProject').onclick=async()=>{
 if(!mesh||busy||!valid)return;cancelFace();busy=true;lockInputs(true);updateButton();
 try{
  const response=await fetch('./a2l-profile.json');if(!response.ok)throw Error('A2L 設定檔載入失敗');const profile=await response.json();
  const settings={layer:+$('layer').value,infill:+$('infill').value,walls:+$('walls').value,support:$('support').checked,brim:$('brim').checked};
  if(![.12,.16,.2,.24,.28].includes(settings.layer)||!Number.isInteger(settings.infill)||settings.infill<0||settings.infill>80||!Number.isInteger(settings.walls)||settings.walls<2||settings.walls>6)throw Error('請先修正層高、填充率或牆壁圈數。');
  const transform=Object.fromEntries(['scale','rx','ry','rz','px','py'].map(id=>[id,+$(id).value]));mesh.updateMatrix();const m=mesh.matrix.elements,matrix=[m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10],m[12],m[13],m[14]];
  const wasVisible=mesh.visible,previewVisible=previewLines?.visible;mesh.visible=true;if(previewLines)previewLines.visible=false;let png;try{png=thumbnail();}finally{mesh.visible=wasVisible;if(previewLines)previewLines.visible=previewVisible;}
  const bytes=projectArchive({profile,settings,stl:binarySTL(false),png,name:modelName,transform,matrix}),url=URL.createObjectURL(new Blob([bytes],{type:'model/3mf'}));
  const a=document.createElement('a');a.href=url;a.download=modelName.replace(/\.(stl|3mf)$/i,'')+'_專案.3mf';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('已儲存可編輯 3MF 專案：可在本網站重新開啟，或在 Bambu Studio 選擇「開啟專案」。');
 }catch(e){status('專案未儲存：'+e.message);}finally{busy=false;lockInputs(false);updateButton();}
};
updateOverhang();
