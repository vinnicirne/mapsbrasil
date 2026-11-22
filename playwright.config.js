import {defineConfig, devices} from '@playwright/test';
import {mkdtempSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const browser=process.env.MAPSBRASIL_CHROMIUM || undefined;
if (browser && !existsSync(browser)) throw Error('MAPSBRASIL_CHROMIUM não existe.');
const data=mkdtempSync(join(tmpdir(),'mapsbrasil-e2e-'));
const port=4181;

export default defineConfig({
  testDir:'tests/e2e',
  timeout:45000,
  workers:1,
  reporter:'list',
  use:{...devices['Pixel 7'],baseURL:'http://127.0.0.1:'+port,
    trace:'retain-on-failure',launchOptions:browser?{executablePath:browser}:{}},
  webServer:{
    command:'npm start',
    url:'http://127.0.0.1:'+port,
    env:{PORT:String(port),HOST:'127.0.0.1',DATA_DIR:data,MAPSBRASIL_DEMO:'1'},
    reuseExistingServer:false
  }
});
