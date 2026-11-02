// Рендеринг страниц настоящим браузером (Chromium через Playwright) для магазинов,
// у которых товары подгружаются JavaScript. Это обычное открытие страницы, как у посетителя:
// без обхода капч/логинов. Если сайт показывает проверку бота — источник = ручной ввод.

import { createRequire } from 'node:module';
import { BlockedError, USER_AGENT } from './http.js';

let browserPromise;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

export function browserAvailable() {
  return Boolean(loadPlaywright());
}

async function getBrowser() {
  if (!browserPromise) {
    const pw = loadPlaywright();
    if (!pw) throw new Error('Playwright не установлен (npm i playwright && npx playwright install chromium)');
    browserPromise = pw.chromium.launch({ args: ['--no-sandbox'] });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) (await browserPromise).close().catch(() => {});
  browserPromise = null;
}

/** Открыть страницу, дождаться загрузки, пролистать (ленивая подгрузка), вернуть HTML. */
export async function renderPage(url, { timeoutMs = 45000, scrolls = 4 } = {}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: `${USER_AGENT} Chrome/130`,
    locale: 'lv-LV',
    viewport: { width: 1280, height: 1600 },
  });
  // Картинки/шрифты/видео не нужны — экономим трафик сайта и время
  await ctx.route('**/*', (route) => (['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue()));
  const page = await ctx.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const status = res?.status() ?? 0;
    const head = (await page.content()).slice(0, 6000);
    if ([403, 429, 503].includes(status) || /Just a moment|challenges\.cloudflare\.com|captcha/i.test(head)) {
      throw new BlockedError(`Источник закрыт для автоматического сбора (HTTP ${status}, проверка бота)`);
    }
    for (let i = 0; i < scrolls; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(700);
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await ctx.close().catch(() => {});
  }
}
