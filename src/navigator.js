import {createMap} from './map.js';
import {orderByProximity,readStops} from './navigation/stops.js';
import {distance,findZone,heading,inBounds,riskMonitor,routeCrossesZone} from './navigation/geometry.js';
import {projectProgress} from './navigation/router.js';

const arrows={left:'↰',right:'↱',straight:'↑',uturn:'↶',arrive:'●'};
const directions={left:'Vire à esquerda',right:'Vire à direita',straight:'Siga em frente',uturn:'Faça o retorno',arrive:'Chegada à parada'};
const audioFiles={start:'/audio/start.wav',left:'/audio/left.wav',right:'/audio/right.wav',straight:'/audio/straight.wav',uturn:'/audio/uturn.wav',arrive:'/audio/arrive.wav',risk:'/audio/risk.wav'};
const formatDistance = value => value>=1000 ? (value/1000).toFixed(1).replace('.',',')+' km' : Math.max(0,Math.round(value/10)*10)+' m';
const outputTemplate=`
  <aside class="route-panel" aria-label="Preparar rota">
    <div class="route-title"><span class="label">NAVEGAÇÃO</span><h1>Sua próxima rota</h1><p>Confira as paradas e baixe a região antes de sair.</p></div>
    <section class="pack-card">
      <div class="pack-top"><span class="download-icon" aria-hidden="true">⇩</span><div><h2>Mapa offline</h2><p id="pack-info">Selecione sua empresa para continuar.</p></div></div>
      <button class="secondary wide" id="download" type="button">Baixar região</button>
    </section>
    <section class="plan">
      <h2>Paradas da rota</h2>
      <p id="stops-help">Cole endereços ou pontos no formato Nome;Latitude;Longitude. Uma parada por linha.</p>
      <div class="origin-line"><span id="origin-state">Origem pelo GPS</span><button id="pick-origin" type="button" class="text-button">Marcar origem</button></div>
      <label class="sr-only" for="stops">Lista de paradas</label>
      <textarea id="stops" rows="4" aria-describedby="stops-help" placeholder="Parada 1;−22.888;−42.994"></textarea>
      <div class="inline-actions"><label class="file-label">Importar CSV<input type="file" id="csv" accept=".csv,.txt,text/csv,text/plain"></label><button id="pick-stop" class="text-button" type="button">Marcar parada no mapa</button></div>
      <div class="inline-actions" id="sample-action" hidden><button id="sample" class="text-button" type="button">Carregar rota de teste</button></div>
      <label class="reorder"><input type="checkbox" id="reorder"> Ordenar paradas por proximidade</label>
      <button class="primary wide" id="calculate" type="button">Calcular rota</button>
      <button class="primary wide" id="start-nav" type="button" hidden>Iniciar navegação</button>
      <p class="inline-note" id="nav-notice" aria-live="polite"></p>
      <ol id="itinerary"></ol>
    </section>
    <p class="fine">Mantenha o PWA visível para receber alertas. O GPS é usado durante a navegação.</p>
  </aside>
  <section class="map-wrap" aria-label="Mapa de navegação">
    <canvas id="map" aria-label="Mapa da região e da rota" role="img"></canvas>
    <div class="map-empty" id="map-empty"><strong>Seu trajeto aparece aqui</strong><span>Baixe uma região para abrir o mapa.</span></div>
    <div class="maneuver" id="maneuver" hidden aria-live="polite">
      <span class="turn-arrow" id="turn-arrow" aria-hidden="true">↑</span>
      <div><span id="turn-distance"></span><h2 id="turn-name">Obtendo GPS</h2><p id="turn-road"></p></div>
    </div>
    <p class="risk-banner" id="risk" role="alert" hidden></p>
    <div class="map-controls" aria-label="Controles do mapa"><button id="zoom-in" type="button" aria-label="Aproximar">+</button><button id="zoom-out" type="button" aria-label="Afastar">−</button><button id="fit" type="button" aria-label="Centralizar mapa">◎</button></div>
    <div class="travel" id="travel" hidden>
      <div><strong id="travel-time"></strong><span id="travel-distance"></span></div>
      <div class="travel-actions"><button id="mute" type="button" aria-pressed="false">Som ligado</button><button id="stop-nav" type="button">Encerrar</button></div>
    </div>
    <a class="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>
  </section>`;

export function makeNavigator(container, {download, persist, reportError}) {
  container.innerHTML=outputTemplate;
  const $=id=>container.querySelector('#'+id);
  let pack, packInfo, route, origin, position, bearing=0, progress=0, legIndex=0, completed=0;
  let watchId, wakeLock, lastVoice, muted=false, offRoute=0, rerouting=false, nav=false, selection='', selectedDestination;
  let monitor=riskMonitor();
  let worker, requestId=0;
  const pending=new Map();
  const audio=new Audio();
  const map=createMap($('map'),point=>{
    if (!selection) return;
    if (!pack || !inBounds(point,pack.bounds)) return note('Escolha um ponto dentro da região baixada.');
    if (selection==='origin') {
      origin=point;
      $('origin-state').textContent='Origem marcada no mapa';
    } else {
      selectedDestination=point;
      const value='Parada no mapa;'+point[1].toFixed(6)+';'+point[0].toFixed(6);
      $('stops').value=[$('stops').value.trim(),value].filter(Boolean).join('\n');
    }
    selection='';
    note('');
    redraw();
  });

  function note(text) { $('nav-notice').textContent=text; }
  function redraw() {map.set({pack,route,legIndex,position,bearing,origin,destination:selectedDestination,nav});}
  const save=()=>persist({route,origin,legIndex,completed,stopsText:$('stops').value});
  function setNetwork(online) { $('download').disabled=!online || !packInfo; $('download').textContent=pack?'Atualizar região':'Baixar região'; }
  function setPackInfo(info,online) {
    packInfo=info;
    $('pack-info').textContent=pack ? pack.region+' · baixado'
      : info ? info.region+' · '+Math.ceil(info.size/1024)+' KB' : 'Nenhuma região publicada.';
    setNetwork(online);
  }

  function setPack(newPack, fit=true) {
    if (newPack!==pack) {
      worker?.terminate();
      for (const result of pending.values()) result.reject(Error('O pacote mudou.'));
      pending.clear();
      worker=undefined;
    }
    pack=newPack;
    $('map-empty').hidden=!!pack;
    $('sample-action').hidden=pack?.riskMode!=='sample';
    $('calculate').disabled=!pack;
    $('pick-origin').disabled=!pack;
    $('pick-stop').disabled=!pack;
    if (pack && fit) map.fit(pack);
    redraw();
  }

  function compute(start,stops) {
    const isNew=!worker;
    if (isNew) {
      worker=new Worker(new URL('./navigation/worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{
        const result=pending.get(data.id);
        if (!result) return;
        pending.delete(data.id);
        if (data.error) result.reject(Error(data.error)); else result.resolve(data.result);
      };
      worker.onerror=()=>{
        for (const item of pending.values()) item.reject(Error('O motor de rota não respondeu.'));
        pending.clear();
        worker?.terminate();
        worker=undefined;
      };
    }
    return new Promise((resolve,reject)=>{
      const id=++requestId;
      pending.set(id,{resolve,reject});
      worker.postMessage({id,pack:isNew?pack:null,start,stops});
    });
  }

  function itinerary() {
    $('itinerary').replaceChildren(...(route?.legs ?? []).map((leg,i)=>{
      const item=document.createElement('li');
      item.textContent=leg.stop.name+(i<legIndex?' · concluída':findZone(leg.stop.point,pack.risks.features)?' · área mapeada':'');
      return item;
    }));
    $('start-nav').hidden=!route || legIndex>=route.legs.length;
    $('calculate').disabled=!pack || nav;
  }

  function acquireOrigin() {
    if (origin) return Promise.resolve(origin);
    return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(
      ({coords})=>{
        if (coords.accuracy>100) return reject(Error('GPS impreciso. Marque a origem no mapa.'));
        position=[coords.longitude,coords.latitude];resolve(position);
      },
      ()=>reject(Error('GPS indisponível. Marque a origem no mapa.')),
      {enableHighAccuracy:true,timeout:10000,maximumAge:5000}
    ));
  }

  async function calculate() {
    if (!pack || nav) return;
    $('calculate').disabled=true;
    note('Calculando rota…');
    try {
      const stops=readStops($('stops').value,pack);
      const start=await acquireOrigin();
      route=await compute(start,$('reorder').checked ? orderByProximity(start,stops) : stops);
      legIndex=0;completed=0;progress=0;
      await save();
      const crosses=routeCrossesZone(route.legs.flatMap(leg=>leg.segments),pack.risks.features);
      note(formatDistance(route.meters)+' · '+Math.max(1,Math.ceil(route.seconds/60))+' min estimados'+(crosses?' · Cruza área mapeada.':'.'));
      itinerary();
      redraw();
    } catch (error) {note(error.message);}
    finally { $('calculate').disabled=!pack || nav;}
  }

  function voice(kind,text) {
    if (muted) return;
    const synth=window.speechSynthesis;
    const available=synth?.getVoices() ?? [];
    const local=available.find(voice=>voice.localService && voice.lang.toLowerCase().startsWith('pt'));
    if (navigator.onLine || local) {
      if (synth) {
        synth.cancel();
        const message=new SpeechSynthesisUtterance(text);
        message.lang='pt-BR';
        if (local) message.voice=local;
        message.onerror=event=>{
          if (!['canceled','interrupted'].includes(event.error)) playClip(kind);
        };
        synth.speak(message);
        return;
      }
    }
    playClip(kind);
  }
  function playClip(kind) {
    if (!audioFiles[kind]) return;
    audio.src=audioFiles[kind];
    audio.play().catch(()=>{});
  }

  function guidance(leg,match) {
    const next=leg.maneuvers.find(man=>man.at>progress+14) ?? leg.maneuvers.at(-1);
    const remaining=Math.max(0,next.at-progress);
    $('turn-arrow').textContent=arrows[next.kind];
    $('turn-distance').textContent=formatDistance(remaining);
    $('turn-name').textContent=directions[next.kind];
    $('turn-road').textContent=next.name || leg.stop.name;
    const seconds=leg.segments.reduce((total,item)=>total+item.seconds*Math.min(1,Math.max(0,(item.at+item.meters-progress)/item.meters)),0)
      + route.legs.slice(legIndex+1).reduce((total,item)=>total+item.seconds,0);
    const meters=Math.max(0,leg.meters-progress)+route.legs.slice(legIndex+1).reduce((total,item)=>total+item.meters,0);
    const time=new Date(Date.now()+seconds*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    $('travel-time').textContent=Math.max(1,Math.ceil(seconds/60))+' min · '+time;
    $('travel-distance').textContent=formatDistance(meters)+' · Parada '+(completed+1);
    const phase=remaining<=55?1:remaining<=170?2:0;
    const key=legIndex+':'+next.at+':'+phase;
    if (match.distance<45 && phase && key!==lastVoice && !$('risk').dataset.new) {
      lastVoice=key;
      voice(next.kind,(phase===2?'Em '+Math.round(remaining)+' metros, ':'')+directions[next.kind].toLowerCase());
    }
  }

  function updateRisk(raw,accuracy) {
    const badge=$('risk');
    const covered=inBounds(raw,pack.bounds);
    const {entered,current}=monitor(raw,accuracy,covered?pack.risks.features:[]);
    badge.hidden=covered && !current;
    badge.textContent=!covered?'Fora da cobertura offline':current ?
      (pack.riskMode==='sample'?'Área de risco simulada':'Área de risco mapeada') : '';
    if (entered && covered) {
      badge.dataset.new='1';
      voice('risk',badge.textContent);
    } else delete badge.dataset.new;
  }

  async function reroute(raw) {
    if (rerouting) return;
    rerouting=true;
    const originalRoute=route;
    try {
      const next=await compute(raw,route.legs.slice(legIndex).map(leg=>leg.stop));
      if (!nav || originalRoute!==route) return;
      route={...route,legs:[...route.legs.slice(0,legIndex),...next.legs]};
      progress=0;offRoute=0;lastVoice=undefined;
      note('Trajeto recalculado no aparelho.');
      $('turn-road').textContent='Trajeto recalculado no aparelho.';
      redraw();
      await save();
    } catch {
      if (!nav) return;
      $('turn-name').textContent='Recálculo indisponível';
      $('turn-road').textContent='Trajeto salvo mantido.';
      note('Recálculo indisponível. Trajeto salvo mantido.');
    } finally {rerouting=false;}
  }

  function gps({coords}) {
    if (!nav || document.hidden || !route) return;
    const raw=[coords.longitude,coords.latitude];
    if (coords.accuracy>65) {
      $('turn-name').textContent='GPS impreciso';
      $('turn-road').textContent='Aguardando uma posição confiável.';
      updateRisk(raw,coords.accuracy);
      return;
    }
    const previous=position;
    position=raw;
    if (Number.isFinite(coords.heading) && (coords.speed ?? 0)>1) bearing=coords.heading;
    else if (previous && distance(previous,raw)>8) bearing=heading(previous,raw);
    updateRisk(raw,coords.accuracy);
    const leg=route.legs[legIndex];
    const match=projectProgress(leg,raw,progress);
    if (match.distance>Math.max(48,coords.accuracy*1.7)) {
      offRoute++;
      $('turn-name').textContent='Fora do trajeto';
      $('turn-road').textContent='Verificando novo caminho…';
      if (offRoute>=2) void reroute(raw);
    } else {
      offRoute=0;
      progress=Math.max(progress,match.at);
      guidance(leg,match);
      if (distance(raw,leg.stop.point)<32 || (progress>=leg.meters-8 && match.distance<18)) {
        if (!$('risk').dataset.new) voice('arrive','Chegada à parada '+leg.stop.name);
        legIndex++;completed++;progress=0;lastVoice=undefined;
        itinerary();
        void save().catch(reportError);
        if (legIndex===route.legs.length) {
          stopNavigation();
          $('turn-arrow').textContent=arrows.arrive;
          $('turn-distance').textContent='';
          $('turn-name').textContent='Rota concluída';
          $('turn-road').textContent=completed+' parada(s) concluída(s)';
          $('maneuver').hidden=false;
          note('Rota concluída.');
        } else {
          const nextLeg=route.legs[legIndex];
          guidance(nextLeg,projectProgress(nextLeg,raw));
        }
      }
    }
    redraw();
  }

  async function keepScreenOn() {
    if (!nav || document.hidden || !navigator.wakeLock || (wakeLock && !wakeLock.released)) return;
    try {
      const lock=await navigator.wakeLock.request('screen');
      if (nav) wakeLock=lock; else await lock.release();
    } catch { /* system setting or browser policy */ }
  }
  const handleVisibility=()=>{
    if (!nav) return;
    if (document.hidden) {
      window.speechSynthesis?.cancel();
      audio.pause();
      monitor=riskMonitor();
      $('risk').hidden=true;
      $('turn-name').textContent='Aguardando GPS';
      $('turn-road').textContent='A posição será atualizada ao voltar.';
    } else void keepScreenOn();
  };
  document.addEventListener('visibilitychange',handleVisibility);

  function startNavigation() {
    if (!route || legIndex>=route.legs.length || !navigator.geolocation) return;
    nav=true; lastVoice=undefined; offRoute=0; monitor=riskMonitor();
    container.classList.add('navigating');
    $('maneuver').hidden=false;
    $('travel').hidden=false;
    $('turn-name').textContent='Obtendo GPS…';
    $('start-nav').disabled=true;
    $('calculate').disabled=true;
    map.follow(position ?? origin ?? route.legs[legIndex].segments[0]?.a ?? route.legs[legIndex].stop.point);
    void keepScreenOn();
    window.speechSynthesis?.resume();
    if (!muted) voice('start','Navegação iniciada');
    watchId=navigator.geolocation.watchPosition(gps,()=>{
      $('turn-name').textContent='GPS indisponível';
      $('turn-road').textContent='Confira a permissão de localização.';
    },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    redraw();
  }

  function stopNavigation() {
    if (watchId!==undefined) navigator.geolocation.clearWatch(watchId);
    watchId=undefined;
    void wakeLock?.release().catch(()=>{});
    wakeLock=undefined;
    nav=false;
    window.speechSynthesis?.cancel();
    audio.pause();
    container.classList.remove('navigating');
    $('maneuver').hidden=true; $('travel').hidden=true; $('risk').hidden=true;
    $('start-nav').disabled=false;
    $('calculate').disabled=!pack;
    if (pack) map.fit(pack);
    redraw();
  }

  $('download').onclick=async ()=>{
    $('download').disabled=true;
    $('download').textContent='Baixando…';
    try { await download();note('Região pronta para uso offline.'); }
    catch (error) {note(error.message);}
    finally {setNetwork(navigator.onLine);}
  };
  $('csv').onchange=async event=>{
    const file=event.target.files[0];
    if (file?.size>24000) note('Arquivo muito grande. Importe até 30 paradas.');
    else if (file) $('stops').value=await file.text();
    event.target.value='';
  };
  $('pick-origin').onclick=()=>{selection='origin';note('Toque na sua origem no mapa.');$('map').scrollIntoView({block:'nearest'});};
  $('pick-stop').onclick=()=>{selection='stop';note('Toque na parada no mapa.');$('map').scrollIntoView({block:'nearest'});};
  $('sample').onclick=()=>{
    origin=[-42.996787,-22.888909];
    $('origin-state').textContent='Origem de teste carregada';
    $('stops').value='Entrega de teste;-22.886991;-42.990098';
    void calculate();
  };
  $('calculate').onclick=calculate;
  $('start-nav').onclick=startNavigation;
  $('stop-nav').onclick=stopNavigation;
  $('mute').onclick=()=>{
    muted=!muted;
    $('mute').textContent=muted?'Som desligado':'Som ligado';
    $('mute').setAttribute('aria-pressed',String(muted));
    if (muted) {window.speechSynthesis?.cancel();audio.pause();}
  };
  $('zoom-in').onclick=()=>map.zoom(1.25);
  $('zoom-out').onclick=()=>map.zoom(0.8);
  $('fit').onclick=()=>{if (pack) map.fit(pack);};
  return {
    active:()=>nav,
    setPackInfo,setNetwork,
    restore(snapshot) {
      stopNavigation();
      route=snapshot?.route;origin=snapshot?.origin;position=undefined;selectedDestination=undefined;
      legIndex=snapshot?.legIndex ?? 0;completed=snapshot?.completed ?? 0;progress=0;
      $('stops').value=snapshot?.stopsText ?? '';
      $('origin-state').textContent=origin?'Origem salva':'Origem pelo GPS';
      note('');
      setPack(snapshot?.pack);
      itinerary();
    },
    changePack(value) {
      route=undefined;legIndex=0;completed=0;progress=0;
      setPack(value);itinerary();
    }
  };
}
