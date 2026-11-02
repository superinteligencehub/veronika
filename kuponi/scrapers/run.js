#!/usr/bin/env node
// Оркестратор сбора: запускает все скраперы изолированно (падение одного не
// влияет на другие), нормализует, убирает просроченное, дедуплицирует,
// переводит на русский и пишет data/coupons.json со статусом каждого источника.
//
//   node scrapers/run.js                 — все источники
//   node scrapers/run.js --only rimi,lidl — выборочно (остальные берутся из прошлого файла)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.js';
import { normalizeCoupon, filterActive, dedupe, byValue, CATEGORIES } from './lib/normalize.js';
import { Translator } from './lib/translate.js';
import { BlockedError } from './lib/http.js';
import { rigaDate } from './lib/util.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const OUT = join(DATA, 'coupons.json');
const SCRAPER_TIMEOUT_MS = Number(process.env.KUPONI_SCRAPER_TIMEOUT_MS ?? 8 * 60 * 1000);

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(String(args[onlyIdx + 1] ?? '').split(',')) : null;

const readJson = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${label}: превышено время ${Math.round(ms / 1000)} с`)), ms);
    }),
  ]);
}

async function runSource(source, today) {
  const started = Date.now();
  const logs = [];
  const log = (m) => {
    logs.push(m);
    console.log(`  ${m}`);
  };
  try {
    const mod = await import(new URL(source.module, import.meta.url));
    const raw = await withTimeout(mod.scrape({ source, today, log }), SCRAPER_TIMEOUT_MS, source.id);
    const coupons = raw.map((r) => normalizeCoupon(r, source)).filter(Boolean);
    if (!coupons.length) throw new Error('Скрапер не нашёл ни одного предложения (возможно, изменилась разметка сайта)');
    return { status: 'ok', coupons, durationMs: Date.now() - started, rawCount: raw.length };
  } catch (err) {
    const blocked = err instanceof BlockedError;
    console.warn(`  ✗ ${source.id}: ${err.message}`);
    return { status: blocked ? 'blocked' : 'error', error: err.message, coupons: [], durationMs: Date.now() - started };
  }
}

async function main() {
  const today = rigaDate();
  await mkdir(DATA, { recursive: true });
  const prev = await readJson(OUT, { sources: [], coupons: [] });
  const prevSources = new Map((prev.sources ?? []).map((s) => [s.id, s]));
  const prevCoupons = prev.coupons ?? [];
  const firstSeen = new Map(prevCoupons.map((c) => [c.id, c.firstSeen]));

  const sourceStates = [];
  let collected = [];

  for (const source of SOURCES) {
    const prevState = prevSources.get(source.id) ?? {};
    const base = { id: source.id, name: source.name, category: source.category, mode: source.mode, url: source.url, note: source.note };

    if (!source.module || source.mode === 'planned') {
      sourceStates.push({ ...base, status: source.mode === 'manual' ? 'manual' : 'planned', count: 0 });
      continue;
    }
    if (only && !only.has(source.id)) {
      // не запускали — переносим прошлые данные как есть
      const kept = prevCoupons.filter((c) => c.source === source.id);
      collected.push(...kept);
      sourceStates.push({ ...base, ...prevState, ...base, count: kept.length });
      continue;
    }

    console.log(`→ ${source.name}`);
    const res = await runSource(source, today);
    if (res.status === 'ok') {
      collected.push(...res.coupons);
      sourceStates.push({ ...base, status: 'ok', count: res.coupons.length, lastSuccess: new Date().toISOString(), durationMs: res.durationMs });
      continue;
    }
    // Ошибка: показываем прошлые (ещё не просроченные) купоны этого источника с пометкой «устарело»
    const stale = filterActive(prevCoupons.filter((c) => c.source === source.id && !c.manual), today).map((c) => ({ ...c, stale: true }));
    collected.push(...stale);
    sourceStates.push({
      ...base,
      status: res.status === 'blocked' ? 'manual' : stale.length ? 'stale' : 'error',
      error: res.error,
      count: stale.length,
      lastSuccess: prevState.lastSuccess ?? null,
      durationMs: res.durationMs,
    });
  }

  // Купоны, добавленные вручную в репозитории (data/manual.json)
  const manual = await readJson(join(DATA, 'manual.json'), []);
  const manualCoupons = (Array.isArray(manual) ? manual : manual.coupons ?? [])
    .map((m) => {
      const src = SOURCES.find((s) => s.id === m.source || s.name.toLowerCase() === String(m.store ?? '').toLowerCase());
      return normalizeCoupon(
        { ...m, manual: true },
        src ?? { id: 'manual', name: m.store ?? 'Другое', category: m.category ?? 'other', url: m.url ?? '' },
      );
    })
    .filter(Boolean);
  collected.push(...manualCoupons);

  let coupons = dedupe(filterActive(collected, today));

  // Перевод на русский
  const translator = new Translator(join(DATA, 'translations.json'));
  await translator.load();
  const texts = coupons.flatMap((c) => [c.title, ...c.conditions]);
  const tr = await translator.translateAll(texts);
  coupons = coupons.map((c) => ({
    ...c,
    titleRu: c.titleRu || tr.get(c.title) || '',
    conditionsRu: c.conditionsRu?.length ? c.conditionsRu : c.conditions.map((s) => tr.get(s) || s),
    firstSeen: firstSeen.get(c.id) ?? today,
  }));
  await translator.save(new Set(texts.map((t) => t.replace(/\n/g, ' '))));
  console.log(`Перевод: ${JSON.stringify(translator.stats)}`);

  coupons.sort(byValue);
  // Количество по источникам после дедупликации/фильтра
  const counts = coupons.reduce((m, c) => m.set(c.source, (m.get(c.source) ?? 0) + 1), new Map());
  for (const s of sourceStates) if (s.status !== 'planned') s.count = counts.get(s.id) ?? 0;

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    today,
    timezone: 'Europe/Riga',
    categories: CATEGORIES,
    sources: sourceStates,
    coupons,
  };
  await writeFile(OUT, `${JSON.stringify(out)}\n`);
  const okCount = sourceStates.filter((s) => s.status === 'ok').length;
  console.log(`Готово: ${coupons.length} купонов, источники ok: ${okCount}/${sourceStates.filter((s) => s.mode === 'auto').length} → ${OUT}`);
  if (!coupons.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
