const routes = new Map([
  ['config', 'GET'],
  ['me', 'GET'],
  ['join', 'POST'],
  ['accept', 'POST'],
  ['members', 'GET'],
  ['pack', 'GET'],
  ['invite', 'POST'],
  ['decision', 'POST'],
  ['lease', 'POST']
]);

const responseHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const failure = (status, error) => Response.json({ error }, { status, headers: responseHeaders });

function originUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash)
      return url;
  } catch {
    // The service has no valid origin configured.
  }
}

export async function forwardApi(request, origin, send = fetch) {
  const requestUrl = new URL(request.url);
  const endpoints = requestUrl.searchParams.getAll('endpoint');
  const endpoint = endpoints.length === 1 ? endpoints[0] : '';
  const company = /^companies\/[\w-]+\/(members|pack|invite|decision|lease)$/.exec(endpoint);
  const action = company?.[1] ?? (/^(config|me|join|accept)$/.test(endpoint) ? endpoint : '');
  if (!action) return failure(404, 'Recurso não encontrado.');
  if (routes.get(action) !== request.method) return failure(405, 'Método indisponível.');

  const url = originUrl(origin);
  if (!url || requestUrl.origin === url.origin) return failure(503, 'Serviço do MapsBrasil Drive ainda não conectado.');
  url.pathname = '/api/' + endpoint;
  if (action === 'pack' && requestUrl.searchParams.get('file') === '1') url.searchParams.set('file', '1');

  const headers = new Headers();
  for (const name of ['authorization', 'content-type']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const declaredLength = Number(request.headers.get('content-length'));
    if (declaredLength > 8192) return failure(413, 'Solicitação excede o tamanho permitido.');
    const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
    if (body?.byteLength > 8192) return failure(413, 'Solicitação excede o tamanho permitido.');
    const upstream = await send(url, {
      method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(7000)
    });
    if (upstream.status >= 300 && upstream.status < 400) return failure(502, 'Resposta inesperada do serviço.');
    const contentType = upstream.headers.get('content-type');
    if (!contentType?.toLowerCase().startsWith('application/json')) return failure(502, 'Resposta inesperada do serviço.');
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...responseHeaders, 'content-type': contentType }
    });
  } catch {
    return failure(502, 'Serviço do MapsBrasil Drive temporariamente indisponível.');
  }
}
