// Lidl: публичные страницы акций магазина (/c/store/...). Каждая карточка товара
// содержит атрибут data-grid-data с JSON: цена, старая цена, %, цена Lidl Plus, даты.

import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { cleanText, isoToRigaDate, rigaDate } from '../lib/util.js';

const BASE = 'https://www.lidl.lv';
const LISTS = [
  '/c/store/aktualie-piedavajumi/a10028219',
  '/c/store/lidl-top-preces/a10054629',
  '/c/store/super-brivdienas/a10036601',
];

function unitFromBase(text) {
  // "1 kg = 5,34 €" / "Ar Lidl Plus 2 gab. = 1,32 €"
  const m = String(text ?? '').match(/1\s*(kg|l|gab)\.?\s*=\s*(\d+(?:[.,]\d+)?)/i);
  return m ? { value: Number(m[2].replace(',', '.')), unit: m[1].toLowerCase() } : null;
}

const epochToDate = (s) => (s ? rigaDate(new Date(s * 1000)) : null);

export function parseGrid(d, listUrl) {
  const price = d.price ?? {};
  const disc = price.discount ?? {};
  const lp = Array.isArray(d.lidlPlus) && d.lidlPlus[0] ? d.lidlPlus[0] : null;
  const regionPrice = d.regionsPrices?.['1']?.currentPrice ?? {};

  const conditions = [];
  const requires = [];
  let priceNew = typeof price.price === 'number' ? price.price : null;
  let priceOld = typeof disc.deletedPrice === 'number' ? disc.deletedPrice : null;
  let savingPct = typeof disc.percentageDiscount === 'number' ? disc.percentageDiscount : null;

  if (lp?.price?.price != null) {
    const lpPrice = lp.price.price;
    const lpOld = lp.price.discount?.deletedPrice;
    if (priceNew == null || lpPrice < priceNew) {
      if (priceOld == null) priceOld = lpOld ?? priceNew ?? null;
      priceNew = lpPrice;
      requires.push('app:lidlplus');
      conditions.push('Cena ar Lidl Plus');
    }
    if (lp.highlightText) conditions.push(cleanText(lp.highlightText));
    if (savingPct == null && priceOld == null) {
      const m = String(lp.highlightText ?? '').match(/^-(\d+)%$/);
      if (m) savingPct = Number(m[1]);
    }
  }
  for (const b of d.stockAvailability?.badgeInfo?.badges ?? []) if (b.text) conditions.push(cleanText(b.text));
  if (price.packaging?.text) conditions.push(`Iepakojums: ${cleanText(price.packaging.text)}`);

  const validFrom = epochToDate(d.storeStartDate) ?? isoToRigaDate(regionPrice.startDate);
  const validTo = epochToDate(d.storeEndDate) ?? isoToRigaDate(regionPrice.endDate);

  return {
    variant: String(d.productId ?? d.itemId ?? ''),
    title: cleanText(d.fullTitle ?? d.title),
    brand: d.brand?.showBrand ? d.brand.name : undefined,
    priceNew,
    priceOld,
    ...(priceOld == null && savingPct ? { savingPct } : {}),
    unitPrice: unitFromBase(price.basePrice?.text ?? lp?.price?.basePrice?.text),
    validFrom,
    validTo,
    conditions,
    requires,
    url: d.canonicalUrl ? new URL(d.canonicalUrl, BASE).href : listUrl,
    image: d.image,
  };
}

export function parseListPage(html, listUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('[data-grid-data]').each((_, el) => {
    try {
      out.push(parseGrid(JSON.parse($(el).attr('data-grid-data')), listUrl));
    } catch {
      /* битая карточка — пропускаем */
    }
  });
  return out;
}

export async function scrape({ log }) {
  const items = [];
  const seen = new Set();
  let ok = 0;
  const errors = [];
  for (const path of LISTS) {
    const url = BASE + path;
    try {
      const list = parseListPage(await fetchText(url), url);
      ok++;
      for (const it of list) {
        if (seen.has(it.variant)) continue;
        seen.add(it.variant);
        items.push(it);
      }
    } catch (err) {
      errors.push(`${path}: ${err.message}`);
    }
  }
  if (!ok) throw new Error(errors.join('; '));
  log(`lidl: ${items.length} товаров (${ok}/${LISTS.length} страниц)`);
  return items;
}
