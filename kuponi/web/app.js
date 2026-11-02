import { WORDS } from './glossary.js';

const CFG = self.KUPONI_CONFIG ?? {};
const DATA_URL = CFG.dataUrl ?? '../data/coupons.json';
const TZ = 'Europe/Riga';
const PAGE = 30;

const CAT_ICONS = { groceries: '🛒', kids: '🧸', fastfood: '🍔', auto: '⛽', electronics: '🔌', home: '🏠', beauty: '💄', fashion: '👗', sport: '⚽', pets: '🐾', books: '📚', fun: '🎬', delivery: '🛵', telecom: '📶', travel: '✈️', other: '🎟️' };
const STORE_COLORS = {
  rimi: '#d6001c', maxima: '#1e5bb8', lidl: '#f2c500', circlek: '#ee6a1f', mcdonalds: '#ffbc0d', barbora: '#e4002b',
  mego: '#ff6a00', top: '#e30613', elvi: '#008c45', kfc: '#a3080c', burgerking: '#d62300', neste: '#00a651', virsi: '#0c4da2',
};
const REQUIRES_RU = {
  'card:paldies': '💳 карта PALDIES',
  'app:maxima': '📱 приложение Maxima',
  'app:lidlplus': '📱 Lidl Plus',
  'card:mansrimi': '💳 Mans Rimi',
  'app:circlek-extra': '📱 Circle K EXTRA',
};
const STATUS_RU = { ok: 'работает', stale: 'старые данные', error: 'ошибка', manual: 'ручной ввод', planned: 'нет скидок на сайте' };

// ---------- утилиты ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => (n == null ? '' : `${n.toFixed(2).replace('.', ',')} €`);
const eurShort = (n) => (n == null ? '' : n >= 10 ? `${Math.round(n)} €` : `${n.toFixed(2).replace('.', ',')} €`);
const rigaDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ddmm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е');

const store = {
  get(k, def) { try { const v = localStorage.getItem(`kuponi.${k}`); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(`kuponi.${k}`, JSON.stringify(v)); } catch { /* приватный режим */ } },
};

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- состояние ----------
const DEFAULT_FILTERS = { cat: 'all', stores: [], endsToday: false, myOnly: false, minPct: 0, minEur: 0, noCard: false, hideUpcoming: false, onlyDiscounts: false, sort: 'eur' };
const S = {
  data: null,
  all: [],
  today: rigaDate(),
  filters: { ...DEFAULT_FILTERS, ...store.get('filters', {}) },
  favorites: new Map(Object.entries(store.get('favorites', {}))),
  myStores: new Set(store.get('myStores', [])),
  manual: store.get('manual', []),
  view: 'feed',
  feedItems: [],
  feedShown: 0,
};

function saveFilters() { store.set('filters', S.filters); }

/** Состояние для service worker (утренний дайджест, напоминания). */
async function syncSwState() {
  try {
    const cache = await caches.open('kuponi-state');
    const favs = [...S.favorites.values()].map((c) => ({ id: c.id, title: c.title, titleRu: c.titleRu, store: c.store, validTo: c.validTo }));
    await cache.put('state.json', new Response(JSON.stringify({ myStores: [...S.myStores], favorites: favs, pushEnabled: store.get('pushEnabled', false), localDigest: store.get('localDigest', false) })));
  } catch { /* нет Cache API */ }
}

// ---------- данные ----------
async function loadData({ force = false } = {}) {
  let data = null;
  let fromNetwork = false;
  try {
    const res = await fetch(DATA_URL, { cache: force ? 'reload' : 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
    fromNetwork = true;
  } catch {
    try {
      const cached = await caches.match(new URL(DATA_URL, location.href).href);
      if (cached) data = await cached.json();
    } catch { /* ignore */ }
  }
  $('#offlineBanner').hidden = fromNetwork && navigator.onLine;
  if (!data) {
    $('#updated').textContent = 'Нет данных — проверьте подключение';
    return;
  }
  S.data = data;
  S.today = rigaDate();
  rebuildAll();
  const gen = new Date(data.generatedAt);
  const when = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(gen);
  const ok = data.sources.filter((s) => s.status === 'ok').length;
  const auto = data.sources.filter((s) => s.mode === 'auto').length;
  $('#updated').textContent = `Обновлено ${when} · ${S.all.length} предложений · источники ${ok}/${auto}`;
  renderAll();
}

function rebuildAll() {
  const manual = S.manual.map((m) => ({ ...m, manual: true, local: true }));
  // Просроченное скрываем (и в данных, и в ручных купонах)
  S.all = [...(S.data?.coupons ?? []), ...manual].filter((c) => !c.validTo || c.validTo >= S.today);
}

const isActiveToday = (c) => !c.validFrom || c.validFrom <= S.today;
const endsToday = (c) => c.validTo === S.today && c.kind !== 'price';
const categories = () => S.data?.categories ?? { groceries: 'Продукты', fastfood: 'Фастфуд и кафе', auto: 'Авто и топливо', electronics: 'Электроника и дом', beauty: 'Красота и здоровье', other: 'Спорт, одежда, досуг' };
const storeNames = () => [...new Set([...(S.data?.sources ?? []).map((s) => s.name), ...S.all.map((c) => c.store)])].sort((a, b) => a.localeCompare(b));
const storesWithData = () => [...new Set(S.all.map((c) => c.store))].sort((a, b) => a.localeCompare(b));

// ---------- рендер карточки ----------
function validityBadge(c) {
  if (c.kind === 'price') return '<span class="badge soon">цена на сегодня</span>';
  if (c.validFrom && c.validFrom > S.today) return `<span class="badge soon">с ${ddmm(c.validFrom)}</span>`;
  if (!c.validTo) return '<span class="badge soon">срок уточняйте</span>';
  if (c.validTo === S.today) return '<span class="badge hot">⏰ сегодня последний день</span>';
  if (c.validTo === addDays(S.today, 1)) return '<span class="badge warn">до завтра</span>';
  const far = c.validTo > addDays(S.today, 60);
  return `<span class="badge soon">до ${far ? `${ddmm(c.validTo)}.${c.validTo.slice(0, 4)}` : ddmm(c.validTo)}</span>`;
}

function cardHtml(c) {
  const color = STORE_COLORS[c.source] ?? 'var(--accent)';
  const fav = S.favorites.has(c.id);
  const thumb = c.image || c.photo
    ? `<img class="thumb" src="${esc(c.photo || c.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;thumb ph&quot;>${CAT_ICONS[c.category] ?? '🏷️'}</div>'">`
    : `<div class="thumb ph" aria-hidden="true">${CAT_ICONS[c.category] ?? '🏷️'}</div>`;
  const unit = c.unitPrice ? `<span class="unit">${eur(c.unitPrice.value)}/${esc(c.unitPrice.unit === 'gab' ? 'шт' : c.unitPrice.unit === 'l' ? 'л' : c.unitPrice.unit === 'kg' ? 'кг' : c.unitPrice.unit)}</span>` : '';
  const price = c.priceNew != null
    ? `<div class="price-row"><span class="price-new">${eur(c.priceNew).replace(' €', '<small> €</small>')}</span>${c.priceOld ? `<span class="price-old">${eur(c.priceOld)}</span>` : ''}${unit}</div>`
    : '';
  const badges = [];
  if (c.savingEur) badges.push(`<span class="badge save">−${eurShort(c.savingEur)}${c.savingPct ? ` · −${c.savingPct}%` : ''}</span>`);
  else if (c.savingPct) badges.push(`<span class="badge save">−${c.savingPct}%</span>`);
  if (c.kind === 'catalog') badges.push('<span class="badge req">📖 буклет акций</span>');
  badges.push(validityBadge(c));
  for (const r of c.requires ?? []) badges.push(`<span class="badge req">${esc(REQUIRES_RU[r] ?? r)}</span>`);
  if (c.manual) badges.push('<span class="badge soon">✍️ вручную</span>');
  if (c.stale) badges.push('<span class="badge warn">данные могут устареть</span>');

  const conds = (c.conditions ?? []).map((lv, i) => {
    const ru = c.conditionsRu?.[i];
    return `<li>${esc(ru || lv)}${ru && ru !== lv ? `<span class="lv">${esc(lv)}</span>` : ''}</li>`;
  }).join('');
  const details = `<details><summary>Условия и источник</summary>${conds ? `<ul class="conds">${conds}</ul>` : ''}${
    c.validFrom || c.validTo ? `<div>Срок: ${c.validFrom ? `с ${ddmm(c.validFrom)} ` : ''}${c.validTo ? `по ${ddmm(c.validTo)}.${c.validTo.slice(0, 4)}` : ''}</div>` : ''
  }${c.url ? `<a class="src" href="${esc(c.url)}" target="_blank" rel="noopener">${c.kind === 'catalog' ? 'Открыть буклет ↗' : 'Открыть источник ↗'}</a>` : ''}${
    c.local ? ` · <button class="btn" data-del="${esc(c.id)}">Удалить</button>` : ''
  }</details>`;

  return `<article class="card${c.stale ? ' stale' : ''}" data-id="${esc(c.id)}">
    ${thumb}
    <div class="head">
      <span class="store-tag" style="--c:${color}"><span class="store-dot"></span>${esc(c.store)}</span>
      <p class="title-lv">${esc(c.title)}</p>
      ${c.titleRu && c.titleRu !== c.title ? `<p class="title-ru">${esc(c.titleRu)}</p>` : ''}
    </div>
    <div>${price}</div>
    <div class="badges">${badges.join('')}</div>
    ${details}
    <button class="fav-btn" data-fav="${esc(c.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Убрать из избранного' : 'В избранное'}">${fav ? '★' : '☆'}</button>
  </article>`;
}

const findCoupon = (id) => S.all.find((c) => c.id === id) ?? S.favorites.get(id);

// ---------- лента ----------
function applyFilters(list) {
  const f = S.filters;
  const stores = new Set(f.stores);
  return list.filter((c) => {
    if (f.cat !== 'all' && c.category !== f.cat) return false;
    if (stores.size && !stores.has(c.store)) return false;
    if (f.myOnly && S.myStores.size && !S.myStores.has(c.store)) return false;
    if (f.endsToday && !endsToday(c)) return false;
    if (f.minPct && (c.savingPct ?? 0) < f.minPct) return false;
    if (f.minEur && (c.savingEur ?? 0) < f.minEur) return false;
    if (f.noCard && c.requires?.length) return false;
    if (f.hideUpcoming && !isActiveToday(c)) return false;
    if (f.onlyDiscounts && !c.savingEur && !c.savingPct) return false;
    return true;
  });
}

const SORTS = {
  eur: (a, b) => (b.savingEur ?? -1) - (a.savingEur ?? -1) || (b.savingPct ?? -1) - (a.savingPct ?? -1),
  pct: (a, b) => (b.savingPct ?? -1) - (a.savingPct ?? -1) || (b.savingEur ?? -1) - (a.savingEur ?? -1),
  ends: (a, b) => (a.validTo ?? '9999').localeCompare(b.validTo ?? '9999') || SORTS.eur(a, b),
  price: (a, b) => (a.priceNew ?? 1e9) - (b.priceNew ?? 1e9),
  new: (a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? '') || SORTS.eur(a, b),
};

function renderCats() {
  const counts = S.all.reduce((m, c) => m.set(c.category, (m.get(c.category) ?? 0) + 1), new Map());
  const cats = Object.entries(categories());
  $('#catChips').innerHTML = [`<button class="chip" data-cat="all" aria-pressed="${S.filters.cat === 'all'}">Все<small>${S.all.length}</small></button>`]
    .concat(cats.map(([id, name]) => `<button class="chip" data-cat="${id}" aria-pressed="${S.filters.cat === id}">${CAT_ICONS[id] ?? ''} ${esc(name)}<small>${counts.get(id) ?? 0}</small></button>`))
    .join('');
}

function renderFeed() {
  renderCats();
  const f = S.filters;
  $('#endsTodayQuick').checked = f.endsToday;
  $('#myStoresQuick').checked = f.myOnly;
  $('#sortSel').value = f.sort;
  const active = ['stores', 'minPct', 'minEur', 'noCard', 'hideUpcoming', 'onlyDiscounts'].filter((k) => (Array.isArray(f[k]) ? f[k].length : f[k])).length;
  $('#filterCount').hidden = !active;
  $('#filterCount').textContent = active;
  S.feedItems = applyFilters(S.all).sort(SORTS[f.sort] ?? SORTS.eur);
  S.feedShown = 0;
  $('#feedList').innerHTML = '';
  $('#feedCount').textContent = S.feedItems.length ? `Найдено: ${S.feedItems.length}` : '';
  if (!S.feedItems.length) {
    $('#feedList').innerHTML = `<p class="empty">Ничего не найдено. ${f.myOnly && !S.myStores.size ? 'Сначала отметьте «Мои магазины» во вкладке «Избранное».' : 'Попробуйте ослабить фильтры.'}</p>`;
    return;
  }
  moreFeed();
}

function moreFeed() {
  const next = S.feedItems.slice(S.feedShown, S.feedShown + PAGE);
  if (!next.length) return;
  $('#feedList').insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
  S.feedShown += next.length;
}

// ---------- лучшее ----------
function renderBest() {
  const scope = store.get('bestScope', 'all');
  const hasMy = S.myStores.size > 0;
  $('#bestScope').innerHTML = `<button class="chip" data-scope="all" aria-pressed="${scope === 'all' || !hasMy}">Все магазины</button>${
    hasMy ? `<button class="chip" data-scope="my" aria-pressed="${scope === 'my'}">Мои магазины</button>` : ''}`;
  let pool = S.all.filter((c) => isActiveToday(c) && c.savingEur > 0 && !c.stale);
  if (scope === 'my' && hasMy) pool = pool.filter((c) => S.myStores.has(c.store));
  const top = pool.sort(SORTS.eur).slice(0, 30);
  $('#bestList').innerHTML = top.length ? top.map((c) => `<li>${cardHtml(c)}</li>`).join('') : '<p class="empty">Пока нет данных о выгоде.</p>';
  let ending = S.all.filter((c) => endsToday(c) && (c.savingEur || c.savingPct));
  if (scope === 'my' && hasMy) ending = ending.filter((c) => S.myStores.has(c.store));
  ending.sort(SORTS.eur);
  $('#endingTitle').textContent = `Заканчиваются сегодня (${ending.length})`;
  $('#endingList').innerHTML = ending.slice(0, 20).map(cardHtml).join('') || '<p class="empty">Сегодня ничего не заканчивается.</p>';
  let cats = S.all.filter((c) => c.kind === 'catalog');
  if (scope === 'my' && hasMy) cats = cats.filter((c) => S.myStores.has(c.store));
  cats.sort((a, b) => a.store.localeCompare(b.store));
  $('#catalogTitle').textContent = `Буклеты акций (${cats.length})`;
  $('#catalogList').innerHTML = cats.map(cardHtml).join('') || '<p class="empty">Нет действующих буклетов.</p>';
}

// ---------- поиск ----------
const STOP = new Set(['для', 'и', 'с', 'в', 'на', 'по', 'без', 'из', 'or', 'un', 'ar']);
const glossary = WORDS.map(([lv, ru]) => ({ lv: norm(lv), ru: norm(ru).split(/[\s,/()-]+/).filter((w) => w.length > 2) }));

function expandToken(t) {
  const alts = new Set([t]);
  // основа русского слова: «молоко»→«молок», «двигателя»→«двигате»
  const stem = t.length >= 7 ? t.slice(0, -2) : t.length >= 4 ? t.slice(0, -1) : t;
  alts.add(stem);
  for (const g of glossary) {
    if (g.ru.some((w) => w.startsWith(stem) || (w.length > 4 && stem.startsWith(w)))) alts.add(g.lv);
    if (t.length > 2 && g.lv.startsWith(t)) alts.add(g.lv);
  }
  return [...alts].filter((a) => a.length > 1);
}

/** Совпадение только с начала слова: «ell» (eļļa) не должно находиться в «WELL». */
function hayMatch(hay, alt) {
  return hay.startsWith(alt) || hay.includes(` ${alt}`);
}

function search(q) {
  const tokens = norm(q).split(/[\s,.]+/).filter((t) => t && !STOP.has(t));
  S.searchExact = true;
  if (!tokens.length) return [];
  const expanded = tokens.map(expandToken);
  const scored = [];
  for (const c of S.all) {
    const hay = c._hay ?? (c._hay = ` ${norm(`${c.title} ${c.titleRu} ${c.brand ?? ''} ${c.store}`).replace(/[^a-zа-я0-9]+/g, ' ')}`);
    let score = 0;
    for (const alts of expanded) if (alts.some((a) => hayMatch(hay, a))) score++;
    if (score) scored.push([score, c]);
  }
  const max = Math.max(0, ...scored.map((s) => s[0]));
  S.searchExact = max === tokens.length;
  return scored.filter((s) => s[0] === max).map((s) => s[1]);
}

function renderCompare(results) {
  if (!results.length) return '';
  // Лучшее предложение в каждом магазине: по цене за единицу, если она есть у всех, иначе по цене.
  const withUnit = results.filter((c) => c.unitPrice?.value);
  const units = new Map();
  for (const c of withUnit) units.set(c.unitPrice.unit, (units.get(c.unitPrice.unit) ?? 0) + 1);
  const mainUnit = [...units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const useUnit = mainUnit && units.get(mainUnit) >= Math.min(3, results.length);
  const key = (c) => (useUnit ? (c.unitPrice?.unit === mainUnit ? c.unitPrice.value : null) : c.priceNew ?? null);
  const perStore = new Map();
  for (const c of results) {
    const k = key(c);
    if (k == null) continue;
    const prev = perStore.get(c.store);
    if (!prev || k < key(prev)) perStore.set(c.store, c);
  }
  const rows = [...perStore.values()].sort((a, b) => key(a) - key(b));
  if (rows.length < 1) return '';
  const unitRu = { kg: 'кг', l: 'л', gab: 'шт' }[mainUnit] ?? mainUnit;
  return `<div class="compare"><h3>Сравнение по магазинам ${useUnit ? `(цена за 1 ${esc(unitRu)})` : '(цена)'}</h3><table>${rows
    .map((c, i) => `<tr class="${i === 0 ? 'best' : ''}"><td><b>${esc(c.store)}</b>${i === 0 ? ' 🏆' : ''}<div class="what">${esc(c.titleRu || c.title)}</div></td><td class="p">${eur(key(c))}${useUnit ? `/${esc(unitRu)}` : ''}${useUnit ? `<div class="what">${eur(c.priceNew)} за уп.</div>` : ''}</td></tr>`)
    .join('')}</table></div>`;
}

function renderSearch() {
  const q = $('#searchInput').value.trim();
  const sugg = ['молоко', 'кофе', 'масло', 'сыр', 'курица', 'бензин', 'яйца', 'хлеб', 'стиральный порошок', 'пиво'];
  $('#searchSuggest').innerHTML = sugg.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('');
  if (!q) {
    $('#compare').innerHTML = '';
    $('#searchList').innerHTML = '<p class="empty">Введите товар по-русски или по-латышски — покажем все акции и где дешевле.</p>';
    return;
  }
  const results = search(q).sort((a, b) => (a.unitPrice?.value ?? a.priceNew ?? 1e9) - (b.unitPrice?.value ?? b.priceNew ?? 1e9));
  $('#compare').innerHTML = (results.length && !S.searchExact ? '<p class="hint">Точных совпадений нет — показаны похожие предложения.</p>' : '') + renderCompare(results);
  $('#searchList').innerHTML = results.length ? results.slice(0, 80).map(cardHtml).join('') : `<p class="empty">По запросу «${esc(q)}» ничего нет.</p>`;
}

// ---------- избранное и мои магазины ----------
function renderFav() {
  const favs = [...S.favorites.values()].map((f) => S.all.find((c) => c.id === f.id) ?? { ...f, stale: true });
  const active = favs.filter((c) => !c.validTo || c.validTo >= S.today);
  $('#favList').innerHTML = active.length ? active.sort(SORTS.ends).map(cardHtml).join('') : '<p class="empty">Нажмите ☆ на купоне, чтобы сохранить его здесь.</p>';
  $('#myStoresGrid').innerHTML = storeNames()
    .map((n) => `<label><input type="checkbox" data-mystore="${esc(n)}" ${S.myStores.has(n) ? 'checked' : ''}><span>${esc(n)}</span></label>`)
    .join('');
}

function toggleFav(id) {
  if (S.favorites.has(id)) S.favorites.delete(id);
  else {
    const c = findCoupon(id);
    if (!c) return;
    const { _hay, ...copy } = c;
    S.favorites.set(id, copy);
  }
  store.set('favorites', Object.fromEntries(S.favorites));
  syncSwState();
  $$(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => {
    const on = S.favorites.has(id);
    b.setAttribute('aria-pressed', on);
    b.textContent = on ? '★' : '☆';
  });
  if (S.view === 'fav') renderFav();
}

// ---------- источники ----------
function renderSources() {
  const src = S.data?.sources ?? [];
  const by = (st) => src.filter((s) => s.status === st).length;
  $('#sourcesSummary').textContent = `Всего источников: ${src.length}. Автосбор: ${by('ok')} работают, ${by('stale') + by('error')} с проблемами · ручной ввод: ${by('manual')} · без публичных скидок: ${by('planned')}`;
  const q = norm($('#sourceFilter')?.value ?? '');
  const st = $('#sourceStatus')?.value ?? 'all';
  const order = { ok: 0, stale: 1, error: 2, manual: 3, planned: 4 };
  const cats = categories();
  $('#sourcesList').innerHTML = [...src]
    .filter((s) => (st === 'all' || s.status === st) && (!q || norm(`${s.name} ${s.url} ${cats[s.category] ?? ''}`).includes(q)))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
    .map((s) => {
      const last = s.lastSuccess ? new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s.lastSuccess)) : null;
      return `<div class="source"><div class="top"><span class="name">${CAT_ICONS[s.category] ?? ''} ${esc(s.name)}</span><span class="status ${esc(s.status)}">${STATUS_RU[s.status] ?? s.status}${s.count ? ` · ${s.count}` : ''}</span></div>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
        ${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
        <p class="note">${esc(cats[s.category] ?? '')}${last ? ` · сбор: ${last}` : ''} · <a href="${esc(s.url)}" target="_blank" rel="noopener">Сайт ↗</a>${
          ['manual', 'error', 'planned'].includes(s.status) ? ` · <button class="btn" data-addfor="${esc(s.name)}" data-cat="${esc(s.category)}">+ купон</button>` : ''}</p></div>`;
    })
    .join('') || '<p class="empty">Ничего не найдено.</p>';
}

// ---------- уведомления ----------
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function renderPush() {
  const supported = 'serviceWorker' in navigator && 'Notification' in self;
  const perm = supported ? Notification.permission : 'unsupported';
  const pushOn = store.get('pushEnabled', false);
  const localOn = store.get('localDigest', false);
  const hasServer = Boolean(CFG.pushServer && CFG.vapidPublicKey);
  $('#pushPanel').innerHTML = `
    <p><b>Каждое утро в 08:00 (Рига):</b> топ-5 купонов дня и напоминание о том, что заканчивается сегодня (в т.ч. из избранного).</p>
    ${!supported ? '<p class="err">Этот браузер не поддерживает уведомления. Установите приложение в Chrome на Android.</p>' : ''}
    ${perm === 'denied' ? '<p class="err">Уведомления запрещены в настройках браузера для этого сайта.</p>' : ''}
    ${hasServer
      ? `<p>Статус: ${pushOn ? '✅ включены' : 'выключены'}</p>
         <div class="row-actions"><button class="btn primary" id="pushToggle">${pushOn ? 'Выключить' : 'Включить уведомления'}</button><button class="btn" id="pushTest">Тест</button></div>`
      : `<p class="hint">Сервер push ещё не настроен (бесплатный Cloudflare Worker, см. <code>kuponi/worker/README.md</code>). Пока можно:</p>
         <label class="checks"><input type="checkbox" id="localDigest" ${localOn ? 'checked' : ''}> Показывать утренний дайджест при фоновом обновлении (Android, установленное приложение; время примерное)</label>
         ${CFG.ntfyTopic ? `<p>Или подпишитесь в приложении <a href="https://ntfy.sh/${esc(CFG.ntfyTopic)}" target="_blank" rel="noopener">ntfy</a> на тему <code>${esc(CFG.ntfyTopic)}</code> — туда GitHub Actions отправляет топ-5 в 08:00.</p>` : ''}
         <div class="row-actions"><button class="btn" id="pushTest">Показать дайджест сейчас</button></div>`}
  `;
}

async function ensurePermission() {
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

async function togglePush() {
  const reg = await navigator.serviceWorker.ready;
  if (store.get('pushEnabled', false)) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`${CFG.pushServer}/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    store.set('pushEnabled', false);
    toast('Уведомления выключены');
  } else {
    if (!(await ensurePermission())) return toast('Нет разрешения на уведомления');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(CFG.vapidPublicKey) });
    const res = await fetch(`${CFG.pushServer}/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    if (!res.ok) return toast('Сервер уведомлений не ответил');
    store.set('pushEnabled', true);
    toast('Готово! Уведомление придёт завтра в 08:00');
  }
  await syncSwState();
  renderPush();
}

async function testDigest() {
  if (!(await ensurePermission())) return toast('Нет разрешения на уведомления');
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: 'digest', force: true });
}

async function setLocalDigest(on) {
  store.set('localDigest', on);
  await syncSwState();
  if (!on) return;
  if (!(await ensurePermission())) return toast('Нет разрешения на уведомления');
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.periodicSync.register('kuponi-daily', { minInterval: 6 * 60 * 60 * 1000 });
    toast('Фоновое обновление включено');
  } catch {
    toast('Фоновое обновление доступно только в установленном приложении Chrome');
  }
}

// ---------- ручной ввод ----------
function renderManual() {
  const list = S.manual.filter((c) => !c.validTo || c.validTo >= S.today).map((m) => ({ ...m, manual: true, local: true }));
  $('#manualList').innerHTML = list.map(cardHtml).join('');
  $('#manualActions').hidden = !S.manual.length;
}

function openManual(prefill = {}) {
  const f = $('#manualForm');
  f.reset();
  $('#mPhotoPreview').hidden = true;
  $('#ocrStatus').textContent = '';
  $('#storeNames').innerHTML = storeNames().map((n) => `<option value="${esc(n)}">`).join('');
  $('#mCategory').innerHTML = Object.entries(categories()).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  if (prefill.store) $('#mStore').value = prefill.store;
  if (prefill.category) $('#mCategory').value = prefill.category;
  S.pendingPhoto = null;
  $('#manualDlg').showModal();
}

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

function saveManual() {
  const storeName = $('#mStore').value.trim();
  const title = $('#mTitle').value.trim();
  if (!storeName || !title) return toast('Укажите магазин и товар');
  const priceNew = num($('#mPriceNew').value);
  let priceOld = num($('#mPriceOld').value);
  const pct = num($('#mPct').value);
  if (!priceOld && priceNew && pct && pct < 100) priceOld = Math.round((priceNew / (1 - pct / 100)) * 100) / 100;
  const src = (S.data?.sources ?? []).find((s) => s.name.toLowerCase() === storeName.toLowerCase());
  const conditions = $('#mConditions').value.trim();
  const c = {
    id: `m-${Date.now()}`,
    source: src?.id ?? 'manual',
    store: src?.name ?? storeName,
    category: $('#mCategory').value || src?.category || 'other',
    kind: priceNew ? 'discount' : 'coupon',
    title,
    titleRu: '',
    ...(priceNew ? { priceNew } : {}),
    ...(priceOld && priceNew && priceOld > priceNew ? { priceOld, savingEur: Math.round((priceOld - priceNew) * 100) / 100, savingPct: Math.round(((priceOld - priceNew) / priceOld) * 100) } : pct ? { savingPct: pct } : {}),
    ...($('#mValidTo').value ? { validTo: $('#mValidTo').value } : {}),
    conditions: conditions ? [conditions] : [],
    conditionsRu: [],
    requires: [],
    url: $('#mUrl').value.trim() || src?.url || '',
    ...(S.pendingPhoto ? { photo: S.pendingPhoto } : {}),
    firstSeen: S.today,
  };
  S.manual.unshift(c);
  store.set('manual', S.manual);
  rebuildAll();
  renderAll();
  toast('Купон сохранён');
}

/** Уменьшить фото до ~480px, чтобы влезло в localStorage. */
function shrinkImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Распознавание текста на фото (Tesseract.js, всё в браузере, без ключей). */
async function ocrPhoto(file) {
  const st = $('#ocrStatus');
  st.textContent = 'Распознаю текст… (первый раз загружается ~10 МБ)';
  try {
    if (!self.Tesseract) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const { data } = await self.Tesseract.recognize(file, 'lav+eng');
    const text = data.text.replace(/\s+\n/g, '\n').trim();
    const prices = [...text.matchAll(/(\d{1,4})[.,](\d{2})\s*(?:€|eur)?/gi)].map((m) => Number(`${m[1]}.${m[2]}`)).filter((n) => n > 0 && n < 5000);
    const pct = text.match(/-?\s?(\d{1,2})\s?%/);
    const date = [...text.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})?/g)].pop();
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3 && /[a-zāēīūčšž]{3}/i.test(l));
    if (!$('#mTitle').value && lines[0]) $('#mTitle').value = lines[0].slice(0, 80);
    if (prices.length && !$('#mPriceNew').value) $('#mPriceNew').value = Math.min(...prices).toFixed(2);
    if (prices.length > 1 && !$('#mPriceOld').value) $('#mPriceOld').value = Math.max(...prices).toFixed(2);
    if (pct && !$('#mPct').value) $('#mPct').value = pct[1];
    if (date && !$('#mValidTo').value) {
      const y = date[3] || S.today.slice(0, 4);
      $('#mValidTo').value = `${y}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`;
    }
    if (!$('#mConditions').value) $('#mConditions').value = lines.slice(1, 4).join(' ').slice(0, 200);
    st.textContent = 'Готово — проверьте поля.';
  } catch {
    st.textContent = 'Не удалось распознать (нет сети?) — заполните поля вручную, фото сохранится.';
  }
}

// ---------- навигация ----------
function show(view) {
  S.view = view;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === view));
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  renderView(view);
  window.scrollTo({ top: 0 });
}

function renderView(view) {
  if (!S.data && view !== 'more') return;
  ({ feed: renderFeed, best: renderBest, search: renderSearch, fav: renderFav, more: () => { renderPush(); renderManual(); renderSources(); } })[view]?.();
}

function renderAll() { renderView(S.view); }

function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

// ---------- события ----------
function bind() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-fav],[data-cat],[data-scope],[data-q],[data-addfor],[data-del]');
    if (!t) return;
    if (t.dataset.fav) return toggleFav(t.dataset.fav);
    if (t.dataset.addfor) return openManual({ store: t.dataset.addfor, category: t.dataset.cat });
    if (t.dataset.del) {
      S.manual = S.manual.filter((m) => m.id !== t.dataset.del);
      store.set('manual', S.manual);
      rebuildAll();
      return renderAll();
    }
    if (t.dataset.cat && t.closest('#catChips')) {
      S.filters.cat = t.dataset.cat;
      saveFilters();
      return renderFeed();
    }
    if (t.dataset.scope) {
      store.set('bestScope', t.dataset.scope);
      return renderBest();
    }
    if (t.dataset.q) {
      $('#searchInput').value = t.dataset.q;
      return renderSearch();
    }
  });

  $('#endsTodayQuick').addEventListener('change', (e) => { S.filters.endsToday = e.target.checked; saveFilters(); renderFeed(); });
  $('#myStoresQuick').addEventListener('change', (e) => {
    S.filters.myOnly = e.target.checked;
    saveFilters();
    if (e.target.checked && !S.myStores.size) toast('Отметьте свои магазины во вкладке «Избранное»');
    renderFeed();
  });
  $('#sortSel').addEventListener('change', (e) => { S.filters.sort = e.target.value; saveFilters(); renderFeed(); });

  // Фильтры
  $('#filterBtn').addEventListener('click', () => {
    const f = S.filters;
    $('#filterStores').innerHTML = storesWithData().map((n) => `<label><input type="checkbox" value="${esc(n)}" ${f.stores.includes(n) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('');
    $('#minPct').value = f.minPct;
    $('#minPctLabel').textContent = `${f.minPct}%`;
    $('#minEur').value = f.minEur;
    $('#minEurLabel').textContent = `${f.minEur} €`;
    $('#fEndsToday').checked = f.endsToday;
    $('#fMyStores').checked = f.myOnly;
    $('#fNoCard').checked = f.noCard;
    $('#fHideUpcoming').checked = f.hideUpcoming;
    $('#fOnlyDiscounts').checked = f.onlyDiscounts;
    $('#filterDlg').showModal();
  });
  $('#minPct').addEventListener('input', (e) => { $('#minPctLabel').textContent = `${e.target.value}%`; });
  $('#minEur').addEventListener('input', (e) => { $('#minEurLabel').textContent = `${e.target.value} €`; });
  $('#filterDlg').addEventListener('close', () => {
    const v = $('#filterDlg').returnValue;
    if (v === 'reset') S.filters = { ...DEFAULT_FILTERS, cat: S.filters.cat, sort: S.filters.sort };
    else if (v === 'ok') {
      Object.assign(S.filters, {
        stores: $$('#filterStores input:checked').map((i) => i.value),
        minPct: Number($('#minPct').value),
        minEur: Number($('#minEur').value),
        endsToday: $('#fEndsToday').checked,
        myOnly: $('#fMyStores').checked,
        noCard: $('#fNoCard').checked,
        hideUpcoming: $('#fHideUpcoming').checked,
        onlyDiscounts: $('#fOnlyDiscounts').checked,
      });
    } else return;
    saveFilters();
    renderFeed();
  });

  // Бесконечная лента
  new IntersectionObserver((entries) => { if (entries[0].isIntersecting && S.view === 'feed') moreFeed(); }, { rootMargin: '600px' }).observe($('#feedMore'));

  // Поиск
  let tm;
  $('#searchInput').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(renderSearch, 200); });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); renderSearch(); $('#searchInput').blur(); });

  // Мои магазины
  $('#myStoresGrid').addEventListener('change', (e) => {
    const n = e.target.dataset.mystore;
    if (!n) return;
    if (e.target.checked) S.myStores.add(n);
    else S.myStores.delete(n);
    store.set('myStores', [...S.myStores]);
    syncSwState();
  });

  // Ещё
  $('#pushPanel').addEventListener('click', (e) => {
    if (e.target.id === 'pushToggle') togglePush().catch((err) => toast(`Ошибка: ${err.message}`));
    if (e.target.id === 'pushTest') testDigest();
  });
  $('#pushPanel').addEventListener('change', (e) => { if (e.target.id === 'localDigest') setLocalDigest(e.target.checked); });
  $('#addCouponBtn').addEventListener('click', () => openManual());
  $('#manualDlg').addEventListener('close', () => { if ($('#manualDlg').returnValue === 'save') saveManual(); });
  $('#mPhoto').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      S.pendingPhoto = await shrinkImage(file);
      $('#mPhotoPreview').src = S.pendingPhoto;
      $('#mPhotoPreview').hidden = false;
    } catch { /* не картинка */ }
    ocrPhoto(file);
  });
  $('#exportManual').addEventListener('click', async () => {
    const out = S.manual.map(({ photo, id, local, manual, firstSeen, ...c }) => c);
    const text = JSON.stringify(out, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('JSON скопирован — вставьте в kuponi/data/manual.json на GitHub');
    } catch {
      const blob = new Blob([text], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'manual.json' });
      a.click();
    }
  });
  $('#sourceFilter').addEventListener('input', renderSources);
  $('#sourceStatus').addEventListener('change', renderSources);
  $('#refreshBtn').addEventListener('click', () => loadData({ force: true }).then(() => toast('Данные обновлены')));

  // Тема
  const themes = ['auto', 'light', 'dark'];
  applyTheme(store.get('theme', 'auto'));
  $('#themeBtn').addEventListener('click', () => {
    const next = themes[(themes.indexOf(store.get('theme', 'auto')) + 1) % themes.length];
    store.set('theme', next);
    applyTheme(next);
    toast({ auto: 'Тема: как в системе', light: 'Светлая тема', dark: 'Тёмная тема' }[next]);
  });

  addEventListener('online', () => loadData());
  addEventListener('offline', () => { $('#offlineBanner').hidden = false; });
  addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== S.view && $(`#view-${v}`)) show(v); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && rigaDate() !== S.today) loadData();
  });
}

// ---------- старт ----------
async function init() {
  bind();
  const initial = location.hash.slice(1);
  show($(`#view-${initial}`) ? initial : 'feed');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  await loadData();
  syncSwState();
}

init();
