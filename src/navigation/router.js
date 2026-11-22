import {distance,heading,inBounds,project} from './geometry.js';

class Queue {
  items = [];
  push(value) {
    const items = this.items;
    let i = items.push(value)-1;
    while (i>0) {
      const parent = (i-1)>>1;
      if (items[parent].cost<=value.cost) break;
      items[i]=items[parent];
      i=parent;
    }
    items[i]=value;
  }
  pop() {
    const items=this.items;
    const first=items[0];
    const last=items.pop();
    if (!items.length) return first;
    let i=0;
    while (i*2+1<items.length) {
      let child=i*2+1;
      if (items[child+1] && items[child+1].cost<items[child].cost) child++;
      if (items[child].cost>=last.cost) break;
      items[i]=items[child];
      i=child;
    }
    items[i]=last;
    return first;
  }
}

const validPoint = point => Array.isArray(point) && point.length===2 && point.every(Number.isFinite);
const edge = (from,to,a,b,road) => {
  const meters=distance(a,b);
  return {from,to,a,b,road,meters,seconds:meters/(road.speed/3.6)};
};

export function makeRouter(pack) {
  const outgoing = new Map();
  const segments = [];
  const barriers = new Set(pack.barriers ?? []);
  const restrictions = Object.groupBy(pack.turns, turn => turn.node+'|'+turn.from);
  for (const road of pack.roads) {
    for (let i=1;i<road.path.length;i++) {
      const from=road.path[i-1], to=road.path[i];
      const a=pack.nodes[from], b=pack.nodes[to];
      if (from===to || !distance(a,b) || barriers.has(from) || barriers.has(to)) continue;
      segments.push({from,to,a,b,road});
      for (const [x,y,first,last] of [[from,to,a,b],[to,from,b,a]]) {
        if ((x===from && road.direction===-1) || (x===to && road.direction===1)) continue;
        if (!outgoing.has(x)) outgoing.set(x,[]);
        outgoing.get(x).push(edge(x,y,first,last,road));
      }
    }
  }

  const snap = point => {
    if (!validPoint(point) || !inBounds(point,pack.bounds)) throw Error('Ponto fora da região baixada.');
    let best;
    for (const segment of segments) {
      const projected=project(point,segment.a,segment.b);
      if (!best || projected.distance<best.distance) best={...projected,segment};
    }
    if (!best || best.distance>100) throw Error('Nenhuma via trafegável a até 100 m do ponto.');
    return best;
  };

  function pathBetween(start,end) {
    const origin=snap(start), goal=snap(end);
    const s=origin.segment, g=goal.segment;
    const from=-1,to=-2;
    const initial=[], final=[];
    if (origin.t===0) initial.push(edge(from,s.from,origin.point,origin.point,s.road));
    else if (origin.t===1) initial.push(edge(from,s.to,origin.point,origin.point,s.road));
    else {
      if (s.road.direction!==-1) initial.push(edge(from,s.to,origin.point,s.b,s.road));
      if (s.road.direction!==1) initial.push(edge(from,s.from,origin.point,s.a,s.road));
    }
    if (goal.t===0) final.push(edge(g.from,to,goal.point,goal.point,g.road));
    else if (goal.t===1) final.push(edge(g.to,to,goal.point,goal.point,g.road));
    else {
      if (g.road.direction!==-1) final.push(edge(g.from,to,g.a,goal.point,g.road));
      if (g.road.direction!==1) final.push(edge(g.to,to,g.b,goal.point,g.road));
    }
    if (s===g && ((goal.t>=origin.t && s.road.direction!==-1) || (goal.t<=origin.t && s.road.direction!==1)))
      initial.push(edge(from,to,origin.point,goal.point,s.road));

    const queue=new Queue();
    const costs=new Map();
    queue.push({node:from,cost:0});
    while (queue.items.length) {
      const state=queue.pop();
      if (state.key && state.cost!==costs.get(state.key)) continue;
      if (state.node===to) {
        const steps=[];
        for (let current=state;current.incoming;current=current.previous) if (current.incoming.meters) steps.push(current.incoming);
        return steps.reverse();
      }
      const next=state.node===from ? initial : [...(outgoing.get(state.node) ?? []),...final.filter(item=>item.from===state.node)];
      for (const item of next) {
        const previous=state.incoming;
        if (item.meters && previous?.meters) {
          const turns=restrictions[state.node+'|'+previous.road.id] ?? [];
          const uturn = item.to===previous.from;
          const matches=turn => turn.to===item.road.id && (!turn.uturn || uturn);
          const only=turns.filter(turn=>turn.only);
          if ((only.length && !only.some(matches)) || turns.some(turn=>!turn.only && matches(turn))) continue;
        }
        const cost=state.cost+item.seconds;
        const key=item.to+'|'+item.road.id+'|'+item.from;
        if (cost>=(costs.get(key) ?? Infinity)) continue;
        costs.set(key,cost);
        queue.push({node:item.to,cost,key,incoming:item,previous:state});
      }
    }
    throw Error('Não há trajeto viário disponível entre as paradas nesta região.');
  }

  return (start,stops) => {
    if (!Array.isArray(stops) || !stops.length || stops.length>30) throw Error('Adicione de 1 a 30 paradas.');
    let position=start;
    const legs=stops.map(stop=>{
      const edges=pathBetween(position,stop.point);
      position=stop.point;
      return describeLeg(edges,stop);
    });
    return {legs,meters:legs.reduce((sum,leg)=>sum+leg.meters,0),seconds:legs.reduce((sum,leg)=>sum+leg.seconds,0)};
  };
}

function describeLeg(edges,stop) {
  let meters=0,seconds=0;
  const maneuvers=[];
  const segments=edges.map((edge,i)=>{
    const prior=edges[i-1];
    const name=edge.road.name;
    if (!prior) {
      maneuvers.push({at:0,kind:'straight',name});
    } else {
      const delta=((heading(edge.a,edge.b)-heading(prior.a,prior.b)+540)%360)-180;
      const changed=prior.road.id!==edge.road.id;
      if (Math.abs(delta)>35 && (changed || Math.abs(delta)>80)) {
        maneuvers.push({at:meters,kind:Math.abs(delta)>155?'uturn':delta>0?'right':'left',name});
      } else if (changed && name && prior.road.name!==name) {
        maneuvers.push({at:meters,kind:'straight',name});
      }
    }
    const segment={a:edge.a,b:edge.b,at:meters,meters:edge.meters,seconds:edge.seconds};
    meters+=edge.meters;
    seconds+=edge.seconds;
    return segment;
  });
  maneuvers.push({at:meters,kind:'arrive',name:stop.name});
  return {stop,meters,seconds,maneuvers,segments};
}

export function projectProgress(leg,point,previous=0) {
  let best;
  for (const segment of leg.segments) {
    const match=project(point,segment.a,segment.b);
    const at=segment.at+match.t*segment.meters;
    const score=match.distance+Math.abs(at-previous)*0.055 + (at+30<previous?20:0);
    if (!best || score<best.score) best={at,point:match.point,distance:match.distance,score};
  }
  return best ?? {at:0,point:leg.stop.point,distance:distance(point,leg.stop.point)};
}
