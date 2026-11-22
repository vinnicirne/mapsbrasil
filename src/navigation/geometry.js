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

export function findZone(point, features) {
  return features.find(feature => polygons(feature.geometry).some(([outer,...holes]) =>
    outer && inRing(point,outer) && holes.every(hole => !inRing(point,hole))));
}

function lineCrosses(a,b,c,d) {
  const side = (p,x,y) => (y[0]-x[0])*(p[1]-x[1])-(y[1]-x[1])*(p[0]-x[0]);
  return Math.min(a[0],b[0])<=Math.max(c[0],d[0]) && Math.max(a[0],b[0])>=Math.min(c[0],d[0])
    && Math.min(a[1],b[1])<=Math.max(c[1],d[1]) && Math.max(a[1],b[1])>=Math.min(c[1],d[1])
    && side(a,c,d)*side(b,c,d)<=0 && side(c,a,b)*side(d,a,b)<=0;
}

export function routeCrossesZone(segments,features) {
  return features.some(feature => segments.some(({a,b}) => findZone(a,[feature]) ||
    polygons(feature.geometry).some(rings => rings.some(ring =>
      ring.some((point,i)=> i>0 && lineCrosses(a,b,ring[i-1],point))))));
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
