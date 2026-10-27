import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('SePay – thanh toán chuyển khoản tự động (VietQR + webhook) – T-260..T-267', () => {
  let t: TestApp;
  let s: Session;
  let other: Session;
  let cashierAuth: { Authorization: string };
  let variantId: string;
  let customerId: string;
  let bankFundId: string;
  let apiKey: string;
  let hookSeq = 1000;

  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    other = await registerTenant(t);
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tnsepay', password: 'Secret123', fullName: 'Thu Ngân QR', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tnsepay', password: 'Secret123' });
    cashierAuth = { Authorization: `Bearer ${l.body.accessToken}` };
    const p = await createProduct(t, s, { name: 'Serum QR', variants: [{ sellPrice: '100000', costPrice: '40000' }] });
    variantId = p.variantId;
    await postReceipt(t, s, [{ variantId, quantity: '100', unitCost: '40000' }]);
    customerId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Khách Chuyển Khoản', phone: '0909000111' })).body.id;
    bankFundId = (await t.http().post(`${api}/cash/accounts`).set(s.auth).send({ name: 'MB Bank Bảo Ân', type: 'BANK', bankName: 'MBBank', accountNumber: '0123456789' })).body.id;
  });
  afterAll(async () => { await t.close(); });

  const hook = (body: Record<string, unknown>, key: string | null = apiKey) => {
    const req = t.http().post(`${api}/webhooks/sepay`);
    if (key !== null) req.set('Authorization', `Apikey ${key}`);
    return req.send({
      id: ++hookSeq, gateway: 'MBBank', transactionDate: '2026-10-25 10:30:00', accountNumber: '0123456789', code: null, transferType: 'in',
      accumulated: 1000000, subAccount: null, referenceCode: `FT${hookSeq}`, description: '', ...body,
    });
  };
  const checkout = (auth: { Authorization: string }, body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const fund = async () => (await t.http().get(`${api}/cash/accounts`).set(s.auth)).body.find((a: { id: string }) => a.id === bankFundId);

  it('T-260 cấu hình: bật cần ngân hàng + số TK, ngân hàng phải thuộc danh sách VietQR, quỹ phải là quỹ ngân hàng; khóa webhook chỉ hiện một lần; thu ngân không cấu hình được', async () => {
    const g = await t.http().get(`${api}/integrations/sepay`).set(s.auth);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ enabled: false, ready: false, codePrefix: 'BA', webhookPath: '/api/v1/webhooks/sepay', hasWebhookKey: false });
    expect((await t.http().put(`${api}/integrations/sepay`).set(s.auth).send({ enabled: true })).status).toBe(400);
    expect((await t.http().put(`${api}/integrations/sepay`).set(s.auth).send({ bankCode: 'NoSuchBank', accountNumber: '0123456789' })).status).toBe(400);
    const drawer = (await t.http().get(`${api}/cash/accounts`).set(s.auth)).body.find((a: { type: string }) => a.type === 'CASH');
    expect((await t.http().put(`${api}/integrations/sepay`).set(s.auth).send({ cashAccountId: drawer.id })).status).toBe(400);
    expect((await t.http().put(`${api}/integrations/sepay`).set(cashierAuth).send({ enabled: false })).status).toBe(403);
    const saved = await t.http().put(`${api}/integrations/sepay`).set(s.auth).send({ enabled: true, bankCode: 'MBBank', accountNumber: '0123456789', accountName: 'Nguyen Thi Bao An', cashAccountId: bankFundId, codePrefix: 'ba', posTtlMinutes: 10 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ enabled: true, ready: true, bankCode: 'MBBank', accountName: 'NGUYEN THI BAO AN', codePrefix: 'BA', posTtlMinutes: 10, cashAccountId: bankFundId });
    const k = await t.http().post(`${api}/integrations/sepay/key`).set(s.auth);
    expect(k.status).toBe(200);
    expect(k.body.apiKey).toMatch(/^sp_[\w-]{20,}$/);
    apiKey = k.body.apiKey;
    const after = (await t.http().get(`${api}/integrations/sepay`).set(s.auth)).body;
    expect(after).toMatchObject({ hasWebhookKey: true, webhookKeyLast4: apiKey.slice(-4) });
    expect(JSON.stringify(after)).not.toContain(apiKey);
    expect((await t.http().get(`${api}/bank-transfers/banks`).set(s.auth)).body.some((b: { shortName: string }) => b.shortName === 'MBBank')).toBe(true);
  });

  it('T-261 webhook: sai / thiếu khóa → 401; tiền ra, khác tài khoản → bỏ qua; không có mã → chưa khớp; cùng id gửi lặp → chỉ ghi một lần', async () => {
    const noKey = await hook({ transferAmount: 10000, content: 'x' }, null);
    expect(noKey.status).toBe(401);
    expect(noKey.body.success).toBe(false);
    expect((await hook({ transferAmount: 10000, content: 'x' }, 'sp_wrong-key-000000000000')).status).toBe(401);
    const out = await hook({ transferType: 'out', transferAmount: 50000, content: 'chuyen di' });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ success: true, result: 'ignored' });
    expect((await hook({ accountNumber: '9999999999', transferAmount: 50000, content: 'BA11111111' })).body.result).toBe('ignored');
    const none = await hook({ transferAmount: 70000, content: 'NGUYEN VAN A chuyen tien' });
    expect(none.body).toMatchObject({ success: true, result: 'unmatched' });
    const dupBody = { id: 777001, transferAmount: 20000, content: 'khong ma' };
    expect((await t.http().post(`${api}/webhooks/sepay`).set('Authorization', `Apikey ${apiKey}`).send(dupBody)).body.result).toBe('unmatched');
    const again = await t.http().post(`${api}/webhooks/sepay`).set('Authorization', `apikey ${apiKey}`).send(dupBody);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ success: true, result: 'duplicate' });
    const list = (await t.http().get(`${api}/bank-transfers/transactions`).set(s.auth).query({ search: 'khong ma' })).body;
    expect(list.meta.total).toBe(1);
  });

  it('T-262 POS: thu ngân tạo mã QR → chưa có tiền thì không thanh toán được → webhook về → hoàn tất hóa đơn bằng phiếu chuyển khoản vào quỹ ngân hàng; mã đã dùng không dùng lại', async () => {
    const req = await t.http().post(`${api}/bank-transfers/requests`).set(cashierAuth).send({ purpose: 'POS', branchId: s.branchId, amount: '200000' });
    expect(req.status).toBe(201);
    expect(req.body.code).toMatch(/^BA\d{8}$/);
    expect(req.body.status).toBe('PENDING');
    expect(req.body.qrUrl).toContain('https://qr.sepay.vn/img?');
    expect(req.body.qrUrl).toContain('acc=0123456789');
    expect(req.body.qrUrl).toContain('bank=MBBank');
    expect(req.body.qrUrl).toContain('amount=200000');
    expect(req.body.qrUrl).toContain(`des=${req.body.code}`);
    const early = await checkout(cashierAuth, { lines: [{ variantId, quantity: '2' }], payments: [{ method: 'BANK_TRANSFER', amount: '200000', bankRequestId: req.body.id }] });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('BANK_PAYMENT_NOT_RECEIVED');
    const before = Number((await fund()).balance);
    // ngân hàng thường viết liền / thường hóa nội dung: "ck ba-xxxxxxxx tu nguyen van a"
    const h = await hook({ transferAmount: 200000, content: `ck ${req.body.code.toLowerCase().replace('ba', 'ba-')} tu nguyen van a` });
    expect(h.body).toMatchObject({ success: true, result: 'matched', requestCode: req.body.code });
    const polled = (await t.http().get(`${api}/bank-transfers/requests/${req.body.id}`).set(cashierAuth)).body;
    expect(polled).toMatchObject({ status: 'PAID', paidAmount: '200000', available: '200000' });
    const inv = await checkout(cashierAuth, { lines: [{ variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '200000', bankRequestId: req.body.id }] });
    expect(inv.status).toBe(201);
    expect(inv.body.status).toBe('COMPLETED');
    expect(inv.body.paidAmount).toBe('200000');
    const pays = (await t.http().get(`${api}/payments`).set(s.auth).query({ search: inv.body.code })).body.data;
    const pay = pays.find((p: { method: string }) => p.method === 'BANK_TRANSFER');
    expect(pay).toBeDefined();
    expect(Number((await fund()).balance) - before).toBe(200000);
    const used = (await t.http().get(`${api}/bank-transfers/requests/${req.body.id}`).set(cashierAuth)).body;
    expect(used).toMatchObject({ usedAmount: '200000', available: '0', documentCode: inv.body.code });
    expect(used.consumedAt).toBeTruthy();
    expect(used.transactions[0].paymentId).toBeTruthy();
    const reuse = await checkout(cashierAuth, { lines: [{ variantId, quantity: '2' }], payments: [{ method: 'BANK_TRANSFER', amount: '200000', bankRequestId: req.body.id }] });
    expect(reuse.status).toBe(409);
    // khách chuyển lặp / chuyển muộn bằng mã đã dùng → không tự gắn, nằm trong danh sách chờ xử lý
    const late = await hook({ transferAmount: 200000, content: req.body.code });
    expect(late.body.result).toBe('unmatched');
    expect(late.body.note).toContain('đã dùng cho hóa đơn');
    // thu ngân đọc được trạng thái QR (không cần quyền tích hợp)
    expect((await t.http().get(`${api}/bank-transfers/status`).set(cashierAuth)).body).toMatchObject({ ready: true, bankCode: 'MBBank', accountNumber: '0123456789' });
    expect((await t.http().get(`${api}/integrations/sepay`).set(cashierAuth)).status).toBe(403);
  });

  it('T-263 POS nhận thiếu: trạng thái PARTIAL, chỉ dùng được đúng số đã nhận, phần còn lại thu tiền mặt', async () => {
    const req = (await t.http().post(`${api}/bank-transfers/requests`).set(cashierAuth).send({ purpose: 'POS', branchId: s.branchId, amount: '300000' })).body;
    expect((await hook({ transferAmount: 100000, content: `${req.code} thanh toan` })).body.result).toBe('matched');
    const polled = (await t.http().get(`${api}/bank-transfers/requests/${req.id}`).set(cashierAuth)).body;
    expect(polled).toMatchObject({ status: 'PARTIAL', paidAmount: '100000', remaining: '200000' });
    expect(polled.qrUrl).toContain('amount=200000'); // QR còn lại cho phần thiếu
    const over = await checkout(cashierAuth, { lines: [{ variantId, quantity: '3' }], payments: [{ method: 'BANK_TRANSFER', amount: '150000', bankRequestId: req.id }, { method: 'CASH', amount: '150000' }] });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('BANK_PAYMENT_INSUFFICIENT');
    const ok = await checkout(cashierAuth, { lines: [{ variantId, quantity: '3' }], payments: [{ method: 'BANK_TRANSFER', amount: '100000', bankRequestId: req.id }, { method: 'CASH', amount: '200000' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.paidAmount).toBe('300000');
  });

  it('T-264 hóa đơn còn nợ: tạo QR theo số còn nợ (tạo lại dùng lại mã cũ) → tiền về tự lập phiếu thu, hết nợ; khách chuyển thừa → ghi có cho khách', async () => {
    const debt = await checkout(s.auth, { customerId, lines: [{ variantId, quantity: '3' }], payments: [{ method: 'CASH', amount: '100000' }] });
    expect(debt.status).toBe(201);
    expect(debt.body.paidAmount).toBe('100000');
    expect((await t.http().post(`${api}/bank-transfers/requests`).set(cashierAuth).send({ purpose: 'INVOICE', documentId: debt.body.id })).status).toBe(403); // thu ngân không có payment.create
    const r1 = await t.http().post(`${api}/bank-transfers/requests`).set(s.auth).send({ purpose: 'INVOICE', documentId: debt.body.id });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ amount: '200000', documentCode: debt.body.code });
    expect((await t.http().post(`${api}/bank-transfers/requests`).set(s.auth).send({ purpose: 'INVOICE', documentId: debt.body.id })).body.code).toBe(r1.body.code);
    expect((await t.http().post(`${api}/bank-transfers/requests`).set(s.auth).send({ purpose: 'INVOICE', documentId: debt.body.id, amount: '999999' })).status).toBe(409);
    const h = await hook({ transferAmount: 200000, content: `Thanh toan ${r1.body.code}` });
    expect(h.body.result).toBe('matched');
    expect(h.body.paymentId).toBeTruthy();
    const inv = (await t.http().get(`${api}/invoices/${debt.body.id}`).set(s.auth)).body;
    expect(inv.paidAmount).toBe('300000');
    expect((await t.http().get(`${api}/customers/${customerId}`).set(s.auth)).body.balance).toBe('0');
    expect((await t.http().get(`${api}/bank-transfers/requests/${r1.body.id}`).set(s.auth)).body).toMatchObject({ status: 'PAID', usedAmount: '200000' });
    // trả thừa: hóa đơn còn 100.000, khách chuyển 150.000 → hết nợ, dư 50.000 thành tiền trả trước
    const debt2 = await checkout(s.auth, { customerId, lines: [{ variantId, quantity: '1' }], payments: [] });
    const r2 = (await t.http().post(`${api}/bank-transfers/requests`).set(s.auth).send({ purpose: 'INVOICE', documentId: debt2.body.id })).body;
    const h2 = await hook({ transferAmount: 150000, content: r2.code });
    expect(h2.body.result).toBe('matched');
    expect(h2.body.note).toContain('50000');
    expect((await t.http().get(`${api}/invoices/${debt2.body.id}`).set(s.auth)).body.paidAmount).toBe('100000');
    expect((await t.http().get(`${api}/customers/${customerId}`).set(s.auth)).body.balance).toBe('-50000');
  });

  it('T-265 đặt hàng: QR tiền cọc → tiền về cộng vào tiền cọc của đơn; hủy mã chưa có tiền → tiền về sau đó chờ xử lý tay', async () => {
    const o = await t.http().post(`${api}/orders`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, customerId, source: 'PHONE', lines: [{ variantId, quantity: '2' }] });
    expect(o.status).toBe(201);
    const r = await t.http().post(`${api}/bank-transfers/requests`).set(s.auth).send({ purpose: 'SALES_ORDER', documentId: o.body.id, amount: '80000' });
    expect(r.status).toBe(201);
    expect((await hook({ transferAmount: 80000, content: r.body.code })).body.result).toBe('matched');
    expect((await t.http().get(`${api}/orders/${o.body.id}`).set(s.auth)).body.depositAmount).toBe('80000');
    const c = (await t.http().post(`${api}/bank-transfers/requests`).set(cashierAuth).send({ purpose: 'POS', branchId: s.branchId, amount: '50000' })).body;
    const cancelled = await t.http().post(`${api}/bank-transfers/requests/${c.id}/cancel`).set(cashierAuth);
    expect(cancelled.body.status).toBe('CANCELLED');
    const late = await hook({ transferAmount: 50000, content: c.code });
    expect(late.body).toMatchObject({ result: 'unmatched' });
    expect(late.body.note).toContain('đã hủy');
    expect((await t.http().post(`${api}/bank-transfers/requests/${r.body.id}/cancel`).set(s.auth)).status).toBe(409); // đã nhận tiền
  });

  it('T-266 giao dịch chưa khớp: gắn tay vào hóa đơn khách lẻ / bỏ qua; không xử lý hai lần; gian hàng khác không thấy và không khớp được mã', async () => {
    const walkIn = await checkout(s.auth, { customerId, lines: [{ variantId, quantity: '1' }], payments: [] });
    const u1 = await hook({ transferAmount: 100000, content: 'chuyen tien hang hom qua' });
    expect(u1.body.result).toBe('unmatched');
    const list = (await t.http().get(`${api}/bank-transfers/transactions`).set(s.auth).query({ status: 'UNMATCHED' })).body;
    expect(list.unmatchedCount).toBeGreaterThanOrEqual(1);
    expect((await t.http().post(`${api}/bank-transfers/transactions/${u1.body.transactionId}/apply`).set(cashierAuth).send({ target: 'INVOICE', documentId: walkIn.body.id })).status).toBe(403);
    const applied = await t.http().post(`${api}/bank-transfers/transactions/${u1.body.transactionId}/apply`).set(s.auth).send({ target: 'INVOICE', documentId: walkIn.body.id });
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ status: 'APPLIED' });
    expect(applied.body.paymentCode).toMatch(/^PT\d{6}$/);
    expect((await t.http().get(`${api}/invoices/${walkIn.body.id}`).set(s.auth)).body.paidAmount).toBe('100000');
    expect((await t.http().post(`${api}/bank-transfers/transactions/${u1.body.transactionId}/apply`).set(s.auth).send({ target: 'INVOICE', documentId: walkIn.body.id })).body.code).toBe('TRANSACTION_HANDLED');
    const u2 = await hook({ transferAmount: 5000, content: 'test' });
    const ign = await t.http().post(`${api}/bank-transfers/transactions/${u2.body.transactionId}/ignore`).set(s.auth).send({ note: 'chuyển nhầm' });
    expect(ign.body.status).toBe('IGNORED');
    // gian hàng khác
    expect((await t.http().get(`${api}/bank-transfers/transactions`).set(other.auth)).body.meta.total).toBe(0);
    const mine = (await t.http().post(`${api}/bank-transfers/requests`).set(s.auth).send({ purpose: 'POS', branchId: s.branchId, amount: '10000' })).body;
    expect((await t.http().get(`${api}/bank-transfers/requests/${mine.id}`).set(other.auth)).status).toBe(404);
    await t.http().put(`${api}/integrations/sepay`).set(other.auth).send({ enabled: true, bankCode: 'MBBank', accountNumber: '0123456789' });
    const otherKey = (await t.http().post(`${api}/integrations/sepay/key`).set(other.auth)).body.apiKey;
    const cross = await hook({ transferAmount: 10000, content: mine.code }, otherKey);
    expect(cross.body.result).toBe('unmatched'); // mã của gian hàng A không khớp ở gian hàng B
    expect((await t.http().get(`${api}/bank-transfers/requests/${mine.id}`).set(s.auth)).body.status).toBe('PENDING');
  });

  it('T-267 bật SePay ở gian hàng chưa có quỹ ngân hàng → tự tạo quỹ ngân hàng cho đúng tài khoản (một lần); gian hàng đã có quỹ ngân hàng thì không tạo thêm', async () => {
    const fresh = await registerTenant(t);
    // chưa có tài khoản → không có QR thủ công
    expect((await t.http().get(`${api}/bank-transfers/status`).set(fresh.auth)).body).toMatchObject({ ready: false, bankCode: null, accountNumber: null });
    // có tài khoản nhưng chưa bật SePay → ready false nhưng vẫn trả tài khoản để hiện VietQR xác nhận thủ công
    await t.http().put(`${api}/integrations/sepay`).set(fresh.auth).send({ enabled: false, bankCode: 'Vietcombank', accountNumber: '1029384756', accountName: 'nguyen thi bao an' });
    expect((await t.http().get(`${api}/bank-transfers/status`).set(fresh.auth)).body).toMatchObject({ ready: false, bankCode: 'Vietcombank', accountNumber: '1029384756', accountName: 'NGUYEN THI BAO AN' });
    const banksBefore = (await t.http().get(`${api}/cash/accounts`).set(fresh.auth)).body.filter((a: { type: string }) => a.type === 'BANK');
    expect(banksBefore).toHaveLength(0);
    const saved = await t.http().put(`${api}/integrations/sepay`).set(fresh.auth).send({ enabled: true, bankCode: 'Vietcombank', accountNumber: '1029384756', accountName: 'nguyen thi bao an' });
    expect(saved.status).toBe(200);
    expect(saved.body.cashAccount).toMatchObject({ type: 'BANK', name: 'Vietcombank - 1029384756' });
    const again = await t.http().put(`${api}/integrations/sepay`).set(fresh.auth).send({ codePrefix: 'BAN' });
    expect(again.body.cashAccount.id).toBe(saved.body.cashAccount.id);
    const banks = (await t.http().get(`${api}/cash/accounts`).set(fresh.auth)).body.filter((a: { type: string }) => a.type === 'BANK');
    expect(banks).toHaveLength(1);
    expect(banks[0]).toMatchObject({ accountNumber: '1029384756', accountHolder: 'NGUYEN THI BAO AN', isDefault: true });
    // gian hàng s đã có quỹ ngân hàng (khác số TK): cấu hình không tự tạo quỹ mới
    const sBanks = (await t.http().get(`${api}/cash/accounts`).set(s.auth)).body.filter((a: { type: string }) => a.type === 'BANK').length;
    await t.http().put(`${api}/integrations/sepay`).set(s.auth).send({ enabled: true });
    expect((await t.http().get(`${api}/cash/accounts`).set(s.auth)).body.filter((a: { type: string }) => a.type === 'BANK')).toHaveLength(sBanks);
  });
});
