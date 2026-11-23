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

export function createTrackingControl({dialog,status,button,send,route,beforePrompt,latestFix}) {
  const form=dialog.querySelector('form');
  const name=form.querySelector('input');
  const companyName=dialog.querySelector('#tracking-company');
  let scope,active,preference,attempted=false;

  function remember(value) {
    preference=value;
    try {localStorage.setItem(scope.key,JSON.stringify(value));} catch { /* Consent still applies to this open session. */ }
  }

  function feedback(text) {
    status.textContent=text;
    status.hidden=!scope || !text;
    button.textContent=active?'Parar compartilhamento':'Compartilhar GPS';
    button.hidden=!scope;
  }

  async function stop() {
    const session=active;
    if(!session) return;
    active=undefined;
    clearInterval(session.timer);
    navigator.geolocation.clearWatch(session.watch);
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
      if(active===session) feedback('GPS enviado para '+session.companyName+'.');
    }).catch(error=>{
      if (active!==session) return;
      if ([401,403].includes(error.status)) void stop();
      feedback(error.message || 'Não foi possível enviar a posição.');
    }).finally(()=>{session.sending=undefined;});
  }

  const geoOptions={enableHighAccuracy:true,maximumAge:5000,timeout:10000};
  function failedFix(session,error) {
    if(active!==session) return;
    if(error.code===1) void stop();
    feedback(error.code===1?'Autorize a localização no navegador para compartilhar.':'Aguardando sinal de GPS…');
  }
  function refresh() {
    const session=active;
    if (!session || session.locating || session.sending || document.hidden) return;
    if (!navigator.onLine) return feedback('Sem internet. A empresa aguarda uma posição atualizada.');
    const navigationFix=latestFix();
    const fix=(!session.fix || navigationFix?.timestamp>session.fix.timestamp) ? navigationFix : session.fix;
    if (fix && Date.now()-fix.timestamp<20000) return publish(session,fix);
    session.locating=true;
    navigator.geolocation.getCurrentPosition(fix=>{
      session.locating=false;
      session.fix=fix;
      publish(session,fix);
    },error=>{
      session.locating=false;
      failedFix(session,error);
    },geoOptions);
  }

  function start() {
    if (!scope || active) return;
    attempted=true;
    if (!navigator.geolocation) return feedback('GPS indisponível neste navegador.');
    const session=active={id:crypto.randomUUID(),company:scope.id,companyName:scope.companyName,
      name:preference.name,timer:setInterval(refresh,interval)};
    feedback('Obtendo posição do GPS…');
    session.watch=navigator.geolocation.watchPosition(fix=>{
      session.fix=fix;
      if(!session.sent) publish(session,fix);
    },error=>failedFix(session,error),geoOptions);
    refresh();
  }

  function prompt() {
    if (!scope || dialog.open) return;
    beforePrompt();
    dialog.showModal();
  }

  function resume() {
    if (!scope || document.hidden || !navigator.onLine) return;
    if(active) return refresh();
    if(attempted) return;
    if(preference?.enabled) start();
    else if(!preference) prompt();
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
  window.addEventListener('offline',refresh);
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
