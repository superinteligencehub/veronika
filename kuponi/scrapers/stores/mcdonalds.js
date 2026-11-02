// McDonald's Latvija: сайт закрыт проверкой Cloudflare, купоны — в приложении.
// Мы ничего не обходим: только проверяем, не стал ли сайт доступен, и если нет —
// источник остаётся в режиме «ручной ввод» (купоны добавляются в приложении или в data/manual.json).

import { fetchText, BlockedError } from '../lib/http.js';

export async function scrape({ log }) {
  try {
    await fetchText('https://www.mcdonalds.lv/', { retries: 0, timeoutMs: 15000 });
  } catch (err) {
    if (err instanceof BlockedError) {
      log('mcdonalds: сайт закрыт проверкой бота → ручной ввод');
      throw err;
    }
    throw err;
  }
  // Сайт открылся — но структура акций неизвестна; парсер добавим, когда это повторится.
  const e = new BlockedError('Сайт доступен, но купоны публикуются только в приложении — нужен ручной ввод');
  throw e;
}
