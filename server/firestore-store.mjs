import {cert,getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {hash,HttpError} from './membership-core.mjs';

export function firestoreStore(database, namespace) {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(namespace)) throw Error('Namespace inválido.');
  const base=database.collection('drive_access').doc(namespace);
  const grants=base.collection('memberships');
  const invites=base.collection('invites');
  const member=(company,uid)=>grants.doc(hash(JSON.stringify([company,uid])));
  return {
    async reserveProvider(kind) {
      const ref=database.collection('drive_provider_limits').doc(kind);
      await database.runTransaction(async tx=>{
        const last=(await tx.get(ref)).data()?.at ?? 0;
        const now=Date.now();
        if(now-last<1250) throw new HttpError(429,'O serviço nacional está ocupado. Tente novamente em instantes.');
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
        if (!(await tx.get(ref)).exists) throw new HttpError(404,'Vínculo não encontrado.');
        tx.update(ref,decision);
      });
    },
    async saveInvite(key,invite) { await invites.doc(key).create(invite); },
    async consumeInvite(key,uid,inspect) {
      const ref=invites.doc(key);
      await database.runTransaction(async tx=>{
        const grant=inspect((await tx.get(ref)).data());
        const membership=member(grant.company,uid);
        const prev=(await tx.get(membership)).data();
        tx.set(membership,{...grant,requested:prev?.requested ?? grant.requested});
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
