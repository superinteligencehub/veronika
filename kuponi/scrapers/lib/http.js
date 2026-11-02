// Простой HTTP-клиент для скраперов: честный User-Agent, таймаут, повторы,
// вежливая пауза между запросами к одному хосту. Никаких обходов капч/логинов:
// если сайт отвечает проверкой бота (Cloudflare challenge, 403) — бросаем
// BlockedError, и источник помечается как «ручной ввод».

export const USER_AGENT =
  'Mozilla/5.0 (compatible; KuponiLV/1.0; personal deal aggregator; +https://github.com/superinteligencehub/veronika)';

export class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedError';
  }
}

const lastHit = new Map();
const MIN_GAP_MS = Number(process.env.KUPONI_MIN_GAP_MS ?? 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeWait(url) {
  const host = new URL(url).host;
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + MIN_GAP_MS - Date.now();
  lastHit.set(host, Math.max(Date.now(), prev + MIN_GAP_MS));
  if (wait > 0) await sleep(wait);
}

function looksLikeBotWall(status, body) {
  if (status === 403 || status === 429 || status === 503) {
    if (/Just a moment|cf-challenge|challenges\.cloudflare\.com|captcha|Attention Required/i.test(body)) return true;
    if (status === 403) return true;
  }
  return false;
}

/**
 * @param {string} url
 * @param {{method?:string, body?:string|URLSearchParams, headers?:Record<string,string>, timeoutMs?:number, retries?:number}} [opts]
 */
export async function fetchText(url, opts = {}) {
  const { method = 'GET', body, headers = {}, timeoutMs = 30000, retries = 2 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await politeWait(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'lv-LV,lv;q=0.9,ru;q=0.6,en;q=0.5',
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          ...headers,
        },
      });
      const text = await res.text();
      if (looksLikeBotWall(res.status, text)) {
        throw new BlockedError(`Источник закрыт для автоматического сбора (HTTP ${res.status}, проверка бота)`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
      return text;
    } catch (err) {
      lastErr = err;
      if (err instanceof BlockedError) throw err;
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers ?? {}) } });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Ожидался JSON от ${url}, получено: ${text.slice(0, 120)}`);
  }
}

/** Выполнить async-задачи с ограничением параллельности. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
