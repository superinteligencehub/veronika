#!/usr/bin/env node
// Автообнаружение магазинов: для каждого домена из scrapers/registry/candidates.txt
// определяет, откуда можно публично взять акции (Shopify / WooCommerce / страница акций
// с разметкой), и пишет результат в scrapers/registry/stores.json.
//
//   node scripts/discover.js            — все кандидаты
//   node scripts/discover.js babycity.lv — один домен (для проверки)

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fetchText, mapLimit, BlockedError } from '../scrapers/lib/http.js';
import { extractHtmlDeals, findSaleLinks } from '../scrapers/lib/generic.js';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scrapers', 'registry');
const only = process.argv[2];

async function parseCandidates() {
  const txt = await readFile(join(DIR, 'candidates.txt'), 'utf8');
  return txt
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [domain, name, category] = l.split('|').map((s) => s.trim());
      return { domain, name, category };
    });
}

async function tryJson(url) {
  try {
    const t = await fetchText(url, { retries: 0, timeoutMs: 15000, headers: { Accept: 'application/json' } });
    return JSON.parse(t);
  } catch {
    return null;
  }
}

async function probe(c) {
  const res = { ...c, id: c.domain.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, ''), checked: new Date().toISOString().slice(0, 10) };
  const url = `https://${c.domain.includes('/') ? c.domain : `${c.domain}/`}`;
  let html;
  let finalUrl = url;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': (await import('../scrapers/lib/http.js')).USER_AGENT, 'Accept-Language': 'lv,ru;q=0.8,en;q=0.5' } });
    finalUrl = r.url;
    html = await r.text();
    if ([403, 429, 503].includes(r.status) || /Just a moment|challenges\.cloudflare\.com|captcha/i.test(html.slice(0, 5000))) {
      return { ...res, status: 'blocked', note: `HTTP ${r.status}, проверка бота` };
    }
    if (!r.ok) return { ...res, status: 'unavailable', note: `HTTP ${r.status}` };
  } catch (err) {
    return { ...res, status: 'unavailable', note: String(err.cause?.code ?? err.message).slice(0, 80) };
  }
  const origin = new URL(finalUrl).origin;
  res.origin = origin;
  res.url = finalUrl;

  // Shopify
  if (/cdn\.shopify|Shopify\.theme|shopify-section/i.test(html)) {
    const j = await tryJson(`${origin}/products.json?limit=250`);
    if (j?.products) {
      const deals = j.products.filter((p) => p.variants?.some((v) => Number(v.compare_at_price) > Number(v.price))).length;
      return { ...res, status: deals ? 'auto' : 'no-deals', platform: 'shopify', sample: deals };
    }
  }
  // WooCommerce
  if (/woocommerce|wp-content/i.test(html)) {
    const j = await tryJson(`${origin}/wp-json/wc/store/v1/products?on_sale=true&per_page=100`);
    if (Array.isArray(j)) return { ...res, status: j.length ? 'auto' : 'no-deals', platform: 'woo', sample: j.length };
  }
  // HTML: главная + страницы акций
  const links = findSaleLinks(html, finalUrl);
  const pages = [];
  let total = extractHtmlDeals(html, finalUrl).length;
  if (total) pages.push(finalUrl);
  for (const l of links.slice(0, 4)) {
    try {
      const n = extractHtmlDeals(await fetchText(l, { retries: 0, timeoutMs: 20000 }), l).length;
      if (n) {
        pages.push(l);
        total += n;
      }
    } catch (err) {
      if (err instanceof BlockedError) break;
    }
  }
  if (total >= 3) return { ...res, status: 'auto', platform: 'html', saleUrls: pages.slice(0, 4), sample: total };
  return { ...res, status: 'no-deals', platform: 'html', saleLinks: links.slice(0, 3), sample: total, note: 'Публичных цен со скидкой не найдено (акции в PDF/картинках/приложении)' };
}

const cands = (await parseCandidates()).filter((c) => !only || c.domain === only);
let prev = [];
try {
  prev = JSON.parse(await readFile(join(DIR, 'stores.json'), 'utf8'));
} catch {
  /* первый запуск */
}
const results = await mapLimit(cands, 8, async (c) => {
  const r = await probe(c).catch((err) => ({ ...c, status: 'unavailable', note: err.message }));
  console.log(`${r.status.padEnd(11)} ${(r.platform ?? '').padEnd(8)} ${String(r.sample ?? '').padStart(4)}  ${c.domain}  ${r.note ?? ''}`);
  return r;
});
// Второй проход: сайты на JavaScript — открываем настоящим браузером
const { browserAvailable, renderPage, closeBrowser } = await import('../scrapers/lib/browser.js');
if (browserAvailable() && !process.argv.includes('--no-browser')) {
  const retry = results.filter((r) => r.status === 'no-deals' && r.platform === 'html');
  console.log(`\nБраузер: проверяю ${retry.length} сайтов…`);
  await mapLimit(retry, 3, async (r) => {
    try {
      const home = await renderPage(r.url);
      const links = findSaleLinks(home.html, home.finalUrl);
      const pages = [];
      let total = 0;
      const n0 = extractHtmlDeals(home.html, home.finalUrl).length;
      if (n0) { pages.push(home.finalUrl); total += n0; }
      for (const l of links.slice(0, 3)) {
        const n = extractHtmlDeals((await renderPage(l)).html, l).length;
        if (n) { pages.push(l); total += n; }
      }
      if (total >= 3) Object.assign(r, { status: 'auto', platform: 'browser', saleUrls: pages.slice(0, 4), sample: total, note: undefined });
      else Object.assign(r, { saleLinks: links.slice(0, 3), note: 'Цен со скидкой на сайте не найдено даже в браузере (акции в PDF/картинках/приложении)' });
    } catch (err) {
      if (err instanceof BlockedError) Object.assign(r, { status: 'blocked', note: 'проверка бота (в браузере)' });
    }
    console.log(`${r.status.padEnd(11)} ${(r.platform ?? '').padEnd(8)} ${String(r.sample ?? '').padStart(4)}  ${r.domain}`);
  });
  await closeBrowser();
}
// Не понижаем рабочий магазин из-за одной неудачной проверки (временная блокировка IP,
// сбой сайта): сохраняем прошлую конфигурацию, ежедневный сбор сам покажет реальный статус.
const prevBy = new Map(prev.map((p) => [p.domain, p]));
for (const r of results) {
  const p = prevBy.get(r.domain);
  if (p?.status === 'auto' && r.status !== 'auto') {
    const fails = (p.failedChecks ?? 0) + 1;
    if (fails < 3) Object.assign(r, { ...p, failedChecks: fails, lastCheckNote: `${r.status}: ${r.note ?? ''}`.trim() });
  }
}

// Ручные настройки
const overrides = JSON.parse(await readFile(join(DIR, 'overrides.json'), 'utf8'));
for (const r of results) if (overrides[r.domain]) Object.assign(r, overrides[r.domain]);
const merged = only ? [...prev.filter((p) => p.domain !== only), ...results] : results;
merged.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
await writeFile(join(DIR, 'stores.json'), `${JSON.stringify(merged, null, 1)}\n`);
const by = (s) => merged.filter((m) => m.status === s).length;
console.log(`\nauto: ${by('auto')}, без акций на сайте: ${by('no-deals')}, закрыты: ${by('blocked')}, недоступны: ${by('unavailable')}`);
