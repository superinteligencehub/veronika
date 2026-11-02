// Универсальный скрапер для магазинов из реестра автообнаружения (scrapers/registry/stores.json).
import { scrapeShopify, scrapeWoo, scrapeHtml, capDeals } from '../lib/generic.js';

export async function scrape({ source, log }) {
  let items;
  switch (source.platform) {
    case 'shopify':
      items = await scrapeShopify(source.origin);
      break;
    case 'woo':
      items = await scrapeWoo(source.origin);
      break;
    case 'browser':
      items = await scrapeHtml(source.saleUrls, { browser: true, pages: source.pages ?? 3 });
      break;
    default:
      items = await scrapeHtml(source.saleUrls ?? [source.url], { pages: source.pages ?? 3 });
  }
  const out = capDeals(items);
  log(`${source.id}: ${items.length} скидок (${source.platform}), в ленту — ${out.length}`);
  return out;
}
