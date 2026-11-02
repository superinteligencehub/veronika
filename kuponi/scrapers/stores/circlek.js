// Circle K: страницы «Īpaši piedāvājumi» и «Kampaņas un akcijas» (карточки с
// заголовком/текстом/картинкой) + официальная таблица цен на топливо.

import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { cleanText, parsePrice, rigaDate } from '../lib/util.js';

const BASE = 'https://www.circlek.lv';
const OFFER_PAGES = ['/ipasi-piedavajumi', '/kampanas-un-akcijas'];
const FUEL_PAGE = '/degviela-miles/degvielas-cenas';

export function parseOfferCards(html, pageUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('.atom-card').each((_, el) => {
    const $el = $(el);
    const title = cleanText($el.find('h2, h3').first().text());
    const text = cleanText($el.find('.field-textarea').text());
    if (!title || /noteikumi/i.test(title)) return;
    const link = $el.find('a[href]').attr('href');
    const img = $el.find('img').attr('src');
    // «… tikai par 6,99€!» → цена; «3€, 4€, 7€» → минимальная
    const prices = [...text.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*€/g)].map((m) => parsePrice(m[1]));
    const pct = text.match(/(\d{1,2})\s*%\s*atlaid/i);
    out.push({
      variant: title,
      kind: 'offer',
      title,
      priceNew: prices.length ? Math.min(...prices) : null,
      ...(pct ? { savingPct: Number(pct[1]) } : {}),
      conditions: [text, /extra/i.test(pageUrl + text) ? 'Circle K EXTRA' : ''].filter(Boolean),
      requires: /extra/i.test(text) ? ['app:circlek-extra'] : [],
      url: link ? new URL(link, BASE).href : pageUrl,
      image: img ? new URL(img, BASE).href : undefined,
    });
  });
  return out;
}

function fuelType(name) {
  if (/^d/i.test(name)) return 'Dīzeļdegviela';
  if (/9[58]/.test(name)) return 'Benzīns';
  if (/lpg|gāz|gaz/i.test(name)) return 'Autogāze';
  if (/ad ?blue/i.test(name)) return 'AdBlue';
  return 'Degviela';
}

export function parseFuel(html, today = rigaDate()) {
  const $ = cheerio.load(html);
  const out = [];
  $('table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const name = cleanText($(tds[0]).text());
    const price = parsePrice(cleanText($(tds[1]).text()));
    if (!name || price == null || price > 10 || /degviela/i.test(name)) return;
    out.push({
      variant: `fuel-${name}`,
      kind: 'price',
      title: `${fuelType(name)} ${name}`,
      priceNew: price,
      unitPrice: { value: price, unit: 'l' },
      validFrom: today,
      validTo: today, // цена на сегодня, завтра обновится
      conditions: [cleanText($(tds[2]).text()) || 'Cena par litru'].filter(Boolean),
      url: BASE + FUEL_PAGE,
    });
  });
  return out;
}

export async function scrape({ log }) {
  const items = [];
  const errors = [];
  for (const p of OFFER_PAGES) {
    try {
      items.push(...parseOfferCards(await fetchText(BASE + p), BASE + p));
    } catch (err) {
      errors.push(err.message);
    }
  }
  try {
    items.push(...parseFuel(await fetchText(BASE + FUEL_PAGE)));
  } catch (err) {
    errors.push(err.message);
  }
  if (!items.length && errors.length) throw new Error(errors.join('; '));
  // На двух страницах часть карточек повторяется
  const uniq = [...new Map(items.map((i) => [i.variant, i])).values()];
  log(`circlek: ${uniq.length} предложений/цен`);
  return uniq;
}
