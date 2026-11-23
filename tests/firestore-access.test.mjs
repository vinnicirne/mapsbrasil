import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {membershipService,HttpError,hash} from '../server/membership-core.mjs';
import {createDriveHandler} from '../server/firestore-api.mjs';
import {corporateManagement} from '../server/corporate-management.mjs';
import {driverRegistration} from '../server/driver-registration.mjs';

const company={id:'empresa',name:'Empresa de teste',joinCode:'teste',adminUids:['admin']};
const admin={uid:'admin',email:'admin@example.test'};
const driver={uid:'driver',email:'pessoal@example.test'};
const auth=async header=>{
  if (header==='Bearer admin') return admin;
  if (header==='Bearer driver') return driver;
  throw new HttpError(401,'Entre para continuar.');
};
const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1',privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'jwk'}});

function memory() {
  const members=new Map(),invites=new Map(),companies=new Map();
  const key=(c,u)=>c+'/'+u;
  return {
    getCompany:id=>companies.get(id),
    companyByCode:code=>[...companies.values()].find(company=>company.joinCode===code),
    ensureCompany(domain,name) {
      const id='corp_'+hash(domain);
      if(!companies.has(id)) companies.set(id,{id,name,corporateDomain:domain,joinCode:hash(domain).slice(0,32),adminUids:[]});
      return companies.get(id);
    },
    get:(c,u)=>members.get(key(c,u)),
    list:(field,value)=>[...members.values()].filter(row=>row[field]===value),
    request(row) { const id=key(row.company,row.uid); if (!members.has(id)) members.set(id,row); },
    decide(c,u,change) {
      const id=key(c,u);
      if (!members.has(id)) throw new HttpError(404,'Vínculo não encontrado.');
      members.set(id,{...members.get(id),...change});
    },
    saveInvite:(id,row)=>invites.set(id,row),
    async consumeInvite(id,u,inspect) {
      const row=invites.get(id);
      const grant=await inspect(row);
      members.set(key(grant.company,u),grant);
      row.used=Date.now();
    }
  };
}
test('API Firestore preserva permissões e libera o pacote com autorização offline assinada',async()=>{
  const access=membershipService({store:memory(),companies:[company],authenticate:auth,privateKey});
  const handler=createDriveHandler({access,firebase:{projectId:'fixture'},packBytes:Buffer.from('{"version":"v1","region":"Teste","bounds":[],"dataDate":"fixture","riskMode":"sample"}')});
  const api=(id,actor,payload)=>handler(new Request('https://mapsbrasil.example/api/'+id,{
    method:payload?'POST':'GET',headers:actor?{authorization:'Bearer '+actor}:{},body:payload?JSON.stringify(payload):undefined
  }));
  assert.equal((await api('me')).status,401);
  assert.equal((await api('companies/empresa/members','driver')).status,403);
  assert.equal((await (await api('join','driver',{code:'teste'})).json()).memberships[0].status,'pending');
  assert.equal((await api('companies/empresa/pack','driver')).status,403);
  assert.equal((await api('companies/empresa/decision','admin',{uid:'driver',status:'approved'})).status,200);
  assert.equal((await api('companies/empresa/pack?file=1','driver')).status,200);
  assert.equal((await api('companies/another/pack','driver')).status,403);
  const lease=await (await api('companies/empresa/lease','driver',{version:'v1'})).json();
  assert.ok(verify('sha256',Buffer.from(lease.claims),{key:lease.publicKey,format:'jwk',dsaEncoding:'ieee-p1363'},Buffer.from(lease.signature,'base64url')));
  assert.equal((await api('companies/empresa/decision','admin',{uid:'driver',status:'revoked'})).status,200);
  assert.equal((await api('companies/empresa/lease','driver',{version:'v1'})).status,403);
  const invitation=await (await api('companies/empresa/invite','admin',{email:driver.email})).json();
  assert.equal((await api('accept','driver',{token:invitation.token})).status,200);
  assert.equal((await api('accept','driver',{token:invitation.token})).status,404);
});

test('Painel Empresa usa o vínculo correto para convidar, aprovar e revogar motoristas',async t=>{
  const companies=[
    {...company,corporateDomain:'empresa.example'},
    {id:'outra',name:'Outra',joinCode:'outro',adminUids:[],corporateDomain:'outra.example'}
  ];
  const origin='https://painel.example';
  const profiles={
    gestor:{companyDomain:'empresa.example',status:'approved',companyRole:'company_admin'},
    suspenso:{companyDomain:'empresa.example',status:'approved',companyRole:'company_admin',licenseStatus:'suspended'},
    comum:{companyDomain:'empresa.example',status:'approved',companyRole:'member'},
    superadmin:{status:'approved',role:'admin'}
  };
  const env={DRIVE_CORPORATE_ORIGIN:origin,DRIVE_CORPORATE_AUTH_PROJECT:'painel',DRIVE_CORPORATE_DATABASE:'corporativo'};
  const store=memory();
  const corporate=corporateManagement({env,companies,ensureCompany:store.ensureCompany,verifyToken:async authorization=>{
    const uid=authorization?.replace('Bearer ','');
    if (!Object.hasOwn(profiles,uid)) throw new HttpError(401,'Sessão inválida.');
    return {uid};
  }});
  let active=true;
  let registrations=0;
  t.mock.method(globalThis,'fetch',async (url,{headers,body})=>{
    if (url.hostname==='identitytoolkit.googleapis.com') {
      const input=JSON.parse(body);
      if (url.pathname.endsWith(':sendOobCode')) {
        assert.deepEqual(input,{requestType:'VERIFY_EMAIL',idToken:'novo-token'});
        return Response.json({email:'novo@example.test'});
      }
      assert.ok(url.pathname.endsWith(':signUp'));
      registrations++;
      if (input.email===driver.email) return Response.json({error:{message:'EMAIL_EXISTS'}},{status:400});
      assert.equal(input.email,'novo@example.test');
      assert.equal(input.password,'SenhaInicial123!');
      return Response.json({email:input.email,localId:'novo',idToken:'novo-token'});
    }
    const actor=headers.authorization.replace('Bearer ','');
    assert.match(url.href,/\/projects\/painel\/databases\/corporativo\/documents\//);
    const path=url.pathname.split('/documents/')[1];
    if (path.startsWith('users/')) {
      assert.equal(path,'users/'+actor);
      return Response.json({fields:Object.fromEntries(Object.entries(profiles[actor]).map(([key,stringValue])=>[key,{stringValue}]))});
    }
    assert.ok(path.startsWith('corporate_companies/'));
    return Response.json({fields:{active:{booleanValue:active}}});
  });
  const access=membershipService({store,companies,authenticate:auth,privateKey});
  const handler=createDriveHandler({access,corporate,registerDriver:driverRegistration('fixture')});
  const call=(path,{actor='gestor',source=origin,body,method=body?'POST':'GET'}={})=>handler(new Request('https://drive.example/api/'+path,{
    method,headers:{origin:source,authorization:'Bearer '+actor},body:body && JSON.stringify(body)
  }));
  const path='empresa/empresa.example/';
  const preflight=await call(path+'motoristas',{method:'OPTIONS'});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  assert.equal((await call(path+'motoristas',{source:'https://externo.example'})).status,403);
  assert.equal((await call(path+'motoristas',{actor:'driver'})).status,401);
  assert.equal((await call(path+'motoristas',{actor:'comum'})).status,403);
  assert.equal((await call(path+'motoristas',{actor:'suspenso'})).status,403);
  assert.equal((await call('empresa/outra.example/motoristas')).status,403);
  assert.equal((await call('empresa/outra.example/motoristas',{actor:'superadmin'})).status,200);
  active=false;
  assert.equal((await call(path+'motoristas')).status,403);
  active=true;
  await call('join',{actor:'driver',body:{code:'teste'}});
  assert.equal((await (await call(path+'motoristas')).json()).members[0].status,'pending');
  assert.equal((await (await call(path+'decisao',{body:{uid:'driver',status:'approved',company:'outra'}})).json()).members[0].status,'approved');
  assert.equal((await (await call(path+'decisao',{body:{uid:'driver',status:'revoked'}})).json()).members[0].status,'revoked');
  const {token}=await (await call(path+'convite',{body:{email:driver.email}})).json();
  assert.equal((await call('accept',{actor:'admin',body:{token}})).status,403);
  assert.equal((await call('accept',{actor:'driver',body:{token}})).status,200);
  assert.equal((await (await call(path+'motoristas')).json()).members[0].status,'approved');
  const newPath='empresa/nova.example/';
  assert.equal((await call(newPath+'motoristas')).status,403);
  const first=await (await call(newPath+'motoristas',{actor:'superadmin'})).json();
  assert.equal(first.members.length,0);
  assert.equal((await (await call(newPath+'motoristas',{actor:'superadmin'})).json()).joinCode,first.joinCode);
  await call('join',{actor:'driver',body:{code:first.joinCode}});
  assert.equal((await (await call(newPath+'motoristas',{actor:'superadmin'})).json()).members[0].status,'pending');
  const nextInvite=await (await call(newPath+'convite',{actor:'superadmin',body:{email:driver.email}})).json();
  assert.equal((await call('accept',{actor:'driver',body:nextInvite})).status,200);
  assert.equal((await call('companies/corp_'+hash('nova.example')+'/pack',{actor:'driver'})).status,200);
  const body={email:'novo@example.test',password:'SenhaInicial123!'};
  assert.equal((await call(newPath+'cadastro',{body})).status,403);
  assert.equal(registrations,0);
  const registered=await call(newPath+'cadastro',{actor:'superadmin',body});
  assert.equal(registered.status,201);
  assert.deepEqual(await registered.json(),{email:body.email,verificationSent:true,linked:true});
  const row=store.get('corp_'+hash('nova.example'),'novo');
  assert.equal(row.status,'approved');
  assert.equal(row.password,undefined);
  assert.equal((await call(newPath+'cadastro',{actor:'superadmin',body:{...body,email:driver.email}})).status,409);
});
