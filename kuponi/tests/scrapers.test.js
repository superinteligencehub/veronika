// Тесты парсеров на сохранённых фрагментах реальных страниц (02.11.2026) и общей логики.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListPage as rimiList, parseDetails } from '../scrapers/stores/rimi.js';
import { parseOffers } from '../scrapers/stores/maxima.js';
import { parseListPage as lidlList } from '../scrapers/stores/lidl.js';
import { parseOfferCards, parseFuel } from '../scrapers/stores/circlek.js';
import { normalizeCoupon, dedupe, filterActive } from '../scrapers/lib/normalize.js';
import { parseLvRange, parsePrice, parseUnitPrice } from '../scrapers/lib/util.js';
import { glossaryTranslate } from '../scrapers/lib/translate.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const SRC = { id: 't', name: 'Test', category: 'groceries', url: 'https://example.lv' };

test('rimi: список акций', () => {
  const { items, lastPage } = rimiList(fx('rimi-list.html'));
  assert.equal(lastPage, 51);
  assert.ok(items.length >= 5);
  const first = items[0];
  assert.match(first.title, /krējums/i);
  assert.equal(first.priceNew, 1.39);
  assert.equal(first.priceOld, 2.19);
  assert.deepEqual(first.unitPrice, { value: 3.86, unit: 'kg' });
  assert.ok(first.url.startsWith('https://www.rimi.lv/e-veikals/'));
});

test('rimi: срок со страницы товара', () => {
  const d = parseDetails('<p>Piedāvājums spēkā no 20.10.2026 līdz 02.11.2026</p>');
  assert.equal(d.validFrom, '2026-10-20');
  assert.equal(d.validTo, '2026-11-02');
});

test('maxima: карточки с картой PALDIES и обычной ценой', () => {
  const items = parseOffers(fx('maxima-offers.html'), '2026-11-02');
  assert.equal(items.length, 5);
  const tic = items.find((i) => /TIC TAC/.test(i.title));
  assert.equal(tic.priceNew, 9.99);
  assert.equal(tic.priceOld, 15.99);
  assert.equal(tic.validTo, '2026-11-02');
  assert.equal(tic.validFrom, '2026-10-27');
  assert.ok(tic.requires.includes('card:paldies'));
  const wonder = items.find((i) => /WONDER/.test(i.title));
  assert.equal(wonder.priceNew, 1.69);
  assert.equal(wonder.priceOld, 2.69);
});

test('lidl: JSON карточек, Lidl Plus, даты', () => {
  const items = lidlList(fx('lidl-list.html'), 'https://www.lidl.lv/x');
  assert.equal(items.length, 6);
  const chicken = items.find((i) => /Cāļa/.test(i.title));
  assert.equal(chicken.priceNew, 5.79);
  assert.equal(chicken.priceOld, 6.79);
  assert.equal(chicken.validTo, '2026-11-04');
  const plus = items.find((i) => i.requires.includes('app:lidlplus'));
  assert.ok(plus, 'есть товар с ценой Lidl Plus');
});

test('circle k: спецпредложения и цены топлива', () => {
  const offers = parseOfferCards(fx('circlek-offers.html'), 'https://www.circlek.lv/ipasi-piedavajumi');
  assert.ok(offers.length >= 1);
  assert.ok(offers.every((o) => o.title && o.kind === 'offer'));
  const fuel = parseFuel(fx('circlek-fuel.html'), '2026-11-02');
  const p95 = fuel.find((f) => /95/.test(f.title));
  assert.equal(p95.priceNew, 1.954);
  assert.match(p95.title, /^Benzīns/);
  assert.equal(p95.validTo, '2026-11-02');
});

test('normalize: выгода в € и %, защита от мусора', () => {
  const c = normalizeCoupon({ title: 'Piens', priceNew: 1, priceOld: 1.5 }, SRC);
  assert.equal(c.savingEur, 0.5);
  assert.equal(c.savingPct, 33);
  assert.equal(c.kind, 'discount');
  const pctOnly = normalizeCoupon({ title: 'X', priceNew: 3, savingPct: 25 }, SRC);
  assert.equal(pctOnly.priceOld, 4);
  assert.equal(pctOnly.savingEur, 1);
  assert.equal(normalizeCoupon({ title: 'Bad', priceNew: 0.01, priceOld: 50 }, SRC), null);
  assert.equal(normalizeCoupon({ title: '' }, SRC), null);
  const noGain = normalizeCoupon({ title: 'Y', priceNew: 2, priceOld: 1 }, SRC);
  assert.equal(noGain.priceOld, undefined);
});

test('dedupe и фильтр просроченных', () => {
  const a = normalizeCoupon({ title: 'Kafija  JACOBS', priceNew: 5, priceOld: 7, validTo: '2026-11-05' }, SRC);
  const b = normalizeCoupon({ title: 'kafija jacobs', priceNew: 4, priceOld: 7, validTo: '2026-11-05' }, SRC);
  const old = normalizeCoupon({ title: 'Old', priceNew: 1, priceOld: 2, validTo: '2026-11-01' }, SRC);
  const out = dedupe(filterActive([a, b, old], '2026-11-02'));
  assert.equal(out.length, 1);
  assert.equal(out[0].priceNew, 4);
});

test('даты, цены, единицы', () => {
  assert.deepEqual(parseLvRange('27.10. - 02.11.2026.', '2026-11-02'), { from: '2026-10-27', to: '2026-11-02' });
  assert.deepEqual(parseLvRange('26.02. - 28.04.2027.', '2026-11-02'), { from: '2026-02-26', to: '2027-04-28' });
  assert.deepEqual(parseLvRange('no 28.12. līdz 03.01.', '2026-12-30'), { from: '2026-12-28', to: '2027-01-03' });
  assert.equal(parsePrice('Regulārā cena: 2,19 €'), 2.19);
  assert.deepEqual(parseUnitPrice('Cena par vienību: 3,86 €/kg'), { value: 3.86, unit: 'kg' });
});

test('словарный перевод', () => {
  assert.equal(glossaryTranslate('Piens 2,5% 1l'), 'Молоко 2,5% 1l');
  assert.equal(glossaryTranslate('Atlaide ar PALDIES karti'), 'Скидка по карте PALDIES (Maxima)');
  assert.match(glossaryTranslate('Cena ar Lidl Plus'), /Цена с приложением Lidl Plus/);
  assert.match(glossaryTranslate('Graudainais biezpiens SMILTENE'), /творог SMILTENE/);
});

import { extractHtmlDeals } from '../scrapers/lib/generic.js';
import { parseCatalogs } from '../scrapers/stores/visasakcijas.js';

test('универсальный разбор: Omnibus «Regulārā cena» + срок (Baby City)', () => {
  const d = extractHtmlDeals(fx('babycity-sale.html'), 'https://www.babycity.lv/lv/x');
  assert.ok(d.length >= 3, `найдено ${d.length}`);
  const coat = d.find((x) => /HUPPA/.test(x.title));
  assert.equal(coat.priceOld, 135);
  assert.equal(coat.priceNew, 67.5);
  assert.equal(coat.validTo, '2027-11-01');
  assert.match(coat.url, /^https:\/\/www\.babycity\.lv\/lv\//);
});

test('буклеты VisasAkcijas', () => {
  const c = parseCatalogs(fx('visasakcijas.html'), '2026-11-02');
  const mx = c.find((x) => x.store === 'Maxima');
  assert.equal(mx.kind, 'catalog');
  assert.equal(mx.validFrom, '2026-11-03');
  assert.equal(mx.validTo, '2026-11-09');
  assert.equal(mx.source, 'maxima');
});

test('универсальный разбор: тысячи через неразрывный пробел, рассрочка не считается ценой', () => {
  const html = `<div class="list"><div class="product"><a href="/p/rio"><h3>Dārza mēbeļu komplekts RIO</h3></a>
    <span class="special-price">Īpaša cena 1 090,00 €</span>
    <span class="old-price">Parastā cena 1 790,00 €</span>
    <div>Iemaksa Mēneša maksājums 90,83 €</div><div>Depozīts: 25% - 272,50 €</div></div></div>`;
  const d = extractHtmlDeals(html, 'https://www.home4you.lv/lv/');
  assert.equal(d.length, 1);
  assert.equal(d[0].priceOld, 1790);
  assert.equal(d[0].priceNew, 1090);
});

test('универсальный разбор: Omnibus с суммой во вложенном теге и порогом покупки (Benu)', () => {
  const html = `<div class="grid"><div class="bnuProduct"><h2><a href="/p/ziepes">TAKE TIME roku ziepes 300ml</a></h2>
    <div class="bnuProduct__price"><ins><span class="money_amount">2,80</span> <span>€</span></ins>
    <p>cena grozā pirkumam virs 9.99 € kampaņai: <strong>IZPARDOSANA</strong></p></div>
    <p class="lowest">Zemākā cena 30 dienu laikā – <strong><span>6,99</span> <span>€</span></strong> (-60%)</p>
    <p class="regular">Regulārā cena – <strong><span>6,99</span> <span>€</span></strong> (-60%)</p></div></div>`;
  const d = extractHtmlDeals(html, 'https://www.benu.lv/');
  assert.equal(d.length, 1);
  assert.equal(d[0].priceOld, 6.99);
  assert.equal(d[0].priceNew, 2.8);
});
