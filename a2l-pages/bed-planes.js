import {Vector3} from './vendor/three.module.js';
import {ConvexHull} from './vendor/ConvexHull.js';
// Hull facets include virtual planes spanning separate contact edges.
export function bedPlanes(positions){
 const unique=new Map();for(let i=0;i<positions.length;i+=3){const k=`${positions[i]},${positions[i+1]},${positions[i+2]}`;if(!unique.has(k))unique.set(k,new Vector3(positions[i],positions[i+1],positions[i+2]));}
 const hull=new ConvexHull().setFromPoints([...unique.values()]),groups=[];
 for(const f of hull.faces){const n=f.normal,d=f.constant;let group=groups.find(g=>g.normal.dot(n)>1-1e-7&&Math.abs(g.constant-d)<.01);
  if(!group){group={normal:n.clone(),constant:d,area:0,positions:[]};groups.push(group);}
  let e=f.edge;const points=[];do{points.push(e.head().point);e=e.next;}while(e!==f.edge);
  for(let i=1;i<points.length-1;i++){const a=points[0],b=points[i],c=points[i+1];group.positions.push(...a,...b,...c);group.area+=new Vector3().subVectors(b,a).cross(new Vector3().subVectors(c,a)).length()/2;}
 }
 groups.sort((a,b)=>b.area-a.area);return groups.filter(g=>g.area>Math.max(1,groups[0].area*.01)).slice(0,16);
}
