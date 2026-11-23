import {HttpError} from './membership-core.mjs';

const point=([lon,lat])=>Number.isFinite(lon) && lon>=-180 && lon<=180 && Number.isFinite(lat) && lat>=-90 && lat<=90;

export function trackingService(store,access) {
  return {
    async update(user,company,input) {
      const {session}=input;
      if (typeof session!=='string' || !/^[a-f0-9-]{36}$/.test(session)) throw new HttpError(400,'Sessão de compartilhamento inválida.');
      if (input.stop===true) {
        await store.stopTracking(company,user.uid,session);
        return {sharing:false};
      }
      await access.requireApproved(user,company);
      const {position,route,accuracy,observedAt}=input;
      const name=typeof input.name==='string'?input.name.trim():'';
      const now=Date.now();
      if (!name || name.length>100 || !Array.isArray(position) || position.length!==2 || !point(position) ||
          !Array.isArray(route) || route.length>480 || route.length%2 || !Number.isFinite(accuracy) || accuracy<0 || accuracy>1000 ||
          !Number.isSafeInteger(observedAt) || observedAt<now-60000 || observedAt>now+30000) {
        throw new HttpError(400,'Posição do GPS ou trajeto inválido.');
      }
      for (let i=0;i<route.length;i+=2) {
        if (!point([route[i],route[i+1]])) throw new HttpError(400,'Trajeto inválido.');
      }
      await store.updateTracking(company,user.uid,{
        session,name,position,route,accuracy,observedAt,updatedAt:now,expiresAt:new Date(now+90000)
      });
      return {sharing:true,updatedAt:now};
    },
    async live(company) {
      const rows=await store.liveTracking(company,Date.now()-65000);
      const positions=await Promise.all(rows.map(async row=>{
        const member=await store.get(company,row.uid);
        if (member?.status!=='approved') return null;
        const {uid,name,position,route,accuracy,updatedAt}=row;
        return {uid,name:member.driverName || name,phone:member.driverPhone || '',position,route,accuracy,updatedAt};
      }));
      return positions.filter(Boolean);
    }
  };
}
