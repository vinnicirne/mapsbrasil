const radians = Math.PI / 180;
const meters = 111195;

export function distance(a, b) {
  const dx = (a[0]-b[0])*Math.cos((a[1]+b[1])*radians/2);
  return Math.hypot(dx,a[1]-b[1])*meters;
}

export function project(p, a, b) {
  const factor = Math.cos(p[1]*radians);
  const dx = (b[0]-a[0])*factor;
  const dy = b[1]-a[1];
  const ratio = dx || dy ? (((p[0]-a[0])*factor*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)) : 0;
  const t = Math.max(0, Math.min(1, ratio));
  const point = [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  return {t,point,distance:distance(p,point)};
}

export function heading(a,b) {
  return Math.atan2((b[0]-a[0])*Math.cos(a[1]*radians),b[1]-a[1])/radians;
}

export function inBounds(point,bounds) {
  return point[0]>=bounds[0] && point[1]>=bounds[1] && point[0]<=bounds[2] && point[1]<=bounds[3];
}

export function polygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function inRing([x,y],ring) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [ax,ay]=ring[i], [bx,by]=ring[j];
    if ((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside;
}

const zoneIndexes=new WeakMap();
const cellSize=.05;
const cell=value=>Math.floor(value/cellSize);

function zoneIndex(features) {
  if (zoneIndexes.has(features)) return zoneIndexes.get(features);
  const cells=new Map();
  const extent=[Infinity,Infinity,-Infinity,-Infinity];
  for(const feature of features) {
    const sides=[Infinity,Infinity,-Infinity,-Infinity];
    for(const [outer] of polygons(feature.geometry)) for(const [x,y] of outer??[]) {
      sides[0]=Math.min(sides[0],x);sides[1]=Math.min(sides[1],y);
      sides[2]=Math.max(sides[2],x);sides[3]=Math.max(sides[3],y);
    }
    const box=sides.map(cell);
    extent[0]=Math.min(extent[0],box[0]);extent[1]=Math.min(extent[1],box[1]);
    extent[2]=Math.max(extent[2],box[2]);extent[3]=Math.max(extent[3],box[3]);
    for(let x=box[0];x<=box[2];x++) for(let y=box[1];y<=box[3];y++) {
      const key=x+':'+y;
      if(!cells.has(key)) cells.set(key,[]);
      cells.get(key).push(feature);
    }
  }
  const index={cells,extent};
  zoneIndexes.set(features,index);
  return index;
}

function includesPoint(point,feature) {
  return polygons(feature.geometry).some(([outer,...holes])=>outer && inRing(point,outer) && holes.every(hole=>!inRing(point,hole)));
}

export function findZone(point,features) {
  const {cells}=zoneIndex(features);
  return cells.get(cell(point[0])+':'+cell(point[1]))?.find(feature=>includesPoint(point,feature));
}

function lineCrosses(a,b,c,d) {
  const side = (p,x,y) => (y[0]-x[0])*(p[1]-x[1])-(y[1]-x[1])*(p[0]-x[0]);
  return Math.min(a[0],b[0])<=Math.max(c[0],d[0]) && Math.max(a[0],b[0])>=Math.min(c[0],d[0])
    && Math.min(a[1],b[1])<=Math.max(c[1],d[1]) && Math.max(a[1],b[1])>=Math.min(c[1],d[1])
    && side(a,c,d)*side(b,c,d)<=0 && side(c,a,b)*side(d,a,b)<=0;
}

export function routeCrossesZone(segments,features) {
  const {cells,extent}=zoneIndex(features);
  for(const {a,b} of segments) {
    const west=Math.max(extent[0],cell(Math.min(a[0],b[0])));
    const east=Math.min(extent[2],cell(Math.max(a[0],b[0])));
    const south=Math.max(extent[1],cell(Math.min(a[1],b[1])));
    const north=Math.min(extent[3],cell(Math.max(a[1],b[1])));
    const candidates=new Set();
    for(let x=west;x<=east;x++) for(let y=south;y<=north;y++) {
      for(const zone of cells.get(x+':'+y)??[]) candidates.add(zone);
    }
    for(const feature of candidates) {
      if(includesPoint(a,feature) || polygons(feature.geometry).some(rings=>rings.some(ring=>
        ring.some((position,index)=>index>0 && lineCrosses(a,b,ring[index-1],position))))) return true;
    }
  }
  return false;
}

export function riskMonitor() {
  let candidate, streak = 0, current;
  return (position,accuracy,features) => {
    if (accuracy>45) { candidate=undefined; streak=0; return {current}; }
    const zone = findZone(position,features);
    const key = zone ? zone.id ?? zone.properties?.label ?? zone : null;
    const oldKey = current ? current.id ?? current.properties?.label ?? current : null;
    if (key!==candidate) { candidate=key; streak=0; }
    if (++streak<2 || key===oldKey) return {current};
    current=zone;
    return {current,entered:zone};
  };
}
