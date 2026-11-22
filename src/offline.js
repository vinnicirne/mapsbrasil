const table='state';
let connection;
function database() {
  connection ??= new Promise((resolve,reject)=>{
    const request=indexedDB.open('mapsbrasil-offline',1);
    request.onupgradeneeded=()=>request.result.createObjectStore(table);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  return connection;
}

async function transaction(mode,callback) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(table,mode);
    const op=callback(tx.objectStore(table));
    tx.oncomplete=()=>resolve(op.result);
    tx.onabort=()=>reject(tx.error ?? Error('O navegador interrompeu a gravação.'));
  });
}
export const loadSnapshot=()=>transaction('readonly',store=>store.get('turn'));
export const saveSnapshot=value=>transaction('readwrite',store=>store.put(value,'turn'));
export const clearSnapshot=()=>transaction('readwrite',store=>store.delete('turn'));

const bytes64=text=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));

export function offlineExpiry(snapshot) {
  try { return JSON.parse(new TextDecoder().decode(bytes64(snapshot.lease.claims))).expires; }
  catch { return 0; }
}

export async function allowsOffline(snapshot) {
  try {
    const {lease, uid, company, pack}=snapshot;
    const decoded=JSON.parse(new TextDecoder().decode(bytes64(lease.claims)));
    if (decoded.sub!==uid || decoded.company!==company || decoded.packVersion!==pack.version || decoded.expires<=Date.now()) return false;
    const key=await crypto.subtle.importKey('jwk',lease.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes64(lease.signature),new TextEncoder().encode(lease.claims));
  } catch { return false; }
}

export async function readPack(response, info) {
  const data=await response.arrayBuffer();
  const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)), byte=>byte.toString(16).padStart(2,'0')).join('');
  if (checksum!==info.sha256) throw Error('Download incompleto ou corrompido. Tente baixar novamente.');
  const pack=JSON.parse(new TextDecoder().decode(data));
  if (pack.format!==1 || pack.version!==info.version || !pack.roads?.length || !Array.isArray(pack.risks?.features))
    throw Error('Pacote inválido para este aplicativo.');
  return pack;
}
