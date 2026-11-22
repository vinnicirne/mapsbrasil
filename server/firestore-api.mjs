import {readFile} from 'node:fs/promises';
import {firebaseWebConfig,hash,HttpError,membershipService} from './membership-core.mjs';
import {configuredFirestore} from './firestore-store.mjs';
import {authVerifier} from './firebase-token.mjs';
import {nationalNavigation} from './national-navigation.mjs';

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

export function createDriveHandler({access, firebase, packBytes, national}) {
  const pack=packBytes && JSON.parse(packBytes);
  const packInfo=pack && {version:pack.version,region:pack.region,size:packBytes.length,sha256:hash(packBytes),
    bounds:pack.bounds,dataDate:pack.dataDate,riskMode:pack.riskMode};
  return async request=>{
    try {
      const url=new URL(request.url);
      const named=url.searchParams.getAll('endpoint');
      const endpoint=named.length===1 ? named[0] : named.length===0 ? url.pathname.slice('/api/'.length) : '';
      const method=request.method;
      const companyRoute=/^companies\/([\w-]+)\/(members|invite|decision|pack|lease|search|route)$/.exec(endpoint);
      if (endpoint==='config' && method==='GET') return json({firebase,demo:false,signup:null});
      if (!companyRoute && !['me','join','accept'].includes(endpoint)) throw new HttpError(404,'Recurso não encontrado.');
      const user=await access.authenticate(request.headers.get('authorization'));
      if (endpoint==='me' && method==='GET') return json(await access.me(user));
      if (endpoint==='join' && method==='POST') return json(await access.request(user,(await readBody(request)).code));
      if (endpoint==='accept' && method==='POST') return json(await access.acceptInvite(user,(await readBody(request)).token));
      if (companyRoute) {
        const [,company,action]=companyRoute;
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
          return json(action==='search'?await national.search(input.query):await national.route(input));
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
      return json({error:error instanceof HttpError ? error.message : 'Falha temporária no serviço.'},error.status ?? 500);
    }
  };
}

export async function configureDriveHandler(env) {
  const firebase=firebaseWebConfig(env);
  if (!firebase) throw new HttpError(503,'Login ainda não configurado.');
  const companies=JSON.parse(env.COMPANIES_JSON ?? '[]');
  if (!Array.isArray(companies) || companies.some(c=>!c || !/^[\w-]+$/.test(c.id) || typeof c.name!=='string' ||
      typeof c.joinCode!=='string' || !c.joinCode || !Array.isArray(c.adminUids) || c.adminUids.some(uid=>typeof uid!=='string'))) {
    throw Error('COMPANIES_JSON inválido.');
  }
  const store=configuredFirestore(env);
  const access=membershipService({store,companies,authenticate:authVerifier(firebase),privateKey:env.DRIVE_LEASE_PRIVATE_KEY});
  const packBytes=env.DRIVE_PACK_PROFILE==='sample'
    ? (env.ALLOW_SAMPLE_PACK==='1' ? await readFile(new URL('../public/packs/rio-do-ouro.json',import.meta.url)) : null)
    : await readFile(new URL('./packs/rio-do-ouro-faccoes.json',import.meta.url));
  return createDriveHandler({access,firebase,packBytes,national:nationalNavigation({env,limit:kind=>store.reserveProvider(kind)})});
}
