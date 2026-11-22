import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardApi } from '../server/vercel-proxy.mjs';

const incoming = endpoint => new Request('https://mapsbrasil.example/api/bridge?endpoint=' + endpoint);
const origin = 'https://backend.example';

test('endpoint sem backend informa indisponibilidade sem desviar o navegador', async () => {
  assert.equal((await forwardApi(incoming('config'))).status, 503);
  assert.equal((await forwardApi(incoming('config'), 'https://mapsbrasil.example')).status, 503);
  assert.equal((await forwardApi(incoming('https://backend.example'), origin)).status, 404);
});

test('encaminha somente o caminho, o campo de download e a autorização esperados', async () => {
  const req = new Request('https://mapsbrasil.example/api/bridge?endpoint=companies%2Fpiloto%2Fpack&file=1&other=extra', {
    headers: { Authorization: 'Bearer example', Cookie: 'test=1' }
  });
  const reply = await forwardApi(req, origin, async (url, options) => {
    assert.equal(url.href, origin + '/api/companies/piloto/pack?file=1');
    assert.equal(options.headers.get('authorization'), 'Bearer example');
    assert.equal(options.headers.get('cookie'), null);
    return Response.json({version:'test'});
  });
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), {version:'test'});
  assert.equal(reply.headers.get('cache-control'), 'no-store');
});

test('preserva a rejeição do backend e trata respostas inválidas', async () => {
  const req = new Request('https://mapsbrasil.example/api/bridge?endpoint=join', {
    method:'POST', headers:{'content-type':'application/json'}, body:'{"code":"example"}'
  });
  const reply = await forwardApi(req, origin, async (url, options) => {
    assert.equal(url.pathname, '/api/join');
    assert.equal(new TextDecoder().decode(options.body), '{"code":"example"}');
    return Response.json({error:'Vínculo pendente.'}, {status:403});
  });
  assert.equal(reply.status, 403);
  const missing = await forwardApi(incoming('config'), origin, async () => new Response('HTML', {status:404}));
  assert.equal(missing.status, 502);
});
