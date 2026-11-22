import {HttpError} from './membership-core.mjs';

const nationalBounds=[-74,-34,-28,6];
const point=value=>Array.isArray(value) && value.length===2 && value.every(Number.isFinite)
  && value[0]>=nationalBounds[0] && value[0]<=nationalBounds[2] && value[1]>=nationalBounds[1] && value[1]<=nationalBounds[3];
const origin='https://mapsbrasil.vercel.app';
const headers={'user-agent':'MapsBrasilDrive/0.1 (+https://mapsbrasil.vercel.app)',referer:origin+'/'};
const directions={'left':'left','sharp left':'left','slight left':'left','right':'right','sharp right':'right','slight right':'right','uturn':'uturn'};

async function request(url) {
  try {
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});
    if(response.status===429) throw new HttpError(429,'O serviço nacional está ocupado. Tente novamente em instantes.');
    if(!response.ok) throw Error();
    return await response.json();
  } catch(error) {
    if(error instanceof HttpError) throw error;
    throw new HttpError(503,'O serviço nacional está indisponível no momento.');
  }
}

export function routeFromOsrm(json,stops) {
  const plan=json.routes?.[0];
  if(!plan || plan.legs?.length!==stops.length) throw new HttpError(404,'Não foi encontrado um trajeto de carro.');
  const legs=plan.legs.map((leg,index)=>{
    const segments=[], maneuvers=[];
    let meters=0,seconds=0;
    for(const step of leg.steps){
      const shape=step.geometry?.coordinates ?? [];
      const kind=step.maneuver?.type==='arrive'?'arrive':directions[step.maneuver?.modifier] ?? 'straight';
      if(kind!=='arrive' && (step.distance>0 || !maneuvers.length)) maneuvers.push({at:meters,kind,name:step.name||''});
      const lengths=[];
      for(let i=1;i<shape.length;i++){
        const [x,y]=shape[i], [a,b]=shape[i-1];
        const degrees=Math.PI/180;
        lengths.push(111195*Math.hypot((x-a)*Math.cos((y+b)*degrees/2),y-b));
      }
      const length=lengths.reduce((sum,n)=>sum+n,0);
      if(!length) continue;
      for(let i=0;i<lengths.length;i++){
        if(!lengths[i]) continue;
        const ratio=lengths[i]/length;
        const size=ratio*(step.distance || length);
        const time=ratio*step.duration;
        segments.push({a:shape[i],b:shape[i+1],at:meters,meters:size,seconds:time});
        meters+=size;
        seconds+=time;
      }
    }
    const stop=stops[index];
    maneuvers.push({at:meters,kind:'arrive',name:stop.name});
    return {stop,segments,maneuvers,meters,seconds};
  });
  return {profile:'national',legs,meters:plan.distance,seconds:plan.duration};
}

export function nationalNavigation({limit=async()=>{},env=process.env}={}) {
  const geocoder=env.DRIVE_GEOCODER_URL ?? 'https://photon.komoot.io/api/';
  const router=env.DRIVE_OSRM_URL ?? 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
  return {
    async search(query) {
      if(typeof query!=='string' || query.trim().length<3 || query.length>180) throw new HttpError(400,'Digite um endereço de até 180 caracteres.');
      await limit('geocoder');
      const url=new URL(geocoder);
      url.searchParams.set('q',query.trim());
      url.searchParams.set('bbox',nationalBounds.join(','));
      url.searchParams.set('limit','8');
      const data=await request(url);
      const wantedNumber=query.match(/\b(\d+[a-z]?)\s*(?=,|$)/i)?.[1] ?? query.match(/,\s*(\d+[a-z]?)\b/i)?.[1];
      const results=[];
      for(const [index,feature] of (data.features ?? []).entries()){
        const p=feature.properties;
        const coordinates=feature.geometry?.coordinates;
        if (!p || !point(coordinates) || p.countrycode?.toUpperCase()!=='BR') continue;
        const street=[p.street ?? p.name,p.housenumber].filter(Boolean).join(', ');
        if(!street) continue;
        const locality=[p.district,p.city ?? p.county,p.state].filter((value,i,list)=>value && list.indexOf(value)===i).join(' · ');
        const missing=!!wantedNumber && String(p.housenumber ?? '').toLowerCase()!==wantedNumber.toLowerCase();
        results.push({id:'br:'+index,name:street,locality,point:coordinates,numberMissing:missing,
          precision:p.housenumber && !missing?'address':'street'});
      }
      return results.sort((a,b)=>Number(a.numberMissing)-Number(b.numberMissing)).slice(0,6);
    },
    async route({start,stops}) {
      if(!point(start) || !Array.isArray(stops) || !stops.length || stops.length>30 || stops.some(stop=>!point(stop?.point) || typeof stop.name!=='string' || stop.name.length>180)) {
        throw new HttpError(400,'Informe uma origem e destinos válidos no Brasil.');
      }
      await limit('routing');
      const directions= [start,...stops.map(stop=>stop.point)].map(pair=>pair.join(',')).join(';');
      const url=new URL(directions,router.endsWith('/')?router:router+'/');
      url.searchParams.set('overview','false');
      url.searchParams.set('steps','true');
      url.searchParams.set('geometries','geojson');
      return routeFromOsrm(await request(url),stops);
    }
  };
}
