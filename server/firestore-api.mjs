import {readFile} from 'node:fs/promises';
import {driverContact,firebaseWebConfig,hash,HttpError,membershipService} from './membership-core.mjs';
import {configuredFirestore} from './firestore-store.mjs';
import {authVerifier} from './firebase-token.mjs';
import {nationalNavigation} from './national-navigation.mjs';
import {corporateDomainPattern,corporateManagement} from './corporate-management.mjs';
import {driverRegistration} from './driver-registration.mjs';
import {trackingService} from './tracking.mjs';
import {sosService} from './sos.mjs';
import {streamSos} from './sos-stream.mjs';

const responseHeaders={'cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value,status=200)=>Response.json(value,{status,headers:responseHeaders});

async function readBody(request) {
  const limit=8192;
  if (Number(request.headers.get('content-length'))>limit) throw new HttpError(413,'Solicitação excede o tamanho permitido.');
  const chunks=[];
  let size=0;
  if (request.body) {
    for await (const chunk of request.body) {
      size+=chunk.length;
      if (size>limit) throw new HttpError(413,'Solicitação excede o tamanho permitido.');
      chunks.push(chunk);
    }
  }
  try {
    const body=JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (body && typeof body==='object' && !Array.isArray(body)) return body;
  } catch { /* erro apresentado abaixo */ }
  throw new HttpError(400,'Dados inválidos.');
}

export function createDriveHandler({access, firebase, packBytes, national, corporate, registerDriver, tracking, sos}) {
  const pack=packBytes && JSON.parse(packBytes);
  const packInfo=pack && {version:pack.version,region:pack.region,size:packBytes.length,sha256:hash(packBytes),
    bounds:pack.bounds,dataDate:pack.dataDate,riskMode:pack.riskMode};
  return async request=>{
    let corporateHeaders;
    const reply=(value,status=200)=>corporateHeaders
      ? Response.json(value,{status,headers:{...responseHeaders,...corporateHeaders}})
      : json(value,status);
    try {
      const url=new URL(request.url);
      const named=url.searchParams.getAll('endpoint');
      const endpoint=named.length===1 ? named[0] : named.length===0 ? url.pathname.slice('/api/'.length) : '';
      const method=request.method;
      const corporateRoute=/^empresa\/([a-z0-9.-]+)\/(motoristas|convite|decisao|cadastro|localizacoes|perfil|sos|sos-atendido|sos-stream|sos-historico)$/.exec(endpoint);
      if (corporateRoute) {
        if (!corporate || request.headers.get('origin')!==corporate.origin) {
          throw new HttpError(403,'Integração com o Painel Empresa indisponível.');
        }
        corporateHeaders={'access-control-allow-origin':corporate.origin,vary:'Origin'};
        if (method==='OPTIONS') return new Response(null,{status:204,headers:{
          ...corporateHeaders,'access-control-allow-methods':'GET, POST','access-control-allow-headers':'Authorization, Content-Type',
          'access-control-max-age':'600'
        }});
        const [,domain,action]=corporateRoute;
        if (!corporateDomainPattern.test(domain)) throw new HttpError(400,'Identificador de empresa inválido.');
        if (method!==(['motoristas','localizacoes','sos','sos-stream','sos-historico'].includes(action)?'GET':'POST')) throw new HttpError(405,'Método indisponível.');
        const authorization=request.headers.get('authorization');
        const {company,user,direct}=await corporate.authorize(domain,authorization);
        async function loadBranches(load) {
          const domains=await corporate.branches(domain,authorization);
          const rows=await Promise.all(domains.map(async branch=>{
            try {
              const {company:carrier}=await corporate.authorize(branch,authorization);
              return load(branch,carrier);
            } catch (error) {
              if (error.status===403) return [];
              throw error;
            }
          }));
          return rows.flat();
        }
        if (action==='sos-historico') {
          if (!sos) throw new HttpError(503,'Histórico de SOS indisponível.');
          const since=Number(url.searchParams.get('desde'));
          const until=Number(url.searchParams.get('ate'));
          const list=async (branch,record)=>(await sos.history(record.id,since,until)).map(
            ({id,driverName,createdAt,acknowledgedAt})=>({
              id,driverName,createdAt,acknowledgedAt,companyDomain:branch,companyName:record.name
            })
          );
          const local=list(domain,company);
          if (!direct || url.searchParams.get('tree')!=='1') return reply(await local);
          const [own,linked]=await Promise.all([local,loadBranches(list)]);
          return reply([...own,...linked].sort((left,right)=>right.createdAt-left.createdAt));
        }
        if (action==='sos' || action==='sos-atendido' || action==='sos-stream') {
          if (!sos) throw new HttpError(503,'Serviço de SOS indisponível.');
          if (action==='sos-atendido') return reply(await sos.acknowledge(company.id,(await readBody(request)).id,user));
          const format=(branch,record,alert)=>({
            id:alert.id,createdAt:alert.createdAt,driverName:alert.driverName,driverPhone:alert.driverPhone,
            location:alert.location,companyDomain:branch,companyName:record.name
          });
          if (action==='sos-stream') {
            if (!sos.subscribe) throw new HttpError(503,'Canal de SOS indisponível.');
            const companies=new Map([[domain,company]]);
            if (direct && url.searchParams.get('tree')==='1') {
              for (const [branch,carrier] of await loadBranches((branch,carrier)=>[[branch,carrier]])) {
                companies.set(branch,carrier);
              }
            }
            return streamSos({companies,subscribe:sos.subscribe,format,signal:request.signal,
              headers:{...responseHeaders,...corporateHeaders},
              async verify(branch,id) {
                try {
                  if (branch!==domain && !(await corporate.authorize(domain,authorization)).direct) return false;
                  const match=await corporate.authorize(branch,authorization);
                  return match.company.id===id;
                } catch (error) {
                  if (error.status===403) return false;
                  throw error;
                }
              }
            });
          }
          const list=async (branch,record)=>(await sos.pending(record.id)).map(alert=>format(branch,record,alert));
          const local=list(domain,company);
          if (!direct || url.searchParams.get('tree')!=='1') return reply(await local);
          const [own,linked]=await Promise.all([local,loadBranches(list)]);
          return reply([...own,...linked].sort((left,right)=>right.createdAt-left.createdAt));
        }
        if (action==='motoristas') return reply({joinCode:company.joinCode,members:await access.members(user,company.id)});
        if (action==='localizacoes' && tracking) {
          const root=tracking.live(company.id);
          if (!direct || new URL(request.url).searchParams.get('tree')!=='1') return reply(await root);
          const [local,descendants]=await Promise.all([root,loadBranches(async (branch,carrier)=>
            (await tracking.live(carrier.id)).map(position=>({...position,companyName:carrier.name,companyDomain:branch}))
          )]);
          const positions=new Map();
          for (const row of [...local.map(position=>({...position,companyName:company.name,companyDomain:domain})),...descendants]) {
            if (!positions.has(row.uid) || positions.get(row.uid).updatedAt<row.updatedAt) positions.set(row.uid,row);
          }
          return reply([...positions.values()]);
        }
        const input=await readBody(request);
        if (action==='convite') return reply(await access.invite(user,company.id,input.email,driverContact(input)));
        if (action==='cadastro') {
          if (!registerDriver) throw new HttpError(503,'Cadastro direto indisponível.');
          const contact=driverContact(input);
          const driver=await registerDriver(input.email,input.password);
          let linked=true;
          try { await access.enroll(user,company.id,{...driver,...contact}); }
          catch { linked=false; }
          return reply({email:driver.email,verificationSent:driver.verificationSent,linked},201);
        }
        if (typeof input.uid!=='string' || !input.uid || input.uid.length>128) throw new HttpError(400,'Conta inválida.');
        if (action==='perfil') return reply({joinCode:company.joinCode,members:await access.editContact(user,company.id,input.uid,driverContact(input))});
        return reply({joinCode:company.joinCode,members:await access.depart(user,company.id,input.uid,input.status)});
      }
      const companyRoute=/^companies\/([\w-]+)\/(members|invite|decision|pack|lease|search|route|tracking|sos)$/.exec(endpoint);
      if (endpoint==='config' && method==='GET') return json({firebase,demo:false,signup:null,tracking:!!tracking,sos:!!sos});
      if (!companyRoute && !['me','join','accept'].includes(endpoint)) throw new HttpError(404,'Recurso não encontrado.');
      const user=await access.authenticate(request.headers.get('authorization'));
      if (endpoint==='me' && method==='GET') return json(await access.me(user));
      if (endpoint==='join' && method==='POST') return json(await access.request(user,(await readBody(request)).code));
      if (endpoint==='accept' && method==='POST') return json(await access.acceptInvite(user,(await readBody(request)).token));
      if (companyRoute) {
        const [,company,action]=companyRoute;
        if (action==='sos' && method==='POST' && sos) return json(await sos.send(user,company,await readBody(request)),201);
        if (action==='tracking' && method==='POST' && tracking) return json(await tracking.update(user,company,await readBody(request)));
        if (action==='members' && method==='GET') return json(await access.members(user,company));
        if (action==='decision' && method==='POST') {
          const {uid,status}=await readBody(request);
          if (typeof uid!=='string' || !uid || uid.length>128) throw new HttpError(400,'Conta inválida.');
          return json(await access.depart(user,company,uid,status));
        }
        if (action==='invite' && method==='POST') return json(await access.invite(user,company,(await readBody(request)).email));
        if (national && ['search','route'].includes(action) && method==='POST') {
          await access.requireApproved(user,company);
          const input=await readBody(request);
          return json(action==='search'?await national.search(input.query,input.near):await national.route(input));
        }
        if (action==='pack' && method==='GET') {
          await access.requireApproved(user,company);
          if (url.searchParams.get('file')==='1') {
            if (!packBytes) throw new HttpError(404,'Região indisponível.');
            return new Response(packBytes,{headers:{...responseHeaders,'content-type':'application/json'}});
          }
          return json(packInfo ?? null);
        }
        if (action==='lease' && method==='POST') {
          if (!pack || (await readBody(request)).version!==pack.version) throw new HttpError(409,'Baixe a versão atual da região.');
          return json(await access.lease(user,company,pack.version));
        }
      }
      throw new HttpError(405,'Método indisponível.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Erro na API do Drive:',error.code ?? error.name);
      return reply({error:error instanceof HttpError ? error.message : 'Falha temporária no serviço.',retryAfterMs:error.retryAfterMs},error.status ?? 500);
    }
  };
}

export async function configureDriveHandler(env) {
  const firebase=firebaseWebConfig(env);
  if (!firebase) throw new HttpError(503,'Login ainda não configurado.');
  const companies=JSON.parse(env.COMPANIES_JSON ?? '[]');
  if (!Array.isArray(companies) || companies.some(c=>!c || !/^[\w-]+$/.test(c.id) || typeof c.name!=='string' ||
      typeof c.joinCode!=='string' || !c.joinCode || !Array.isArray(c.adminUids) || c.adminUids.some(uid=>typeof uid!=='string') ||
      (c.corporateDomain!==undefined && (typeof c.corporateDomain!=='string' || !corporateDomainPattern.test(c.corporateDomain))))) {
    throw Error('COMPANIES_JSON inválido.');
  }
  const domains=companies.flatMap(company=>company.corporateDomain?[company.corporateDomain]:[]);
  if (new Set(domains).size!==domains.length) throw Error('Empresas do Painel Empresa duplicadas.');
  const store=configuredFirestore(env);
  const access=membershipService({store,companies,authenticate:authVerifier(firebase),privateKey:env.DRIVE_LEASE_PRIVATE_KEY});
  const packBytes=env.DRIVE_PACK_PROFILE==='sample'
    ? (env.ALLOW_SAMPLE_PACK==='1' ? await readFile(new URL('../public/packs/rio-do-ouro.json',import.meta.url)) : null)
    : await readFile(new URL('./packs/rio-do-ouro-faccoes.json',import.meta.url));
  return createDriveHandler({access,firebase,packBytes,corporate:corporateManagement({env,companies,ensureCompany:store.ensureCompany}),
    tracking:trackingService(store,access),sos:sosService(store,access),registerDriver:driverRegistration(firebase.apiKey),
    national:nationalNavigation({env,limit:kind=>store.reserveProvider(kind)})});
}
