import {createMap} from './map.js';
import {orderByProximity,readStops} from './navigation/stops.js';
import {distance,findZone,heading,inBounds,riskMonitor,routeCrossesZone} from './navigation/geometry.js';
import {projectProgress} from './navigation/router.js';
import {createDestinationIndex} from './navigation/destinations.js';
import {createDestinationFinder} from './destination-finder.js';
import {createTrackingControl,routeCoordinates} from './tracking.js';
import {areaName,factionColors} from './navigation/factions.js';

const arrows={left:'↰',right:'↱',straight:'↑',uturn:'↶',arrive:'●'};
const directions={left:'Vire à esquerda',right:'Vire à direita',straight:'Siga em frente',uturn:'Faça o retorno',arrive:'Chegada à parada'};
const audioFiles={start:'/audio/start.wav',left:'/audio/left.wav',right:'/audio/right.wav',straight:'/audio/straight.wav',uturn:'/audio/uturn.wav',arrive:'/audio/arrive.wav',risk:'/audio/risk.wav'};
const formatDistance = value => value>=1000 ? (value/1000).toFixed(1).replace('.',',')+' km' : Math.max(0,Math.round(value/10)*10)+' m';
const outputTemplate=`
  <dialog class="route-panel" id="route-menu" aria-labelledby="route-menu-title">
    <div class="route-title"><h1 id="route-menu-title">Rotas</h1><button id="close-route-menu" class="icon-button close-menu" type="button" aria-label="Fechar menu de rotas" autofocus>×</button></div>
    <a class="text-button" href="/?vinculo=1">Vincular outra empresa</a>
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
    <section class="pack-card" id="tracking-settings" aria-labelledby="tracking-settings-title" hidden>
      <h2 id="tracking-settings-title">Localização</h2>
      <p>Mantenha o Drive aberto para atualizar sua posição no painel da empresa.</p>
      <p id="tracking-status" role="status" hidden></p>
      <button class="secondary" id="tracking-stop" type="button" hidden></button>
    </section>
    <p class="fine">Mantenha o PWA visível para receber alertas. O GPS é usado durante a navegação.</p>
  </dialog>
  <dialog class="fleet-consent" id="tracking-consent" aria-labelledby="tracking-title" aria-describedby="tracking-description">
    <form id="tracking-form">
      <h2 id="tracking-title">Permitir localização</h2>
      <p id="tracking-description">Permita o acesso à localização quando o navegador pedir. <strong id="tracking-company"></strong> verá sua posição e a rota em andamento enquanto o Drive estiver visível e conectado. Empresas com permissão de gestão dos motoristas também terão acesso. O envio será retomado ao reabrir o app para esta empresa. Você pode desativar o envio em Localização, no menu do Drive.</p>
      <p id="tracking-permission-help" role="alert" hidden>A localização está bloqueada. Nas permissões do site ou do app, libere a localização. Depois, volte ao Drive e toque em Tentar novamente.</p>
      <label for="tracking-name">Seu nome</label>
      <input id="tracking-name" required maxlength="100" autocomplete="name">
      <div class="fleet-consent-actions">
        <button class="secondary" id="tracking-decline" type="button" autofocus>Agora não</button>
        <button class="primary" type="submit">Permitir localização</button>
      </div>
    </form>
  </dialog>
  <section class="map-wrap" aria-label="Mapa de navegação">
    <div id="national-map" role="region" aria-label="Mapa de navegação do Brasil" hidden></div>
    <canvas id="map" aria-label="Mapa da região e da rota" role="img"></canvas>
    <div class="map-empty" id="map-empty"><strong>Seu trajeto aparece aqui</strong><span>Carregando a região disponível.</span></div>
    <button class="icon-button route-toggle" id="open-route-menu" type="button" aria-label="Abrir menu de rotas" aria-haspopup="dialog" aria-controls="route-menu" aria-expanded="false"><span aria-hidden="true"></span></button>
    <form class="destination-finder" id="destination-finder" aria-label="Buscar destino">
      <label for="destination-query">Para onde você vai?</label>
      <div class="destination-entry"><input id="destination-query" type="search" maxlength="180" placeholder="Rua, número e cidade" autocomplete="off" enterkeyhint="search">
        <button class="primary" type="submit">Buscar</button></div>
      <p role="status"></p>
      <ul aria-label="Resultados do endereço"></ul>
      <button class="primary wide" type="button" data-go hidden>Iniciar navegação até o destino</button>
    </form>
    <div class="point-picker" id="point-picker" hidden><p id="point-instruction" role="status"></p><button id="cancel-point" type="button" class="text-button">Cancelar</button></div>
    <details id="faction-legend" class="faction-legend" hidden><summary>Áreas de facções</summary><p id="faction-source"></p><ul></ul></details>
    <span id="offline-map-note" class="offline-map-note" hidden>Trajeto salvo · mapa de ruas indisponível offline</span>
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

export function makeNavigator(container, {download, prepareDestination, searchNational, routeNational, persist, reportError, sendTracking}) {
  container.innerHTML=outputTemplate;
  const $=id=>container.querySelector('#'+id);
  const menu=$('route-menu');
  const menuButton=$('open-route-menu');
  let pack, packInfo, route, origin, position, bearing=0, progress=0, legIndex=0, completed=0;
  let navigationFix;
  let watchId, wakeLock, lastVoice, muted=false, offRoute=0, rerouting=false, nav=false, selection='', selectedDestination;
  let monitor=riskMonitor();
  let worker, requestId=0;
  const pending=new Map();
  const addressCache=new Map();
  let searchPosition, searchPositionAt=0, locating;
  const audio=new Audio();
  let hasStoredPack=false,connected=false,nationalMap,nationalLoading,findLocal,factions,alertFactions,factionLoad,selectedSearchPoint,lastReroute=0,planning=false,demo=false;
  const tracker=createTrackingControl({
    dialog:$('tracking-consent'),status:$('tracking-status'),button:$('tracking-stop'),settings:$('tracking-settings'),send:sendTracking,
    route:()=>nav?routeCoordinates(route,legIndex):[],
    latestFix:()=>nav?navigationFix:undefined,
    beforePrompt:()=>{endPointSelection();if(menu.open) menu.close();}
  });
  function openMenu() {
    menu.showModal();
    menuButton.setAttribute('aria-expanded','true');
  }
  function endPointSelection() {
    selection='';
    container.classList.remove('picking-point');
    $('point-picker').hidden=true;
  }
  menuButton.onclick=()=>{endPointSelection();openMenu();};
  $('close-route-menu').onclick=()=>menu.close();
  menu.addEventListener('close',()=>menuButton.setAttribute('aria-expanded',String(menu.open)));
  menu.addEventListener('click',event=>{
    if (event.target===menu && event.clientX>menu.getBoundingClientRect().right) menu.close();
  });
  const onMapPoint=point=>{
    if (!selection) return;
    if (!pack || !inBounds(point,pack.bounds)) {
      $('point-instruction').textContent='Escolha um ponto dentro da região disponível.';
      return;
    }
    if (selection==='origin') {
      origin=point;
      $('origin-state').textContent='Origem marcada no mapa';
    } else {
      selectedDestination=point;
      const value='Parada no mapa;'+point[1].toFixed(6)+';'+point[0].toFixed(6);
      $('stops').value=[$('stops').value.trim(),value].filter(Boolean).join('\n');
    }
    endPointSelection();
    note('');
    redraw();
    openMenu();
  };
  const map=createMap($('map'),onMapPoint);
  function locateSearch() {
    if (Date.now()-searchPositionAt<30000 || !navigator.geolocation) return Promise.resolve(searchPosition);
    if (locating) return locating;
    locating=new Promise(resolve=>{
      const settle=point=>{
        searchPosition=point;
        searchPositionAt=Date.now();
        resolve(point);
      };
      navigator.geolocation.getCurrentPosition(
        ({coords})=>settle(coords.accuracy<=5000 ? [coords.longitude,coords.latitude].map(value=>Number(value.toFixed(3))) : undefined),
        ()=>settle(undefined),
        {timeout:3500,maximumAge:5000}
      );
    }).finally(()=>{locating=undefined;});
    return locating;
  }
  $('destination-query').addEventListener('focus',()=>void locateSearch());
  const finder=createDestinationFinder($('destination-finder'),{
    find:async (address,{signal,preview})=>{
      const near=await Promise.race([locateSearch(),new Promise(resolve=>setTimeout(resolve,180))]);
      signal.throwIfAborted();
      const bounds=pack?.bounds;
      const localRegionNearby=!near || !bounds || distance(near,near.map((coordinate,axis)=>
        Math.min(Math.max(coordinate,bounds[axis]),bounds[axis+2])
      ))<=30000;
      const local=(!connected || localRegionNearby) ? findLocal?.(address,near) ?? [] : [];
      if (!connected && !findLocal) throw Error('Abra o mapa da região com internet antes de pesquisar offline.');
      if (!connected || local.some(result=>result.precision==='address' || result.precision==='coordinate')) return local;
      const key=address.normalize().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ')+'|'+(near?.join(',')??'');
      const cached=addressCache.get(key);
      if(cached?.expires>Date.now()) return cached.results.length ? cached.results : local;
      addressCache.delete(key);
      preview(local);
      const national=await searchNational(address,near,signal);
      if(!signal.aborted) {
        if(addressCache.size>=30) addressCache.delete(addressCache.keys().next().value);
        addressCache.set(key,{results:national,expires:Date.now()+120000});
      }
      return national.length ? national : local;
    },
    select:result=>{
      selectedSearchPoint=result?.point;
      redraw();
      if (!result || selection) return;
      if (nationalVisible()) nationalMap.focus(result.point);
      else map.focus(result.point);
      const risk=findZone(result.point,riskAlerts());
      return risk && 'Destino em área mapeada: '+areaName(risk)+'.';
    },
    navigate:async destination=>{
      if (planning || nav) throw Error('Encerre a navegação em andamento primeiro.');
      planning=true;
      try {
        if (connected) await prepareDestination();
        const start=await acquireOrigin(false);
        const stop={name:destination.name.slice(0,120),point:destination.point};
        const planned=await computeRoute(start,[stop]);
        origin=undefined;
        $('origin-state').textContent='Origem pelo GPS';
        $('stops').value=stop.name.replaceAll(';',',')+';'+stop.point[1]+';'+stop.point[0];
        await applyRoute(planned);
        startNavigation();
        finder.reset();
      } finally {planning=false;}
    }
  });

  function note(text) { $('nav-notice').textContent=text; }
  function nationalVisible() {
    return !!nationalMap?.ready() && connected && (operationalLayer() || route?.profile==='national' ||
      (selectedSearchPoint && !inBounds(selectedSearchPoint,pack?.bounds ?? [0,0,0,0])));
  }

  function operationalLayer() {
    return pack?.riskMode==='operational' || (connected && packInfo?.riskMode==='operational');
  }

  function riskFeatures() {
    if (!operationalLayer()) return pack?.risks.features ?? [];
    return factions ?? (pack?.riskMode==='operational' ? pack.risks.features : []);
  }

  function riskAlerts() {
    return operationalLayer() ? alertFactions ?? riskFeatures() : riskFeatures();
  }

  function loadFactions() {
    if (!operationalLayer() || factions || factionLoad) return;
    factionLoad=import('./map-data/faccoes-rj.json').then(({default:source})=>{
      factions=source.features.map((feature,index)=>({...feature,id:feature.id??'rj-'+index,
        properties:{label:feature.properties.n,faction:feature.properties.f}}));
      alertFactions=factions.filter(feature=>feature.properties.faction!=='NEU');
      legend();
      redraw();
    }).catch(()=>{factionLoad=undefined;});
  }

  function legend() {
    const panel=$('faction-legend');
    panel.hidden=!operationalLayer() || !riskFeatures().length;
    if(panel.hidden) return;
    $('faction-source').textContent='Rio de Janeiro · Dados de Riscos / GENI-UFF · ago/2026';
    const unique=new Map();
    for (const feature of riskFeatures()) {
      const code=feature.properties?.faction;
      if(code && !unique.has(code)) unique.set(code,factionColors(feature)[0]);
    }
    panel.querySelector('ul').replaceChildren(...[...unique].map(([code,color])=>{
      const item=document.createElement('li');
      const marker=document.createElement('i');
      marker.style.backgroundColor=color;
      item.append(marker,code);
      return item;
    }));
  }

  function enableNationalMap() {
    if (!connected || nationalMap || nationalLoading) return;
    nationalLoading=import('./national-map.js').then(({createNationalMap})=>{
      const element=$('national-map');
      element.hidden=false;
      try { nationalMap=createNationalMap(element,onMapPoint,redraw); }
      catch { element.hidden=true; }
      redraw();
      nationalMap?.resize();
    }).catch(()=>{});
  }

  function redraw() {
    const useNational=nationalVisible();
    const changed=$('map').hidden!==useNational;
    const preparing=!!nationalMap && connected && !nationalMap.ready();
    $('national-map').hidden=!useNational && !preparing;
    $('national-map').style.visibility=useNational?'visible':'hidden';
    $('map').hidden=useNational;
    $('map-empty').hidden=useNational || !!pack;
    $('offline-map-note').hidden=useNational || route?.profile!=='national';
    const state={pack,route,legIndex,position,bearing,origin,destination:selectedSearchPoint ?? selectedDestination,nav,risks:riskFeatures()};
    if (useNational) {
      if(changed) {
        nationalMap.resize();
        if(!nav && selectedSearchPoint) nationalMap.focus(selectedSearchPoint);
        else if(!nav) nationalMap.overview(route);
      }
      nationalMap.set(state);
    } else {
      map.set(state);
      if(changed && !nav && route?.profile==='national') map.fitRoute(route);
    }
  }
  const save=()=>persist({route,origin,legIndex,completed,stopsText:$('stops').value});
  function setNetwork(online) {
    connected=online;
    $('download').disabled=!online || !packInfo;
    $('download').textContent=hasStoredPack?'Atualizar região':'Baixar região';
    if (operationalLayer()) {enableNationalMap();loadFactions();}
    $('sample-action').hidden=!demo || pack?.riskMode!=='sample' || operationalLayer();
    legend();
    redraw();
  }
  function setPackInfo(info,online) {
    packInfo=info;
    $('pack-info').textContent=hasStoredPack && pack ? pack.region+(info && info.version!==pack.version?' · atualização disponível':' · baixado')
      : info ? info.region+' · '+Math.ceil(info.size/1024)+' KB' : 'Nenhuma região publicada.';
    setNetwork(online);
  }

  function setPack(newPack, stored=true) {
    hasStoredPack=!!newPack && stored;
    if (newPack!==pack) {
      worker?.terminate();
      for (const result of pending.values()) result.reject(Error('O pacote mudou.'));
      pending.clear();
      worker=undefined;
    }
    if (pack!==newPack) findLocal=newPack?createDestinationIndex(newPack):undefined;
    pack=newPack;
    loadFactions();
    legend();
    $('sample-action').hidden=!demo || pack?.riskMode!=='sample' || operationalLayer();
    $('calculate').disabled=!pack;
    $('pick-origin').disabled=!pack;
    $('pick-stop').disabled=!pack;
    if (pack) map.fit(pack);
    if (route?.profile==='national') map.fitRoute(route);
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

  function acquireOrigin(useSaved=true) {
    if (useSaved && origin) return Promise.resolve(origin);
    if (!navigator.geolocation) return Promise.reject(Error('GPS indisponível neste navegador.'));
    return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(
      fix=>{
        const {coords}=fix;
        if (coords.accuracy>100) return reject(Error('GPS impreciso. Marque a origem no mapa.'));
        navigationFix=fix;
        position=[coords.longitude,coords.latitude];resolve(position);
      },
      ()=>reject(Error('GPS indisponível. Marque a origem no mapa.')),
      {enableHighAccuracy:true,timeout:10000,maximumAge:useSaved?5000:0}
    ));
  }

  async function computeRoute(start,stops) {
    if (pack && [start,...stops.map(stop=>stop.point)].every(point=>inBounds(point,pack.bounds))) return compute(start,stops);
    if (!connected) throw Error('O recálculo fora da região baixada precisa de internet. O trajeto salvo continua disponível.');
    enableNationalMap();
    return routeNational(start,stops);
  }

  async function applyRoute(planned) {
    route=planned;
    legIndex=0;completed=0;progress=0;lastReroute=0;
    await save();
    const crosses=routeCrossesZone(route.legs.flatMap(leg=>leg.segments),riskAlerts());
    note(formatDistance(route.meters)+' · '+Math.max(1,Math.ceil(route.seconds/60))+' min estimados'+(crosses?' · Cruza área mapeada.':'.'));
    itinerary();
    redraw();
    if (route.profile==='national') {
      if(nationalVisible()) nationalMap.overview(route);
      else map.fitRoute(route);
    }
  }

  async function calculate() {
    if (!pack || nav || planning) return;
    planning=true;
    $('calculate').disabled=true;
    note('Calculando rota…');
    try {
      const stops=readStops($('stops').value,pack);
      const start=await acquireOrigin();
      await applyRoute(await computeRoute(start,$('reorder').checked ? orderByProximity(start,stops) : stops));
    } catch (error) {note(error.message);}
    finally { planning=false; $('calculate').disabled=!pack || nav;}
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
    const {entered,current}=monitor(raw,accuracy,riskAlerts());
    badge.hidden=!current && (covered || route?.profile==='national');
    badge.textContent=current ? (!operationalLayer()?'Área de risco simulada':'Área de risco mapeada · '+areaName(current))
      : 'Fora da cobertura offline';
    if (entered) {
      badge.dataset.new='1';
      voice('risk',badge.textContent);
    } else delete badge.dataset.new;
  }

  async function reroute(raw) {
    if (rerouting || Date.now()-lastReroute<8000) return;
    lastReroute=Date.now();
    rerouting=true;
    const originalRoute=route;
    try {
      const next=await computeRoute(raw,route.legs.slice(legIndex).map(leg=>leg.stop));
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

  function gps(fix) {
    if (!nav || document.hidden || !route) return;
    const {coords}=fix;
    const raw=[coords.longitude,coords.latitude];
    if (coords.accuracy>65) {
      $('turn-name').textContent='GPS impreciso';
      $('turn-road').textContent='Aguardando uma posição confiável.';
      updateRisk(raw,coords.accuracy);
      return;
    }
    navigationFix=fix;
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
        const announceArrival=!$('risk').dataset.new;
        legIndex++;completed++;progress=0;lastVoice=undefined;
        if (legIndex===route.legs.length) {
          finishNavigation('Rota concluída.');
          if (announceArrival) voice('arrive','Chegada à parada '+leg.stop.name);
          return;
        }
        if (announceArrival) voice('arrive','Chegada à parada '+leg.stop.name);
        itinerary();
        void save().catch(reportError);
        const nextLeg=route.legs[legIndex];
        guidance(nextLeg,projectProgress(nextLeg,raw));
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
    if (menu.open) menu.close();
    endPointSelection();
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
    tracker.refresh();
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
  }

  function finishNavigation(message) {
    stopNavigation();
    resetTrip();
    itinerary();
    redraw();
    if (nationalVisible()) nationalMap.overview();
    else if (pack) map.fit(pack);
    $('destination-finder').querySelector('[role="status"]').textContent=message;
    tracker.refresh();
    void save().catch(reportError);
  }

  function resetTrip() {
    route=origin=position=navigationFix=selectedDestination=selectedSearchPoint=undefined;
    legIndex=completed=progress=bearing=0;
    $('stops').value='';
    $('origin-state').textContent='Origem pelo GPS';
    finder.reset();
    note('');
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
  function pickPoint(kind) {
    if(nav || !pack) return;
    selection=kind;
    menu.close();
    if(nationalVisible()) nationalMap.focus(origin ?? pack.nodes[0]);
    else map.fit(pack);
    $('point-instruction').textContent=kind==='origin'?'Toque na sua origem no mapa.':'Toque na parada no mapa.';
    container.classList.add('picking-point');
    $('point-picker').hidden=false;
  }
  $('pick-origin').onclick=()=>pickPoint('origin');
  $('pick-stop').onclick=()=>pickPoint('stop');
  $('cancel-point').onclick=()=>{endPointSelection();openMenu();};
  $('sample').onclick=()=>{
    if (!demo || pack?.riskMode!=='sample' || operationalLayer()) return;
    origin=[-42.996787,-22.888909];
    $('origin-state').textContent='Origem de teste carregada';
    $('stops').value='Entrega de teste;-22.886991;-42.990098';
    void calculate();
  };
  $('calculate').onclick=calculate;
  $('start-nav').onclick=startNavigation;
  $('stop-nav').onclick=()=>finishNavigation('Navegação encerrada.');
  $('mute').onclick=()=>{
    muted=!muted;
    $('mute').textContent=muted?'Som desligado':'Som ligado';
    $('mute').setAttribute('aria-pressed',String(muted));
    if (muted) {window.speechSynthesis?.cancel();audio.pause();}
  };
  $('zoom-in').onclick=()=>(nationalVisible()?nationalMap:map).zoom(1.25);
  $('zoom-out').onclick=()=>(nationalVisible()?nationalMap:map).zoom(0.8);
  $('fit').onclick=()=>{
    if(nationalVisible()) nationalMap.overview(route);
    else if(route?.profile==='national') map.fitRoute(route);
    else if(pack) map.fit(pack);
  };
  return {
    active:()=>nav,
    setTrackingCompany:tracker.setCompany,
    stopTracking:tracker.stop,
    setPackInfo,setNetwork,
    setDemo(value) {demo=value;},
    previewPack(value) { if(!hasStoredPack) setPack(value,false); },
    restore(snapshot) {
      if (menu.open) menu.close();
      endPointSelection();
      stopNavigation();
      const finished=snapshot?.route && snapshot.legIndex>=snapshot.route.legs.length;
      const legacyDemo=!demo && snapshot?.stopsText==='Entrega de teste;-22.886991;-42.990098';
      resetTrip();
      if (!finished && !legacyDemo) {
        route=snapshot?.route;
        origin=snapshot?.origin;
        legIndex=snapshot?.legIndex ?? 0;
        completed=snapshot?.completed ?? 0;
        $('stops').value=snapshot?.stopsText ?? '';
        $('origin-state').textContent=origin?'Origem salva':'Origem pelo GPS';
      }
      addressCache.clear();
      setPack(snapshot?.pack);
      itinerary();
      if (!route && nationalVisible()) nationalMap.overview();
      if (finished || legacyDemo) void save().catch(reportError);
    },
    changePack(value) {
      route=undefined;legIndex=0;completed=0;progress=0;
      setPack(value);itinerary();
    }
  };
}
