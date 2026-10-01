const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }
    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'pdf-studio-worker', mode: 'static' })
    }
    if (url.pathname === '/api/structure' && env.API_ORIGIN) {
      try {
        const upstream = await fetch(String(env.API_ORIGIN) + url.pathname, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: await request.text(),
        })
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
        })
      } catch (e) {
        return json({ error: String(e) }, 502)
      }
    }
    return json({ error: 'endpoint indisponible en mode statique' }, 501)
  },
}
