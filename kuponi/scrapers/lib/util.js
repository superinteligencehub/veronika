import { createHash } from 'node:crypto';

export const TZ = 'Europe/Riga';

/** Дата YYYY-MM-DD в часовом поясе Риги. */
export function rigaDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Час (0–23) в Риге. */
export function rigaHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
}

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2,19 €", "1.39", "  9 " → число или null. */
export function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/\s+/g, '').replace(/[^\d.,-]/g, '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const round2 = (n) => Math.round(n * 100) / 100;

const pad = (n) => String(n).padStart(2, '0');

/** "02.11.2026" → "2026-11-02". */
export function parseLvDate(s) {
  const m = String(s ?? '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
}

/**
 * Интервал вида "27.10. - 02.11.2026." или "no 02.11. līdz 08.11." → {from,to}.
 * Год берётся из строки, иначе из refDate; учитывается переход через Новый год.
 */
export function parseLvRange(s, refDate = rigaDate()) {
  const str = String(s ?? '');
  const parts = [...str.matchAll(/(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?/g)];
  if (!parts.length) return { from: null, to: null };
  const refYear = Number(refDate.slice(0, 4));
  const explicitYear = parts.map((p) => p[3]).find(Boolean);
  const mk = (p, year) => `${year}-${pad(p[2])}-${pad(p[1])}`;
  const last = parts[parts.length - 1];
  let toYear = Number(last[3] || explicitYear || refYear);
  // Без явного года: если дата окончания «сильно в прошлом» — значит, это следующий год.
  if (!last[3] && !explicitYear && mk(last, toYear) < addDays(refDate, -180)) toYear += 1;
  const to = mk(last, toYear);
  if (parts.length === 1) return { from: null, to };
  const first = parts[0];
  let fromYear = Number(first[3] || toYear);
  // «26.02. - 28.04.2027.»: без года начало относится к ближайшему прошлому, а не к далёкому будущему
  if (!first[3] && (mk(first, fromYear) > to || mk(first, fromYear) > addDays(refDate, 60))) fromYear -= 1;
  return { from: mk(first, fromYear), to };
}

/** ISO-время (UTC) → дата в Риге. */
export function isoToRigaDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : rigaDate(d);
}

export function cleanText(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Нормализованная строка для сравнения/дедупликации. */
export function normKey(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9а-яё]+/g, ' ')
    .trim();
}

export function shortHash(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

/** "3,86 €/kg" → {value: 3.86, unit: "kg"} */
export function parseUnitPrice(s) {
  const m = String(s ?? '').match(/(\d+(?:[.,]\d+)?)\s*€\s*\/\s*([a-zA-Zāēīūģķļņšž.]+)/);
  if (!m) return null;
  return { value: Number(m[1].replace(',', '.')), unit: m[2].replace(/\.$/, '').toLowerCase() };
}
