import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDestinationIndex} from '../src/navigation/destinations.js';
import {routeFromOsrm} from '../server/national-navigation.mjs';

test('a busca offline encontra ruas e sinaliza um número ausente',()=>{
  const pack=JSON.parse(readFileSync(new URL('../public/packs/rio-do-ouro.json',import.meta.url),'utf8'));
  const search=createDestinationIndex(pack);
  const [result]=search('R. Jorge Rachid, 987654, São Gonçalo');
  assert.equal(result.name,'Rua Jorge Rachid');
  assert.equal(result.precision,'street');
  assert.equal(result.numberMissing,true);
  assert.deepEqual(search('Rua Jorge Rachid, São Paulo'),[]);
  const known=pack.addresses[0];
  assert.ok(search(known.street+', '+known.number).some(found=>found.precision==='address'));
});

test('a rota OSRM mantém as manobras e o traçado utilizável sem rede',()=>{
  const a=[-46.66,-23.56],b=[-46.654,-23.563],c=[-46.647,-23.565];
  const [stop]=[{name:'Destino em São Paulo',point:c}];
  const route=routeFromOsrm({routes:[{distance:1400,duration:180,legs:[{steps:[
    {distance:600,duration:60,maneuver:{type:'depart'},name:'Rua A',geometry:{coordinates:[a,b]}},
    {distance:800,duration:120,maneuver:{type:'turn',modifier:'left'},name:'Rua B',geometry:{coordinates:[b,c]}}
  ]}]}]},[stop]);
  assert.equal(route.profile,'national');
  assert.deepEqual(route.legs[0].maneuvers.map(entry=>[entry.at,entry.kind]),[[0,'straight'],[600,'left'],[1400,'arrive']]);
  assert.equal(route.legs[0].segments[1].seconds,120);
  assert.deepEqual(route.legs[0].segments[1].b,c);
});
