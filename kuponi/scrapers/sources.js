// Реестр источников = собственные парсеры крупных сетей + магазины из автообнаружения
// (scrapers/registry/stores.json, создаётся `npm run discover`).
// mode: auto — собирается автоматически; manual — закрыт проверкой бота/только приложение → ручной ввод;
//       planned — сайт открыт, но цен со скидкой публично нет (часто есть буклет — см. VisasAkcijas).

import { readFileSync } from 'node:fs';

const CUSTOM = [
  { id: 'rimi', name: 'Rimi', category: 'groceries', mode: 'auto', module: './stores/rimi.js',
    url: 'https://www.rimi.lv/e-veikals/lv/akcijas-piedavajumi',
    note: 'Акции e-veikals: цена, обычная цена, цена за ед. Срок — со страницы товара (для топ-позиций).' },
  { id: 'maxima', name: 'Maxima', category: 'groceries', mode: 'auto', module: './stores/maxima.js',
    url: 'https://www.maxima.lv/piedavajumi',
    note: 'Все акции: цена с картой PALDIES/в приложении, обычная цена или %, срок, условия.' },
  { id: 'lidl', name: 'Lidl', category: 'groceries', mode: 'auto', module: './stores/lidl.js',
    url: 'https://www.lidl.lv/c/store/aktualie-piedavajumi/a10028219',
    note: 'Товары недели: цена, старая цена, %, цена Lidl Plus, даты. Купоны Lidl Plus — только в приложении.' },
  { id: 'circlek', name: 'Circle K', category: 'auto', mode: 'auto', module: './stores/circlek.js',
    url: 'https://www.circlek.lv/ipasi-piedavajumi',
    note: 'Спецпредложения + официальные цены на топливо. Купоны EXTRA — в приложении.' },
  { id: 'visasakcijas', name: 'Буклеты акций (VisasAkcijas.lv)', category: 'other', mode: 'auto', module: './stores/visasakcijas.js',
    url: 'https://www.visasakcijas.lv/', aggregator: true,
    note: 'Действующие буклеты акций ~30 сетей (Mego, top!, Elvi, Drogas, Jysk, Pepco, аптеки…) с периодом и ссылкой.' },
  { id: 'mcdonalds', name: "McDonald's", category: 'fastfood', mode: 'manual', module: './stores/mcdonalds.js',
    url: 'https://www.mcdonalds.lv/',
    note: 'Сайт закрыт проверкой Cloudflare, купоны — в приложении. Ручной ввод/фото.' },
  { id: 'wolt', name: 'Wolt', category: 'delivery', mode: 'manual', url: 'https://wolt.com/',
    note: 'Акции зависят от адреса и аккаунта (приложение) — ручной ввод.' },
  { id: 'boltfood', name: 'Bolt Food', category: 'delivery', mode: 'manual', url: 'https://food.bolt.eu/',
    note: 'Только приложение/аккаунт — ручной ввод.' },
];

function loadRegistry() {
  try {
    return JSON.parse(readFileSync(new URL('./registry/stores.json', import.meta.url), 'utf8'));
  } catch {
    return [];
  }
}

const taken = new Set(CUSTOM.flatMap((s) => [s.id, s.name.toLowerCase()]));
const NOTE = {
  blocked: 'Сайт закрыт проверкой бота — ручной ввод (или буклет, если есть).',
  'no-deals': 'Сайт открыт, но публичных цен со скидкой не найдено (акции в буклете/картинках/приложении).',
};

// Несколько доменов могут вести на один сайт (mothercare.lv → babycity.lv): берём один,
// предпочитая домен, совпадающий с конечным сайтом.
const hostOf = (r) => (r.origin ? new URL(r.origin).host.replace(/^www\./, '') : null);
const registry = loadRegistry().sort((a, b) => Number(hostOf(b) === b.domain) - Number(hostOf(a) === a.domain));
const usedHosts = new Set();
const unique = registry.filter((r) => {
  const h = hostOf(r);
  if (!h) return true;
  if (usedHosts.has(h)) return false;
  usedHosts.add(h);
  return true;
});

const discovered = unique
  .filter((r) => r.status !== 'unavailable' && !taken.has(r.id) && !taken.has(r.name.toLowerCase()) && r.category !== 'deals')
  .map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    url: r.url ?? `https://${r.domain}`,
    mode: r.status === 'auto' ? 'auto' : r.status === 'blocked' ? 'manual' : 'planned',
    ...(r.status === 'auto' ? { module: './stores/generic.js', platform: r.platform, origin: r.origin, saleUrls: r.saleUrls, pages: r.pages } : {}),
    note: r.note ?? (r.status === 'auto' ? `Автосбор (${r.platform}), найдено при проверке: ${r.sample}` : NOTE[r.status] ?? ''),
  }));

export const SOURCES = [...CUSTOM, ...discovered];
export const getSource = (id) => SOURCES.find((s) => s.id === id);
