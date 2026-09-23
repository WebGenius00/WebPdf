/**
 * PDF Studio — Pages Function : `/api/*` (santé + relais de structuration).
 *
 * ⚠️ Limite connue : la génération PDF finale côté serveur exige WeasyPrint
 * (Python), indisponible sur Cloudflare Workers. En mode 100 % statique, le
 * frontend bascule automatiquement sur son moteur de rendu interne et
 * n'appelle cette fonction que pour /api/health (et /api/structure en option).
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS),
  });
}

export async function onRequest(context) {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    return json({ ok: true, service: 'pdf-studio-pages', mode: 'static' }, 200);
  }

  // Relais optionnel vers une API complète (structuration avancée par règles)
  // si un backend est configuré via la variable d'environnement API_ORIGIN.
  if (url.pathname === '/api/structure' && context.env && context.env.API_ORIGIN) {
    try {
      const upstream = await fetch(String(context.env.API_ORIGIN) + url.pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await request.text(),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS),
      });
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  }

  return json({ error: 'endpoint indisponible en mode statique' }, 501);
}
