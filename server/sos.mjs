import {HttpError} from './membership-core.mjs';

export function sosId(value) {
  if (typeof value!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) {
    throw new HttpError(400,'Identificador de SOS inválido.');
  }
  return value;
}

function recentLocation(value, now) {
  if (!value || !Array.isArray(value.position) || value.position.length!==2 ||
      !value.position.every(Number.isFinite) || Math.abs(value.position[0])>180 || Math.abs(value.position[1])>90 ||
      !Number.isSafeInteger(value.observedAt) || value.observedAt<now-120000 || value.observedAt>now+10000) return null;
  return {position:value.position,observedAt:value.observedAt};
}

export function sosService(store,access) {
  return {
    async send(user,company,input) {
      const id=sosId(input.id);
      await access.requireApproved(user,company);
      const createdAt=Date.now();
      const location=recentLocation(input.location,createdAt);
      return store.createSos(company,user,{id,createdAt,location});
    },
    async pending(company) {
      const alerts=await store.pendingSos(company);
      return alerts.sort((left,right)=>right.createdAt-left.createdAt);
    },
    subscribe:store.watchSos,
    acknowledge(company,id,user) {
      return store.acknowledgeSos(company,sosId(id),user.uid);
    }
  };
}
