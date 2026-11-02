#!/usr/bin/env node
// Утренний топ-5 в ntfy.sh (бесплатно, без ключей). Запускается из GitHub Actions.
//   NTFY_TOPIC=моя-тема node scrapers/notify-ntfy.js [--force]
import { readFile } from 'node:fs/promises';
import { rigaDate, rigaHour } from './lib/util.js';

const topic = process.env.NTFY_TOPIC;
const appUrl = process.env.KUPONI_APP_URL || '';
const force = process.argv.includes('--force');

if (!topic) {
  console.log('NTFY_TOPIC не задан — пропускаю');
  process.exit(0);
}
const hour = rigaHour();
if (!force && (hour < 8 || hour > 9)) {
  console.log(`Сейчас ${hour}:xx по Риге — не время утреннего уведомления`);
  process.exit(0);
}

const data = JSON.parse(await readFile(new URL('../data/coupons.json', import.meta.url), 'utf8'));
const today = rigaDate();
const active = data.coupons.filter((c) => (!c.validTo || c.validTo >= today) && (!c.validFrom || c.validFrom <= today));
const top = active.filter((c) => c.savingEur > 0).sort((a, b) => b.savingEur - a.savingEur).slice(0, 5);
const ending = active.filter((c) => c.validTo === today && c.kind !== 'price' && c.savingEur > 0).length;
const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;
const lines = top.map((c, i) => `${i + 1}. −${eur(c.savingEur)} · ${c.store}: ${(c.titleRu || c.title).slice(0, 60)} — ${eur(c.priceNew)}`);
if (ending) lines.push(`⏰ Сегодня последний день у ${ending} предложений`);

const res = await fetch('https://ntfy.sh/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic,
    title: 'Kuponi LV — топ-5 сегодня',
    message: lines.join('\n') || 'Сегодня нет новых скидок',
    tags: ['moneybag'],
    ...(appUrl ? { click: `${appUrl.replace(/\/$/, '')}/#best` } : {}),
  }),
});
console.log(`ntfy: HTTP ${res.status}`);
if (!res.ok) process.exitCode = 1;
