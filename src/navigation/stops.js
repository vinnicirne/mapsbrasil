import {distance,inBounds} from './geometry.js';

const normal = text => text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export function readStops(value,pack) {
  const lines=value.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if (/^(?:nome|parada);(?:latitude|lat);(?:longitude|lon|lng)$/i.test(lines[0] ?? '')) lines.shift();
  if (!lines.length || lines.length>30) throw Error('Informe de 1 a 30 paradas, uma por linha.');
  return lines.map((line,i)=>{
    const columns=line.split(';').map(value=>value.trim());
    let point, name;
    if (columns.length===3 && columns[1] && columns[2] && columns.slice(1).every(x=>Number.isFinite(Number(x.replace(',','.'))))) {
      point=[Number(columns[2].replace(',','.')),Number(columns[1].replace(',','.'))];
      name=columns[0] || 'Parada '+(i+1);
    } else {
      const address=normal(line);
      const matches=pack.addresses.filter(item=>normal(item.street+' '+item.number)===address);
      if (matches.length===1) { point=matches[0].point; name=line; }
      else throw Error('Linha '+(i+1)+': endereço sem ponto único no mapa. Use Nome;Latitude;Longitude.');
    }
    if (!inBounds(point,pack.bounds)) throw Error('Linha '+(i+1)+': parada fora da cobertura offline.');
    return {point,name:name.slice(0,120)};
  });
}

export function orderByProximity(origin,stops) {
  const remaining=[...stops];
  const ordered=[];
  while (remaining.length) {
    let nearest=0;
    for (let i=1;i<remaining.length;i++) {
      if (distance(origin,remaining[i].point)<distance(origin,remaining[nearest].point)) nearest=i;
    }
    const [next]=remaining.splice(nearest,1);
    ordered.push(next);
    origin=next.point;
  }
  return ordered;
}
