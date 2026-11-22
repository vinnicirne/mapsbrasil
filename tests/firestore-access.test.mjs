import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {membershipService,HttpError} from '../server/membership-core.mjs';
import {createDriveHandler} from '../server/firestore-api.mjs';

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
  const members=new Map(),invites=new Map();
  const key=(c,u)=>c+'/'+u;
  return {
    get:(c,u)=>members.get(key(c,u)),
    list:(field,value)=>[...members.values()].filter(row=>row[field]===value),
    request(row) { const id=key(row.company,row.uid); if (!members.has(id)) members.set(id,row); },
    decide(c,u,change) {
      const id=key(c,u);
      if (!members.has(id)) throw new HttpError(404,'Vínculo não encontrado.');
      members.set(id,{...members.get(id),...change});
    },
    saveInvite:(id,row)=>invites.set(id,row),
    consumeInvite(id,u,inspect) {
      const row=invites.get(id);
      const grant=inspect(row);
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
