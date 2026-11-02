/* Kuponi LV service worker: офлайн-режим, утренний дайджест (push / periodic sync). */
importScripts('config.js');

const VERSION = 'kuponi-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'glossary.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const CFG = self.KUPONI_CONFIG || {};
const DATA_URL = new URL(CFG.dataUrl || '../data/coupons.json', self.registration.scope).href;
const TZ = 'Europe/Riga';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      // данные кладём в кэш сразу, чтобы офлайн работал уже после первого визита
      .then(() => caches.open(`${VERSION}-data`).then((c) => c.add(DATA_URL)).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kuponi-v') && k !== VERSION && k !== `${VERSION}-data`).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirstData(req) {
  const cache = await caches.open(`${VERSION}-data`);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) await cache.put(DATA_URL, res.clone());
    return res;
  } catch {
    const cached = await cache.match(DATA_URL);
    if (cached) return cached;
    throw new Error('offline and no cached data');
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.split('?')[0] === DATA_URL) return e.respondWith(networkFirstData(req));
  if (url.origin === location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
    return e.respondWith(staleWhileRevalidate(req));
  }
});

// ---------- дайджест ----------
const rigaDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const rigaHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;

async function readState() {
  try {
    const res = await (await caches.open('kuponi-state')).match('state.json');
    return res ? await res.json() : {};
  } catch {
    return {};
  }
}

async function writeMeta(patch) {
  const cache = await caches.open('kuponi-state');
  const prev = await cache.match('meta.json').then((r) => (r ? r.json() : {})).catch(() => ({}));
  await cache.put('meta.json', new Response(JSON.stringify({ ...prev, ...patch })));
  return prev;
}

async function loadData() {
  try {
    const res = await networkFirstData(new Request(DATA_URL));
    return await res.json();
  } catch {
    return null;
  }
}

async function showDigest({ force = false } = {}) {
  const today = rigaDate();
  const meta = await writeMeta({});
  if (!force && meta.lastDigest === today) return;
  const [data, state] = await Promise.all([loadData(), readState()]);
  if (!data) {
    if (force) await self.registration.showNotification('Kuponi LV', { body: 'Нет данных — откройте приложение при подключении к сети.', tag: 'kuponi-digest' });
    return;
  }
  const my = new Set(state.myStores || []);
  const active = (data.coupons || []).filter((c) => (!c.validTo || c.validTo >= today) && (!c.validFrom || c.validFrom <= today));
  const deals = active.filter((c) => c.savingEur > 0).sort((a, b) => b.savingEur - a.savingEur);
  let top = my.size ? deals.filter((c) => my.has(c.store)) : deals;
  if (top.length < 5) top = top.concat(deals.filter((c) => !top.includes(c))).slice(0, 5);
  top = top.slice(0, 5);
  const lines = top.map((c) => `−${eur(c.savingEur)} · ${c.store}: ${(c.titleRu || c.title).slice(0, 48)}`);

  await self.registration.showNotification('Kuponi LV — топ-5 сегодня', {
    body: lines.join('\n') || 'Сегодня нет новых скидок.',
    tag: 'kuponi-digest',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: './#best' },
  });

  const favEnding = (state.favorites || []).filter((f) => f.validTo === today);
  const endingMine = active.filter((c) => c.validTo === today && c.kind !== 'price' && c.savingEur > 0 && (!my.size || my.has(c.store)));
  if (favEnding.length || endingMine.length) {
    const body = favEnding.length
      ? `Из избранного: ${favEnding.slice(0, 3).map((f) => f.titleRu || f.title).join(', ')}${favEnding.length > 3 ? '…' : ''}`
      : `${endingMine.length} предложений${my.size ? ' в ваших магазинах' : ''} действуют последний день.`;
    await self.registration.showNotification('⏰ Заканчивается сегодня', {
      body,
      tag: 'kuponi-ending',
      icon: 'icons/icon-192.png',
      data: { url: favEnding.length ? './#fav' : './#best' },
    });
  }
  await writeMeta({ lastDigest: today });
}

// Push от Cloudflare Worker (без содержимого — данные берём сами)
self.addEventListener('push', (e) => {
  e.waitUntil(showDigest({ force: true }));
});

// Резерв без сервера: периодическая фоновая синхронизация (Chrome, установленное PWA)
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'kuponi-daily') return;
  e.waitUntil((async () => {
    await loadData();
    const state = await readState();
    const h = rigaHour();
    if (state.localDigest && !state.pushEnabled && h >= 8 && h < 12) await showDigest();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'digest') e.waitUntil(showDigest({ force: Boolean(e.data.force) }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        return c.navigate(target);
      }
    }
    return self.clients.openWindow(target);
  })());
});
