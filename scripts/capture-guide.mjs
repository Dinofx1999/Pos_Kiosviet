#!/usr/bin/env node
/**
 * Chụp ảnh màn hình cho mục "Hướng dẫn sử dụng" (apps/web/public/guide/<tên>-{desktop|mobile}.jpg) từ ứng dụng đang chạy.
 *   node scripts/capture-guide.mjs [--base http://localhost:5174] [--tenant demo] [--user admin] [--pass Admin@123] [--only pos,invoices] [--check]
 * Mỗi màn hình được chụp ở hai kích thước: desktop 1280×800 (cả trang) và mobile 390×844 (đúng khung điện thoại), JPEG chất lượng 80,
 * deviceScaleFactor 1. Chạy lại mỗi khi giao diện đổi. `--check` chỉ kiểm tra ảnh mà các bài hướng dẫn tham chiếu có đủ trên đĩa hay không.
 * Bước chuẩn bị (prep) của một ảnh lỗi không làm hỏng cả lượt chụp: ảnh vẫn được chụp ở trạng thái hiện có và được ghi "⚠".
 */
import { chromium, devices } from 'playwright';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const has = (name) => process.argv.includes(`--${name}`);
const BASE = arg('base', 'http://localhost:5174');
const TENANT = arg('tenant', 'demo');
const USER = arg('user', 'admin');
const PASS = arg('pass', 'Admin@123');
const ONLY = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(process.cwd(), 'apps/web/public/guide');
const GUIDES_DIR = path.resolve(process.cwd(), 'apps/web/src/pages/help/guides');
const JPEG = { type: 'jpeg', quality: 80 };

// ------------------------------------------------------------------ helpers used by prep callbacks
const wait = (page, ms = 600) => page.waitForTimeout(ms);
/** Click the first match of a locator (short timeout) and let the UI settle. */
const click = async (page, locator, ms = 700) => { await locator.first().click({ timeout: 5000 }); await wait(page, ms); };
/** AntD buttons with an icon expose "<icon-name> <label>" as their accessible name – never anchor the regex with ^ on the label. */
const button = (page, re) => page.getByRole('button', { name: re });
/** First list row – AntD table row on desktop, card on phones. */
const firstRow = (page) => page.locator('.ant-table-tbody tr.ant-table-row, .sr-card, .od-card, .km-card, .tk-card, .cb-card').first();
/** Mobile pages hide the toolbar buttons behind the floating "Bộ lọc"? No – only filters. Buttons stay in the toolbar. */
const openUserMenu = async (page, ctx) => {
  if (ctx.mobile) await click(page, page.locator('.kv-burger'));
  else await click(page, page.locator('.kv-user'));
};
/** Type into the POS search box and pick the first suggestion (adds one line to the cart). */
const addToCart = async (page, ctx, text = 'son') => {
  // the desktop header search stays in the DOM (hidden) on phones – pick the visible one for the viewport
  const input = page.locator(ctx.mobile ? '.pos-msearch input' : '.pos-search input').first();
  await input.click({ timeout: 5000 });
  await input.fill(text);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click({ timeout: 6000 });
  await wait(page, 900);
};
/** On phones the payment panel lives in a bottom sheet – open it. */
const openPaySheet = async (page, ctx) => { if (ctx.mobile) await click(page, page.locator('.pos-mbar .pos-pay-btn'), 700); };
const apiGet = (page, p) => page.evaluate(async (p) => {
  const raw = localStorage.getItem('erp-auth');
  const tok = raw ? JSON.parse(raw)?.state?.accessToken : null;
  const r = await fetch(`/api/v1${p}`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
  return r.ok ? r.json() : null;
}, p);
/** Prefer a document in one of the given statuses; otherwise the one with the most lines (an empty cancelled document makes a poor screenshot). */
const lines = (r) => Number(r.totalLines ?? r._count?.lines ?? r.lines?.length ?? 0);
const pick = (list, prefer) => { const rows = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : []; for (const st of prefer) { const hit = rows.filter((r) => r.status === st).sort((x, y) => lines(y) - lines(x))[0]; if (hit) return hit.id; } return [...rows].sort((x, y) => lines(y) - lines(x))[0]?.id; };

/** Resolve demo record ids once per context so detail routes point at real documents. */
async function resolveIds(page) {
  const [tr, st, od, rt, pm, pr] = await Promise.all([
    apiGet(page, '/transfers?pageSize=20'), apiGet(page, '/stocktakes?pageSize=20'), apiGet(page, '/orders?pageSize=20'), apiGet(page, '/sales-returns?pageSize=20'), apiGet(page, '/promotions?pageSize=20'), apiGet(page, '/purchase-receipts?pageSize=20'),
  ]);
  return {
    receipt: pick(pr, ['POSTED']),
    transfer: pick(tr, ['IN_TRANSIT', 'RECEIVED', 'DRAFT']),
    stocktake: pick(st, ['COUNTING', 'IN_PROGRESS', 'OPEN', 'COMPLETED']),
    order: pick(od, ['CONFIRMED', 'DRAFT', 'COMPLETED']),
    salesReturn: pick(rt, ['COMPLETED', 'DRAFT']),
    promotion: pick(pm, ['ACTIVE']),
  };
}

/**
 * [tên file, route | (ctx) => route, prep?: async (page, ctx) => void]
 * ctx = { mobile: boolean, ids: {...} }. Tên file phải trùng với `shot:` trong apps/web/src/pages/help/guides/*.ts.
 */
const SHOTS = [
  // ---- bắt đầu
  ['login', '/login'],
  ['dashboard', '/'],
  ['menu-drawer', '/', async (page, ctx) => { if (ctx.mobile) await click(page, page.locator('.kv-burger')); }],
  ['change-password', '/', async (page, ctx) => { await openUserMenu(page, ctx); await click(page, ctx.mobile ? button(page, /Đổi mật khẩu/) : page.locator('.ant-dropdown-menu-item', { hasText: 'Đổi mật khẩu' })); }],
  ['settings-branches', '/settings/branches'],
  ['settings-warehouses', '/settings/warehouses'],
  ['settings-users', '/settings/users'],
  ['settings-roles', '/settings/roles'],
  ['settings-config', '/settings/config'],
  ['settings-loyalty', '/settings/loyalty'],
  ['settings-subscription', '/settings/subscription'],
  ['settings-audit', '/settings/audit'],
  ['settings-logins', '/settings/logins'],
  // ---- hàng hóa
  ['products', '/products'],
  ['product-new', '/products', async (page) => { await click(page, button(page, /Thêm mới/)); }],
  ['product-detail', '/products', async (page) => { await click(page, firstRow(page), 900); }],
  ['products-import', '/products', async (page) => { const b = button(page, /Import/).first(); await b.hover({ timeout: 5000 }); await wait(page, 700); if (!(await page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').count())) await click(page, b); }],
  ['price-books', '/price-books'],
  ['price-book-new', '/price-books', async (page) => { await click(page, button(page, /Thêm bảng giá/)); }],
  ['promotions', '/promotions'],
  ['promotion-new', '/promotions', async (page) => { await click(page, button(page, /Thêm khuyến mãi/)); }],
  ['promotion-detail', (ctx) => (ctx.ids.promotion ? `/promotions/${ctx.ids.promotion}` : '/promotions')],
  // ---- kho
  ['inventory-documents', '/inventory/documents'],
  ['inventory-document-detail', '/inventory/documents', async (page) => { await click(page, firstRow(page), 900); }],
  ['inventory-receipt-new', '/inventory/documents/new?type=RECEIPT'],
  ['inventory-issue-new', '/inventory/documents/new?type=ISSUE'],
  ['inventory-adjust-new', '/inventory/documents/new?type=ADJUSTMENT'],
  ['inventory-balances', '/inventory/balances'],
  ['inventory-movements', '/inventory/movements'],
  ['transfers', '/transfers'],
  ['transfer-new', '/transfers/new'],
  ['transfer-detail', (ctx) => (ctx.ids.transfer ? `/transfers/${ctx.ids.transfer}` : '/transfers')],
  ['stocktakes', '/stocktakes'],
  ['stocktake-new', '/stocktakes/new'],
  ['stocktake-detail', (ctx) => (ctx.ids.stocktake ? `/stocktakes/${ctx.ids.stocktake}` : '/stocktakes')],
  // ---- mua hàng
  ['suppliers', '/suppliers'],
  ['supplier-new', '/suppliers', async (page) => { await click(page, button(page, /Thêm mới/)); }],
  ['purchase-orders', '/purchase-orders'],
  ['purchase-order-new', '/purchase-orders/new'],
  ['purchase-receipts', '/purchase-receipts'],
  ['purchase-receipt-new', '/purchase-receipts/new'],
  ['purchase-receipt-detail', '/purchase-receipts', async (page) => { await click(page, firstRow(page), 900); }],
  ['purchase-returns', '/purchase-returns'],
  ['purchase-return-new', (ctx) => (ctx.ids.receipt ? `/purchase-returns/new?receiptId=${ctx.ids.receipt}` : '/purchase-returns/new')],
  ['payments-out', '/payments?direction=OUT'],
  // ---- bán hàng
  ['pos', '/pos'],
  ['pos-cart', '/pos', async (page, ctx) => { await addToCart(page, ctx); }],
  ['pos-customer', '/pos', async (page, ctx) => {
    await addToCart(page, ctx);
    if (ctx.mobile) await click(page, page.locator('.pos-mbar button').first(), 500); // opens the sheet and focuses the customer box
    else await click(page, page.locator('.pos-side .ant-select-show-search .ant-select-selection-search-input'), 300);
    await page.keyboard.type('a'); await wait(page, 900);
  }],
  ['pos-mixed', '/pos', async (page, ctx) => { await addToCart(page, ctx); await openPaySheet(page, ctx); await click(page, page.locator('.pos-chip', { hasText: 'Kết hợp' })); }],
  ['pos-held', '/pos', async (page) => { await click(page, page.locator('.pos-header button:has(.anticon-file-text)'), 900); }],
  ['shifts', '/shifts'],
  ['shift-open', '/shifts', async (page) => { await click(page, button(page, /Mở ca/)); }],
  ['shift-detail', '/shifts', async (page) => { await click(page, firstRow(page), 900); }],
  ['invoices', '/invoices'],
  ['invoice-detail', '/invoices', async (page) => { await click(page, firstRow(page), 900); }],
  ['orders', '/orders'],
  ['order-new', '/orders/new'],
  ['order-detail', (ctx) => (ctx.ids.order ? `/orders/${ctx.ids.order}` : '/orders')],
  ['deliveries', '/deliveries'],
  ['delivery-detail', '/deliveries', async (page) => { await click(page, firstRow(page), 900); }],
  ['sales-returns', '/sales-returns'],
  ['sales-return-new', '/sales-returns/new'],
  ['sales-return-detail', (ctx) => (ctx.ids.salesReturn ? `/sales-returns/${ctx.ids.salesReturn}` : '/sales-returns')],
  // ---- khách hàng
  ['customers', '/customers'],
  ['customer-new', '/customers', async (page) => { await click(page, button(page, /Thêm mới/)); }],
  ['customer-detail', '/customers', async (page) => { await click(page, firstRow(page), 900); }],
  // ---- sổ quỹ
  ['cash', '/cash'],
  ['cash-accounts', '/cash/accounts'],
  ['cash-account-new', '/cash/accounts', async (page) => { await click(page, button(page, /Thêm quỹ/)); }],
  ['cash-reconcile', '/cash/accounts', async (page) => { await click(page, button(page, /Kiểm quỹ/)); }],
  ['cash-categories', '/cash/accounts', async (page) => { await click(page, page.getByRole('tab', { name: /Loại thu \/ chi/ })); }],
  ['payments-in', '/payments?direction=IN'],
  ['voucher-new', '/payments?direction=IN', async (page) => { await click(page, button(page, /Lập phiếu thu$/)); }],
  ['cash-transfers', '/cash/transfers'],
  ['cash-transfer-new', '/cash/transfers', async (page) => { await click(page, button(page, /^(?!.*Hủy).*Chuyển quỹ$/)); }],
  ['debt-offset', '/cash', async (page) => { await click(page, button(page, /Cấn trừ/)); }],
  // ---- nhân viên
  ['employees', '/employees'],
  ['attendance', '/employees/attendance'],
  ['commissions', '/employees/commissions'],
  ['commission-rule-new', '/employees/commissions', async (page) => { await click(page, page.getByRole('tab', { name: /Quy tắc hoa hồng/ })); await click(page, button(page, /Thêm quy tắc/)); }],
  ['performance', '/employees/performance'],
  // ---- báo cáo
  ['reports-sales', '/reports/sales'],
  ['reports-products', '/reports/products'],
  ['reports-profit', '/reports/profit'],
  ['reports-nxt', '/reports/inventory-nxt'],
  ['reports-slow-movers', '/reports/slow-movers'],
  ['reports-valuation', '/reports/valuation'],
  ['reports-tax', '/reports/tax'],
  ['reports-purchasing', '/reports/purchasing'],
  ['reports-supplier-debt', '/reports/supplier-debt'],
  ['reports-customer-debt', '/reports/customer-debt'],
  // ---- tích hợp & trợ giúp
  ['integrations', '/integrations'],
  ['integrations-excel', '/integrations/excel'],
  ['integrations-kiotviet', '/integrations/kiotviet'],
  ['integrations-reconcile', '/integrations/reconcile'],
  ['integrations-jobs', '/integrations/jobs'],
  ['help', '/help'],
  ['help-guide', '/help/ban-hang-pos'],
];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('vd: demo').fill(TENANT);
  await page.getByPlaceholder('admin').fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  await wait(page, 500);
}

async function goto(page, route) {
  // networkidle can hang on pages that poll – fall back to 'load' after a while
  try { await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 15000 }); } catch { await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 15000 }).catch(() => {}); }
  await wait(page, 700);
}

async function capture(browser, label, viewport, deviceOpts = {}) {
  const context = await browser.newContext({ viewport, locale: 'vi-VN', deviceScaleFactor: 1, ...deviceOpts });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await login(page);
  const ctx = { mobile: label === 'mobile', ids: await resolveIds(page).catch(() => ({})) };
  const stats = { ok: 0, warn: 0, fail: 0 };
  for (const [name, routeOrFn, prep] of SHOTS) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    const route = typeof routeOrFn === 'function' ? routeOrFn(ctx) : routeOrFn;
    const file = path.join(OUT, `${name}-${label}.jpg`);
    let note = '';
    try {
      if (name === 'login') { await context.clearCookies(); await page.evaluate(() => localStorage.clear()); await goto(page, route); }
      else await goto(page, route);
      if (prep) { try { await prep(page, ctx); } catch (e) { note = ` ⚠ prep: ${String(e.message).split('\n')[0].slice(0, 90)}`; stats.warn++; } }
      // phones: exactly the device frame; desktop: the whole page (except the full-height POS app and the long help pages)
      const fullPage = !ctx.mobile && !name.startsWith('pos') && !name.startsWith('help');
      await page.screenshot({ path: file, fullPage, ...JPEG });
      stats.ok++;
      process.stdout.write(`✓ ${name}-${label}${note}\n`);
      if (name === 'login') await login(page);
    } catch (e) {
      stats.fail++;
      process.stdout.write(`✗ ${name}-${label}: ${String(e.message).split('\n')[0].slice(0, 120)}\n`);
      // the session may be broken (e.g. logged out) – make sure the next shot starts authenticated
      if (!page.url().includes('/login')) { /* still inside the app */ } else await login(page).catch(() => {});
    }
  }
  await context.close();
  return stats;
}

/** Every `shot: '<name>'` referenced by the guides must exist as <name>-desktop.jpg and <name>-mobile.jpg. */
async function checkReferencedShots() {
  const files = (await readdir(GUIDES_DIR)).filter((f) => f.endsWith('.ts') && !['index.ts', 'types.ts'].includes(f));
  const refs = new Set();
  for (const f of files) for (const m of (await readFile(path.join(GUIDES_DIR, f), 'utf8')).matchAll(/shot:\s*'([^']+)'/g)) refs.add(m[1]);
  const missing = [];
  for (const r of refs) for (const v of ['desktop', 'mobile']) if (!existsSync(path.join(OUT, `${r}-${v}.jpg`))) missing.push(`${r}-${v}.jpg`);
  const notInScript = [...refs].filter((r) => !SHOTS.some(([n]) => n === r));
  console.log(`Ảnh được tham chiếu: ${refs.size} tên · thiếu trên đĩa: ${missing.length}${notInScript.length ? ` · không có trong SHOTS: ${notInScript.join(', ')}` : ''}`);
  if (missing.length) { console.log('Thiếu: ' + missing.join(', ')); process.exitCode = 1; }
  return missing;
}

if (has('check')) { await checkReferencedShots(); process.exit(); }

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const t0 = Date.now();
const d = await capture(browser, 'desktop', { width: 1280, height: 800 });
const m = await capture(browser, 'mobile', { width: 390, height: 844 }, { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await browser.close();
const files = (await readdir(OUT)).filter((f) => f.endsWith('.jpg')).length;
console.log(`Xong sau ${Math.round((Date.now() - t0) / 1000)}s · desktop ✓${d.ok} ⚠${d.warn} ✗${d.fail} · mobile ✓${m.ok} ⚠${m.warn} ✗${m.fail} · ${files} ảnh trong ${OUT}`);
await checkReferencedShots();
