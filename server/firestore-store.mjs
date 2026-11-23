import {cert,getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {randomBytes} from 'node:crypto';
import {hash,HttpError} from './membership-core.mjs';

export function firestoreStore(database, namespace) {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(namespace)) throw Error('Namespace inválido.');
  const base=database.collection('drive_access').doc(namespace);
  const grants=base.collection('memberships');
  const invites=base.collection('invites');
  const companies=base.collection('companies');
  const positions=company=>base.collection('tracking').doc(company).collection('positions');
  const alerts=company=>companies.doc(company).collection('sos');
  const member=(company,uid)=>grants.doc(hash(JSON.stringify([company,uid])));
  return {
    async createSos(company,user,alert) {
      const ref=alerts(company).doc(alert.id);
      return database.runTransaction(async tx=>{
        const [existing,membership]=await Promise.all([tx.get(ref),tx.get(member(company,user.uid))]);
        const driver=membership.data();
        if (driver?.status!=='approved') throw new HttpError(403,'Seu vínculo ainda não foi aprovado.');
        const previous=existing.data();
        if (previous) {
          if (previous.uid!==user.uid) throw new HttpError(409,'Identificador de SOS em uso.');
          return {id:previous.id,createdAt:previous.createdAt};
        }
        tx.create(ref,{...alert,uid:user.uid,driverName:driver.driverName || user.email,
          driverPhone:driver.driverPhone || '',acknowledgedAt:null});
        return {id:alert.id,createdAt:alert.createdAt};
      });
    },
    async pendingSos(company) {
      return (await alerts(company).where('acknowledgedAt','==',null).get()).docs.map(doc=>doc.data());
    },
    async sosHistory(company,since,until) {
      const snapshot=await alerts(company).where('createdAt','>=',since).where('createdAt','<',until)
        .orderBy('createdAt','desc').select('id','createdAt','driverName','acknowledgedAt').get();
      return snapshot.docs.map(doc=>doc.data());
    },
    watchSos(company,onNext,onError) {
      return alerts(company).where('acknowledgedAt','==',null).onSnapshot(
        snapshot=>onNext(snapshot.docs.map(doc=>doc.data())),onError
      );
    },
    async acknowledgeSos(company,id,actor) {
      const ref=alerts(company).doc(id);
      return database.runTransaction(async tx=>{
        const row=(await tx.get(ref)).data();
        if (!row) throw new HttpError(404,'SOS não encontrado.');
        if (!row.acknowledgedAt) tx.update(ref,{acknowledgedAt:Date.now(),acknowledgedBy:actor});
        return {id,acknowledged:true};
      });
    },
    async updateTracking(company,uid,update) {
      const ref=positions(company).doc(hash(uid));
      await database.runTransaction(async tx=>{
        const current=(await tx.get(ref)).data();
        if (current?.observedAt>update.observedAt || (current?.session===update.session && current.ended)) return;
        const membership=member(company,uid);
        const row=(await tx.get(membership)).data();
        if (row?.status!=='approved') throw new HttpError(403,'Seu vínculo ainda não foi aprovado.');
        tx.set(ref,{...update,uid});
        if (!row.driverName) tx.update(membership,{driverName:update.name});
      });
    },
    async stopTracking(company,uid,session) {
      const ref=positions(company).doc(hash(uid));
      await database.runTransaction(async tx=>{
        const current=(await tx.get(ref)).data();
        if (!current || current.session===session) tx.set(ref,{session,ended:true,updatedAt:0,expiresAt:new Date(Date.now()+90000)});
      });
    },
    async liveTracking(company,since) {
      const result=await positions(company).where('updatedAt','>=',since).get();
      return result.docs.map(doc=>doc.data());
    },
    async getCompany(id) {return (await companies.doc(id).get()).data();},
    async companyByCode(code) {
      const result=await companies.where('joinCode','==',code).limit(1).get();
      return result.docs[0]?.data();
    },
    async ensureCompany(domain,name) {
      const id='corp_'+hash(domain);
      const ref=companies.doc(id);
      return database.runTransaction(async tx=>{
        const existing=(await tx.get(ref)).data();
        if (existing) return existing;
        const company={id,name,corporateDomain:domain,joinCode:randomBytes(24).toString('base64url'),adminUids:[]};
        tx.create(ref,company);
        return company;
      });
    },
    async reserveProvider(kind) {
      const ref=database.collection('drive_provider_limits').doc(kind);
      await database.runTransaction(async tx=>{
        const last=(await tx.get(ref)).data()?.at ?? 0;
        const now=Date.now();
        const retryAfterMs=1250-(now-last);
        if(retryAfterMs>0) throw Object.assign(
          new HttpError(429,'O serviço nacional está ocupado. Tente novamente em instantes.'),{retryAfterMs}
        );
        tx.set(ref,{at:now});
      });
    },
    async get(company,uid) { return (await member(company,uid).get()).data(); },
    async list(field,value) { return (await grants.where(field,'==',value).get()).docs.map(doc=>doc.data()); },
    async request(request) {
      const ref=member(request.company,request.uid);
      await database.runTransaction(async tx=>{
        if (!(await tx.get(ref)).exists) tx.create(ref,request);
      });
    },
    async decide(company,uid,decision) {
      const ref=member(company,uid);
      await database.runTransaction(async tx=>{
        const current=(await tx.get(ref)).data();
        if (!current) throw new HttpError(404,'Vínculo não encontrado.');
        if (current.transferredTo) throw new HttpError(409,'Este motorista foi transferido. Edite o vínculo na empresa atual.');
        tx.update(ref,decision);
      });
    },
    async transferDriver(source,target,uid,contact,actor,changed) {
      const original=member(source,uid);
      const destination=member(target,uid);
      await database.runTransaction(async tx=>{
        const [from,to]=await Promise.all([tx.get(original),tx.get(destination)]);
        const current=from.data();
        const existing=to.data();
        if (!current) throw new HttpError(404,'Vínculo não encontrado.');
        if (current.transferredTo===target && existing && !existing.transferredTo) return;
        if (!['pending','approved'].includes(current.status)) throw new HttpError(409,'Transfira um vínculo pendente ou aprovado.');
        if (existing && existing.status!=='revoked') throw new HttpError(409,'O motorista já tem um vínculo na empresa de destino.');
        tx.set(destination,{company:target,uid,email:current.email ?? '',status:current.status,
          requested:current.requested ?? changed,changed,decided_by:actor,...contact});
        tx.update(original,{status:'revoked',transferredTo:target,changed,decided_by:actor});
      });
    },
    async saveInvite(key,invite) { await invites.doc(key).create(invite); },
    async consumeInvite(key,uid,inspect) {
      const ref=invites.doc(key);
      await database.runTransaction(async tx=>{
        const grant=await inspect((await tx.get(ref)).data());
        const membership=member(grant.company,uid);
        const prev=(await tx.get(membership)).data();
        if (prev?.transferredTo) throw new HttpError(409,'O motorista já foi transferido para outra empresa.');
        tx.set(membership,{...prev,...grant,requested:prev?.requested ?? grant.requested});
        tx.update(ref,{used:grant.changed});
      });
    }
  };
}

export function configuredFirestore(env) {
  const projectId=env.FIRESTORE_PROJECT_ID;
  const secret=JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON ?? 'null');
  if (!secret || !projectId || secret.project_id!==projectId) throw Error('Credencial Firestore fora do projeto configurado.');
  const name='drive-data-'+projectId;
  const app=getApps().find(app=>app.name===name) ?? initializeApp({projectId,credential:cert(secret)},name);
  return firestoreStore(getFirestore(app), env.DRIVE_DATA_NAMESPACE ?? 'production');
}
