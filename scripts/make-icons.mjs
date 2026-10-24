#!/usr/bin/env node
/**
 * Sinh icon ứng dụng (PNG) từ một SVG vẽ tay bằng Chromium của Playwright:
 *   node scripts/make-icons.mjs   → apps/web/public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(process.cwd(), 'apps/web/public/icons');
// mặt nạ (maskable) cần biểu tượng nằm trong 80 % giữa; bản thường bo góc sẵn
const svg = (size, { rounded, pad }) => {
  const r = rounded ? size * 0.22 : 0;
  const s = size * (1 - pad * 2); const o = size * pad; // vùng vẽ glyph
  const u = s / 100; // đơn vị theo lưới 100
  const g = (x, y) => `${(o + x * u).toFixed(2)},${(o + y * u).toFixed(2)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f7dff"/><stop offset="1" stop-color="#0055c8"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <!-- mái hiên -->
  <path d="M ${g(14, 36)} L ${g(22, 18)} L ${g(78, 18)} L ${g(86, 36)} Z" fill="#fff"/>
  <path d="M ${g(14, 36)} Q ${g(23, 48)} ${g(32, 36)} Q ${g(41, 48)} ${g(50, 36)} Q ${g(59, 48)} ${g(68, 36)} Q ${g(77, 48)} ${g(86, 36)} Z" fill="#fff"/>
  <path d="M ${g(32, 36)} L ${g(36, 18)} M ${g(50, 36)} L ${g(50, 18)} M ${g(68, 36)} L ${g(64, 18)}" stroke="#0055c8" stroke-opacity=".35" stroke-width="${(2 * u).toFixed(2)}"/>
  <!-- thân cửa hàng -->
  <rect x="${(o + 20 * u).toFixed(2)}" y="${(o + 46 * u).toFixed(2)}" width="${(60 * u).toFixed(2)}" height="${(38 * u).toFixed(2)}" rx="${(4 * u).toFixed(2)}" fill="#fff"/>
  <!-- cửa và cửa sổ -->
  <rect x="${(o + 28 * u).toFixed(2)}" y="${(o + 56 * u).toFixed(2)}" width="${(18 * u).toFixed(2)}" height="${(28 * u).toFixed(2)}" rx="${(3 * u).toFixed(2)}" fill="#1f7dff"/>
  <rect x="${(o + 52 * u).toFixed(2)}" y="${(o + 56 * u).toFixed(2)}" width="${(20 * u).toFixed(2)}" height="${(14 * u).toFixed(2)}" rx="${(3 * u).toFixed(2)}" fill="#1f7dff"/>
</svg>`;
};

const files = [
  ['icon-192.png', 192, { rounded: true, pad: 0.08 }],
  ['icon-512.png', 512, { rounded: true, pad: 0.08 }],
  ['icon-maskable-512.png', 512, { rounded: false, pad: 0.16 }],
  ['apple-touch-icon.png', 180, { rounded: false, pad: 0.08 }],
];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, opt] of files) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, opt)}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(OUT, name), omitBackground: true });
  console.log('✓', name);
}
await browser.close();
