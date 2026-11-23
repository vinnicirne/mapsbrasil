import {emailOf,HttpError} from './membership-core.mjs';

export function driverRegistration(apiKey) {
  async function call(operation,body) {
    const url=new URL('https://identitytoolkit.googleapis.com/v1/accounts:'+operation);
    url.searchParams.set('key',apiKey);
    const response=await fetch(url,{
      method:'POST',headers:{'content-type':'application/json','x-firebase-locale':'pt-BR'},
      body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(4000)
    });
    return {ok:response.ok,result:await response.json()};
  }
  return async (value,password)=>{
    const email=emailOf(value);
    if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400,'Informe um e-mail válido.');
    if (typeof password!=='string' || password.length<8 || password.length>128) {
      throw new HttpError(400,'Informe uma senha inicial de 8 a 128 caracteres.');
    }
    const {ok,result}=await call('signUp',{email,password,returnSecureToken:true}).catch(()=>{
      throw new HttpError(502,'Não foi possível confirmar o cadastro no Drive. Se a conta já existir, use Gerar convite.');
    });
    if (!ok) {
      const code=result.error?.message?.split(/[:\s]/)[0];
      if (code==='EMAIL_EXISTS') throw new HttpError(409,'Este e-mail já tem conta no Drive. Use Gerar convite para vinculá-lo à empresa.');
      if (['INVALID_EMAIL','WEAK_PASSWORD','PASSWORD_DOES_NOT_MEET_REQUIREMENTS'].includes(code)) {
        throw new HttpError(400,'Confira o e-mail ou escolha uma senha inicial mais forte.');
      }
      throw new HttpError(502,'O serviço de cadastro do Drive está temporariamente indisponível.');
    }
    const uid=result.localId;
    if (typeof uid!=='string' || !/^[\w-]{1,128}$/.test(uid) || emailOf(result.email)!==email) {
      throw new HttpError(502,'Não foi possível confirmar a conta criada no Drive. Use Gerar convite se ela já existir.');
    }
    const verificationSent=await call('sendOobCode',{requestType:'VERIFY_EMAIL',idToken:result.idToken})
      .then(response=>response.ok,()=>false);
    return {uid,email,verificationSent};
  };
}
