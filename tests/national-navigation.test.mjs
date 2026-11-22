import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDestinationIndex} from '../src/navigation/destinations.js';
import {nationalNavigation,routeFromOsrm} from '../server/national-navigation.mjs';

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

test('a busca nacional usa o GPS para desempatar ruas e preserva a cidade e o número pedidos',async t=>{
  const features=[
    ['Rua São João da Madeira','São João de Meriti',105,[-43.37,-22.81]],
    ['Rua São João da Madeira','São Gonçalo',105,[-43.06,-22.83]],
    ['Rua São João da Madeira','São Gonçalo',101,[-43.05,-22.82]],
    ['Rua São João','São Gonçalo',105,[-43.04,-22.81]]
  ].map(([street,city,housenumber,coordinates])=>({
    properties:{street,city,housenumber,countrycode:'BR'},geometry:{coordinates}
  }));
  const receive=t.mock.method(globalThis,'fetch',async()=>Response.json({features}));
  const api=nationalNavigation({env:{}});
  const near=[-43.04,-22.81];
  const nearby=await api.search('Rua São João da Madeira',near);
  assert.deepEqual(nearby[0].point,[-43.05,-22.82]);
  assert.equal(receive.mock.calls[0].arguments[0].searchParams.get('lon'),'-43.04');
  const explicit=await api.search('Rua São João da Madeira, 105, São João de Meriti',near);
  assert.equal(explicit[0].locality,'São João de Meriti');
  assert.equal(explicit[0].numberMissing,false);
  const noGps=await api.search('Rua São João da Madeira, 105, São Gonçalo');
  assert.equal(noGps[0].name,'Rua São João da Madeira, 105');
  assert.equal(noGps[0].locality,'São Gonçalo');
  assert.equal(receive.mock.calls[2].arguments[0].searchParams.has('lat'),false);
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
