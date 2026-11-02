// Реестр всех источников. mode:
//   auto    — есть рабочий скрапер (публичные страницы/JSON);
//   planned — публичные данные есть, скрапер ещё не написан (этап масштабирования);
//   manual  — данные только в приложении/за логином/за проверкой бота → ручной ввод (в т.ч. по фото).
// note — оценка, что именно можно собрать (по проверке 02.11.2026).

export const SOURCES = [
  // ---- MVP ----
  { id: 'rimi', name: 'Rimi', category: 'groceries', mode: 'auto', module: './stores/rimi.js',
    url: 'https://www.rimi.lv/e-veikals/lv/akcijas-piedavajumi',
    note: 'Акции e-veikals: HTML с ценой, обычной ценой и цен. за ед. Срок — со страницы товара (для топ-позиций).' },
  { id: 'maxima', name: 'Maxima', category: 'groceries', mode: 'auto', module: './stores/maxima.js',
    url: 'https://www.maxima.lv/piedavajumi',
    note: 'Публичный список акций (AJAX JSON с HTML): цена, обычная цена/%, срок, условия (карта PALDIES, приложение).' },
  { id: 'lidl', name: 'Lidl', category: 'groceries', mode: 'auto', module: './stores/lidl.js',
    url: 'https://www.lidl.lv/c/store/aktualie-piedavajumi/a10028219',
    note: 'Страницы «Aktuālie piedāvājumi» содержат JSON товаров: цена, старая цена, %, даты, цена Lidl Plus. Купоны Lidl Plus — только в приложении.' },
  { id: 'circlek', name: 'Circle K', category: 'auto', mode: 'auto', module: './stores/circlek.js',
    url: 'https://www.circlek.lv/ipasi-piedavajumi',
    note: 'Спецпредложения (текст, иногда цена) + официальные цены на топливо. Персональные купоны EXTRA — в приложении.' },
  { id: 'mcdonalds', name: "McDonald's", category: 'fastfood', mode: 'manual', module: './stores/mcdonalds.js',
    url: 'https://www.mcdonalds.lv/',
    note: 'Сайт закрыт проверкой Cloudflare («Just a moment…»), купоны — в приложении. Ручной ввод/фото. Скрапер только проверяет доступность.' },

  // ---- Продукты ----
  { id: 'barbora', name: 'Barbora', category: 'groceries', mode: 'planned', url: 'https://barbora.lv/cl/50XV/akcijas',
    note: 'Публичная страница акций (Maxima online), серверный HTML/JSON — автосбор возможен.' },
  { id: 'mego', name: 'Mego', category: 'groceries', mode: 'planned', url: 'https://mego.lv/',
    note: 'Сайт открыт; акции в виде страниц/буклета — вероятно автосбор, нужна проверка разметки.' },
  { id: 'top', name: 'top!', category: 'groceries', mode: 'planned', url: 'https://www.top.lv/',
    note: 'Сайт открыт, акции в основном в PDF-буклете — частично (только заголовки/период).' },
  { id: 'elvi', name: 'Elvi', category: 'groceries', mode: 'planned', url: 'https://elvi.lv/',
    note: 'Сайт открыт, страница акций/буклет — частично автоматически.' },

  // ---- Фастфуд и кафе ----
  { id: 'kfc', name: 'KFC', category: 'fastfood', mode: 'planned', url: 'https://kfc.lv/',
    note: 'Сайт открыт; акции на сайте — автосбор вероятен. Купоны приложения — вручную.' },
  { id: 'burgerking', name: 'Burger King', category: 'fastfood', mode: 'planned', url: 'https://burgerking.lv/',
    note: 'Сайт открыт; раздел предложений — автосбор вероятен. Купоны приложения — вручную.' },
  { id: 'lido', name: 'Lido', category: 'fastfood', mode: 'planned', url: 'https://www.lido.lv/lv/',
    note: 'Сайт открыт; акции публикуются новостями — частично.' },
  { id: 'doublecoffee', name: 'Double Coffee', category: 'fastfood', mode: 'manual', url: 'https://doublecoffee.lv/',
    note: 'Сайт сбрасывает соединение для автоматических запросов — ручной ввод.' },

  // ---- Авто ----
  { id: 'neste', name: 'Neste', category: 'auto', mode: 'planned', url: 'https://www.neste.lv/',
    note: 'Публичные цены на топливо и акции — автосбор.' },
  { id: 'virsi', name: 'Virši', category: 'auto', mode: 'planned', url: 'https://www.virsi.lv/lv/privatpersonam',
    note: 'Публичные цены на топливо и акции — автосбор.' },
  { id: 'viada', name: 'Viada', category: 'auto', mode: 'planned', url: 'https://www.viada.lv/',
    note: 'Публичные цены на топливо и акции — автосбор.' },

  // ---- Электроника и дом ----
  { id: '1a', name: '1a.lv', category: 'electronics', mode: 'manual', url: 'https://www.1a.lv/',
    note: 'HTTP 403 (проверка бота) — ручной ввод.' },
  { id: 'depo', name: 'Depo', category: 'electronics', mode: 'planned', url: 'https://depo.lv/',
    note: 'Сайт открыт, акции на сайте — автосбор вероятен.' },
  { id: 'elkor', name: 'Elkor', category: 'electronics', mode: 'planned', url: 'https://www.elkor.lv/',
    note: 'Цикл редиректов для бота — нужна доп. проверка, возможно ручной ввод.' },
  { id: 'pigu', name: 'Pigu', category: 'electronics', mode: 'manual', url: 'https://pigu.lt/lv/',
    note: 'HTTP 403 (проверка бота) — ручной ввод.' },

  // ---- Красота и здоровье ----
  { id: 'drogas', name: 'Drogas', category: 'beauty', mode: 'manual', url: 'https://www.drogas.lv/',
    note: 'HTTP 403 (проверка бота) — ручной ввод.' },
  { id: 'apotheka', name: 'Apotheka', category: 'beauty', mode: 'planned', url: 'https://www.apotheka.lv/',
    note: 'Сайт открыт, акционные товары с ценами — автосбор вероятен.' },
  { id: 'benu', name: 'Benu', category: 'beauty', mode: 'planned', url: 'https://www.benu.lv/',
    note: 'Сайт открыт, акционные товары с ценами — автосбор вероятен.' },

  // ---- Спорт, одежда, досуг, доставка ----
  { id: 'sportland', name: 'Sportland', category: 'other', mode: 'planned', url: 'https://sportland.lv/',
    note: 'Сайт открыт, распродажи — автосбор вероятен.' },
  { id: 'forumcinemas', name: 'Forum Cinemas', category: 'other', mode: 'planned', url: 'https://www.forumcinemas.lv/',
    note: 'Сайт открыт, акции кино — частично.' },
  { id: 'wolt', name: 'Wolt', category: 'other', mode: 'manual', url: 'https://wolt.com/',
    note: 'Акции зависят от адреса и аккаунта (приложение) — ручной ввод.' },
  { id: 'boltfood', name: 'Bolt Food', category: 'other', mode: 'manual', url: 'https://food.bolt.eu/',
    note: 'Только приложение/аккаунт — ручной ввод.' },
  { id: 'salidzini', name: 'Salidzini.lv', category: 'other', mode: 'planned', url: 'https://www.salidzini.lv/',
    note: 'Агрегатор цен, сайт открыт — для сравнения цен (этап 3).' },
];

export const getSource = (id) => SOURCES.find((s) => s.id === id);
