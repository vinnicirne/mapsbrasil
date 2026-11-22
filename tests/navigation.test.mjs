import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRouter,projectProgress} from '../src/navigation/router.js';
import {findZone,riskMonitor,routeCrossesZone} from '../src/navigation/geometry.js';
import {orderByProximity,readStops} from '../src/navigation/stops.js';

const pilot=JSON.parse(readFileSync(new URL('../public/packs/rio-do-ouro.json',import.meta.url),'utf8'));
const start=[-42.997152,-22.888367];
const stop={point:[-42.990098,-22.886991],name:'Entrega de teste'};

test('piloto calcula sequência de manobras e cruzamento de área',()=>{
  const route=makeRouter(pilot)(start,[stop]);
  const leg=route.legs[0];
  assert.ok(route.meters>700 && route.meters<1000);
  assert.deepEqual(leg.maneuvers.map(step=>step.kind),['straight','left','right','arrive']);
  assert.ok(routeCrossesZone(leg.segments,pilot.risks.features));
  const segment=leg.segments.at(-2);
  const position=projectProgress(leg,segment.a,segment.at-10);
  assert.ok(Math.abs(position.at-segment.at)<10);
});

test('sentido único e restrição de conversão exigem trajeto válido',()=>{
  const nodes=[[0,0],[.001,0],[.002,0],[.001,.001],[.002,.001]];
  const road=(id,path,direction=0)=>({id,path,direction,speed:30,name:String(id)});
  const pack={nodes,roads:[road(1,[0,1],1),road(2,[1,2]),road(3,[1,3,4,2])],
    turns:[{node:1,from:1,to:2,only:false}],bounds:[-.01,-.01,.01,.01]};
  const router=makeRouter(pack);
  const via=router([.0003,0],[{point:[.0019,0],name:'Teste'}]).legs[0];
  assert.ok(via.segments.some(segment=>segment.a[1]>.0005 || segment.b[1]>.0005));
  assert.throws(()=>router([.0008,0],[{point:[.0002,0],name:'Volta'}]),/Não há trajeto/);
});

test('alerta exige posições coerentes e rearma após sair',()=>{
  const zone=pilot.risks.features[0];
  const inside=[-42.9935,-22.8878],outside=[-42.996,-22.886];
  const watch=riskMonitor();
  assert.equal(findZone(inside,[zone]),zone);
  assert.equal(watch(inside,100,[zone]).entered,undefined);
  assert.equal(watch(inside,5,[zone]).entered,undefined);
  assert.equal(watch(inside,5,[zone]).entered,zone);
  assert.equal(watch(inside,5,[zone]).entered,undefined);
  watch(outside,3,[zone]);watch(outside,3,[zone]);
  watch(inside,5,[zone]);
  assert.equal(watch(inside,5,[zone]).entered,zone);
});

test('importação preserva a ordem e valida limites',()=>{
  const stops=readStops('Nome;Latitude;Longitude\nUm;-22.888;-42.994\nDois;-22.886;-42.991',pilot);
  assert.deepEqual(stops.map(stop=>stop.name),['Um','Dois']);
  assert.deepEqual(orderByProximity(stops[1].point,stops).map(stop=>stop.name),['Dois','Um']);
  assert.throws(()=>readStops('Fora;-20;-40',pilot),/fora da cobertura/);
  const address=pilot.addresses.find(item=>pilot.addresses.filter(other=>item.street===other.street && item.number===other.number).length===1);
  assert.deepEqual(readStops(address.street+' '+address.number,pilot)[0].point,address.point);
});
