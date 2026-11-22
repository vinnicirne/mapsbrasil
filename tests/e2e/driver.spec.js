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
  const driver=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    geolocation:asPosition(origin),permissions:['geolocation']});
  const company=await browser.newContext({baseURL});
  const page=await driver.newPage();
  const manager=await company.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/MapsBrasil Drive/);
  await expect(page.getByRole('link',{name:'MapsBrasil Drive, início'})).toHaveText('MapsBrasil Drive');
  const manifest=await page.request.get('/manifest.webmanifest');
  expect((await manifest.json()).name).toBe('MapsBrasil Drive');
  await page.getByRole('button',{name:'Entrar como motorista'}).click();
  await page.getByLabel('Código da empresa').fill('rio-demo');
  await page.getByRole('button',{name:'Solicitar acesso'}).click();
  await expect(page.getByRole('heading',{name:'Aguardando aprovação'})).toBeVisible();
  await page.goto('/gestao');
  await expect(page.getByRole('heading',{name:'Acesso restrito'})).toBeVisible();

  await manager.goto('/gestao');
  await manager.getByRole('button',{name:'Entrar como empresa'}).click();
  const member=manager.getByRole('article',{name:'entregador@example.test'});
  await expect(member).toContainText('Pendente');
  await member.getByRole('button',{name:'Aprovar',exact:true}).click();
  await expect(member).toContainText('Aprovado');

  await page.goto('/');
  await page.getByRole('button',{name:'Baixar região'}).click();
  await expect(page.getByText('Região pronta para uso offline.')).toBeVisible();
  await expect(page.getByText('Áreas de risco simuladas',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Carregar rota de teste'}).click();
  await expect(page.getByText('Cruza área mapeada.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Iniciar navegação'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);

  await driver.setOffline(true);
  await page.goto('/');
  await expect(page.locator('#network')).toHaveText('Offline');
  await expect(page.locator('#itinerary')).toContainText('Entrega de teste');
  const offlineAudio=await page.evaluate(async()=>{
    const response=await fetch('/audio/left.wav');
    const audio=new AudioContext();
    try { return (await audio.decodeAudioData(await response.arrayBuffer())).duration; }
    finally { await audio.close(); }
  });
  expect(offlineAudio).toBeGreaterThan(.5);
  await expect(page.getByRole('img',{name:'Mapa da região e da rota'})).toBeVisible();
  await page.getByRole('button',{name:'Iniciar navegação'}).click();
  await expect(page.locator('#turn-name')).toHaveText('Vire à esquerda');
  await expect(page.locator('#travel-time')).toContainText('min');
  await expect(page.getByRole('button',{name:'Encerrar'})).toBeInViewport();
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
  await expect(page.locator('#turn-name')).toHaveText('Rota concluída');
  await expect(page.locator('#itinerary')).toContainText('Entrega de teste · concluída');
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
  await page.getByRole('button',{name:'Baixar região'}).click();
  await expect(page.getByText('Região pronta para uso offline.')).toBeVisible();
  await locate(driver,origin);
  const file='Nome;Latitude;Longitude\nPrimeira;-22.887809;-42.993987\nSegunda;-22.886991;-42.990098';
  await page.locator('#csv').setInputFiles({name:'paradas.csv',mimeType:'text/csv',buffer:Buffer.from(file)});
  await expect(page.locator('#stops')).toHaveValue(file);
  await page.getByRole('button',{name:'Calcular rota'}).click();
  await expect(page.locator('#itinerary li')).toHaveText(['Primeira · área mapeada','Segunda']);
  await page.getByRole('button',{name:'Iniciar navegação'}).click();
  await expect(page.locator('#travel-distance')).toContainText('Parada 1');
  await locate(driver,[-42.993987,-22.887809]);
  await expect(page.locator('#itinerary')).toContainText('Primeira · concluída');
  await expect(page.locator('#travel-distance')).toContainText('Parada 2');
  await locate(driver,destination);
  await expect(page.locator('#turn-name')).toHaveText('Rota concluída');
  await expect(page.locator('#itinerary')).toContainText('Segunda · concluída');
  expect(errors).toEqual([]);
  await company.close();
  await driver.close();
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
