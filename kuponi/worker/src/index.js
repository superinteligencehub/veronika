// Kuponi LV — сервер Web Push на Cloudflare Workers (бесплатный тариф).
//
//  POST /subscribe    — сохранить подписку браузера (PushSubscription JSON) в KV
//  POST /unsubscribe  — удалить подписку {endpoint}
//  GET  /health       — проверка
//  cron               — в 08:00 по Риге отправить всем подписчикам push БЕЗ содержимого;
//                       service worker приложения сам загрузит свежие данные и покажет топ-5.
//
// Push без содержимого = не нужно шифрование payload (RFC 8291), достаточно VAPID-подписи (RFC 8292).
// Секреты: VAPID_PRIVATE_JWK (wrangler secret). Переменные: VAPID_PUBLIC_KEY, VAPID_SUBJECT, ALLOWED_ORIGIN.

const TZ = 'Europe/Riga';
const enc = new TextEncoder();

const b64url = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function sha256(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

let keyCache;
async function signingKey(env) {
  if (!keyCache) {
    keyCache = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  return keyCache;
}

/** VAPID JWT (ES256) для origin push-сервиса. */
async function vapidHeader(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:kuponi@example.com' })));
  const unsigned = `${header}.${payload}`;
  // WebCrypto возвращает подпись в формате r||s (P1363) — ровно то, что нужно для JWS
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function sendPush(sub, env) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(sub.endpoint, env), TTL: '14400', Urgency: 'normal', 'Content-Length': '0' },
  });
  return res.status;
}

function rigaHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
}

async function broadcast(env) {
  let cursor;
  const stats = { sent: 0, removed: 0, failed: 0 };
  do {
    const page = await env.SUBS.list({ cursor });
    for (const { name } of page.keys) {
      const sub = await env.SUBS.get(name, 'json');
      if (!sub?.endpoint) continue;
      try {
        const status = await sendPush(sub, env);
        if (status === 404 || status === 410) {
          await env.SUBS.delete(name); // подписка больше не существует
          stats.removed++;
        } else if (status >= 200 && status < 300) stats.sent++;
        else stats.failed++;
      } catch {
        stats.failed++;
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return stats;
}

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : allowed[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    const { pathname } = new URL(req.url);
    if (pathname === '/health') return json({ ok: true, rigaHour: rigaHour() }, 200, h);

    if (req.method === 'POST' && (pathname === '/subscribe' || pathname === '/unsubscribe')) {
      const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes(req.headers.get('Origin') || '')) return json({ error: 'origin' }, 403, h);
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'bad json' }, 400, h);
      }
      const endpoint = String(body?.endpoint || '');
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return json({ error: 'bad endpoint' }, 400, h);
      const key = await sha256(endpoint);
      if (pathname === '/unsubscribe') {
        await env.SUBS.delete(key);
        return json({ ok: true }, 200, h);
      }
      await env.SUBS.put(key, JSON.stringify({ endpoint, keys: body.keys ?? {}, created: new Date().toISOString() }));
      return json({ ok: true }, 201, h);
    }
    return json({ error: 'not found' }, 404, h);
  },

  // Cron срабатывает в 05:00 и 06:00 UTC; отправляем только когда в Риге 08 часов (зимнее/летнее время).
  async scheduled(event, env, ctx) {
    if (rigaHour(new Date(event.scheduledTime)) !== 8) return;
    ctx.waitUntil(broadcast(env).then((s) => console.log('push', JSON.stringify(s))));
  },
};
