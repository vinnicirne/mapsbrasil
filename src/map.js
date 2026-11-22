import {factionColors} from './navigation/factions.js';

const radians=Math.PI/180;
const limits=new WeakMap();
function bounds(points) {
  const box=[Infinity,Infinity,-Infinity,-Infinity];
  for (const [x,y] of points) {
    box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);
    box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],y);
  }
  return box;
}
const palette = {motorway:'#a88746',trunk:'#bb995a',primary:'#c4aa70',secondary:'#b1ad95',tertiary:'#b9bdb0'};

export function createMap(canvas, onPoint) {
  const context=canvas.getContext('2d');
  let state={}, center=[-42.985,-22.884], zoom=1, angle=0, width=0,height=0, drag, renderFrame;
  const lonRatio=Math.cos(center[1]*radians);
  const scale=()=>36000*zoom;
  function screen([x,y]) {
    const dx=(x-center[0])*scale()*lonRatio, dy=(center[1]-y)*scale();
    return [width/2+dx*Math.cos(angle)-dy*Math.sin(angle),height/2+dx*Math.sin(angle)+dy*Math.cos(angle)];
  }
  function geo(x,y) {
    const dx=x-width/2,dy=y-height/2;
    return [center[0]+(dx*Math.cos(angle)+dy*Math.sin(angle))/(scale()*lonRatio),
      center[1]-(dy*Math.cos(angle)-dx*Math.sin(angle))/scale()];
  }
  function trace(points) {
    if (!points.length) return;
    context.moveTo(...screen(points[0]));
    for (const point of points.slice(1)) context.lineTo(...screen(point));
  }
  function dot(point,color,label) {
    const [x,y]=screen(point);
    context.beginPath();context.arc(x,y,label?11:7,0,Math.PI*2);
    context.fillStyle=color;context.fill();context.strokeStyle='#fff';context.lineWidth=2;context.stroke();
    if (label) {
      context.font='bold 12px system-ui';context.textAlign='center';context.textBaseline='middle';
      context.fillStyle='#fff';context.fillText(label,x,y+0.5);
    }
  }

  function show() {
    const box=canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    width=box.width;height=box.height;
    const ratio=Math.min(devicePixelRatio,2);
    if (canvas.width!==Math.ceil(width*ratio) || canvas.height!==Math.ceil(height*ratio)) {
      canvas.width=Math.ceil(width*ratio);canvas.height=Math.ceil(height*ratio);
    }
    context.setTransform(ratio,0,0,ratio,0,0);
    context.fillStyle='#edf1e9';context.fillRect(0,0,width,height);
    const {pack,route,legIndex,position,origin,destination,nav,bearing,risks}=state;
    if (!pack) return;
    context.lineJoin='round';context.lineCap='round';
    for (const {kind,points} of pack.areas) {
      context.beginPath();trace(points);
      context.fillStyle=kind==='water'?'#bdd9e1':'#dce6d4';
      context.strokeStyle=context.fillStyle;context.lineWidth=3;
      if (points.length>2 && points[0][0]===points.at(-1)[0] && points[0][1]===points.at(-1)[1]) context.fill();
      else context.stroke();
    }
    for (const major of [false,true]) for (const road of pack.roads) {
      if (Object.hasOwn(palette,road.kind)!==major) continue;
      const points=road.path.map(i=>pack.nodes[i]);
      context.beginPath();trace(points);
      context.strokeStyle=major?'#faf3e0':'#d4dcd3';context.lineWidth=major?7:4;context.stroke();
      context.strokeStyle=major?palette[road.kind]:'#fff';context.lineWidth=major?3.6:2;context.stroke();
    }
    const viewport=bounds([geo(0,0),geo(width,0),geo(width,height),geo(0,height)]);
    for (const feature of risks ?? pack.risks.features) {
      const {type,coordinates}=feature.geometry;
      const polys=type==='Polygon'?[coordinates]:type==='MultiPolygon'?coordinates:[];
      let box=limits.get(feature);
      if(!box) {
        box=bounds(polys.flatMap(polygon=>polygon[0]??[]));
        limits.set(feature,box);
      }
      if(box[2]<viewport[0] || box[0]>viewport[2] || box[3]<viewport[1] || box[1]>viewport[3]) continue;
      context.beginPath();
      for (const polygon of polys) for (const ring of polygon) { trace(ring);context.closePath(); }
      const [outline,fill]=factionColors(feature);
      context.fillStyle=fill;context.fill('evenodd');
      context.strokeStyle=outline;context.lineWidth=1.5;context.stroke();
    }
    if (zoom>=0.75) {
      const grid=new Set();
      context.font='11px system-ui';context.textAlign='center';context.textBaseline='middle';
      for (const road of pack.roads) {
        if (!road.name) continue;
        const [x,y]=screen(pack.nodes[road.path[Math.floor(road.path.length/2)]]);
        if (x<35 || x>width-35 || y<18 || y>height-18) continue;
        const cell=Math.floor(x/138)+':'+Math.floor(y/37);
        if (grid.has(cell)) continue;
        grid.add(cell);
        context.lineWidth=3;context.strokeStyle='#f6f8f4';context.strokeText(road.name,x,y,130);
        context.fillStyle='#344641';context.fillText(road.name,x,y,130);
      }
    }
    if (route) {
      for (const [index,leg] of route.legs.entries()) {
        if (index<legIndex || !leg.segments.length) continue;
        const points=[leg.segments[0].a,...leg.segments.map(segment=>segment.b)];
        context.beginPath();trace(points);context.lineWidth=10;context.strokeStyle='#fff';context.stroke();
        context.lineWidth=6;context.strokeStyle=index===legIndex?'#2863d7':'#7899e3';context.stroke();
      }
      route.legs.forEach((leg,i)=>i>=legIndex && dot(leg.stop.point,'#254d91',String(i+1)));
    }
    if (origin && !nav) dot(origin,'#215646','');
    if (destination && !route) dot(destination,'#254d91','');
    if (position) {
      if (nav) {
        const [x,y]=screen(position);
        context.save();context.translate(x,y);context.rotate((bearing ?? 0)*radians+angle);
        context.beginPath();context.moveTo(0,-14);context.lineTo(10,12);context.lineTo(0,8);context.lineTo(-10,12);context.closePath();
        context.fillStyle='#215dde';context.strokeStyle='#fff';context.lineWidth=3;context.stroke();context.fill();
        context.restore();
      } else dot(position,'#2160d4','');
    }
  }

  const schedule=()=>{ cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(show); };
  const observer=new ResizeObserver(schedule);observer.observe(canvas);
  canvas.addEventListener('pointerdown',event=>{
    drag={x:event.offsetX,y:event.offsetY,center:[...center]};canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if (!drag || state.nav) return;
    center=[...drag.center];
    center=geo(width/2+drag.x-event.offsetX,height/2+drag.y-event.offsetY);
    schedule();
  });
  canvas.addEventListener('pointerup',event=>{
    if (drag && !state.nav && Math.hypot(drag.x-event.offsetX,drag.y-event.offsetY)<5) onPoint(geo(event.offsetX,event.offsetY));
    drag=null;
  });
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  function focus(next,bearing=0) { center=[...next];angle=-bearing*radians;schedule(); }
  return {
    set(data) {state=data;if (data.nav && data.position) focus(data.position,data.bearing);else schedule();},
    fit(pack) {
      const [a,b,c,d]=pack.bounds;
      const rect=canvas.getBoundingClientRect();
      zoom=Math.max(0.24,Math.min(rect.width/(scale()/zoom*(c-a)*lonRatio),rect.height/(scale()/zoom*(d-b)))*0.9);
      focus([(a+c)/2,(b+d)/2]);
    },
    fitRoute(route) {
      const points=route.legs.flatMap(leg=>leg.segments.flatMap(segment=>[segment.a,segment.b]));
      if(!points.length) return;
      const [a,b,c,d]=bounds(points);
      const rect=canvas.getBoundingClientRect();
      zoom=Math.min(3,Math.max(.001,Math.min(rect.width/(36000*Math.max(c-a,.0004)*lonRatio),
        rect.height/(36000*Math.max(d-b,.0004)))*.68));
      focus([(a+c)/2,(b+d)/2]);
    },
    focus,
    zoom(delta) {zoom=Math.min(9,Math.max(0.001,zoom*delta));schedule();},
    follow(position) {zoom=2.5;focus(position,0);}
  };
}
