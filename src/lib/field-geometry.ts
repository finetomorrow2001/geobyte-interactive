import type { Polygon, MultiPolygon, Position } from 'geojson';
export type FieldGeometry = Polygon | MultiPolygon;
export type Bounds = [number, number, number, number];
export type FieldPoint = [number, number];
const eps = 1e-12;
const cross = (a: Position,b: Position,c: Position) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function onSegment(p: Position,a: Position,b: Position) {
 return Math.abs(cross(a,b,p))<eps && p[0]>=Math.min(a[0],b[0])-eps && p[0]<=Math.max(a[0],b[0])+eps && p[1]>=Math.min(a[1],b[1])-eps && p[1]<=Math.max(a[1],b[1])+eps;
}
export function inRing(p: Position,ring: Position[]): boolean {
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
  const a=ring[i],b=ring[j];if(onSegment(p,a,b))return true;
  if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
export const polygons = (g: FieldGeometry) => g.type==='Polygon' ? [g.coordinates] : g.coordinates;
export const inField = (p: Position,g: FieldGeometry) => polygons(g).some(r=>inRing(p,r[0])&&!r.slice(1).some(h=>inRing(p,h)));
export function boundsOf(g: FieldGeometry): Bounds {
 const points=polygons(g).flat(2);
 return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}
function intersects(a: Position,b: Position,c: Position,d: Position) {
 return (cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0) || onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b);
}
const ringsIntersect = (a: Position[],b: Position[]) => a.slice(1).some((p,i)=>b.slice(1).some((q,j)=>intersects(a[i],p,b[j],q)));
export function parseField(text: string): FieldGeometry {
 if(text.length>150000)throw Error('geometry');
 let raw=JSON.parse(text);
 if(raw.type==='FeatureCollection') { if(raw.features?.length!==1)throw Error('geometry');raw=raw.features[0]; }
 if(raw.type==='Feature')raw=raw.geometry;
 if(!raw || !['Polygon','MultiPolygon'].includes(raw.type) || !Array.isArray(raw.coordinates))throw Error('geometry');
 // Strip arbitrary properties / legacy CRS; only explicit WGS84 coordinates are accepted.
 const g=JSON.parse(JSON.stringify({type:raw.type,coordinates:raw.coordinates})) as FieldGeometry;
 let vertices=0;
 const ps=polygons(g);if(!ps.length||ps.length>20)throw Error('geometry');
 for(const rings of ps) {
  if(!Array.isArray(rings)||!rings.length||rings.length>20)throw Error('geometry');
  for(const ring of rings) {
   if(!Array.isArray(ring)||ring.length<4)throw Error('geometry');
   vertices+=ring.length;if(vertices>1000)throw Error('geometry');
   if(ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||p[1]<-80||p[1]>84))throw Error('geometry');
   if(ring[0][0]!==ring.at(-1)![0]||ring[0][1]!==ring.at(-1)![1])throw Error('geometry');
   const area=ring.slice(1).reduce((s,p,i)=>s+ring[i][0]*p[1]-p[0]*ring[i][1],0);
   if(Math.abs(area)<eps)throw Error('geometry');
   for(let i=0;i<ring.length-1;i++)for(let j=i+1;j<ring.length-1;j++) {
    if(j===i+1||(i===0&&j===ring.length-2))continue;
    if(intersects(ring[i],ring[i+1],ring[j],ring[j+1]))throw Error('geometry');
   }
  }
  for(let i=1;i<rings.length;i++) {
   if(!inRing(rings[i][0],rings[0])||ringsIntersect(rings[i],rings[0]))throw Error('geometry');
   for(let j=1;j<i;j++)if(ringsIntersect(rings[i],rings[j])||inRing(rings[i][0],rings[j])||inRing(rings[j][0],rings[i]))throw Error('geometry');
  }
 }
 // Reject overlapping outer shells (avoids double-counted or ambiguous parcels).
 for(let i=0;i<ps.length;i++)for(let j=0;j<i;j++)if(ringsIntersect(ps[i][0],ps[j][0])||inRing(ps[i][0][0],ps[j][0])||inRing(ps[j][0][0],ps[i][0]))throw Error('geometry');
 const b=boundsOf(g),height=(b[3]-b[1])*111.32,width=(b[2]-b[0])*111.32*Math.cos((b[1]+b[3])/2*Math.PI/180);
 if(height<=0||width<=0||height>20||width>20)throw Error('extent');
 return g;
}
export function rectangle(b: Bounds): FieldGeometry {return {type:'Polygon',coordinates:[[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]]]};}
export function fieldGrid(g: FieldGeometry,n=48): FieldPoint[] {
 if(!Number.isInteger(n)||n<4||n>96)throw Error('grid');
 const b=boundsOf(g),out: FieldPoint[]=[];
 const {nx,ny}=spacingMeters(g,n);
 if(nx<1||ny<1)throw Error('too-small');
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++) {
  const p: FieldPoint=[b[0]+(x+.5)/nx*(b[2]-b[0]),b[3]-(y+.5)/ny*(b[3]-b[1])];
  if(inField(p,g))out.push(p);
 }
 if(!out.length)throw Error('empty-grid');return out;
}
export function spacingMeters(g: FieldGeometry,n: number) {
 const b=boundsOf(g),width=(b[2]-b[0])*111320*Math.cos((b[1]+b[3])/2*Math.PI/180),height=(b[3]-b[1])*111320;
 const nx=Math.min(n,Math.floor(width/20)),ny=Math.min(n,Math.floor(height/20));
 return {x:nx?width/nx:0,y:ny?height/ny:0,nx,ny};
}
