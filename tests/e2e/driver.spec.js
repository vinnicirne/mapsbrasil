import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {makeRouter,projectProgress} from '../../src/navigation/router.js';
import {distance,findZone} from '../../src/navigation/geometry.js';

const pack=JSON.parse(readFileSync(new URL('../../public/packs/rio-do-ouro.json',import.meta.url),'utf8'));
const origin=[-42.996787,-22.888909], destination=[-42.990098,-22.886991];
const driverStop={point:destination,name:'Entrega de teste'};
const router=makeRouter(pack);
const leg=router(origin,[driverStop]).legs[0];
const asPosition=([longitude,latitude])=>({longitude,latitude,accuracy:4});

async function locate(context,coordinate) {
  await context.setGeolocation(asPosition(coordinate));
}

test('autocadastro, aprovação por empresa e navegação offline com manobras, recálculo e chegada',async({browser,baseURL})=>{
  test.setTimeout(65000);
  const driver=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    geolocation:asPosition(origin),permissions:['geolocation']});
  const company=await browser.newContext({baseURL});
  const page=await driver.newPage();
  const manager=await company.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const menu=page.getByRole('dialog',{name:'Rotas'});
  const openMenu=page.getByRole('button',{name:'Abrir menu de rotas'});
  await page.goto('/');
  await expect(page).toHaveTitle(/MapsBrasil Drive/);
  await expect(page.getByRole('link',{name:'MapsBrasil Drive, início'})).toHaveText('MapsBrasil Drive');
  const manifest=await page.request.get('/manifest.webmanifest');
  expect((await manifest.json()).name).toBe('MapsBrasil Drive');
  await page.getByRole('button',{name:'Entrar como motorista'}).click();
  await page.getByLabel('Código da empresa').fill('codigo-invalido');
  await page.getByRole('button',{name:'Solicitar acesso'}).click();
  await expect(page.locator('#join-feedback')).toHaveText('Código de adesão inválido.');
  await page.getByLabel('Código da empresa').fill('rio-demo');
  await page.getByRole('button',{name:'Solicitar acesso'}).click();
  await expect(page.getByRole('heading',{name:'Aguardando aprovação'})).toBeVisible();
  await expect(page.locator('#join-feedback')).toHaveText('Solicitação enviada para Operação Rio do Ouro. Aguarde a aprovação da empresa.');
  await page.goto('/gestao');
  await expect(page.getByRole('heading',{name:'Acesso restrito'})).toBeVisible();

  await manager.goto('/gestao');
  await manager.getByRole('button',{name:'Entrar como empresa'}).click();
  const member=manager.getByRole('article',{name:'entregador@example.test'});
  await expect(member).toContainText('Pendente');
  await member.getByRole('button',{name:'Aprovar',exact:true}).click();
  await expect(member).toContainText('Aprovado');

  await page.goto('/?codigo=rio-demo');
  await expect(page.getByLabel('Código da empresa')).toHaveValue('rio-demo');
  await page.getByRole('button',{name:'Solicitar acesso'}).click();
  await expect(page.locator('#join-feedback')).toHaveText('Seu acesso a Operação Rio do Ouro já está aprovado.');
  await expect(page.getByRole('link',{name:'Voltar ao mapa'})).toBeVisible();
  await page.goto('/');
  await page.getByRole('button',{name:'Agora não'}).click();
  let releaseLocal;
  const nationalPending=new Promise(resolve=>{releaseLocal=resolve;});
  await page.route('**/api/companies/piloto/search',async route=>{
    await nationalPending;
    await route.fulfill({json:[]}).catch(()=>{});
  });
  await expect(menu).toBeHidden();
  const mapBounds=await page.getByRole('region',{name:'Mapa de navegação',exact:true}).boundingBox();
  expect(mapBounds.width).toBe(390);
  expect(mapBounds.y+mapBounds.height).toBe(844);
  await openMenu.click();
  await expect(menu).toBeVisible();
  await menu.getByRole('button',{name:'Marcar origem'}).click();
  await expect(page.getByText('Toque na sua origem no mapa.')).toBeVisible();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(openMenu).toHaveAttribute('aria-expanded','false');
  await page.getByLabel('Para onde você vai?').fill('Rua Jorge Rachid, São Gonçalo');
  const localResult=page.getByRole('button',{name:/Rua Jorge Rachid.*Ponto aproximado/i});
  await expect(page.getByText('Resultados da região. Buscando mais endereços…')).toBeVisible();
  await localResult.click();
  releaseLocal();
  await page.getByRole('button',{name:'Iniciar navegação até o destino'}).click();
  await expect(page.getByRole('button',{name:'Finalizar rota'})).toBeVisible();
  const livePositions=()=>manager.evaluate(async()=>{
    const response=await fetch('/api/companies/piloto/tracking',{
      headers:{authorization:'Bearer '+sessionStorage.getItem('mapsbrasil-demo-session')}
    });
    return response.json();
  });
  expect(await livePositions()).toEqual([]);
  await page.getByRole('button',{name:'Abrir menu de rotas'}).click();
  await page.getByRole('button',{name:'Compartilhar GPS'}).click();
  await page.getByLabel('Seu nome').fill('Motorista de teste');
  await page.getByRole('button',{name:'Permitir localização'}).click();
  await expect.poll(async()=>(await livePositions())[0]?.name).toBe('Motorista de teste');
  const firstLocation=(await livePositions())[0];
  expect(firstLocation.position).toEqual(origin);
  expect(firstLocation.route.length).toBeGreaterThanOrEqual(4);
  const nextPoint=[origin[0]+0.00001,origin[1]];
  await locate(driver,nextPoint);
  await expect.poll(async()=>(await livePositions())[0]?.position,{timeout:20000}).toEqual(nextPoint);
  await openMenu.click();
  await page.getByRole('button',{name:'Desativar localização'}).click();
  await page.keyboard.press('Escape');
  await expect.poll(livePositions).toEqual([]);
  await locate(driver,origin);
  await page.getByRole('button',{name:'Finalizar rota'}).click();
  await expect(page.getByText('Rota finalizada.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Para onde você vai?')).toHaveValue('');
  await openMenu.click();
  await expect(page.locator('#itinerary li')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Atualizar região'})).toBeVisible();
  await page.unroute('**/api/companies/piloto/search');
  await expect(page.getByText('Áreas de risco simuladas',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Carregar rota de teste'}).click();
  await expect(page.getByText('Cruza área mapeada.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Iniciar navegação',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);

  await driver.setOffline(true);
  await page.goto('/');
  await expect(page.locator('#network')).toHaveText('Offline');
  await page.getByLabel('Para onde você vai?').fill('Rua Jorge Rachid, São Gonçalo');
  await expect(localResult).toBeVisible();
  await page.getByLabel('Para onde você vai?').clear();
  await openMenu.click();
  await expect(page.locator('#itinerary')).toContainText('Entrega de teste');
  const offlineAudio=await page.evaluate(async()=>{
    const response=await fetch('/audio/left.wav');
    const audio=new AudioContext();
    try { return (await audio.decodeAudioData(await response.arrayBuffer())).duration; }
    finally { await audio.close(); }
  });
  expect(offlineAudio).toBeGreaterThan(.5);
  await expect(page.getByRole('img',{name:'Mapa da região e da rota'})).toBeVisible();
  await page.getByRole('button',{name:'Iniciar navegação',exact:true}).click();
  await expect(page.locator('#turn-name')).toHaveText('Vire à esquerda');
  await expect(page.locator('#travel-time')).toContainText('min');
  await expect.poll(()=>page.locator('#map').evaluate(canvas=>{
    const [r,g,b]=canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;
    return [r,g,b];
  })).toEqual([35,98,222]);
  await expect(page.getByRole('button',{name:'Finalizar rota'})).toBeInViewport();
  await page.screenshot({path:test.info().outputPath('navegacao-offline.png')});

  const zone=pack.risks.features[0];
  const crossing=leg.segments.flatMap(segment=>[segment.a,segment.b]).filter(point=>findZone(point,[zone]));
  const points=[...new Map(crossing.map(point=>[point.join(','),point])).values()];
  expect(points.length).toBeGreaterThanOrEqual(2);
  const initialDistance=await page.locator("#turn-distance").textContent();
  await locate(driver,points[0]);
  await expect(page.locator("#turn-distance")).not.toHaveText(initialDistance);
  await locate(driver,points[1]);
  await expect(page.getByRole('alert').filter({hasText:'Área de risco simulada'})).toBeVisible();

  const turnMiddle=(leg.maneuvers[1].at+leg.maneuvers[2].at)/2;
  const middleSegment=leg.segments.find(segment=>segment.at<=turnMiddle && segment.at+segment.meters>=turnMiddle);
  const fraction=(turnMiddle-middleSegment.at)/middleSegment.meters;
  const afterTurn=middleSegment.a.map((axis,i)=>axis+(middleSegment.b[i]-axis)*fraction);
  await locate(driver,afterTurn);
  await expect(page.locator('#turn-name')).toHaveText('Vire à direita');

  const deviations=pack.nodes.filter(point=>{
    if (distance(point,afterTurn)>480 || projectProgress(leg,point,600).distance<80) return false;
    try { return router(point,[driverStop]).meters>100; } catch {return false;}
  });
  const first=deviations[0],second=deviations.find(point=>distance(point,first)>15 && distance(point,first)<90);
  expect(second).toBeTruthy();
  await locate(driver,first);
  await expect(page.locator('#turn-name')).toHaveText('Fora do trajeto');
  await locate(driver,second);
  await expect(page.locator('#nav-notice')).toHaveText('Trajeto recalculado no aparelho.');
  await locate(driver,destination);
  await expect(page.getByText('Rota concluída.',{exact:true})).toBeVisible();
  await expect(page.locator('#itinerary li')).toHaveCount(0);
  expect(errors).toEqual([]);

  await driver.setOffline(false);
  await member.getByRole('button',{name:'Revogar'}).click();
  await expect(member).toContainText('Revogado');
  await page.goto('/');
  await expect(page.getByText('Operação Rio do Ouro · Revogado')).toBeVisible();
  await driver.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Aguardando conexão'})).toBeVisible();
  await driver.setOffline(false);
  await manager.getByLabel('E-mail do motorista').fill('entregador@example.test');
  await manager.getByRole('button',{name:'Gerar convite'}).click();
  const invite=manager.getByLabel('Link do convite');
  await expect(invite).toBeVisible();
  await page.goto(await invite.inputValue());
  await page.getByRole('button',{name:'Aceitar convite'}).click();
  await openMenu.click();
  await page.getByRole('button',{name:'Baixar região'}).click();
  await expect(page.getByText('Região pronta para uso offline.')).toBeVisible();
  await locate(driver,origin);
  const file='Nome;Latitude;Longitude\nPrimeira;-22.887809;-42.993987\nSegunda;-22.886991;-42.990098';
  await page.locator('#csv').setInputFiles({name:'paradas.csv',mimeType:'text/csv',buffer:Buffer.from(file)});
  await expect(page.locator('#stops')).toHaveValue(file);
  await page.getByRole('button',{name:'Calcular rota'}).click();
  await expect(page.locator('#itinerary li')).toHaveText(['Primeira · área mapeada','Segunda']);
  await page.getByRole('button',{name:'Iniciar navegação',exact:true}).click();
  await expect(page.locator('#travel-distance')).toContainText('Parada 1');
  await locate(driver,[-42.993987,-22.887809]);
  await expect(page.locator('#itinerary')).toContainText('Primeira · concluída');
  await expect(page.locator('#travel-distance')).toContainText('Parada 2');
  await locate(driver,destination);
  await expect(page.getByText('Rota concluída.',{exact:true})).toBeVisible();
  await expect(page.locator('#itinerary li')).toHaveCount(0);
  expect(errors).toEqual([]);
  const saoPaulo=[-46.658,-23.558];
  const destino=[-46.652,-23.562];
  await locate(driver,saoPaulo);
  const searches=[];
  await page.route('**/api/companies/piloto/search',route=>{
    searches.push(route.request().postDataJSON().query);
    return route.fulfill({json:[{
      id:'sp',name:'Avenida Paulista, 1578',locality:'São Paulo · SP',point:destino,precision:'address'
    }]});
  });
  await page.route('**/api/companies/piloto/route',route=>{
    expect(route.request().postDataJSON().start).toEqual(saoPaulo);
    return route.fulfill({json:{profile:'national',meters:900,seconds:160,legs:[{
      meters:900,seconds:160,stop:{name:'Avenida Paulista, 1578',point:destino},
      segments:[{a:saoPaulo,b:destino,meters:900,seconds:160,at:0}],
      maneuvers:[{at:0,kind:'straight',name:''},{at:900,kind:'arrive',name:'Avenida Paulista'}]
    }]}});
  });
  const field=page.getByLabel('Para onde você vai?');
  const result=page.getByRole('button',{name:/Avenida Paulista, 1578.*São Paulo/});
  await field.fill('Ave');
  await expect(result).toBeVisible();
  expect(searches).toEqual(['Ave']);
  const fullAddress='Avenida Paulista, 1578, São Paulo';
  await field.fill(fullAddress);
  await expect(result).toBeVisible();
  await field.clear();
  await field.fill(fullAddress);
  await result.click();
  expect(searches).toEqual(['Ave',fullAddress]);
  await page.getByRole('button',{name:'Iniciar navegação até o destino'}).click();
  await expect(page.getByRole('button',{name:'Finalizar rota'})).toBeVisible();
  await driver.setOffline(true);
  await page.goto('/');
  await expect(page.locator('#itinerary')).toContainText('Avenida Paulista, 1578');
  await expect(page.getByText('Trajeto salvo · mapa de ruas indisponível offline')).toBeVisible();
  await openMenu.click();
  await page.getByRole('button',{name:'Iniciar navegação',exact:true}).click();
  await expect(page.locator('#travel-distance')).toContainText('Parada 1');
  await page.getByRole('button',{name:'Finalizar rota'}).click();
  await page.reload();
  await expect(field).toBeVisible();
  await expect(page.locator('#itinerary li')).toHaveCount(0);
  await expect(page.locator('#offline-map-note')).toBeHidden();

  // Simulate an offline production install carrying the old demonstration trip.
  await page.evaluate(legacyRoute=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('mapsbrasil-offline',1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result;
      const tx=db.transaction('state','readwrite');
      const store=tx.objectStore('state');
      const saved=store.get('turn');
      saved.onsuccess=()=>store.put({...saved.result,demo:false,route:legacyRoute,legIndex:0,
        stopsText:'Entrega de teste;-22.886991;-42.990098'},'turn');
      tx.oncomplete=()=>{db.close();resolve();};
      tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }),router(origin,[driverStop]));
  await page.reload();
  await openMenu.click();
  await expect(page.getByRole('button',{name:'Carregar rota de teste',includeHidden:true})).toBeHidden();
  await expect(page.locator('#stops')).toHaveValue('');
  await expect(page.locator('#itinerary li')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Atualizar região'})).toBeVisible();
  await company.close();
  await driver.close();
});

test('Drive solicita consentimento e retoma o GPS somente para a conta e a empresa autorizadas',async({browser,baseURL,request})=>{
  const login=async role=>(await (await request.post('/api/demo',{data:{role}})).json()).token;
  const driverToken=await login('driver');
  const adminToken=await login('admin');
  const headers={authorization:'Bearer '+driverToken};
  const profile=await (await request.post('/api/join',{headers,data:{code:'rio-demo'}})).json();
  const approval=await request.post('/api/companies/piloto/decision',{
    headers:{authorization:'Bearer '+adminToken},data:{uid:profile.user.uid,status:'approved'}
  });
  expect(approval.ok()).toBe(true);

  const context=await browser.newContext({baseURL,geolocation:asPosition(origin),permissions:['geolocation']});
  const page=await context.newPage();
  const requests=[];
  page.on('request',request=>{
    if(request.method()==='POST' && new URL(request.url()).pathname.endsWith('/tracking')) requests.push(request.postDataJSON());
  });
  const tracking=(request)=>request.method()==='POST' && new URL(request.url()).pathname.endsWith('/tracking');
  await page.goto('/');
  await page.getByRole('button',{name:'Entrar como motorista'}).click();
  const permission=page.getByRole('dialog',{name:'Permitir localização'});
  await expect(permission).toBeVisible();
  expect(requests).toEqual([]);
  const first=page.waitForRequest(request=>tracking(request) && !request.postDataJSON().stop);
  await permission.getByRole('button',{name:'Permitir localização'}).click();
  const session=(await first).postDataJSON().session;
  await expect(page.getByText(/GPS enviado para/)).toHaveCount(0);

  const nextPoint=[origin[0]+0.0001,origin[1]];
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await context.setGeolocation(asPosition(nextPoint));
  const visibleFix=page.waitForRequest(request=>tracking(request) && request.postDataJSON().position?.[0]===nextPoint[0]);
  await page.evaluate(()=>{
    Reflect.deleteProperty(document,'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await visibleFix;

  const resumed=page.waitForRequest(request=>tracking(request) && !request.postDataJSON().stop && request.postDataJSON().session!==session);
  await page.reload();
  await resumed;
  await expect(permission).toBeHidden();
  await expect(page.getByText(/GPS enviado para/)).toHaveCount(0);
  const otherCompany='Outra empresa';
  const countBeforeSwitch=requests.length;
  await page.route('**/api/me',async route=>{
    const response=await route.fetch();
    const actual=await response.json();
    await route.fulfill({response,json:{...actual,memberships:[{...actual.memberships[0],company:'outra',name:otherCompany}]}});
  });
  await page.route('**/api/companies/outra/pack',route=>route.fulfill({json:null}));
  await page.reload();
  await expect(permission).toContainText(otherCompany);
  expect(requests).toHaveLength(countBeforeSwitch);
  await page.getByRole('button',{name:'Agora não'}).click();
  await page.unroute('**/api/me');
  const returning=page.waitForRequest(request=>tracking(request) && !request.postDataJSON().stop);
  await page.reload();
  await returning;
  await expect(page.getByText(/GPS enviado para/)).toHaveCount(0);
  const stopped=page.waitForRequest(request=>tracking(request) && request.postDataJSON().stop===true);
  await page.getByRole('button',{name:'Abrir menu de rotas'}).click();
  await page.getByRole('button',{name:'Desativar localização'}).click();
  await stopped;
  const count=requests.length;
  await page.reload();
  await expect(page.getByRole('button',{name:'Compartilhar GPS'})).toBeHidden();
  await page.getByRole('button',{name:'Abrir menu de rotas'}).click();
  await expect(page.getByRole('button',{name:'Compartilhar GPS'})).toBeVisible();
  await expect(permission).toBeHidden();
  expect(requests).toHaveLength(count);
  expect(requests.filter(entry=>!entry.stop).every(entry=>entry.position.length===2)).toBe(true);

  await page.addInitScript(()=>{
    const locate=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    const query=navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query=options=>options.name==='geolocation' && sessionStorage.getItem('gps-blocked')
      ? Promise.resolve({state:'denied'}) : query(options);
    navigator.geolocation.getCurrentPosition=(success,failure,options)=>{
      if (!sessionStorage.getItem('gps-blocked')) return locate(success,failure,options);
      queueMicrotask(()=>failure({code:1}));
    };
  });
  await page.evaluate(()=>sessionStorage.setItem('gps-blocked','1'));
  await page.reload();
  await page.getByRole('button',{name:'Abrir menu de rotas'}).click();
  await page.getByRole('button',{name:'Compartilhar GPS'}).click();
  await permission.getByRole('button',{name:'Permitir localização'}).click();
  await expect(permission.getByRole('alert')).toContainText('Nas permissões do site ou do app');
  expect(requests).toHaveLength(count);
  await page.reload();
  await expect(permission.getByRole('alert')).toBeVisible();
  expect(requests).toHaveLength(count);

  await page.evaluate(()=>sessionStorage.removeItem('gps-blocked'));
  const recovered=page.waitForRequest(request=>tracking(request) && !request.postDataJSON().stop);
  await permission.getByRole('button',{name:'Tentar novamente'}).click();
  await recovered;
  await expect(permission).toBeHidden();
  await expect(page.getByText(/GPS enviado para/)).toHaveCount(0);
  await context.close();
});

test('frontend distingue API ausente de dispositivo offline e permite nova tentativa', async ({page})=>{
  await page.route('**/api/config',route=>route.fulfill({status:404,body:'NOT_FOUND'}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Serviço indisponível'})).toBeVisible();
  await expect(page.locator('#network')).toHaveText('Serviço indisponível');
  await page.unroute('**/api/config');
  await page.getByRole('button',{name:'Tentar novamente'}).click();
  await expect(page.getByRole('heading',{name:'Entre para navegar'})).toBeVisible();
  await expect(page.locator('#network')).toHaveText('Online');
});

test('clicar em Entrar com e-mail envia o formulário para o Firebase Auth',async({page})=>{
  const email='motorista@example.test';
  const password='Dr1!teste-do-formulario';
  await page.route('**/api/config',route=>route.fulfill({json:{demo:false,firebase:{
    projectId:'drive-form-test',authDomain:'drive-form-test.firebaseapp.com',apiKey:'example-test-api-key',appId:'test-app'
  }}}));
  await page.route('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?**',route=>route.fulfill({
    status:400,json:{error:{message:'INVALID_LOGIN_CREDENTIALS'}},
    headers:{'access-control-allow-origin':'*'}
  }));
  await page.goto('/');
  const submit=page.getByRole('button',{name:'Entrar com e-mail'});
  await submit.waitFor();
  await page.getByLabel('E-mail',{exact:true}).fill(email);
  await page.getByLabel('Senha',{exact:true}).fill(password);
  const [request]=await Promise.all([
    page.waitForRequest(req=>req.method()==='POST' && req.url().includes('/accounts:signInWithPassword?'),{timeout:6000}),
    submit.click()
  ]);
  expect(request.postDataJSON()).toMatchObject({email,password,returnSecureToken:true});
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha inválidos.');
});
