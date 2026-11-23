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

export function createTrackingControl({form,button,send,route,openSettings,latestFix}) {
  const name=form.querySelector('input');
  const status=form.querySelector('[role="status"]');
  const submit=form.querySelector('button');
  let company,active;

  function feedback(text) {
    status.textContent=text;
    button.textContent=active?'Parar compartilhamento':'Compartilhar GPS';
    button.hidden=!company;
  }

  async function stop() {
    const session=active;
    if(!session) return;
    active=undefined;
    clearInterval(session.timer);
    navigator.geolocation.clearWatch(session.watch);
    submit.textContent='Compartilhar localização';
    name.disabled=false;
    feedback('Compartilhamento encerrado.');
    try {
      await session.sending?.catch(()=>{});
      await send(session.company,{session:session.id,stop:true});
    } catch { /* The panel stops showing the position when the update expires. */ }
  }

  function publish(session,{coords,timestamp}) {
    if (active!==session || document.hidden || !navigator.onLine || session.sending) return;
    if (coords.accuracy>1000) return feedback('Aguardando sinal de GPS mais preciso…');
    session.sending=send(session.company,{
      session:session.id,name:session.name,position:[coords.longitude,coords.latitude],
      accuracy:coords.accuracy,observedAt:Math.round(timestamp),route:route()
    });
    session.sending.then(()=>{
      session.sent=true;
      if(active===session) feedback('Localização compartilhada com a empresa.');
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

  form.onsubmit=event=>{
    event.preventDefault();
    if(active) return void stop();
    if(!company || !navigator.geolocation || !name.value.trim()) return feedback('Informe seu nome e permita o GPS.');
    const session=active={id:crypto.randomUUID(),company,name:name.value.trim(),timer:setInterval(refresh,interval)};
    submit.textContent='Parar compartilhamento';
    name.disabled=true;
    feedback('Obtendo posição do GPS…');
    session.watch=navigator.geolocation.watchPosition(fix=>{
      session.fix=fix;
      if(!session.sent) publish(session,fix);
    },error=>failedFix(session,error),geoOptions);
    refresh();
  };
  button.onclick=()=>{
    if(active) return void stop();
    openSettings();
    name.focus();
  };
  window.addEventListener('online',refresh);
  window.addEventListener('offline',refresh);
  document.addEventListener('visibilitychange',refresh);
  return {
    stop,refresh,
    setCompany(id,driverName) {
      if (company!==id) {
        void stop();
        name.value=driverName ?? '';
      }
      company=id;
      form.hidden=!id;
      button.hidden=!id;
      if(id && !active) button.textContent='Compartilhar GPS';
    }
  };
}
