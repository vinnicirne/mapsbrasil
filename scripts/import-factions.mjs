import {readFile,writeFile} from 'node:fs/promises';

const [source,packFile,output]=process.argv.slice(2);
if (!source || !packFile || !output) throw Error('Uso: node scripts/import-factions.mjs faccoes.json pacote.json saida.geojson');
const sourceData=JSON.parse(await readFile(source,'utf8'));
const {bounds:[west,south,east,north]}=JSON.parse(await readFile(packFile,'utf8'));
const intersections=sourceData.features.filter(({geometry})=>{
  const {coordinates}=geometry;
  const polygons=geometry.type==='Polygon'?[coordinates]:coordinates;
  return polygons.some(([outer])=>{
    let left=Infinity,bottom=Infinity,right=-Infinity,top=-Infinity;
    for (const [x,y] of outer) {
      left=Math.min(left,x); bottom=Math.min(bottom,y);
      right=Math.max(right,x); top=Math.max(top,y);
    }
    return left<=east && right>=west && bottom<=north && top>=south;
  });
});
const features=intersections.map(({properties,geometry},i)=>({
  type:'Feature',id:'rj-faccao-'+(i+1),geometry,
  properties:{label:properties.n,faction:properties.f}
}));
await writeFile(output,JSON.stringify({
  type:'FeatureCollection',source:'Dados de Riscos · GENI-UFF / Fogo Cruzado',reference:'2026-08',features
})+'\n');
console.log(features.length+' polígonos correspondentes ao recorte.');
