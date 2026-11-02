// Универсальные адаптеры для магазинов без отдельного парсера.
//   shopify — публичный /products.json (compare_at_price > price = скидка)
//   woo     — публичный WooCommerce Store API /wp-json/wc/store/v1/products?on_sale=true
//   html    — страница акций: JSON-LD schema.org Product + эвристика карточек «старая/новая цена»
// Всё это данные, которые сайт сам отдаёт любому посетителю.

import * as cheerio from 'cheerio';
import { fetchText, fetchJson } from './http.js';
import { cleanText, parsePrice, isoToRigaDate } from './util.js';

const MAX_PER_STORE = Number(process.env.KUPONI_MAX_PER_STORE ?? 250);

// ---------- Shopify ----------
export async function scrapeShopify(origin) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const data = await fetchJson(`${origin}/products.json?limit=250&page=${page}`);
    const products = data?.products ?? [];
    for (const p of products) {
      const v = (p.variants ?? [])
        .map((x) => ({ price: parsePrice(x.price), old: parsePrice(x.compare_at_price), x }))
        .filter((x) => x.old && x.price && x.old > x.price)
        .sort((a, b) => b.old - b.price - (a.old - a.price))[0];
      if (!v) continue;
      out.push({
        variant: String(p.id),
        title: cleanText(p.title),
        brand: p.vendor || undefined,
        priceNew: v.price,
        priceOld: v.old,
        url: `${origin}/products/${p.handle}`,
        image: p.images?.[0]?.src,
        conditions: (p.variants?.length ?? 0) > 1 ? ['Cena atkarīga no varianta (izmērs/krāsa)'] : [],
      });
    }
    if (products.length < 250) break;
  }
  return out;
}

// ---------- WooCommerce Store API ----------
export async function scrapeWoo(origin) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const list = await fetchJson(`${origin}/wp-json/wc/store/v1/products?on_sale=true&per_page=100&page=${page}`);
    if (!Array.isArray(list) || !list.length) break;
    for (const p of list) {
      const pr = p.prices ?? {};
      const k = 10 ** (pr.currency_minor_unit ?? 2);
      const priceNew = Number(pr.sale_price || pr.price) / k;
      const priceOld = Number(pr.regular_price) / k;
      if (!(priceOld > priceNew) || !priceNew) continue;
      out.push({
        variant: String(p.id),
        title: cleanText(cheerio.load(`<p>${p.name}</p>`)('p').text()),
        priceNew,
        priceOld,
        url: p.permalink,
        image: p.images?.[0]?.src,
        conditions: [],
      });
    }
    if (list.length < 100) break;
  }
  return out;
}

// ---------- HTML: JSON-LD + эвристика ----------
const OLD_SEL = [
  'del', 's', 'strike', '.old-price', '.price-old', '.oldPrice', '.old_price', '.regular-price', '.was-price', '.price--old',
  '.price__old', '.price-before', '.compare-price', '.price-compare', '.product-price-old', '.crossed', '.line-through',
  '[class*="old-price"]', '[class*="oldprice"]', '[class*="OldPrice"]', '[class*="price-old"]', '[class*="price_old"]',
  '[class*="regular-price"]', '[class*="price--regular"]', '[class*="strike"]', '[class*="crossed"]', '[class*="was-price"]',
].join(',');

const PRICE_RE = /(?:€\s*(\d{1,5}(?:[ .]\d{3})*[.,]\d{2}|\d{1,5})|(\d{1,5}(?:[ .]\d{3})*[.,]\d{2})\s*(?:€|EUR|eur))/g;

function pricesIn(text) {
  return [...String(text).matchAll(PRICE_RE)].map((m) => parsePrice((m[1] ?? m[2]).replace(/[ .](?=\d{3}\b)/g, ''))).filter((n) => n > 0 && n < 100000);
}

function jsonLdProducts($, base) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node['@graph']) visit(node['@graph']);
    if (node.itemListElement) visit(node.itemListElement.map((e) => e.item ?? e));
    const type = [].concat(node['@type'] ?? []);
    if (!type.includes('Product')) return;
    const offers = [].concat(node.offers ?? []).flatMap((o) => (o['@type'] === 'AggregateOffer' ? [].concat(o.offers ?? o) : [o]));
    for (const o of offers) {
      const priceNew = parsePrice(o.price ?? o.lowPrice);
      const specs = [].concat(o.priceSpecification ?? []);
      const strike = specs.find((s) => /Strikethrough|ListPrice|RegularPrice/i.test(`${s.priceType ?? ''}`));
      const priceOld = parsePrice(strike?.price ?? o.highPrice);
      if (!priceNew || !priceOld || priceOld <= priceNew) continue;
      out.push({
        title: cleanText(node.name),
        brand: typeof node.brand === 'object' ? node.brand?.name : node.brand,
        priceNew,
        priceOld,
        validTo: o.priceValidUntil ? isoToRigaDate(o.priceValidUntil) : null,
        url: node.url ? new URL(node.url, base).href : base,
        image: [].concat(node.image ?? [])[0]?.url ?? [].concat(node.image ?? [])[0],
      });
      break;
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {
      /* битый JSON-LD */
    }
  });
  return out;
}

const BAD_TITLE = /^(datu lapa|vairāk|uzzināt vairāk|pirkt|ielikt grozā|grozā|skatīt|apskatīt|add to cart|buy|more)$/i;

// Omnibus (ЕС): магазины обязаны показывать прежнюю/обычную цену — «Regulārā cena: 135,00 €»
const OMNI_RE = /(Regulār[aā]|Iepriekš[eē]j[aā]|Parast[aā]|Ierast[aā]|Sākotnēj[aā]|Vecā) cena[^0-9€]{0,20}(\d{1,5}(?:[ .]\d{3})*[.,]\d{2}|\d{1,5})\s*€?/i;
const NOW_RE = /Cena (?:šobrīd|tagad|ar atlaidi)[^0-9€]{0,20}(\d{1,5}[.,]\d{2})/i;
const UNTIL_RE = /(?:derīg[sa]|spēkā|ilgst)[^0-9]{0,20}(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})/i;

function toIsoDate(s) {
  if (!s) return null;
  if (/^\d{4}-/.test(s)) return s;
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** Узлы со «старой ценой»: перечёркнутые элементы + Omnibus-подписи в тексте и атрибутах. */
export function oldPriceNodes($) {
  const nodes = [];
  $(OLD_SEL).each((_, el) => {
    const ps = pricesIn($(el).text());
    if (ps.length === 1) nodes.push({ el, priceOld: ps[0] });
  });
  $('*').each((_, el) => {
    for (const v of Object.values(el.attribs ?? {})) {
      if (v.length > 2000 || !/cena/i.test(v)) continue;
      const txt = cheerio.load(v).root().text();
      const m = txt.match(OMNI_RE);
      if (!m) continue;
      nodes.push({ el, priceOld: parsePrice(m[2]), priceNew: parsePrice(txt.match(NOW_RE)?.[1]), validTo: toIsoDate(txt.match(UNTIL_RE)?.[1]) });
      return;
    }
    const own = $(el).clone().children().remove().end().text();
    if (own.length < 120) {
      const m = own.match(OMNI_RE);
      if (m) nodes.push({ el, priceOld: parsePrice(m[2]) });
    }
  });
  return nodes.filter((n) => n.priceOld > 0);
}

export function cardProducts($, base) {
  const out = [];
  const seen = new Set();
  for (const node of oldPriceNodes($)) {
    const { priceOld } = node;
    // поднимаемся до контейнера карточки: в нём есть ссылка и цена ниже старой
    let $c = $(node.el).parent();
    for (let depth = 0; depth < 8 && $c.length; depth++, $c = $c.parent()) {
      const text = $c.clone().find(OLD_SEL).remove().end().text().replace(OMNI_RE, ' ');
      const lower = node.priceNew && node.priceNew < priceOld ? [node.priceNew] : pricesIn(text).filter((p) => p < priceOld);
      const $a = $c.find('a[href]').filter((__, a) => !/^(#|javascript:|mailto:|tel:)|\.pdf$/i.test($(a).attr('href') ?? '')).first();
      if (!lower.length || !$a.length) continue;
      if ($c.find('a[href]').length > 12) break; // ушли слишком высоко — это уже список
      const href = new URL($a.attr('href'), base).href;
      if (seen.has(href)) break;
      const title =
        cleanText($c.find('h2,h3,h4,[class*="title"],[class*="name"]').first().text()) ||
        cleanText($a.attr('title')) ||
        cleanText($c.find('img').first().attr('alt')) ||
        cleanText($a.text());
      if (!title || title.length < 3 || title.length > 200 || /^\d/.test(title) || BAD_TITLE.test(title)) continue; // название — выше по дереву
      const img = $c.find('img').first();
      const src = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src');
      seen.add(href);
      out.push({
        title,
        priceNew: Math.max(...lower), // ближайшая к старой цене из найденных — обычно это цена со скидкой
        priceOld,
        ...(node.validTo ? { validTo: node.validTo } : {}),
        url: href,
        image: src && !src.startsWith('data:') ? new URL(src, base).href : undefined,
      });
      break;
    }
  }
  return out;
}

/** Ссылки на следующие страницы списка (?page=2, /page/2, ?p=2). */
export function findPageLinks(html, base, maxPages) {
  const $ = cheerio.load(html);
  const u0 = new URL(base);
  const found = new Map();
  $('a[href]').each((_, a) => {
    let u;
    try {
      u = new URL($(a).attr('href'), base);
    } catch {
      return;
    }
    if (u.origin !== u0.origin) return;
    const n = Number(u.searchParams.get('page') ?? u.searchParams.get('p') ?? u.searchParams.get('lapa') ?? u.pathname.match(/\/page\/(\d+)\/?$/)?.[1]);
    if (!Number.isInteger(n) || n < 2 || n > maxPages) return;
    if (u.pathname.replace(/\/page\/\d+\/?$/, '') !== u0.pathname.replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '') && u.pathname !== u0.pathname) return;
    found.set(n, u.href);
  });
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, h]) => h);
}

export function extractHtmlDeals(html, base) {
  const $ = cheerio.load(html);
  const ld = jsonLdProducts($, base);
  const cards = cardProducts($, base);
  const byUrl = new Map();
  for (const p of [...ld, ...cards]) if (!byUrl.has(p.url + p.title)) byUrl.set(p.url + p.title, p);
  return [...byUrl.values()].filter((p) => {
    const pct = (1 - p.priceNew / p.priceOld) * 100;
    return pct >= 3 && pct <= 90;
  });
}

const SALE_LINK = /akcij|atlaid|izp[aā]rdo|izpardo|sale|outlet|pied[aā]v[aā]j|piedavaj|kupon|promo|discount|super-cen|zemas-cen|top-cen|black-friday|melnā-piektdien|offers|deals/i;

/** Ссылки на разделы акций с главной страницы. */
export function findSaleLinks(html, base) {
  const $ = cheerio.load(html);
  const host = new URL(base).host.replace(/^www\./, '');
  const links = new Map();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    const text = cleanText($(a).text());
    if (!href || /^(#|javascript:|mailto:|tel:)/.test(href)) return;
    let u;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (u.host.replace(/^www\./, '') !== host) return;
    if (/\.(pdf|jpg|png)$/i.test(u.pathname) || /noteikum|rules|terms|privacy|login|cart|grozs/i.test(u.pathname)) return;
    if (SALE_LINK.test(u.pathname) || SALE_LINK.test(text)) {
      u.hash = '';
      const score = (SALE_LINK.test(u.pathname) ? 2 : 0) + (SALE_LINK.test(text) ? 1 : 0) - u.pathname.split('/').length * 0.1;
      const k = u.href;
      if (!links.has(k) || links.get(k) < score) links.set(k, score);
    }
  });
  return [...links.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 6);
}

export async function scrapeHtml(urls, { browser = false, pages = 3 } = {}) {
  const { renderPage } = browser ? await import('./browser.js') : {};
  const load = async (url) => (browser ? (await renderPage(url)).html : await fetchText(url, { retries: 1 }));
  const out = [];
  const seen = new Set();
  let ok = 0;
  let lastErr;
  const add = (deals) => {
    for (const d of deals) {
      if (seen.has(d.url + d.title)) continue;
      seen.add(d.url + d.title);
      out.push({ ...d, variant: d.url, conditions: d.conditions ?? [] });
    }
  };
  for (const url of urls) {
    try {
      const html = await load(url);
      ok++;
      add(extractHtmlDeals(html, url));
      for (const next of findPageLinks(html, url, pages)) {
        try {
          add(extractHtmlDeals(await load(next), next));
        } catch {
          break;
        }
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (!ok && lastErr) throw lastErr;
  return out;
}

/** Ограничить объём: самые выгодные в € первыми. */
export function capDeals(items, max = MAX_PER_STORE) {
  return items.sort((a, b) => (b.priceOld ?? 0) - (b.priceNew ?? 0) - ((a.priceOld ?? 0) - (a.priceNew ?? 0))).slice(0, max);
}
