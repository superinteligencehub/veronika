// Maxima: публичная страница акций /piedavajumi. Первые ~21 позиция — в HTML,
// остальные — через тот же AJAX-эндпоинт, что вызывает кнопка «Rādīt vairāk»
// (POST /ajax/salesloadmore, offset/limit), ответ — JSON с HTML карточек.

import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { parsePrice, parseLvRange, parseUnitPrice, cleanText, rigaDate } from '../lib/util.js';

const BASE = 'https://www.maxima.lv';
const PAGE = `${BASE}/piedavajumi`;
const PAGE_SIZE = 100;

function wrapperPrice($, $w) {
  if (!$w || !$w.length) return null;
  const pv = cleanText($w.find('.price-value').first().text());
  if (/[.,]/.test(pv)) return parsePrice(pv);
  const cents = cleanText($w.find('.cents-value').first().text());
  const n = parsePrice(pv);
  if (n == null) return null;
  return cents ? Number(`${n}.${cents.padStart(2, '0')}`) : n;
}

export function parseOffers(html, today = rigaDate()) {
  const $ = cheerio.load(html);
  const out = [];
  $('.offer-item > .item').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('data-product-id');
    const title = cleanText($el.find('.text .title').first().text()) || cleanText($el.find('.item-title-text').first().text());
    const fullTitle = cleanText($el.find('.item-title-text').first().text());
    const range = parseLvRange($el.attr('data-dates-interval'), today);

    const news = [];
    $el.find('.item-price-new').each((__, p) => {
      const $p = $(p);
      const price = wrapperPrice($, $p.find('.price-wrapper'));
      if (price != null) news.push({ price, app: $p.hasClass('app'), paldies: $p.hasClass('paldies'), edlp: $p.hasClass('edlp') });
    });
    let priceOld = wrapperPrice($, $el.find('.item-price-regular .price-wrapper'));
    if (priceOld == null) priceOld = parsePrice(cleanText($el.find('.info-old-price .price-value').first().text()));
    const pct = parsePrice(cleanText($el.find('.discount-value').first().text()).replace('-', ''));
    const fromWord = $el.find('.price-value-word').length > 0;

    const best = news.length ? news.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    const conditions = [];
    const requires = [];
    if (news.some((n) => n.paldies)) {
      conditions.push('Atlaide ar PALDIES karti');
      requires.push('card:paldies');
    }
    if (best?.app) {
      conditions.push('Cena mobilajā lietotnē');
      requires.push('app:maxima');
    }
    if (fromWord) conditions.push('Cena "no" (atkarībā no veida)');
    const appPrice = news.find((n) => n.app);
    const cardPrice = news.find((n) => n.paldies);
    if (appPrice && cardPrice) conditions.push(`Ar PALDIES karti ${cardPrice.price.toFixed(2)} €, lietotnē ${appPrice.price.toFixed(2)} €`);
    $el.find('[data-alt]').each((__, t) => {
      const alt = cheerio
        .load(`<p>${$(t).attr('data-alt').replace(/&lt;br&gt;|<br>/gi, '. ')}</p>`)('p')
        .text()
        .trim();
      if (!alt || /^Atlaide ar PALDIES karti$/i.test(alt) || /^Piedāvājums spēkā/i.test(alt)) return;
      if (/Preču piedāvājums atšķirīgs/i.test(alt)) return conditions.push('Ассортимент отличается по магазинам');
      if (!conditions.includes(alt)) conditions.push(alt);
    });
    const img = $el.find('.img img').attr('src');

    const raw = {
      variant: id,
      title: title || fullTitle,
      priceNew: best?.price ?? null,
      priceOld,
      unitPrice: parseUnitPrice(fullTitle),
      validFrom: range.from,
      validTo: range.to,
      conditions,
      requires,
      url: PAGE,
      image: img ? new URL(img, BASE).href : undefined,
    };
    if (best?.edlp && priceOld == null) raw.kind = 'price'; // «Cenu līderi» — постоянно низкая цена
    if (priceOld == null && pct) raw.savingPct = pct;
    if (!raw.priceNew && pct) raw.kind = 'offer';
    if (!raw.priceNew && pct) raw.conditions.unshift(`Atlaide -${pct}%`);
    out.push(raw);
  });
  return out;
}

export async function scrape({ log }) {
  const first = await fetchText(PAGE);
  const total = Number(first.match(/value="(\d+)" id="totalProducts"/)?.[1] ?? 0);
  const items = parseOffers(first);
  const seen = new Set(items.map((i) => i.variant));
  let offset = items.length;
  let guard = 0;
  while ((total === 0 || offset < total) && guard++ < 30) {
    const body = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
    const txt = await fetchText(`${BASE}/ajax/salesloadmore`, {
      method: 'POST',
      body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: PAGE, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    });
    let html = '';
    try {
      html = JSON.parse(txt).html ?? '';
    } catch {
      break;
    }
    const batch = parseOffers(html);
    if (!batch.length) break;
    for (const b of batch) {
      if (seen.has(b.variant)) continue;
      seen.add(b.variant);
      items.push(b);
    }
    offset += batch.length;
  }
  log(`maxima: ${items.length} из ${total || '?'} предложений`);
  return items;
}
