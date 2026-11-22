import {distance,inBounds} from './geometry.js';

const abbreviations = new Map([['r','rua'],['av','avenida'],['estr','estrada'],['tv','travessa']]);
const fold = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim().split(' ').map(word=>abbreviations.get(word) ?? word).join(' ');
const ignored = new Set(['de','da','do','das','dos']);

function parse(text) {
  const raw=text.trim();
  if (!raw) return {};
  const coordinates=/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/.exec(raw);
  if (coordinates) return {point:[Number(coordinates[2]),Number(coordinates[1])]};
  const parts=raw.split(',').map(piece=>piece.trim()).filter(Boolean);
  const named=fold(parts.shift() ?? '');
  const house=parts[0]?.match(/^\d+[a-z]?$/i)?.[0] ?? /\b(\d+[a-z]?)$/.exec(named)?.[1];
  if (house && parts[0]===house) parts.shift();
  const street=house ? named.replace(/\s+(?:n |num |numero )?\d+[a-z]?$/,'') : named;
  return {street,house:house?.toLowerCase(),locality:fold(parts.join(' '))};
}

export function createDestinationIndex(pack) {
  const region=fold(pack.region);
  const streets=new Map();
  for (const road of pack.roads) {
    if (!road.name) continue;
    const normalized=fold(road.name);
    for(let i=1;i<road.path.length;i++) {
      const a=pack.nodes[road.path[i-1]], b=pack.nodes[road.path[i]];
      const meters=distance(a,b);
      const current=streets.get(normalized);
      if (meters<2 || current?.meters>=meters) continue;
      streets.set(normalized,{id:'street:'+normalized,name:road.name,precision:'street',
        point:[(a[0]+b[0])/2,(a[1]+b[1])/2],meters,normalized});
    }
  }
  const numbered=pack.addresses.map((item,index)=>({
    id:'address:'+index,normalized:fold(item.street),number:String(item.number).toLowerCase(),
    name:item.street+', '+item.number,precision:'address',point:item.point
  }));

  return (text)=>{
    const query=parse(text);
    if (query.point) return inBounds(query.point,pack.bounds)
      ? [{id:'coordinate',name:'Ponto informado',precision:'coordinate',point:query.point}] : [];
    if (!query.street || query.street.length<3) return [];
    if (query.locality) {
      const locality=query.locality.replace(/\b(rj|brasil)\b/g,'').trim();
      if (locality && !region.includes(locality) && !['rio do ouro sao goncalo','sao goncalo rio do ouro'].includes(locality)) return [];
    }
    const terms=query.street.split(' ').filter(word=>word.length>=2 && !ignored.has(word));
    if (!terms.length) return [];
    function score(item) {
      if(item.normalized===query.street) return 0;
      if(item.normalized.startsWith(query.street)) return 1;
      if(item.normalized.includes(query.street)) return 2;
      const words=item.normalized.split(' ');
      return terms.every(term=>words.some(word=>word.startsWith(term))) ? 3 : Infinity;
    }
    const ranked=items=>items.map(item=>({item,rank:score(item)})).filter(result=>Number.isFinite(result.rank))
      .sort((a,b)=>a.rank-b.rank || a.item.name.localeCompare(b.item.name,'pt-BR'));
    if (query.house) {
      const exact=ranked(numbered.filter(item=>item.number===query.house));
      if(exact.length) return exact.slice(0,6).map(({item})=>item);
    }
    return ranked([...streets.values()]).slice(0,6).map(({item})=>({...item,numberMissing:!!query.house}));
  };
}
