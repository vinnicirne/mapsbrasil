import {createHash,createPrivateKey,createPublicKey,randomBytes,sign} from 'node:crypto';
import {getAuth} from 'firebase-admin/auth';
import {getApps,initializeApp} from 'firebase-admin/app';

export class HttpError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const emailOf=value=>String(value ?? '').trim().toLowerCase();
export function authVerifier(firebase) {
  const name='drive-identity-'+firebase?.projectId;
  const app=firebase && (getApps().find(app=>app.name===name) ?? initializeApp({projectId:firebase.projectId},name));
  return async header=>{
    const match=/^Bearer (\S+)$/.exec(header ?? '');
    if (!match) throw new HttpError(401,'Entre para continuar.');
    if (!app) throw new HttpError(503,'Login ainda não configurado.');
    try {
      const user=await getAuth(app).verifyIdToken(match[1]);
      if (!user.email_verified || !user.email) throw new HttpError(403,'Confirme seu e-mail no provedor de login.');
      return {uid:user.uid,email:emailOf(user.email)};
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error.code==='app/network-error' || error.code==='auth/internal-error') throw new HttpError(503,'Serviço de login temporariamente indisponível.');
      throw new HttpError(401,'Sessão inválida. Entre novamente.');
    }
  };
}
export function firebaseWebConfig(env) {
  const {FIREBASE_PROJECT_ID:projectId,FIREBASE_AUTH_DOMAIN:authDomain,FIREBASE_API_KEY:apiKey,FIREBASE_APP_ID:appId}=env;
  return projectId && authDomain && apiKey && appId ? {projectId,authDomain,apiKey,appId} : null;
}

export function membershipService({store,companies,authenticate,privateKey}) {
  const companyById=new Map(companies.map(company=>[company.id,company]));
  const adminsFor=user=>companies.filter(company=>company.adminUids.includes(user.uid));
  const signingKey=createPrivateKey(privateKey);
  const publicKey=createPublicKey(signingKey).export({format:'jwk'});
  if (signingKey.asymmetricKeyType!=='ec' || publicKey.crv!=='P-256') throw Error('Chave offline incompatível.');
  function requireAdmin(user,id) {
    if (!companyById.get(id)?.adminUids.includes(user.uid)) throw new HttpError(403,'Acesso restrito à administração desta empresa.');
  }
  async function requireApproved(user,id) {
    if (!companyById.has(id) || (await store.get(id,user.uid))?.status!=='approved') throw new HttpError(403,'Seu vínculo ainda não foi aprovado.');
  }
  const publicRow=({company,uid,email,status,requested,changed})=>({company,uid,email,status,requested,changed});
  async function me(user) {
    const memberships=(await store.list('uid',user.uid)).filter(row=>companyById.has(row.company))
      .sort((a,b)=>a.requested-b.requested).map(row=>({...publicRow(row),name:companyById.get(row.company).name}));
    return {user,memberships,companies:adminsFor(user).map(({id,name,joinCode})=>({id,name,joinCode}))};
  }
  async function members(user,id) {
    requireAdmin(user,id);
    return (await store.list('company',id)).sort((a,b)=>b.requested-a.requested).map(publicRow);
  }
  async function request(user,code) {
    const company=companies.find(item=>item.joinCode===String(code ?? '').trim());
    if (!company) throw new HttpError(404,'Código de adesão inválido.');
    const now=Date.now();
    await store.request({company:company.id,uid:user.uid,email:user.email,status:'pending',requested:now,changed:now,decided_by:null});
    return me(user);
  }
  async function depart(user,company,uid,status) {
    requireAdmin(user,company);
    if (!['approved','rejected','revoked'].includes(status)) throw new HttpError(400,'Decisão inválida.');
    await store.decide(company,uid,{status,changed:Date.now(),decided_by:user.uid});
    return members(user,company);
  }
  async function invite(user,company,value) {
    requireAdmin(user,company);
    const email=emailOf(value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) throw new HttpError(400,'Informe um e-mail válido.');
    const token=randomBytes(32).toString('base64url');
    const expires=Date.now()+7*24*60*60*1000;
    await store.saveInvite(hash(token),{company,email,created_by:user.uid,expires,used:null});
    return {token,expires};
  }
  async function acceptInvite(user,token) {
    if (typeof token!=='string' || !/^[\w-]{43}$/.test(token)) throw new HttpError(404,'Convite inválido.');
    const now=Date.now();
    await store.consumeInvite(hash(token),user.uid,row=>{
      if (!row || !companyById.has(row.company) || row.used!==null || row.expires<=now ||
          !companyById.get(row.company).adminUids.includes(row.created_by)) throw new HttpError(404,'Convite expirado ou já aceito.');
      if (user.email!==row.email) throw new HttpError(403,'Use o e-mail verificado que recebeu o convite.');
      return {company:row.company,uid:user.uid,email:user.email,status:'approved',requested:now,changed:now,decided_by:row.created_by};
    });
    return me(user);
  }
  async function lease(user,company,packVersion) {
    await requireApproved(user,company);
    const claims=Buffer.from(JSON.stringify({sub:user.uid,company,packVersion,expires:Date.now()+8*60*60*1000})).toString('base64url');
    const signature=sign('sha256',Buffer.from(claims),{key:signingKey,dsaEncoding:'ieee-p1363'});
    return {claims,signature:signature.toString('base64url'),publicKey};
  }
  return {authenticate,requireApproved,me,members,request,depart,invite,acceptInvite,lease};
}
