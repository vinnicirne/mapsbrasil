import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const emailOf = value => String(value ?? '').trim().toLowerCase();
const adminUid = 'demo-company-admin';
const demoUsers = {
  admin:{uid:adminUid,email:'operacao@example.test'},
  driver:{uid:'demo-driver',email:'entregador@example.test'},
  guest:{uid:'demo-unaffiliated',email:'visitante@example.test'}
};

export class HttpError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}

export function openAccess(path, {demo, firebase, companies}) {
  const db=new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS memberships (
      company TEXT NOT NULL, uid TEXT NOT NULL, email TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked')),
      requested INTEGER NOT NULL, changed INTEGER NOT NULL, decided_by TEXT,
      PRIMARY KEY(company,uid)
    );
    CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY, company TEXT NOT NULL, email TEXT NOT NULL,
      created_by TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const companyById=new Map(companies.map(company=>[company.id,company]));
  const forUser=db.prepare('SELECT company,uid,email,status,requested,changed FROM memberships WHERE uid=? ORDER BY requested');
  const forCompany=db.prepare('SELECT company,uid,email,status,requested,changed FROM memberships WHERE company=? ORDER BY requested DESC');
  const membership=db.prepare('SELECT * FROM memberships WHERE company=? AND uid=?');
  const putMember=db.prepare(`INSERT INTO memberships (company,uid,email,status,requested,changed,decided_by) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(company,uid) DO UPDATE SET status=excluded.status,email=excluded.email,changed=excluded.changed,decided_by=excluded.decided_by`);
  const configGet=db.prepare('SELECT value FROM settings WHERE key=?');
  const configPut=db.prepare('INSERT INTO settings VALUES (?,?)');
  const demoSecret=randomBytes(32);
  const sessionTime=1000*60*60*8;
  const app=firebase ? initializeApp({projectId:firebase.projectId}) : null;

  let keys=configGet.get('offline-keys');
  if (!keys) {
    const {publicKey,privateKey}=generateKeyPairSync('ec',{
      namedCurve:'prime256v1',
      publicKeyEncoding:{format:'jwk'},
      privateKeyEncoding:{format:'pem',type:'pkcs8'}
    });
    keys={value:JSON.stringify({publicKey,privateKey})};
    configPut.run('offline-keys',keys.value);
  }
  const {privateKey,publicKey}=JSON.parse(keys.value);

  async function authenticate(header) {
    const token = /^Bearer (\S+)$/.exec(header ?? '')?.[1];
    if (!token) throw new HttpError(401,'Entre para continuar.');
    if (demo) {
      const [body,signature]=token.split('.');
      const expected=createHmac('sha256',demoSecret).update(body).digest();
      const actual=Buffer.from(signature ?? '','base64url');
      if (actual.length===expected.length && timingSafeEqual(actual,expected)) {
        const claims=JSON.parse(Buffer.from(body,'base64url'));
        if (claims.exp>Date.now()) return claims.user;
      }
      throw new HttpError(401,'Sessão de demonstração expirada.');
    }
    if (!app) throw new HttpError(503,'Login ainda não configurado.');
    try {
      const decoded=await getAuth(app).verifyIdToken(token);
      if (!decoded.email_verified || !decoded.email) throw new HttpError(403,'Confirme seu e-mail no provedor de login.');
      return {uid:decoded.uid,email:emailOf(decoded.email)};
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401,'Sessão inválida. Entre novamente.');
    }
  }

  const administers=(user, company)=>company.adminUids.includes(user.uid);
  function requireAdmin(user,id) {
    const company=companyById.get(id);
    if (!company || !administers(user,company)) throw new HttpError(403,'Acesso restrito à administração desta empresa.');
    return company;
  }

  function requireApproved(user,id) {
    if (!companyById.has(id) || membership.get(id,user.uid)?.status!=='approved') throw new HttpError(403,'Seu vínculo ainda não foi aprovado.');
  }

  function me(user) {
    return {user,memberships:forUser.all(user.uid).map(row=>({...row,name:companyById.get(row.company)?.name ?? row.company})),
      companies:companies.filter(company=>administers(user,company)).map(({id,name,joinCode})=>({id,name,joinCode}))};
  }

  function request(user, code) {
    const joinCode=String(code ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim();
    const company=companies.find(item=>item.joinCode===joinCode);
    if (!company) throw new HttpError(404,'Código de adesão inválido.');
    const existing=membership.get(company.id,user.uid);
    if (!existing) {
      const now=Date.now();
      putMember.run(company.id,user.uid,user.email,'pending',now,now,null);
    }
    const profile=me(user);
    return {...profile,requestedMembership:profile.memberships.find(row=>row.company===company.id)};
  }

  function depart(user,company,uid,status) {
    requireAdmin(user,company);
    if (!['approved','rejected','revoked'].includes(status)) throw new HttpError(400,'Decisão inválida.');
    const current=membership.get(company,uid);
    if (!current) throw new HttpError(404,'Vínculo não encontrado.');
    const result=db.prepare(`UPDATE memberships SET status=?, changed=?, decided_by=? WHERE company=? AND uid=? AND status=?`)
      .run(status,Date.now(),user.uid,company,uid,current.status);
    if (!result.changes) throw new HttpError(409,'O vínculo foi alterado. Atualize a tela.');
    return forCompany.all(company);
  }

  function invite(user,company,email) {
    requireAdmin(user,company);
    email=emailOf(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) throw new HttpError(400,'Informe um e-mail válido.');
    const token=randomBytes(32).toString('base64url');
    const expires=Date.now()+7*24*60*60*1000;
    db.prepare('INSERT INTO invites VALUES (?,?,?,?,?,NULL)').run(hash(token),company,email,user.uid,expires);
    return {token,expires};
  }

  function acceptInvite(user,token) {
    if (!/^[\w-]{43}$/.test(String(token))) throw new HttpError(404,'Convite inválido.');
    const key=hash(token);
    const now=Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const row=db.prepare('SELECT * FROM invites WHERE token_hash=?').get(key);
      if (!row || row.used!==null || row.expires<=now) throw new HttpError(404,'Convite expirado ou já aceito.');
      if (user.email!==row.email) throw new HttpError(403,'Use o e-mail verificado que recebeu o convite.');
      putMember.run(row.company,user.uid,user.email,'approved',now,now,row.created_by);
      db.prepare('UPDATE invites SET used=? WHERE token_hash=?').run(now,key);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return me(user);
  }

  function lease(user,company, packVersion) {
    requireApproved(user,company);
    const expires=Date.now()+sessionTime;
    const claims=encode({sub:user.uid,company,packVersion,expires});
    const signature=sign('sha256',Buffer.from(claims),{key:privateKey,dsaEncoding:'ieee-p1363'});
    return {claims,signature:signature.toString('base64url'),publicKey};
  }

  function demoToken(role) {
    if (!demo || !Object.hasOwn(demoUsers,role)) throw new HttpError(404,'Opção indisponível.');
    const body=encode({user:demoUsers[role],exp:Date.now()+sessionTime});
    return {token:body+'.'+createHmac('sha256',demoSecret).update(body).digest('base64url')};
  }

  return {authenticate,requireApproved,me,request,depart,invite,acceptInvite,lease,demoToken,
    members:(user,id)=>{requireAdmin(user,id);return forCompany.all(id);}};
}

export const demoCompanies=[
  {id:'piloto',name:'Operação Rio do Ouro',joinCode:'rio-demo',adminUids:[adminUid]},
  {id:'outra',name:'Operação de teste isolada',joinCode:'outra-demo',adminUids:[]}
];
