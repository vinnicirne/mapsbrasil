const interval=15000;

export function routeCoordinates(route,legIndex) {
  const points=(route?.legs ?? []).slice(legIndex).flatMap(leg=>{
    if(!leg.segments.length) return [];
    return [leg.segments[0].a,...leg.segments.map(segment=>segment.b)];
  });
  if(points.length<2) return [];
  const count=Math.min(points.length,240);
  return Array.from({length:count},(_,index)=>points[Math.round(index*(points.length-1)/(count-1))])
    .flatMap(point=>point.map(value=>Number(value.toFixed(5))));
}

export function createTrackingControl({dialog,status,button,settings,send,route,beforePrompt,latestFix}) {
  const form=dialog.querySelector('form');
  const name=form.querySelector('input');
  const companyName=dialog.querySelector('#tracking-company');
  const permissionHelp=dialog.querySelector('#tracking-permission-help');
  const allow=form.querySelector('button[type="submit"]');
  let scope,active,preference,attempted=false,blocked=false;

  function remember(value) {
    preference=value;
    try {localStorage.setItem(scope.key,JSON.stringify(value));} catch { /* Consent still applies to this open session. */ }
  }

  function feedback(text) {
    status.textContent=text;
    status.hidden=!scope || !text;
    settings.hidden=!scope;
    button.textContent=active?'Desativar localização':blocked?'Desbloquear localização':'Compartilhar GPS';
    button.hidden=!scope;
  }

  async function stop() {
    const session=active;
    if(!session) return;
    active=undefined;
    clearInterval(session.timer);
    void session.wakeLock?.release().catch(()=>{});
    if (session.watch!==undefined) navigator.geolocation.clearWatch(session.watch);
    feedback('Compartilhamento encerrado.');
    if (!session.attemptedUpload) return;
    try {
      await session.sending?.catch(()=>{});
      await send(session.company,{session:session.id,stop:true});
    } catch { /* The panel stops showing the position when the update expires. */ }
  }

  function publish(session,{coords,timestamp}) {
    if (active!==session || document.hidden || !navigator.onLine || session.sending) return;
    if (coords.accuracy>1000) return feedback('Aguardando sinal de GPS mais preciso…');
    session.attemptedUpload=true;
    session.sending=send(session.company,{
      session:session.id,name:session.name,position:[coords.longitude,coords.latitude],
      accuracy:coords.accuracy,observedAt:Math.round(timestamp),route:route()
    });
    session.sending.then(()=>{
      session.sent=true;
      if(active===session) feedback('');
    }).catch(error=>{
      if (active!==session) return;
      if ([401,403].includes(error.status)) void stop();
      feedback(error.message || 'Não foi possível enviar a posição.');
    }).finally(()=>{
      session.sending=undefined;
      if (active===session && session.needsFresh) refresh();
    });
  }

  const geoOptions={enableHighAccuracy:true,maximumAge:5000,timeout:10000};
  function failedFix(session,error) {
    if(active!==session) return;
    if(error.code!==1) return feedback('Aguardando sinal de GPS…');
    void stop();
    showBlockedPermission();
  }
  async function keepScreenAwake(session) {
    if (document.hidden || !navigator.wakeLock || session.requestingWakeLock ||
        (session.wakeLock && !session.wakeLock.released)) return;
    session.requestingWakeLock=true;
    try {
      const lock=await navigator.wakeLock.request('screen');
      if (active===session && !document.hidden) session.wakeLock=lock;
      else await lock.release();
    } catch { /* The device controls when a screen lock is available. */ }
    finally {session.requestingWakeLock=false;}
  }

  function refresh(fresh=false) {
    const session=active;
    if (!session || document.hidden) return;
    if (fresh) session.needsFresh=true;
    if (session.locating || session.sending) return;
    if (!navigator.onLine) return feedback('Sem internet. A empresa aguarda uma posição atualizada.');
    fresh=session.needsFresh===true;
    session.needsFresh=false;
    const navigationFix=latestFix();
    const fix=(!session.fix || navigationFix?.timestamp>session.fix.timestamp) ? navigationFix : session.fix;
    if (!fresh && session.watch!==undefined && fix && Date.now()-fix.timestamp<20000) return publish(session,fix);
    session.locating=true;
    navigator.geolocation.getCurrentPosition(fix=>{
      session.locating=false;
      acceptFix(session,fix);
    },error=>{
      session.locating=false;
      failedFix(session,error);
      if (active===session && session.needsFresh) refresh();
    },fresh?{...geoOptions,maximumAge:0}:geoOptions);
  }

  function acceptFix(session,fix) {
    if (active!==session) return;
    session.fix=fix;
    void keepScreenAwake(session);
    if (session.watch===undefined) {
      session.watch=navigator.geolocation.watchPosition(next=>{
        session.fix=next;
        if(!session.sent) publish(session,next);
      },error=>failedFix(session,error),geoOptions);
    }
    if (session.needsFresh) refresh();
    else publish(session,fix);
  }

  async function start() {
    if (!scope || active) return;
    attempted=true;
    blocked=false;
    if (!navigator.geolocation) return feedback('GPS indisponível neste navegador.');
    const session=active={id:crypto.randomUUID(),company:scope.id,
      name:preference.name,timer:setInterval(refresh,interval)};
    feedback('Obtendo posição do GPS…');
    const knownFix=latestFix();
    if (knownFix && Date.now()-knownFix.timestamp<10000) {
      const permission=await navigator.permissions?.query({name:'geolocation'}).catch(()=>undefined);
      if (active!==session) return;
      if (permission?.state==='denied') return failedFix(session,{code:1});
      if (permission?.state==='granted') return acceptFix(session,knownFix);
    }
    refresh();
  }

  function prompt() {
    if (!scope) return;
    permissionHelp.hidden=!blocked;
    allow.textContent=blocked?'Tentar novamente':'Permitir localização';
    if(dialog.open) return;
    beforePrompt();
    dialog.showModal();
  }

  function showBlockedPermission() {
    blocked=true;
    feedback('Localização bloqueada.');
    prompt();
  }

  async function resume() {
    if (!scope || document.hidden || !navigator.onLine) return;
    if(active) return refresh(true);
    if(attempted) return;
    if(!preference) return prompt();
    if(!preference.enabled) return;

    attempted=true;
    const currentScope=scope;
    const permission=await navigator.permissions?.query({name:'geolocation'}).catch(()=>undefined);
    if (currentScope!==scope || dialog.open || document.hidden || !navigator.onLine) {
      if (currentScope===scope && !dialog.open) attempted=false;
      return;
    }
    if (permission?.state==='denied') return showBlockedPermission();
    if (permission?.state==='prompt') return prompt();
    start();
  }

  function decline() {
    remember({enabled:false});
    dialog.close();
    feedback('');
  }

  form.onsubmit=event=>{
    event.preventDefault();
    if(!scope || !name.value.trim()) return;
    remember({enabled:true,name:name.value.trim()});
    dialog.close();
    start();
  };
  dialog.querySelector('#tracking-decline').onclick=decline;
  dialog.addEventListener('cancel',event=>{event.preventDefault();decline();});
  button.onclick=()=>{
    if(active) {
      remember({enabled:false});
      return void stop();
    }
    prompt();
  };
  window.addEventListener('online',resume);
  window.addEventListener('pageshow',event=>{if(event.persisted) void resume();});
  window.addEventListener('offline',()=>refresh());
  document.addEventListener('visibilitychange',resume);
  return {
    stop,refresh,
    setCompany(context) {
      const key=context && 'mapsbrasil-gps-v1:'+encodeURIComponent(context.uid)+':'+encodeURIComponent(context.id);
      if (scope?.key===key) return;
      if(dialog.open) dialog.close();
      void stop();
      scope=context && {...context,key};
      attempted=false;
      blocked=false;
      preference=undefined;
      if(scope) {
        try {
          const saved=JSON.parse(localStorage.getItem(key));
          if (saved?.enabled===false || (saved?.enabled===true && typeof saved.name==='string' && saved.name.trim() && saved.name.length<=100)) {
            preference=saved;
          }
        } catch { /* Ask for consent when no preference can be recovered. */ }
        companyName.textContent=scope.companyName;
        name.value=preference?.name || scope.driverName;
      }
      feedback('');
      resume();
    }
  };
}
