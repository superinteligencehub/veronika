// Общий формат купона и функции нормализации / дедупликации / фильтра сроков.
//
// Coupon {
//   id: string                 — стабильный id (хэш магазин+название+цена+срок)
//   source: string             — id источника (rimi, maxima, ...)
//   store: string              — название магазина
//   category: string           — groceries | fastfood | auto | electronics | beauty | other
//   kind: 'discount'|'coupon'|'offer'|'price'
//                              — скидка с ценой / купон-код / акция без цены / просто цена (топливо)
//   title: string              — оригинальное название (латышский)
//   titleRu: string            — перевод на русский
//   brand?: string
//   priceNew?: number          — цена по акции, €
//   priceOld?: number          — обычная цена, €
//   savingEur?: number         — выгода в € на единицу
//   savingPct?: number         — выгода в %
//   unitPrice?: {value, unit}  — цена за кг/л/шт (для сравнения)
//   validFrom?: 'YYYY-MM-DD'
//   validTo?: 'YYYY-MM-DD'     — последний день действия включительно (Europe/Riga)
//   conditions: string[]       — условия (латышский)
//   conditionsRu: string[]     — условия по-русски
//   requires: string[]         — нужна карта/приложение: 'card:paldies', 'app:lidlplus', ...
//   url: string                — ссылка на источник
//   image?: string
//   firstSeen: 'YYYY-MM-DD'
// }

import { normKey, round2, shortHash, rigaDate } from './util.js';

export const CATEGORIES = {
  groceries: 'Продукты',
  kids: 'Детям',
  fastfood: 'Фастфуд и кафе',
  auto: 'Авто и топливо',
  electronics: 'Электроника',
  home: 'Дом и сад',
  beauty: 'Красота и аптеки',
  fashion: 'Одежда и обувь',
  sport: 'Спорт',
  pets: 'Животные',
  books: 'Книги и канцелярия',
  fun: 'Кино и досуг',
  delivery: 'Доставка еды',
  telecom: 'Связь',
  travel: 'Путешествия',
  other: 'Другое',
};

/** Привести сырой объект скрапера к общему формату. Возвращает null, если данные битые. */
export function normalizeCoupon(raw, source) {
  const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  let priceNew = typeof raw.priceNew === 'number' && raw.priceNew > 0 ? round2(raw.priceNew) : null;
  let priceOld = typeof raw.priceOld === 'number' && raw.priceOld > 0 ? round2(raw.priceOld) : null;
  if (priceOld != null && priceNew != null && priceOld <= priceNew) priceOld = null;

  let savingEur = null;
  let savingPct = null;
  if (priceOld != null && priceNew != null) {
    savingEur = round2(priceOld - priceNew);
    savingPct = Math.round((savingEur / priceOld) * 100);
  } else if (typeof raw.savingPct === 'number' && raw.savingPct > 0 && raw.savingPct < 100) {
    savingPct = Math.round(raw.savingPct);
    if (priceNew != null) {
      priceOld = round2(priceNew / (1 - savingPct / 100));
      savingEur = round2(priceOld - priceNew);
    }
  }
  // Защита от ошибок парсинга: скидка > 95% почти всегда мусор.
  if (savingPct != null && savingPct > 95) return null;

  const kind = raw.kind ?? (savingEur != null || savingPct != null ? 'discount' : priceNew != null ? 'price' : 'offer');
  const validTo = raw.validTo ?? null;
  const conditions = (raw.conditions ?? []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);

  return {
    id: shortHash(source.id, normKey(title), priceNew ?? '', validTo ?? '', raw.variant ?? ''),
    source: raw.source ?? source.id,
    ...(raw.source && raw.source !== source.id ? { via: source.id } : {}),
    store: raw.store ?? source.name,
    category: raw.category ?? source.category,
    kind,
    title,
    titleRu: raw.titleRu ?? '',
    ...(raw.brand ? { brand: raw.brand } : {}),
    ...(priceNew != null ? { priceNew } : {}),
    ...(priceOld != null ? { priceOld } : {}),
    ...(savingEur != null ? { savingEur } : {}),
    ...(savingPct != null ? { savingPct } : {}),
    ...(raw.unitPrice ? { unitPrice: raw.unitPrice } : {}),
    ...(raw.validFrom ? { validFrom: raw.validFrom } : {}),
    ...(validTo ? { validTo } : {}),
    conditions,
    conditionsRu: raw.conditionsRu ?? [],
    requires: raw.requires ?? [],
    url: raw.url ?? source.url,
    ...(raw.image ? { image: raw.image } : {}),
    ...(raw.manual ? { manual: true } : {}),
  };
}

/** Убрать просроченные (validTo < сегодня) и ещё не начавшиеся более чем через 7 дней. */
export function filterActive(coupons, today = rigaDate()) {
  return coupons.filter((c) => !c.validTo || c.validTo >= today);
}

/**
 * Дедупликация: один и тот же товар одного магазина (название без регистра/диакритики)
 * с одинаковым сроком — оставляем вариант с наибольшей выгодой.
 */
export function dedupe(coupons) {
  const best = new Map();
  for (const c of coupons) {
    const key = `${c.store}|${normKey(c.title)}|${c.validTo ?? ''}|${c.kind}`;
    const prev = best.get(key);
    if (!prev || (c.savingEur ?? 0) > (prev.savingEur ?? 0) || ((c.savingEur ?? 0) === (prev.savingEur ?? 0) && (c.priceNew ?? 1e9) < (prev.priceNew ?? 1e9))) {
      best.set(key, c);
    }
  }
  return [...best.values()];
}

/** Сортировка «по выгоде»: сначала € выгоды, потом %. */
export function byValue(a, b) {
  return (b.savingEur ?? -1) - (a.savingEur ?? -1) || (b.savingPct ?? -1) - (a.savingPct ?? -1);
}
