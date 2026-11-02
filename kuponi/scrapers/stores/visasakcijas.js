// VisasAkcijas.lv — публичный каталог актуальных буклетов акций ~30 сетей
// (Maxima, Rimi, Lidl, Mego, top!, Elvi, Drogas, Benu, Jysk, Pepco, Krūza…).
// Даёт по каждому магазину: какой буклет действует, период и ссылку на просмотр.
// Особенно полезно для сетей, у которых акции есть только в PDF/буклете.

import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { cleanText, parseLvRange, rigaDate } from '../lib/util.js';

const BASE = 'https://www.visasakcijas.lv/';

// Название магазина в буклете → id источника и категория
const STORES = [
  [/^maxima/i, 'maxima', 'Maxima', 'groceries'], [/^rimi/i, 'rimi', 'Rimi', 'groceries'], [/^lidl/i, 'lidl', 'Lidl', 'groceries'],
  [/^mego/i, 'mego', 'Mego', 'groceries'], [/^top/i, 'top', 'top!', 'groceries'], [/^elvi/i, 'elvi', 'Elvi', 'groceries'],
  [/^promo/i, 'promo', 'Promo Cash&Carry', 'groceries'], [/^lats/i, 'lats', 'LaTS', 'groceries'], [/^citro/i, 'citro', 'Citro', 'groceries'],
  [/^aibe/i, 'aibe', 'Aibe', 'groceries'], [/^vynoteka/i, 'vynoteka', 'Vynoteka', 'groceries'], [/^vesko/i, 'vesko', 'Vesko', 'groceries'],
  [/^k-?senukai/i, 'ksenukai-lv', 'Ksenukai', 'home'], [/^jysk/i, 'jysk', 'JYSK', 'home'], [/^kr[uū]za/i, 'kruza', 'Krūza', 'home'],
  [/^pepco/i, 'pepco', 'Pepco', 'home'], [/^m[aā]jai un d[aā]rzam/i, 'majaiundarzam', 'Mājai un dārzam', 'home'],
  [/^kur[sš]i/i, 'kursi-lv', 'Kurši', 'home'], [/^super selection/i, 'superselection', 'Super Selection', 'home'],
  [/^drogas/i, 'drogas', 'Drogas', 'beauty'], [/^siberika/i, 'siberika', 'Siberika', 'beauty'], [/^multilukss/i, 'multilukss', 'Multilukss', 'beauty'],
  [/^euro ?aptieka/i, 'euroaptieka', 'Euroaptieka', 'beauty'], [/^benu/i, 'benu', 'Benu', 'beauty'], [/^m[eē]ness aptieka/i, 'menessaptieka', 'Mēness aptieka', 'beauty'],
  [/^aptieku alianse/i, 'aptiekualianse', 'Aptieku alianse', 'beauty'], [/^mana aptieka/i, 'manaaptieka', 'Mana aptieka', 'beauty'],
];

export function storeFor(title) {
  const t = cleanText(title);
  const hit = STORES.find(([re]) => re.test(t));
  return hit ? { source: hit[1], store: hit[2], category: hit[3] } : null;
}

export function parseCatalogs(html, today = rigaDate()) {
  const $ = cheerio.load(html);
  const out = [];
  $('.box, .box2').each((_, el) => {
    const $b = $(el);
    const title = cleanText($b.find('.title-overlay span, a.title, .title').first().text());
    const href = $b.find('a[href]').first().attr('href') || $b.find('.overlay').attr('onclick')?.match(/'([^']+)'/)?.[1];
    if (!title || !href || !/bukle|katalog|akcij|piedāvāj/i.test(title)) return;
    const range = parseLvRange(title, today);
    const s = storeFor(title);
    out.push({
      variant: `${title}|${href}`,
      kind: 'catalog',
      title,
      ...(s ?? { store: title.split(/\s+/)[0], category: 'other' }),
      validFrom: range.from,
      validTo: range.to,
      conditions: ['Akciju buklets (katalogs) — visas akcijas skatiet bukletā'],
      url: new URL(href, BASE).href,
      image: $b.find('img').attr('src'),
    });
  });
  return out;
}

export async function scrape({ log, today }) {
  const home = await fetchText(BASE);
  const items = parseCatalogs(home, today);
  // страницы магазинов: все действующие буклеты конкретной сети
  const $ = cheerio.load(home);
  const storePages = [...new Set($('a[href$="-akcijas.htm"]').map((_, a) => new URL($(a).attr('href'), BASE).href).get())];
  for (const p of storePages.slice(0, 40)) {
    try {
      items.push(...parseCatalogs(await fetchText(p, { retries: 0 }), today));
    } catch {
      /* одна страница не критична */
    }
  }
  const uniq = [...new Map(items.map((i) => [i.variant, i])).values()].filter((i) => !i.validTo || i.validTo >= today);
  log(`visasakcijas: ${uniq.length} буклетов, ${new Set(uniq.map((i) => i.store)).size} сетей`);
  return uniq;
}
