import {importX509,jwtVerify} from 'jose';
import {HttpError,emailOf} from './membership-core.mjs';

const certificatesUrl='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

function googleKeys() {
  let current, pending;
  async function refresh() {
    const response=await fetch(certificatesUrl,{signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw Error('Certificados do Firebase indisponíveis.');
    const certificates=Object.entries(await response.json());
    if (!certificates.length) throw Error('Resposta do Firebase sem certificados.');
    const entries=await Promise.all(certificates.map(async ([id,certificate])=>[id,await importX509(certificate,'RS256')]));
    const maxAge=Number(/(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 60);
    const loadedAt=Date.now();
    return {keys:new Map(entries),loadedAt,expires:loadedAt+maxAge*1000};
  }
  return async id=>{
    const now=Date.now();
    if (!current || current.expires<=now || (!current.keys.has(id) && now-current.loadedAt>=60000)) {
      pending ??= refresh().then(value=>{current=value;}).finally(()=>{pending=undefined;});
      try { await pending; }
      catch { throw new HttpError(503,'Serviço de login temporariamente indisponível.'); }
    }
    return current.keys.get(id);
  };
}

export function authVerifier(firebase,readKey=googleKeys()) {
  return async header=>{
    const match=/^Bearer (\S+)$/.exec(header ?? '');
    if (!match) throw new HttpError(401,'Entre para continuar.');
    if (!firebase) throw new HttpError(503,'Login ainda não configurado.');
    try {
      const {payload:claims}=await jwtVerify(match[1],async protectedHeader=>{
        if (typeof protectedHeader.kid!=='string' || !protectedHeader.kid) throw Error('Token sem chave.');
        const key=await readKey(protectedHeader.kid);
        if (!key) throw Error('Chave desconhecida.');
        return key;
      },{
        algorithms:['RS256'],issuer:'https://securetoken.google.com/'+firebase.projectId,audience:firebase.projectId,
        requiredClaims:['exp','iat','sub','auth_time'],maxTokenAge:'1h',clockTolerance:5
      });
      if (typeof claims.aud!=='string' || typeof claims.sub!=='string' || !claims.sub || claims.sub.length>128 ||
          typeof claims.auth_time!=='number' || claims.auth_time>Date.now()/1000+5) throw Error('Claims Firebase inválidas.');
      if (claims.email_verified!==true || typeof claims.email!=='string' || !claims.email)
        throw new HttpError(403,'Confirme seu e-mail no provedor de login.');
      return {uid:claims.sub,email:emailOf(claims.email)};
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401,'Sessão inválida. Entre novamente.');
    }
  };
}
