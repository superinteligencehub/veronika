// Перевод латышский → русский при сборе данных (в GitHub Actions, не в браузере).
// Порядок: кэш (data/translations.json) → бесплатный онлайн-перевод без ключей
// (Google translate_a «gtx», запасной — MyMemory) → словарь web/glossary.js.
// Переводы из словаря помечаются как черновые и при следующем запуске
// повторно отправляются в онлайн-перевод.

import { readFile, writeFile } from 'node:fs/promises';
import { WORDS, PHRASES, UNITS } from '../../web/glossary.js';
import { fetchText } from './http.js';

const ENDINGS = ['', 'a', 'as', 'ai', 'u', 'us', 'i', 'is', 'ī', 'e', 'es', 'ē', 's', 'š', 'ām', 'ēm', 'ie', 'ei', 'os', 'ās', 'ēs'];

const lower = (s) => s.toLocaleLowerCase('lv');

const wordEntries = WORDS.map(([lv, ru]) => ({ lv: lower(lv), parts: lower(lv).split(' '), ru })).sort(
  (a, b) => b.lv.length - a.lv.length,
);
const phraseEntries = [...PHRASES].sort((a, b) => b[0].length - a[0].length);
const phraseMap = new Map(PHRASES.map(([lv, ru]) => [lower(lv), ru]));

function stemMatch(token, stem) {
  if (!token.startsWith(stem)) return false;
  const rest = token.slice(stem.length);
  if (stem.length <= 3) return ENDINGS.includes(rest);
  return rest.length <= 4;
}

/** Черновой перевод по словарю: известные слова переводятся, бренды/числа остаются. */
export function glossaryTranslate(text) {
  if (!text) return '';
  let src = String(text);
  // 1) фразы условий — одним проходом (длинные первыми), чтобы не переводить уже переведённое
  const phraseRe = new RegExp(phraseEntries.map(([lv]) => lv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  src = src.replace(phraseRe, (m) => `\u0001${phraseMap.get(lower(m))}\u0002`);
  // 2) по словам (с поддержкой словосочетаний)
  const tokens = src.split(/(\u0001[^\u0002]*\u0002|[\s,.;:()/!?"'«»+-]+)/u).filter((t) => t !== '');
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('\u0001')) {
      out.push(tok.slice(1, -1));
      continue;
    }
    if (/^[\s,.;:()/!?"'«»+-]+$/u.test(tok) || /\d/.test(tok)) {
      out.push(tok);
      continue;
    }
    const lt = lower(tok);
    if (UNITS[lt]) {
      out.push(UNITS[lt]);
      continue;
    }
    // бренды В ВЕРХНЕМ РЕГИСТРЕ не переводим
    if (tok.length > 2 && tok === tok.toLocaleUpperCase('lv') && /\p{L}/u.test(tok)) {
      out.push(tok);
      continue;
    }
    let done = false;
    for (const e of wordEntries) {
      if (e.parts.length > 1) {
        // словосочетание: сравниваем следующие слова (пропуская разделители)
        const words = [];
        let j = i;
        while (j < tokens.length && words.length < e.parts.length) {
          if (!/^[\s]+$/.test(tokens[j])) words.push(lower(tokens[j]));
          j++;
        }
        if (words.length === e.parts.length && e.parts.every((p, k) => stemMatch(words[k], p))) {
          out.push(e.ru);
          i = j - 1;
          done = true;
          break;
        }
      } else if (stemMatch(lt, e.lv)) {
        out.push(e.ru);
        done = true;
        break;
      }
    }
    if (!done) out.push(tok);
  }
  let res = out.join('').replace(/\s+/g, ' ').trim();
  if (res) res = res[0].toLocaleUpperCase('ru') + res.slice(1);
  return res;
}

// ---------- онлайн-провайдеры (бесплатно, без ключей) ----------

async function googleBatch(texts) {
  const q = texts.join('\n');
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=lv&tl=ru&dt=t&q=${encodeURIComponent(q)}`;
  const raw = await fetchText(url, { timeoutMs: 20000, retries: 1 });
  const data = JSON.parse(raw);
  const joined = (data[0] ?? []).map((s) => s[0] ?? '').join('');
  const lines = joined.split('\n').map((s) => s.trim());
  if (lines.length !== texts.length) throw new Error(`google: ожидалось ${texts.length} строк, получено ${lines.length}`);
  return lines;
}

async function myMemory(text) {
  const url = `https://api.mymemory.translated.net/get?langpair=lv|ru&q=${encodeURIComponent(text.slice(0, 480))}`;
  const data = JSON.parse(await fetchText(url, { timeoutMs: 15000, retries: 0 }));
  const t = data?.responseData?.translatedText;
  if (!t || data.responseStatus !== 200) throw new Error('mymemory: нет перевода');
  return t;
}

export class Translator {
  constructor(cachePath, { online = process.env.KUPONI_OFFLINE_TRANSLATE !== '1', maxOnline = 4000 } = {}) {
    this.cachePath = cachePath;
    this.online = online;
    this.maxOnline = maxOnline;
    this.cache = {};
    this.stats = { cached: 0, online: 0, glossary: 0, failures: 0 };
  }

  async load() {
    try {
      this.cache = JSON.parse(await readFile(this.cachePath, 'utf8'));
    } catch {
      this.cache = {};
    }
  }

  async save(keepKeys) {
    // Храним только актуальные строки, чтобы кэш не рос бесконечно.
    const out = {};
    for (const k of Object.keys(this.cache).sort()) if (!keepKeys || keepKeys.has(k)) out[k] = this.cache[k];
    await writeFile(this.cachePath, `${JSON.stringify(out, null, 0).replace(/,"/g, ',\n"')}\n`);
  }

  /** @param {string[]} texts → Map<lv, ru> */
  async translateAll(texts) {
    const uniq = [...new Set(texts.filter((t) => t && t.trim()))];
    const todo = [];
    for (const t of uniq) {
      const c = this.cache[t];
      if (c && c.src !== 'glossary') this.stats.cached++;
      else todo.push(t);
    }
    let onlineBudget = this.online ? this.maxOnline : 0;
    let googleOk = true;
    // Пакеты до ~1800 символов
    const batches = [];
    let cur = [];
    let len = 0;
    for (const t of todo) {
      const clean = t.replace(/\n/g, ' ');
      if (cur.length && (len + clean.length > 1800 || cur.length >= 40)) {
        batches.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(clean);
      len += clean.length + 1;
    }
    if (cur.length) batches.push(cur);

    for (const batch of batches) {
      let translated = null;
      if (onlineBudget > 0 && googleOk) {
        try {
          translated = await googleBatch(batch);
          onlineBudget -= batch.length;
        } catch (err) {
          this.stats.failures++;
          if (/HTTP 4|закрыт/.test(String(err.message))) googleOk = false; // лимит — дальше не долбим
        }
      }
      for (let i = 0; i < batch.length; i++) {
        const lv = batch[i];
        if (translated?.[i]) {
          this.cache[lv] = { ru: translated[i], src: 'google' };
          this.stats.online++;
          continue;
        }
        if (!googleOk && onlineBudget > 0 && this.stats.online + this.stats.failures < 200) {
          try {
            this.cache[lv] = { ru: await myMemory(lv), src: 'mymemory' };
            onlineBudget--;
            this.stats.online++;
            continue;
          } catch {
            this.stats.failures++;
          }
        }
        this.cache[lv] = { ru: glossaryTranslate(lv), src: 'glossary' };
        this.stats.glossary++;
      }
    }
    return new Map(uniq.map((t) => [t, this.cache[t.replace(/\n/g, ' ')]?.ru ?? this.cache[t]?.ru ?? glossaryTranslate(t)]));
  }
}
