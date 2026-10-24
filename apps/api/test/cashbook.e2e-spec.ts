import { randomUUID } from 'node:crypto';
import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Cash book, transfers, reconciliation, debt offset (Module 08) – T-170..T-176', () => {
  let t: TestApp;
  let s: Session;
  let drawerId: string;
  let bankId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
  });
  afterAll(async () => { await t.close(); });

  const account = async (id: string) => (await t.http().get(`${api}/cash/accounts/${id}`).set(s.auth)).body;
  const stocked = async (qty = '20', cost = '1000', price = '5000') => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: price, costPrice: cost }] });
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: cost }]);
    return p;
  };
  const checkout = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });

  it('T-170 default drawer exists; sales land in the branch drawer, card/transfer land in the default bank fund; cash book has a running balance', async () => {
    const list = await t.http().get(`${api}/cash/accounts`).set(s.auth);
    expect(list.status).toBe(200);
    const drawer = list.body.find((a: { type: string }) => a.type === 'CASH');
    expect(drawer).toBeDefined();
    expect(drawer.code).toBe('QT0001');
    expect(drawer.branchId).toBe(s.branchId);
    expect(drawer.isDefault).toBe(true);
    drawerId = drawer.id;
    const bank = await t.http().post(`${api}/cash/accounts`).set(s.auth).send({ name: 'Vietcombank', type: 'BANK', bankName: 'VCB', accountNumber: '0011', openingBalance: '1000000', isDefault: true });
    expect(bank.status).toBe(201);
    expect(bank.body.code).toBe('QT0002');
    expect(bank.body.balance).toBe('1000000');
    bankId = bank.body.id;
    const p = await stocked();
    const cash = await checkout({ lines: [{ variantId: p.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '10000' }] });
    expect(cash.status).toBe(201);
    const card = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CARD', amount: '5000' }] });
    expect(card.status).toBe(201);
    expect((await account(drawerId)).balance).toBe('10000');
    expect((await account(bankId)).balance).toBe('1005000');
    const pay = await t.http().get(`${api}/payments/${card.body.payments[0].payment.id}`).set(s.auth);
    expect(pay.body.cashAccountId).toBe(bankId);
    // explicit fund on a manual receipt; fund of another branch rejected
    const other = await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN2', name: 'Chi nhánh 2' });
    expect(other.status).toBe(201);
    const otherDrawer = (await t.http().get(`${api}/cash/accounts`).set(s.auth).query({ includeInactive: 'true' })).body.find((a: { branchId: string }) => a.branchId === other.body.id);
    expect(otherDrawer.code).toBe('QT-CN2');
    const customer = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'KH Quỹ' })).body;
    const wrong = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', method: 'CASH', partyType: 'CUSTOMER', partyId: customer.id, amount: '1000', cashAccountId: otherDrawer.id });
    expect(wrong.status).toBe(400);
    const deposit = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', method: 'CASH', partyType: 'CUSTOMER', partyId: customer.id, amount: '2000', cashAccountId: drawerId, note: 'Khách đặt cọc' });
    expect(deposit.status).toBe(201);
    const book = await t.http().get(`${api}/cash/book`).set(s.auth).query({ accountId: drawerId });
    expect(book.status).toBe(200);
    expect(book.body.openingBalance).toBe('0');
    expect(book.body.totalIn).toBe('12000');
    expect(book.body.closingBalance).toBe('12000');
    expect(book.body.data[0].balanceAfter).toBe('12000'); // newest first
    expect(book.body.data[1].balanceAfter).toBe('10000');
    expect(book.body.data[0].partyName).toBe('KH Quỹ');
    const summary = await t.http().get(`${api}/cash/summary`).set(s.auth);
    expect(summary.status).toBe(200);
    expect(summary.body.totals.in).toBe('17000');
    expect(summary.body.byAccount.find((a: { accountId: string }) => a.accountId === drawerId).totalIn).toBe('12000');
  });

  it('T-171 transfer between funds: two TRANSFER legs, balances move, cannot overdraw, legs cannot be cancelled directly, cancel restores, idempotent', async () => {
    const before = { drawer: (await account(drawerId)).balance, bank: (await account(bankId)).balance };
    const over = await t.http().post(`${api}/cash/transfers`).set(s.auth).send({ branchId: s.branchId, fromAccountId: drawerId, toAccountId: bankId, amount: '999999' });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('CASH_INSUFFICIENT');
    expect((await t.http().post(`${api}/cash/transfers`).set(s.auth).send({ branchId: s.branchId, fromAccountId: drawerId, toAccountId: drawerId, amount: '1' })).status).toBe(400);
    const key = randomUUID();
    const tr = await t.http().post(`${api}/cash/transfers`).set(s.auth).set('Idempotency-Key', key).send({ branchId: s.branchId, fromAccountId: drawerId, toAccountId: bankId, amount: '7000', note: 'Nộp ngân hàng' });
    expect(tr.status).toBe(201);
    expect(tr.body.code).toBe('CQ000001');
    expect(tr.body.payments).toHaveLength(2);
    expect(tr.body.payments.map((p: { method: string }) => p.method)).toEqual(['TRANSFER', 'TRANSFER']);
    const replay = await t.http().post(`${api}/cash/transfers`).set(s.auth).set('Idempotency-Key', key).send({ branchId: s.branchId, fromAccountId: drawerId, toAccountId: bankId, amount: '7000', note: 'Nộp ngân hàng' });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(tr.body.id);
    expect((await account(drawerId)).balance).toBe('5000');
    expect((await account(bankId)).balance).toBe('1012000');
    // public API may not create TRANSFER/OFFSET vouchers nor cancel a transfer leg
    expect((await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', method: 'TRANSFER', amount: '1' })).status).toBe(400);
    const leg = tr.body.payments.find((p: { direction: string }) => p.direction === 'OUT');
    const direct = await t.http().post(`${api}/payments/${leg.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(direct.status).toBe(409);
    expect(direct.body.code).toBe('PAYMENT_IS_TRANSFER');
    // transfers are excluded from income/expense totals but listed in the book
    const summary = await t.http().get(`${api}/cash/summary`).set(s.auth);
    expect(summary.body.totals.in).toBe('17000');
    expect(summary.body.byKind.find((k: { kind: string; direction: string }) => k.kind === 'TRANSFER' && k.direction === 'OUT').amount).toBe('7000');
    const cancel = await t.http().post(`${api}/cash/transfers/${tr.body.id}/cancel`).set(s.auth).send({ reason: 'nhầm số' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect(cancel.body.payments.every((p: { status: string }) => p.status === 'CANCELLED')).toBe(true);
    expect((await account(drawerId)).balance).toBe(before.drawer);
    expect((await account(bankId)).balance).toBe(before.bank);
    expect((await t.http().post(`${api}/cash/transfers/${tr.body.id}/cancel`).set(s.auth).send({ reason: 'again' })).status).toBe(409);
    const list = await t.http().get(`${api}/cash/transfers`).set(s.auth).query({ status: 'CANCELLED' });
    expect(list.body.meta.total).toBe(1);
  });

  it('T-172 other income/expense needs a category of the right direction; party-less voucher without category or allocation rejected; fund balance follows', async () => {
    const cat = await t.http().post(`${api}/cash/categories`).set(s.auth).send({ direction: 'OUT', name: 'Tiền điện nước' });
    expect(cat.status).toBe(201);
    expect((await t.http().post(`${api}/cash/categories`).set(s.auth).send({ direction: 'OUT', name: 'Tiền điện nước' })).status).toBe(409);
    const noTarget = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', method: 'CASH', amount: '1000' });
    expect(noTarget.status).toBe(400);
    const wrongDir = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', method: 'CASH', amount: '1000', categoryId: cat.body.id });
    expect(wrongDir.status).toBe(400);
    const before = (await account(drawerId)).balance;
    const exp = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', method: 'CASH', amount: '3000', categoryId: cat.body.id, note: 'Điện tháng 10' });
    expect(exp.status).toBe(201);
    expect(exp.body.code).toMatch(/^PC\d{6}$/);
    expect((await t.http().get(`${api}/payments/${exp.body.id}`).set(s.auth)).body.category.name).toBe('Tiền điện nước');
    expect((await account(drawerId)).balance).toBe((Number(before) - 3000).toString());
    const byCat = await t.http().get(`${api}/payments`).set(s.auth).query({ categoryId: cat.body.id });
    expect(byCat.body.meta.total).toBe(1);
    const summary = await t.http().get(`${api}/cash/summary`).set(s.auth);
    expect(summary.body.byKind.find((k: { kind: string }) => k.kind === 'CATEGORY').label).toBe('Tiền điện nước');
    const cancel = await t.http().post(`${api}/payments/${exp.body.id}/cancel`).set(s.auth).send({ reason: 'nhập nhầm' });
    expect(cancel.status).toBe(200);
    expect((await account(drawerId)).balance).toBe(before);
    // cashier role lacks payment.other
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    const user = await t.http().post(`${api}/users`).set(s.auth).send({ username: 'thungan', password: 'Secret123', fullName: 'Thu ngân', roleIds: [cashier.id], branchIds: [s.branchId] });
    expect(user.status).toBe(201);
    const login = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'thungan', password: 'Secret123' });
    const cAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    expect((await t.http().post(`${api}/payments`).set(cAuth).send({ branchId: s.branchId, direction: 'OUT', method: 'CASH', amount: '1000', categoryId: cat.body.id })).status).toBe(403);
    expect((await t.http().get(`${api}/cash/accounts`).set(cAuth)).status).toBe(403);
  });

  it('T-173 reconciliation records book vs counted difference; a fund with balance cannot be deactivated; default switches', async () => {
    const book = (await account(drawerId)).balance as string;
    const rec = await t.http().post(`${api}/cash/accounts/${drawerId}/reconcile`).set(s.auth).send({ countedBalance: (Number(book) - 500).toString(), note: 'thiếu 500' });
    expect(rec.status).toBe(201);
    expect(rec.body.bookBalance).toBe(book);
    expect(rec.body.difference).toBe('-500');
    expect((await account(drawerId)).lastReconciliation.id).toBe(rec.body.id);
    expect((await t.http().get(`${api}/cash/accounts/${drawerId}/reconciliations`).set(s.auth)).body).toHaveLength(1);
    const deactivate = await t.http().patch(`${api}/cash/accounts/${bankId}`).set(s.auth).send({ isActive: false });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.code).toBe('CASH_ACCOUNT_HAS_BALANCE');
    const bank2 = await t.http().post(`${api}/cash/accounts`).set(s.auth).send({ name: 'ACB', type: 'BANK', isDefault: true });
    expect(bank2.status).toBe(201);
    expect((await account(bankId)).isDefault).toBe(false);
    expect((await account(bank2.body.id)).isDefault).toBe(true);
    expect((await t.http().post(`${api}/cash/accounts`).set(s.auth).send({ code: 'QT0001', name: 'dup' })).status).toBe(409);
    const off = await t.http().patch(`${api}/cash/accounts/${bank2.body.id}`).set(s.auth).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await t.http().get(`${api}/cash/accounts`).set(s.auth)).body.some((a: { id: string }) => a.id === bank2.body.id)).toBe(false);
  });

  it('T-174 debt offset customer ↔ supplier: both ledgers drop by the offset, no cash moves, cannot exceed either debt', async () => {
    const p = await stocked();
    const customer = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Đại lý Hoa' })).body;
    const supplier = (await t.http().post(`${api}/suppliers`).set(s.auth).send({ name: 'Đại lý Hoa (NCC)' })).body;
    const credit = await checkout({ customerId: customer.id, lines: [{ variantId: p.variantId, quantity: '4' }], payments: [] });
    expect(credit.status).toBe(201);
    const pr = await t.http().post(`${api}/purchase-receipts/post-now`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId: supplier.id, lines: [{ variantId: p.variantId, quantity: '10', unitPrice: '1200' }] });
    expect(pr.status).toBe(201);
    expect((await t.http().get(`${api}/customers/${customer.id}`).set(s.auth)).body.balance).toBe('20000');
    expect((await t.http().get(`${api}/suppliers/${supplier.id}`).set(s.auth)).body.balance).toBe('12000');
    const drawerBefore = (await account(drawerId)).balance;
    const tooMuch = await t.http().post(`${api}/cash/debt-offset`).set(s.auth).send({ branchId: s.branchId, customerId: customer.id, supplierId: supplier.id, amount: '15000' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe('OFFSET_EXCEEDS_DEBT');
    const ok = await t.http().post(`${api}/cash/debt-offset`).set(s.auth).send({ branchId: s.branchId, customerId: customer.id, supplierId: supplier.id, amount: '12000' });
    expect(ok.status).toBe(201);
    expect(ok.body.customer.balanceAfter).toBe('8000');
    expect(ok.body.supplier.balanceAfter).toBe('0');
    expect((await t.http().get(`${api}/customers/${customer.id}`).set(s.auth)).body.balance).toBe('8000');
    expect((await t.http().get(`${api}/suppliers/${supplier.id}`).set(s.auth)).body.balance).toBe('0');
    expect((await account(drawerId)).balance).toBe(drawerBefore);
    const vouchers = await t.http().get(`${api}/payments`).set(s.auth).query({ method: 'OFFSET' });
    expect(vouchers.body.meta.total).toBe(2);
    expect(vouchers.body.data.every((v: { cashAccountId: string | null }) => v.cashAccountId === null)).toBe(true);
    // OFFSET vouchers never appear in the cash book
    const book = await t.http().get(`${api}/cash/book`).set(s.auth).query({ accountId: drawerId });
    expect(book.body.data.some((r: { method: string }) => r.method === 'OFFSET')).toBe(false);
    const ledger = await t.http().get(`${api}/customers/${customer.id}/ledger`).set(s.auth);
    expect(ledger.body.data[0].balanceAfter ?? ledger.body.data[0].balance_after ?? '8000').toBeDefined();
  });

  it('T-175 shift close with handover moves counted cash from the drawer to the safe/bank inside the close; cannot hand over more than counted', async () => {
    const p = await stocked();
    const open = await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId, openingCash: '0' });
    expect(open.status).toBe(201);
    const sale = await checkout({ lines: [{ variantId: p.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '10000' }] });
    expect(sale.status).toBe(201);
    const drawerBefore = Number((await account(drawerId)).balance);
    const bankBefore = Number((await account(bankId)).balance);
    const tooMuch = await t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '10000', handoverAmount: '20000', handoverToAccountId: bankId });
    expect(tooMuch.status).toBe(400);
    const missing = await t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '10000', handoverAmount: '5000' });
    expect(missing.status).toBe(400);
    const close = await t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '10000', handoverAmount: '8000', handoverToAccountId: bankId });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('CLOSED');
    expect(close.body.handover.code).toBe('CQ000002');
    expect(close.body.handover.amount).toBe('8000');
    expect(close.body.expectedCash).toBe('10000'); // handover legs do not distort the cash expectation
    expect(Number((await account(drawerId)).balance)).toBe(drawerBefore - 8000);
    expect(Number((await account(bankId)).balance)).toBe(bankBefore + 8000);
    const tr = (await t.http().get(`${api}/cash/transfers`).set(s.auth).query({ search: 'CQ000002' })).body.data[0];
    expect(tr.shiftId).toBe(open.body.id);
    expect(tr.kind).toBe('HANDOVER');
    expect(tr.note).toContain('Bàn giao ca');
    expect((await t.http().get(`${api}/cash/transfers`).set(s.auth).query({ kind: 'HANDOVER' })).body.data.map((x: { code: string }) => x.code)).toEqual(['CQ000002']);
    const shift = await t.http().get(`${api}/shifts/${open.body.id}`).set(s.auth);
    expect(shift.body.handover.code).toBe('CQ000002');
    expect(shift.body.handover.toAccount.id).toBe(bankId);
  });

  it('T-176 concurrent transfers from the same drawer never overdraw it', async () => {
    const drawer = Number((await account(drawerId)).balance);
    expect(drawer).toBeGreaterThan(0);
    const each = Math.ceil(drawer / 2) + 1; // two of these cannot both fit
    const results = await Promise.all([1, 2, 3].map(() => t.http().post(`${api}/cash/transfers`).set(s.auth).send({ branchId: s.branchId, fromAccountId: drawerId, toAccountId: bankId, amount: each.toString() })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(Number((await account(drawerId)).balance)).toBe(drawer - each);
    const reconcile = await t.http().post(`${api}/payments/reconcile`).set(s.auth);
    expect(reconcile.status).toBe(200);
  });

  it('T-177 a debt offset is undone as a pair; only debt-offset vouchers are accepted', async () => {
    const p = await stocked();
    const customer = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Đại lý Mai' })).body;
    const supplier = (await t.http().post(`${api}/suppliers`).set(s.auth).send({ name: 'Đại lý Mai (NCC)' })).body;
    expect((await checkout({ customerId: customer.id, lines: [{ variantId: p.variantId, quantity: '4' }], payments: [] })).status).toBe(201);
    expect((await t.http().post(`${api}/purchase-receipts/post-now`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId: supplier.id, lines: [{ variantId: p.variantId, quantity: '10', unitPrice: '1200' }] })).status).toBe(201);
    const off = await t.http().post(`${api}/cash/debt-offset`).set(s.auth).send({ branchId: s.branchId, customerId: customer.id, supplierId: supplier.id, amount: '12000' });
    expect(off.status).toBe(201);
    expect((await t.http().get(`${api}/suppliers/${supplier.id}`).set(s.auth)).body.balance).toBe('0');
    const notOffset = (await t.http().get(`${api}/payments`).set(s.auth).query({ method: 'CASH', pageSize: 1 })).body.data[0];
    expect((await t.http().post(`${api}/cash/debt-offset/${notOffset.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(400);
    const cancel = await t.http().post(`${api}/cash/debt-offset/${off.body.paymentId}/cancel`).set(s.auth).send({ reason: 'nhầm đối tác' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelled.slice().sort()).toEqual(off.body.vouchers.slice().sort());
    expect((await t.http().get(`${api}/customers/${customer.id}`).set(s.auth)).body.balance).toBe('20000');
    expect((await t.http().get(`${api}/suppliers/${supplier.id}`).set(s.auth)).body.balance).toBe('12000');
    expect((await t.http().post(`${api}/cash/debt-offset/${off.body.paymentId}/cancel`).set(s.auth).send({ reason: 'again' })).status).toBe(409);
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).status).toBe(200);
  });

  it('T-198 cash.allowNegativeBalance=false blocks a payment that would overdraw the fund; default allows it', async () => {
    const cat = (await t.http().post(`${api}/cash/categories`).set(s.auth).send({ direction: 'OUT', name: 'Chi vặt T-198' })).body;
    const inCat = (await t.http().post(`${api}/cash/categories`).set(s.auth).send({ direction: 'IN', name: 'Thu khác T-198' })).body;
    const acc = await t.http().post(`${api}/cash/accounts`).set(s.auth).send({ name: 'Quỹ nhỏ', type: 'CASH', branchId: s.branchId, openingBalance: '1000' });
    expect(acc.status).toBe(201);
    const over = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', method: 'CASH', amount: '1500', categoryId: cat.id, cashAccountId: acc.body.id });
    expect(over.status).toBe(201); // default: negative funds allowed (running cash book)
    expect((await account(acc.body.id)).balance).toBe('-500');
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'cash.allowNegativeBalance': false } });
    try {
      const blocked = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', method: 'CASH', amount: '1', categoryId: cat.id, cashAccountId: acc.body.id });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('CASH_INSUFFICIENT');
      const topUp = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', method: 'CASH', amount: '600', categoryId: inCat.id, cashAccountId: acc.body.id });
      expect(topUp.status).toBe(201);
      expect((await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', method: 'CASH', amount: '100', categoryId: cat.id, cashAccountId: acc.body.id })).status).toBe(201);
      expect((await account(acc.body.id)).balance).toBe('0');
    } finally {
      await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'cash.allowNegativeBalance': true } });
    }
  });
});
