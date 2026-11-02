#!/usr/bin/env node
// PNG-иконки из web/icons/icon.svg (нужен Playwright/Chromium).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// require (а не import), чтобы работал и глобально установленный playwright через NODE_PATH
const { chromium } = createRequire(import.meta.url)('playwright');

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web', 'icons');
const svg = await readFile(join(DIR, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.12]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  // maskable: фон на весь квадрат, сам значок — в безопасной зоне
  await page.setContent(`<html><body style="margin:0;background:${pad ? '#0f766e' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: join(DIR, name), omitBackground: !pad });
  console.log('✓', name);
}
await browser.close();
