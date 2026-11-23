import {authVerifier} from './firebase-token.mjs';
import {HttpError} from './membership-core.mjs';

export const corporateDomainPattern=/^[a-z0-9][a-z0-9.-]{1,118}[a-z0-9]$/;

export function corporateManagement({env,companies,ensureCompany,verifyToken}) {
  if (!env.DRIVE_CORPORATE_ORIGIN) return;
  const origin=new URL(env.DRIVE_CORPORATE_ORIGIN);
  const projectId=env.DRIVE_CORPORATE_AUTH_PROJECT;
  const databaseId=env.DRIVE_CORPORATE_DATABASE;
  if (origin.protocol!=='https:' || origin.origin!==env.DRIVE_CORPORATE_ORIGIN ||
      !/^[a-z0-9-]+$/.test(projectId ?? '') || !/^(?:\(default\)|[a-z0-9-]+)$/.test(databaseId ?? '')) {
    throw Error('Configuração corporativa inválida.');
  }
  const byDomain=new Map(companies.filter(company=>company.corporateDomain).map(company=>[company.corporateDomain,company]));
  const authenticate=verifyToken ?? authVerifier({projectId});
  const base='https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/'+encodeURIComponent(databaseId)+'/documents/';

  async function read(path,authorization,mask=[],list=false) {
    const url=new URL(base+path);
    for (const field of mask) url.searchParams.append('mask.fieldPaths',field);
    if(list) url.searchParams.set('pageSize','1');
    try {
      const response=await fetch(url,{
        headers:{authorization},redirect:'error',signal:AbortSignal.timeout(5000)
      });
      if ([403,404].includes(response.status)) return;
      if (!response.ok) throw Error();
      return await response.json();
    } catch {
      throw new HttpError(503,'Não foi possível confirmar o acesso no Painel Empresa.');
    }
  }

  return {
    origin:origin.origin,
    async authorize(domain,authorization) {
      const {uid}=await authenticate(authorization);
      if (!/^[\w-]{1,128}$/.test(uid)) throw new HttpError(401,'Conta corporativa inválida.');
      const [record,user]=await Promise.all([
        read('corporate_companies/'+domain,authorization,['active','companyName']),
        read('users/'+encodeURIComponent(uid),authorization,['status','licenseStatus','companyRole','companyDomain','domain'])
      ]);
      const profile=user?.fields;
      if (record?.fields?.active?.booleanValue!==true || !profile) {
        throw new HttpError(403,'Acesso à gestão de motoristas restrito aos administradores da empresa ativa.');
      }
      const companyDomain=profile.companyDomain?.stringValue || profile.domain?.stringValue;
      const canManage=profile.status?.stringValue==='approved' && profile.licenseStatus?.stringValue!=='suspended' &&
        profile.companyRole?.stringValue==='company_admin' && companyDomain===domain;
      // The territorial rules allow listing companies only for SuperAdmins.
      if (!canManage && !await read('corporate_companies',authorization,['active'],true)) {
        throw new HttpError(403,'Acesso à gestão de motoristas restrito aos administradores da empresa.');
      }
      const company=byDomain.get(domain) ?? await ensureCompany(domain,record.fields.companyName?.stringValue || domain);
      return {company,user:{uid:'corporate:'+uid,managedCompany:company.id}};
    }
  };
}
