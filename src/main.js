import './style.css';
import {connectAuth} from './auth-client.js';
import {makeNavigator} from './navigator.js';
import {allowsOffline,clearSnapshot,loadSnapshot,offlineExpiry,readPack,saveSnapshot} from './offline.js';

const root=document.querySelector('#app');
root.innerHTML=`
  <header class="app-header">
    <a class="brand" href="/" aria-label="MapsBrasil Drive, início"><img src="/icons/icon-192.png" alt="" width="42" height="42"><span>MapsBrasil Drive</span></a>
    <div class="header-actions">
      <span id="network" class="network" aria-live="polite"><i></i><span>Online</span></span>
      <a href="/gestao" id="manage-link" hidden>Gestão de motoristas</a>
      <a href="/" id="driver-link" hidden>Área do motorista</a>
      <button id="logout" type="button" hidden>Sair</button>
    </div>
  </header>
  <p id="feedback" role="alert" class="feedback" hidden></p>
  <main id="welcome" class="welcome" hidden>
    <article class="access-card">
      <div class="access-symbol" aria-hidden="true">↗</div>
      <h1 id="access-title">Entre para navegar</h1>
      <p id="access-copy">Use seu e-mail verificado para acessar suas rotas e preparar o mapa offline.</p>
      <div id="login-group" hidden>
        <button type="button" class="primary wide" id="sign-in">Continuar com Google</button>
        <form id="email-login" hidden>
          <label for="login-email">E-mail</label><input id="login-email" type="email" required autocomplete="email" maxlength="254">
          <label for="login-password">Senha</label><input id="login-password" type="password" required autocomplete="current-password" minlength="6">
          <button type="submit" class="secondary wide">Entrar com e-mail</button>
          <button type="button" class="text-button wide" id="register-email">Criar conta com e-mail</button>
          <button type="button" class="text-button wide" id="reset-email">Redefinir senha</button>
        </form>
        <div id="demo-logins" hidden><p class="demo-hint">Demonstração local</p>
          <button type="button" data-demo="driver" class="primary wide">Entrar como motorista</button>
          <button type="button" data-demo="admin" class="secondary wide">Entrar como empresa</button>
        </div>
      </div>
      <div id="verification" hidden>
        <button type="button" class="secondary wide" id="resend-email">Reenviar confirmação</button>
        <button type="button" class="primary wide" id="verify-email">Já confirmei meu e-mail</button>
      </div>
      <div id="join-group" hidden>
        <div id="memberships" class="memberships"></div>
        <form id="join-form">
          <label for="code">Código da empresa</label><input id="code" name="code" maxlength="120" required autocomplete="off">
          <button class="primary wide" type="submit">Solicitar acesso</button>
        </form>
        <button class="secondary wide" id="accept-invite" type="button" hidden>Aceitar convite</button>
        <button class="text-button wide" id="refresh" type="button">Atualizar situação</button>
      </div>
    </article>
  </main>
  <main id="workspace" class="workspace" hidden>
    <section class="company-bar"><label for="company">Empresa</label><select id="company"></select><span id="sample-label" hidden>Áreas de risco simuladas</span></section>
    <div id="navigation" class="navigation"></div>
  </main>
  <main id="management" class="manager" hidden>
    <section class="manager-head"><h1>Gestão de motoristas</h1><p>Analise solicitações e convide motoristas para usar o MapsBrasil Drive.</p></section>
    <section class="manager-tools">
      <div><label for="managed-company">Empresa</label><select id="managed-company"></select></div>
      <div><p>Código para autocadastro</p><output id="join-code"></output></div>
      <form id="invite-form"><label for="invite-email">E-mail do motorista</label>
        <div><input id="invite-email" type="email" required maxlength="254" placeholder="motorista@email.com"><button class="primary" type="submit">Gerar convite</button></div>
      </form>
    </section>
    <div id="invite-result" hidden><label for="invite-link">Link do convite</label>
      <input id="invite-link" readonly><button id="copy-link" type="button" class="text-button">Copiar convite</button>
    </div>
    <section class="requests"><div class="requests-title"><h2>Vínculos</h2><button type="button" id="refresh-list" class="text-button">Atualizar lista</button></div>
      <div id="member-list"></div>
    </section>
  </main>`;

const $=id=>document.getElementById(id);
const isManagement=location.pathname==='/gestao';
const handoff=new URLSearchParams(location.search);
const inviteToken=handoff.get('convite');
if (handoff.has('codigo')) $('code').value=handoff.get('codigo');
const statusLabels={pending:'Pendente',approved:'Aprovado',rejected:'Recusado',revoked:'Revogado'};
let config,auth,profile,company,snapshot,info,serverReachable=false;
let refreshSequence=0;
const report=message=>{
  const text=message?.message ?? message ?? '';
  $('feedback').textContent=text;
  $('feedback').hidden=!text;
};
const navigatorUI=makeNavigator($('navigation'),{download,persist,reportError:report});

async function api(path,{method='GET',body,raw=false}={}) {
  const token=await auth?.token();
  if (!token) throw Object.assign(Error('Entre para continuar.'),{status:401});
  const result=await fetch('/api'+path,{method,headers:{
    Authorization:'Bearer '+token,
    ...(body?{'content-type':'application/json'}:{})
  },body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  if (!result.ok) {
    const payload=await result.json().catch(()=>({}));
    throw Object.assign(Error(payload.error ?? 'Serviço temporariamente indisponível.'),{status:result.status});
  }
  return raw?result:result.json();
}
const apiFor=(resource,options)=>api('/companies/'+encodeURIComponent(company)+'/'+resource,options);
const run=fn=>async event=>{
  event?.preventDefault();
  report('');
  try { await fn(event); } catch(error) {report(error);}
};

function renderNetwork() {
  const online=navigator.onLine && serverReachable;
  $('network').querySelector('span').textContent=online?'Online':'Offline';
  $('network').classList.toggle('offline',!online);
  navigatorUI.setNetwork(online);
}
function screen(name) {
  for (const id of ['welcome','workspace','management']) $(id).hidden=id!==name;
}
function accessScreen(title,copy,{login=false,join=false,verify=false}={}) {
  screen('welcome');
  $('access-title').textContent=title;
  $('access-copy').textContent=copy;
  $('login-group').hidden=!login;
  $('join-group').hidden=!join;
  $('sign-in').hidden=!!config?.demo || !config?.firebase;
  $('email-login').hidden=$('sign-in').hidden;
  $('verification').hidden=!verify;
  $('demo-logins').hidden=!config?.demo;
  $('accept-invite').hidden=!inviteToken;
}
function fillSelect(select,entries,value) {
  select.replaceChildren(...entries.map(({id,name})=>new Option(name,id,id===value,id===value)));
}
function renderMemberships() {
  $('memberships').replaceChildren(...profile.memberships.map(member=>{
    const item=document.createElement('p');
    item.textContent=member.name+' · '+statusLabels[member.status];
    return item;
  }));
}
async function clearLocal() {
  snapshot=undefined;
  navigatorUI.restore();
  await clearSnapshot();
}
function showSnapshot() {
  screen('workspace');
  company=snapshot.company;
  fillSelect($('company'),[{id:company,name:snapshot.companyName}],company);
  $('sample-label').hidden=snapshot.pack.riskMode!=='sample';
  navigatorUI.restore(snapshot);
  navigatorUI.setPackInfo(null,false);
  $('logout').hidden=false;
  $('manage-link').hidden=true;
}

async function boot() {
  try { snapshot=await loadSnapshot(); } catch(error) {report(error);}
  try {
    const result=await fetch('/api/config',{cache:'no-store',signal:AbortSignal.timeout(3500)});
    if (!result.ok) throw Error('Serviço indisponível.');
    config=await result.json();
    auth=await connectAuth(config);
    if (auth && localStorage.getItem('mapsbrasil-signout')) {
      await auth.logout();
      localStorage.removeItem('mapsbrasil-signout');
    }
    serverReachable=true;
  } catch {
    serverReachable=false;
    if (snapshot && !isManagement && await allowsOffline(snapshot)) showSnapshot();
    else accessScreen('Aguardando conexão','Conecte-se para entrar, confirmar seu vínculo e preparar a primeira rota.');
    renderNetwork();
    return;
  }
  await refresh();
}

async function refresh() {
  const sequence=++refreshSequence;
  renderNetwork();
  if (!auth) return accessScreen('Login em preparação','A administração precisa configurar o provedor de identidade do piloto.');
  if (!await auth.token()) {
    if (snapshot) await clearLocal();
    return accessScreen('Entre para navegar','Use seu e-mail verificado para acessar suas rotas e preparar o mapa offline.',{login:true});
  }
  try {
    profile=await api('/me');
  } catch (error) {
    if (error.status===401) {
      await auth.logout();
      if (snapshot) await clearLocal();
      accessScreen('Entre novamente',error.message,{login:true});
      return;
    }
    if (error.status===403) {
      if (snapshot) await clearLocal();
      $('logout').hidden=false;
      accessScreen('E-mail pendente de verificação',error.message,{verify:!config?.demo});
      return;
    }
    serverReachable=false;
    if (snapshot && !isManagement && await allowsOffline(snapshot)) showSnapshot();
    else accessScreen('Serviço indisponível','Conecte-se novamente para validar seu acesso.');
    renderNetwork();
    return;
  }
  if (sequence!==refreshSequence) return;
  serverReachable=true;
  $('logout').hidden=false;
  $('manage-link').hidden=isManagement || profile.companies.length===0;
  $('driver-link').hidden=!isManagement;
  const approved=profile.memberships.filter(member=>member.status==='approved');
  if (snapshot && (snapshot.uid!==profile.user.uid || !approved.some(member=>member.company===snapshot.company))) await clearLocal();
  if (isManagement) {
    if (!profile.companies.length) return accessScreen('Acesso restrito','A gestão de motoristas é reservada aos administradores da empresa.');
    screen('management');
    const select=$('managed-company');
    fillSelect(select,profile.companies,select.value || profile.companies[0].id);
    await listMembers();
  } else if (!approved.length || inviteToken) {
    screen('welcome');
    renderMemberships();
    accessScreen(profile.memberships.some(item=>item.status==='pending')?'Aguardando aprovação':'Solicite seu vínculo',
      'Informe o código recebido da empresa ou aceite o convite enviado ao seu e-mail.',{join:true});
  } else {
    screen('workspace');
    const selected=approved.find(member=>member.company===company) ?? approved.find(member=>member.company===snapshot?.company) ?? approved[0];
    fillSelect($('company'),approved.map(member=>({id:member.company,name:member.name})),selected.company);
    await chooseCompany(selected.company);
  }
  renderNetwork();
}

async function chooseCompany(id) {
  if (company!==id) {
    company=id;
    navigatorUI.restore(snapshot?.company===id?snapshot:undefined);
  }
  $('sample-label').hidden=snapshot?.company!==id || snapshot?.pack.riskMode!=='sample';
  const nextInfo=await apiFor('pack');
  if (company!==id) return;
  info=nextInfo;
  navigatorUI.setPackInfo(info,true);
  if (snapshot?.company===id && info?.version===snapshot.pack.version) {
    const current=snapshot;
    const lease=await apiFor('lease',{method:'POST',body:{version:info.version}});
    if (snapshot===current) {
      snapshot={...current,lease};
      await saveSnapshot(snapshot);
    }
  }
}

async function download() {
  if (!info || navigatorUI.active()) throw Error('Encerre a navegação antes de baixar outra versão.');
  const active=company;
  if ('serviceWorker' in navigator) {
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('A abertura offline ainda não foi preparada. Recarregue a página.')),8000))]);
  } else throw Error('Este navegador não disponibiliza a instalação offline.');
  await navigator.storage?.persist?.().catch(()=>false);
  const pack=await readPack(await apiFor('pack?file=1',{raw:true}),info);
  if (active!==company || !profile) throw Error('A empresa mudou durante o download.');
  const lease=await apiFor('lease',{method:'POST',body:{version:pack.version}});
  if (active!==company || !profile) throw Error('A empresa mudou durante o download.');
  const previous=snapshot?.company===active && snapshot?.pack.version===pack.version ? snapshot : null;
  const next={...previous,pack,lease,uid:profile.user.uid,company:active,companyName:profile.memberships.find(item=>item.company===active).name};
  await saveSnapshot(next);
  snapshot=next;
  $('sample-label').hidden=pack.riskMode!=='sample';
  if (previous) navigatorUI.restore(snapshot);
  else navigatorUI.changePack(pack);
  navigatorUI.setPackInfo(info,true);
}

async function persist(state) {
  if (!snapshot || snapshot.company!==company) return;
  const value={...snapshot,...state};
  await saveSnapshot(value);
  if (snapshot?.company===value.company) snapshot=value;
}

async function listMembers() {
  const id=$('managed-company').value;
  $('join-code').textContent=profile.companies.find(company=>company.id===id)?.joinCode ?? '';
  const rows=await api('/companies/'+id+'/members');
  if ($('managed-company').value!==id) return;
  const list=$('member-list');
  list.replaceChildren();
  if (!rows.length) list.textContent='Nenhuma solicitação recebida.';
  for (const row of rows) {
    const card=document.createElement('article');
    card.className='member';
    card.setAttribute('aria-label',row.email);
    const label=document.createElement('strong');
    label.textContent=row.email;
    const state=document.createElement('span');
    state.className='member-state';
    state.textContent=statusLabels[row.status];
    const actions=document.createElement('div');
    const decisions=row.status==='pending'?[['approved','Aprovar'],['rejected','Recusar']]
      : row.status==='approved'?[['revoked','Revogar']]:[['approved','Reaprovar']];
    for (const [status,title] of decisions) {
      const button=document.createElement('button');
      button.type='button';button.className=status==='approved'?'primary':'secondary';button.textContent=title;
      button.onclick=run(async()=>{
        await api('/companies/'+id+'/decision',{method:'POST',body:{uid:row.uid,status}});
        await listMembers();
      });
      actions.append(button);
    }
    card.append(label,state,actions);
    list.append(card);
  }
}

$('login-group').addEventListener('click',run(async event=>{
  const role=event.target.closest('[data-demo]')?.dataset.demo;
  if (role) await auth.demoLogin(role);
  else if (event.target.closest('#sign-in')) await auth.login();
  else return;
  await refresh();
}));
const credentials=()=>[$('login-email').value,$('login-password').value];
$('email-login').onsubmit=run(async()=>{
  await auth.emailLogin(...credentials());
  await refresh();
});
$('register-email').onclick=run(async()=>{
  if (!$('email-login').reportValidity()) return;
  await auth.register(...credentials());
  await refresh();
});
$('reset-email').onclick=run(async()=>{
  if (!$('login-email').reportValidity()) return;
  await auth.reset($('login-email').value);
  report('Confira sua caixa de entrada para redefinir a senha.');
});
$('resend-email').onclick=run(async()=>{
  await auth.resend();
  report('Link de verificação enviado.');
});
$('verify-email').onclick=run(async()=>{
  await auth.checkVerification();
  await refresh();
});
$('logout').onclick=run(async()=>{
  refreshSequence++;
  localStorage.setItem('mapsbrasil-signout','1');
  await clearLocal();
  if (auth) {
    await auth.logout();
    localStorage.removeItem('mapsbrasil-signout');
  }
  profile=undefined;
  company=undefined;
  location.replace('/');
});
$('join-form').onsubmit=run(async()=>{
  await api('/join',{method:'POST',body:{code:$('code').value}});
  await refresh();
});
$('accept-invite').onclick=run(async()=>{
  await api('/accept',{method:'POST',body:{token:inviteToken}});
  location.replace('/');
});
$('refresh').onclick=run(refresh);
$('refresh-list').onclick=run(listMembers);
$('managed-company').onchange=run(async()=>{$('invite-result').hidden=true;await listMembers();});
$('company').onchange=run(async()=>{
  if (navigatorUI.active()) { $('company').value=company;throw Error('Encerre a navegação antes de trocar de empresa.'); }
  await chooseCompany($('company').value);
});
$('invite-form').onsubmit=run(async()=>{
  const id=$('managed-company').value;
  const {token}=await api('/companies/'+id+'/invite',{method:'POST',body:{email:$('invite-email').value}});
  const url=new URL('/',location.origin);
  url.searchParams.set('convite',token);
  $('invite-link').value=url.href;
  $('invite-result').hidden=false;
});
$('copy-link').onclick=run(async()=>{
  await navigator.clipboard.writeText($('invite-link').value);
  $('copy-link').textContent='Convite copiado';
});

const expireOffline=async()=>{
  if (!serverReachable && snapshot && offlineExpiry(snapshot)<=Date.now()) {
    await clearLocal();
    accessScreen('Autorização offline expirada','Conecte-se para validar seu vínculo e retomar a navegação.');
  }
};
window.addEventListener('offline',()=>{serverReachable=false;renderNetwork();void expireOffline().catch(report);});
window.setInterval(()=>void expireOffline().catch(report),15000);
window.addEventListener('online',run(async()=>{
  if (!auth) return boot();
  serverReachable=true;
  await refresh();
}));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
void boot().catch(report);
