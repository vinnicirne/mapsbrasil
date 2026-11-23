import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import {nationalNavigation} from './national-navigation.mjs';
import {trackingService} from './tracking.mjs';
import {sosService} from './sos.mjs';
import { demoCompanies, hash, HttpError, openAccess } from './access.mjs';

const host=process.env.HOST ?? '127.0.0.1';
const port=Number(process.env.PORT ?? 4173);
const demo=process.env.MAPSBRASIL_DEMO==='1';
if (demo && (process.env.NODE_ENV==='production' || !['127.0.0.1','localhost','::1'].includes(host))) throw Error('Demonstração permitida somente em loopback fora de produção.');
const required=['PROJECT_ID','AUTH_DOMAIN','API_KEY','APP_ID'];
const firebase=required.every(key=>process.env['FIREBASE_'+key]) ? {
  projectId:process.env.FIREBASE_PROJECT_ID,
  authDomain:process.env.FIREBASE_AUTH_DOMAIN,
  apiKey:process.env.FIREBASE_API_KEY,
  appId:process.env.FIREBASE_APP_ID
}: null;
const companies=demo?demoCompanies:JSON.parse(process.env.COMPANIES_JSON ?? '[]');
if (!Array.isArray(companies) || companies.some(c=>!/^[\w-]+$/.test(c.id) || !c.name || !c.joinCode || !Array.isArray(c.adminUids))) {
  throw Error('COMPANIES_JSON inválido.');
}
const dist=resolve('dist');
const lastCall=new Map();
const national=nationalNavigation({limit:async kind=>{
  const now=Date.now();
  const retryAfterMs=1250-(now-(lastCall.get(kind)??0));
  if(retryAfterMs>0) throw Object.assign(
    new HttpError(429,'O serviço nacional está ocupado. Tente novamente em instantes.'),{retryAfterMs}
  );
  lastCall.set(kind,now);
}});
const dbDir=resolve(process.env.DATA_DIR ?? (demo?'data/demo':'data'));
await mkdir(dbDir,{recursive:true});
const access=openAccess(resolve(dbDir,'mapsbrasil.sqlite'),{demo,firebase,companies});
const demoAlerts=new Map();
const demoSos=demo?sosService({
  createSos(company,user,alert) {
    const key=company+'/'+alert.id;
    const existing=demoAlerts.get(key);
    if (existing && existing.uid!==user.uid) throw new HttpError(409,'Identificador de SOS em uso.');
    if (!existing) demoAlerts.set(key,{...alert,company,uid:user.uid,driverName:user.email});
    return {id:alert.id,createdAt:existing?.createdAt ?? alert.createdAt};
  },
  pendingSos(company) {
    return [...demoAlerts.values()].filter(alert=>alert.company===company && !alert.acknowledgedAt);
  }
},access):undefined;
const demoPositions=new Map();
const demoTracking=demo?trackingService({
  updateTracking(company,uid,value) {demoPositions.set(company+'/'+uid,{...value,company,uid});},
  stopTracking(company,uid,session) {
    const key=company+'/'+uid;
    if (demoPositions.get(key)?.session===session) demoPositions.delete(key);
  },
  liveTracking(company,since) {return [...demoPositions.values()].filter(row=>row.company===company && row.updatedAt>=since);},
  get(company,uid) {
    try {
      access.requireApproved({uid},company);
      return {status:'approved'};
    } catch {return null;}
  }
},access):undefined;
const packFile=process.env.PILOT_PACK_PATH ?? (demo || process.env.ALLOW_SAMPLE_PACK==='1'?'dist/packs/rio-do-ouro.json':null);
const packFileBytes=packFile ? await readFile(packFile) : null;
const pack=packFileBytes ? JSON.parse(packFileBytes) : null;
const packInfo=pack ? {version:pack.version,region:pack.region,size:packFileBytes.length,sha256:hash(packFileBytes),
  bounds:pack.bounds,dataDate:pack.dataDate,riskMode:pack.riskMode} : null;

const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.wav':'audio/wav','.txt':'text/plain; charset=utf-8'};
const json=(response,data,status=200)=>{
  response.writeHead(status,{'content-type':type['.json'],'cache-control':'no-store'});
  response.end(JSON.stringify(data));
};
async function body(request) {
  let data='';
  for await (const chunk of request) {
    data+=chunk.toString();
    if (data.length>8192) throw new HttpError(413,'Solicitação excede o tamanho permitido.');
  }
  try {
    const value=JSON.parse(data || '{}');
    if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('Objeto esperado.');
    return value;
  }
  catch { throw new HttpError(400,'Dados inválidos.'); }
}

async function handle(request,response) {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('X-Frame-Options','DENY');
  response.setHeader('Permissions-Policy','geolocation=(self), microphone=(), camera=()');
  const url=new URL(request.url,'http://localhost');
  const pathname=url.pathname;
  const method=request.method;
  if (pathname==='/api/config' && method==='GET') return json(response,{firebase:demo?null:firebase,demo,tracking:demo,sos:demo,
    signup:demo?'rio-demo':null});
  if (pathname==='/api/demo' && method==='POST') return json(response,access.demoToken((await body(request)).role));
  if (pathname.startsWith('/api/')) {
    const user=await access.authenticate(request.headers.authorization);
    if (pathname==='/api/me' && method==='GET') return json(response,access.me(user));
    if (pathname==='/api/join' && method==='POST') return json(response,access.request(user,(await body(request)).code));
    if (pathname==='/api/accept' && method==='POST') return json(response,access.acceptInvite(user,(await body(request)).token));
    const companyRoute=/^\/api\/companies\/([\w-]+)\/(members|invite|decision|pack|lease|search|route|tracking|sos)$/.exec(pathname);
    if (!companyRoute) throw new HttpError(404,'Recurso não encontrado.');
    const [,company,action]=companyRoute;
    if (action==='sos' && method==='POST' && demoSos) return json(response,await demoSos.send(user,company,await body(request)),201);
    if (action==='sos' && method==='GET' && demoSos) {
      access.members(user,company);
      return json(response,await demoSos.pending(company));
    }
    if (action==='tracking' && method==='POST' && demoTracking) return json(response,await demoTracking.update(user,company,await body(request)));
    if (action==='tracking' && method==='GET' && demoTracking) {
      access.members(user,company);
      return json(response,await demoTracking.live(company));
    }
    if (action==='members' && method==='GET') return json(response,access.members(user,company));
    if (action==='decision' && method==='POST') {
      const {uid,status}=await body(request);
      if (typeof uid!=='string') throw new HttpError(400,'Conta inválida.');
      return json(response,access.depart(user,company,uid,status));
    }
    if (action==='invite' && method==='POST') return json(response,access.invite(user,company,(await body(request)).email));
    if (['search','route'].includes(action) && method==='POST') {
      access.requireApproved(user,company);
      const input=await body(request);
      return json(response,action==='search'?await national.search(input.query,input.near):await national.route(input));
    }
    if (action==='pack' && method==='GET') {
      access.requireApproved(user,company);
      if (url.searchParams.has('file')) {
        if (!packFileBytes) throw new HttpError(404,'Região indisponível.');
        response.writeHead(200,{'content-type':type['.json'],'cache-control':'no-store','content-length':packFileBytes.length});
        return response.end(packFileBytes);
      }
      return json(response,packInfo);
    }
    if (action==='lease' && method==='POST') {
      if (!pack || (await body(request)).version!==pack.version) throw new HttpError(409,'Baixe a versão atual da região.');
      return json(response,access.lease(user,company,pack.version));
    }
    throw new HttpError(405,'Método indisponível.');
  }
  if (method!=='GET' && method!=='HEAD') throw new HttpError(405,'Método indisponível.');
  if (!/^\/(?:assets|icons|audio)\/[\w.-]+$/.test(pathname) && !['/','/gestao','/index.html','/sw.js','/manifest.webmanifest','/osm-license.txt'].includes(pathname))
    throw new HttpError(404,'Página não encontrada.');
  const file=resolve(dist,'.'+(['/', '/gestao'].includes(pathname)?'/index.html':pathname));
  if (!file.startsWith(dist+sep)) throw new HttpError(404,'Página não encontrada.');
  const info=await stat(file).catch(()=>null);
  if (!info?.isFile()) throw new HttpError(404,'Arquivo não encontrado. Execute npm run build.');
  response.writeHead(200,{'content-type':type[extname(file)] ?? 'application/octet-stream',
    'content-length':info.size,'cache-control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
  response.end(method==='HEAD' ? undefined : await readFile(file));
}
const server=createServer((request,response)=>handle(request,response).catch(error=>{
  if (!error.status) console.error(error);
  if (!response.headersSent) json(response,{
    error:error.status?error.message:'Falha temporária no serviço.',retryAfterMs:error.retryAfterMs
  },error.status ?? 500);
  else response.end();
}));
server.listen(port,host,()=>console.log('MapsBrasil disponível em http://'+host+':'+port));
