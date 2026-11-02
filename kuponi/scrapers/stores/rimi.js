// Rimi: публичный раздел акций интернет-магазина (e-veikals).
// Список: /e-veikals/lv/akcijas-piedavajumi?currentPage=N&pageSize=80 (серверный HTML).
// Срок акции есть только на странице товара → догружаем для топ-позиций по выгоде.

import * as cheerio from 'cheerio';
import { fetchText, mapLimit } from '../lib/http.js';
import { parsePrice, parseUnitPrice, parseLvDate, cleanText } from '../lib/util.js';

const BASE = 'https://www.rimi.lv';
const LIST = `${BASE}/e-veikals/lv/akcijas-piedavajumi`;
const MAX_PAGES = Number(process.env.KUPONI_RIMI_MAX_PAGES ?? 60);
const DETAILS_TOP = Number(process.env.KUPONI_RIMI_DETAILS ?? 150);

/** Rimi иногда пишет €/kg у напитков в литрах — для сравнения цен приводим к «l». */
function fixUnit(u, title) {
  if (u?.unit === 'kg' && /\d\s*(l|ml)\b/i.test(title) && !/\d\s*(k?g)\b/i.test(title)) return { ...u, unit: 'l' };
  return u;
}

export function parseListPage(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.js-product-container[data-gtm-eec-product]').each((_, el) => {
    const $el = $(el);
    let meta = {};
    try {
      meta = JSON.parse($el.attr('data-gtm-eec-product'));
    } catch {
      return;
    }
    const priceTxt = cleanText($el.find('.price-tag .sr-only').first().text());
    const oldTxt = cleanText($el.find('.old-price-tag .sr-only').first().text());
    const priceOld = parsePrice(oldTxt);
    const unitTxt = cleanText($el.find('.card__price-per .sr-only').first().text());
    const href = $el.find('a.card__url').attr('href');
    const img = $el.find('.card__image-wrapper img').first();
    const badges = $el
      .find('.label-badges')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    items.push({
      sku: String(meta.id ?? $el.attr('data-product-code') ?? ''),
      title: cleanText($el.find('.card__name').first().text()) || meta.name,
      // Видимая цена («13.99 € par kg») надёжнее meta.price: у весовых товаров meta — цена за штуку.
      priceNew: parsePrice(priceTxt) ?? (typeof meta.price === 'number' ? meta.price : null),
      perUnit: priceTxt.match(/par\s+(kg|l|gab)/i)?.[1]?.toLowerCase() ?? null,
      priceOld,
      unitPrice: fixUnit(parseUnitPrice(unitTxt), cleanText($el.find('.card__name').first().text())),
      url: href ? new URL(href, BASE).href : LIST,
      image: img.attr('data-src') || img.attr('src') || undefined,
      conditions: badges ? [badges] : [],
    });
  });
  const pages = [...html.matchAll(/currentPage=(\d+)/g)].map((m) => Number(m[1]));
  return { items, lastPage: pages.length ? Math.max(...pages) : 1 };
}

export function parseDetails(html) {
  const m = cleanText(html).match(/Piedāvājums spēkā no (\d{2}\.\d{2}\.\d{4}) līdz (\d{2}\.\d{2}\.\d{4})/);
  const loyalty = /Mans Rimi/i.test(html.match(/<div class="price-label[\s\S]{0,600}/)?.[0] ?? '');
  return m ? { validFrom: parseLvDate(m[1]), validTo: parseLvDate(m[2]), loyalty } : { loyalty };
}

export async function scrape({ log }) {
  const all = [];
  let last = 1;
  for (let page = 1; page <= Math.min(last, MAX_PAGES); page++) {
    const html = await fetchText(`${LIST}?currentPage=${page}&pageSize=80`);
    const { items, lastPage } = parseListPage(html);
    if (page === 1) last = lastPage;
    if (!items.length) break;
    all.push(...items);
  }
  log(`rimi: ${all.length} товаров на ${Math.min(last, MAX_PAGES)} стр.`);

  // Только реальные скидки (есть обычная цена)
  const deals = all.filter((i) => i.priceOld && i.priceNew && i.priceOld > i.priceNew);
  deals.sort((a, b) => b.priceOld - b.priceNew - (a.priceOld - a.priceNew));
  const top = deals.slice(0, DETAILS_TOP);
  let withDates = 0;
  await mapLimit(top, 4, async (item) => {
    try {
      const d = parseDetails(await fetchText(item.url, { retries: 0, timeoutMs: 20000 }));
      if (d.validTo) {
        item.validFrom = d.validFrom;
        item.validTo = d.validTo;
        withDates++;
      }
    } catch {
      /* срок не критичен */
    }
  });
  log(`rimi: сроки получены для ${withDates}/${top.length}`);

  return deals.map(({ perUnit, ...i }) => ({
    ...i,
    conditions: [
      ...i.conditions,
      ...(perUnit && perUnit !== 'gab' ? [`Cena par 1 ${perUnit}`] : []),
      'Cena Rimi e-veikalā (internetveikalā)',
    ],
    conditionsRu: [],
    variant: i.sku,
  }));
}
