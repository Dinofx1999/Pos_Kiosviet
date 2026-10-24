import { Alert, App, Button, Card, Checkbox, DatePicker, Descriptions, Form, Input, Select, Skeleton, Spin, Switch, Tag } from 'antd';
import { ApiOutlined, CloudDownloadOutlined, DeleteOutlined, LinkOutlined, SaveOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { integrationsApi, type ImportType, type KiotVietImportResult, type KiotVietStatus, type KiotVietTestResult, useKiotViet } from '../../api/integrations';
import { errMsg, normalizeError } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses, useCan, useMe } from '../../store/auth';
import { dt } from '../../utils/format';
import { ReconcileTiles } from './ReconcileTab';
import { ErrorTable, IMPORT_TYPE_LABEL, IMPORT_TYPE_OPTIONS, ResultTiles } from './shared';

const STATUS_LABEL: Record<KiotVietStatus, string> = { DISCONNECTED: 'Chưa kết nối', CONFIGURED: 'Đã lưu, chưa kiểm tra', CONNECTED: 'Đã kết nối', ERROR: 'Lỗi kết nối' };
const STATUS_COLOR: Record<KiotVietStatus, string> = { DISCONNECTED: 'default', CONFIGURED: 'gold', CONNECTED: 'green', ERROR: 'red' };
const ALL_ENTITIES: ImportType[] = ['PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'INVOICES'];

export function KiotVietTab() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const can = useCan();
  const manage = can('integration.manage');
  const me = useMe();
  const branchWarehouses = useBranchWarehouses();
  const currentBranchId = useAuthStore((s) => s.currentBranchId);
  const warehouses = me?.warehouses ?? [];
  const branches = me?.branches ?? [];
  const whOptions = warehouses.map((w) => ({ value: w.id, label: `${w.name}${branches.find((b) => b.id === w.branchId)?.name ? ` (${branches.find((b) => b.id === w.branchId)?.name})` : ''}` }));

  const { data: conn, isLoading } = useKiotViet();
  const [form] = Form.useForm<{ retailer: string; clientId: string; clientSecret?: string }>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<KiotVietTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [branchMap, setBranchMap] = useState<Record<string, string | undefined>>({});
  const [savingMap, setSavingMap] = useState(false);

  useEffect(() => { if (conn) { form.setFieldsValue({ retailer: conn.retailer ?? '' }); setBranchMap((m) => (Object.keys(m).length ? m : { ...conn.branchMap })); } }, [conn]);

  const connected = !!conn && conn.status !== 'DISCONNECTED';
  const refreshConn = () => qc.invalidateQueries({ queryKey: ['kiotviet-connection'] });

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await integrationsApi.saveKiotViet({ retailer: v.retailer.trim(), clientId: v.clientId.trim(), clientSecret: v.clientSecret?.trim() || undefined });
      form.setFieldsValue({ clientSecret: '' });
      message.success('Đã lưu thông tin kết nối. Bấm "Kiểm tra kết nối" để xác nhận.');
      refreshConn();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  const runTest = async () => {
    setTesting(true); setTest(null); setTestError(null);
    try {
      const r = await integrationsApi.testKiotViet();
      setTest(r);
      // pre-fill the branch → warehouse map: saved map, then a name match, then the current branch's default warehouse
      setBranchMap((m) => {
        const next = { ...m };
        for (const b of r.branches) if (!next[b.name]) next[b.name] = guessWarehouse(b.name, r.warehouses) ?? (branchWarehouses.find((w) => w.isDefault) ?? branchWarehouses[0])?.id;
        return next;
      });
      message.success(`Kết nối thành công: ${r.branches.length} chi nhánh KiotViet`);
    } catch (e) {
      const err = normalizeError(e);
      setTestError(err.code && err.code !== 'ERROR' ? `${err.message} (${err.code})` : err.message);
    } finally { setTesting(false); refreshConn(); }
  };

  const saveBranchMap = async () => {
    const v = form.getFieldsValue();
    const clientId = (v.clientId ?? '').trim();
    if (!v.retailer?.trim() || clientId.length < 8) { message.warning('Nhập lại Retailer và Client ID ở phần trên để lưu ánh xạ chi nhánh (Client ID không được hiển thị lại sau khi lưu).'); form.validateFields(['retailer', 'clientId']).catch(() => undefined); return; }
    setSavingMap(true);
    try {
      await integrationsApi.saveKiotViet({ retailer: v.retailer.trim(), clientId, clientSecret: v.clientSecret?.trim() || undefined, branchMap: cleanMap(branchMap) });
      message.success('Đã lưu ánh xạ chi nhánh → kho'); refreshConn();
    } catch (e) { message.error(errMsg(e)); } finally { setSavingMap(false); }
  };

  const remove = () => modal.confirm({
    title: 'Xóa kết nối KiotViet?', okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
    content: 'Retailer, Client ID, Client Secret và ánh xạ chi nhánh sẽ bị xóa khỏi hệ thống. Dữ liệu đã nhập vẫn được giữ nguyên.',
    onOk: async () => { try { await integrationsApi.removeKiotViet(); setTest(null); setTestError(null); setBranchMap({}); form.resetFields(); message.success('Đã xóa kết nối'); refreshConn(); } catch (e) { message.error(errMsg(e)); throw e; } },
  });

  // ---------------------------------------------------------------- import from KiotViet
  const [entities, setEntities] = useState<ImportType[]>(ALL_ENTITIES);
  const [impOpts, setImpOpts] = useState<{ syncDebt: boolean; updateExisting: boolean; importStock: boolean; defaultWarehouseId?: string; defaultBranchId?: string; range: [Dayjs | null, Dayjs | null] | null }>({ syncDebt: true, updateExisting: true, importStock: true, range: null });
  useEffect(() => { setImpOpts((o) => ({ ...o, defaultWarehouseId: o.defaultWarehouseId ?? (branchWarehouses.find((w) => w.isDefault) ?? branchWarehouses[0])?.id, defaultBranchId: o.defaultBranchId ?? currentBranchId ?? undefined })); }, [branchWarehouses.length, currentBranchId]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [impResult, setImpResult] = useState<KiotVietImportResult | null>(null);
  const [impError, setImpError] = useState<string | null>(null);
  useEffect(() => { if (!running) return; setElapsed(0); const t = setInterval(() => setElapsed((s) => s + 1), 1000); return () => clearInterval(t); }, [running]);

  const runImport = () => {
    if (!entities.length) { message.warning('Chọn ít nhất một loại dữ liệu'); return; }
    const names = ALL_ENTITIES.filter((e) => entities.includes(e)).map((e) => IMPORT_TYPE_LABEL[e]).join(', ');
    modal.confirm({
      title: 'Bắt đầu nhập từ KiotViet?', okText: 'Bắt đầu nhập', cancelText: 'Bỏ qua', width: 520,
      content: (
        <div className="ig-confirm">
          <p>Hệ thống sẽ kết nối KiotViet bằng thông tin đã lưu và kéo về: <b>{names}</b>.</p>
          <ul>
            <li>Bản ghi khớp mã sẽ được <b>{impOpts.updateExisting ? 'cập nhật' : 'giữ nguyên (chỉ thêm mới)'}</b>; không tạo trùng.</li>
            {entities.includes('PRODUCTS') && <li>Tồn kho theo chi nhánh KiotViet {impOpts.importStock ? <>được đưa về đúng số bằng phiếu điều chỉnh vào các kho đã ánh xạ{impOpts.defaultWarehouseId ? ', chi nhánh chưa ánh xạ dùng kho mặc định' : ''}</> : <b>không được nhập</b>}.</li>}
            {(entities.includes('CUSTOMERS') || entities.includes('SUPPLIERS')) && <li>Công nợ: lần đầu ghi đầu kỳ{impOpts.syncDebt ? ', bản ghi đã có được điều chỉnh về đúng số KiotViet' : ', bản ghi đã có giữ nguyên công nợ'}.</li>}
            {entities.includes('INVOICES') && <li>Hóa đơn lịch sử (mã KV-…) {impOpts.range?.[0] || impOpts.range?.[1] ? <>từ {impOpts.range?.[0]?.format('DD/MM/YYYY') ?? '…'} đến {impOpts.range?.[1]?.format('DD/MM/YYYY') ?? '…'}</> : 'toàn bộ'} — chỉ để báo cáo, không sinh bút toán kho / công nợ / quỹ.</li>}
            <li>Với cửa hàng lớn quá trình có thể mất <b>vài phút</b>. Đừng đóng trang cho đến khi có kết quả.</li>
          </ul>
        </div>
      ),
      onOk: async () => {
        setRunning(true); setImpResult(null); setImpError(null);
        try {
          const r = await integrationsApi.importKiotViet({
            entities: ALL_ENTITIES.filter((e) => entities.includes(e)), branchMap: cleanMap(branchMap), defaultWarehouseId: impOpts.defaultWarehouseId, defaultBranchId: impOpts.defaultBranchId,
            syncDebt: impOpts.syncDebt, updateExisting: impOpts.updateExisting, importStock: impOpts.importStock,
            invoicesFrom: impOpts.range?.[0]?.startOf('day').toISOString(), invoicesTo: impOpts.range?.[1]?.endOf('day').toISOString(),
          });
          setImpResult(r);
          ['products', 'categories', 'brands', 'customers', 'suppliers', 'invoices', 'import-jobs', 'integrations-reconcile', 'inventory', 'movements', 'debts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
          message.success('Đã nhập dữ liệu từ KiotViet');
        } catch (e) {
          const err = normalizeError(e);
          setImpError(err.code && err.code !== 'ERROR' ? `${err.message} (${err.code})` : err.message);
        } finally { setRunning(false); refreshConn(); }
      },
    });
  };

  const unmappedBranches = useMemo(() => (test?.branches ?? []).filter((b) => !branchMap[b.name]), [test, branchMap]);

  if (isLoading || !conn) return <Skeleton active paragraph={{ rows: 6 }} />;
  return (
    <div className="ig-kv">
      <Card size="small" className="ig-card" title={<span><LinkOutlined /> Lấy thông tin kết nối ở đâu?</span>}>
        <ol className="ig-steps-list">
          <li>Đăng nhập KiotViet trên máy tính, vào <b>Thiết lập → Thiết lập cửa hàng → Kết nối API</b> (gói Chuyên nghiệp trở lên).</li>
          <li>Bấm <b>Tạo ứng dụng</b>, đặt tên bất kỳ; KiotViet hiển thị <b>Client ID</b> và <b>Client Secret</b>.</li>
          <li><b>Retailer</b> là tên gian hàng — phần đầu địa chỉ đăng nhập <code>&lt;retailer&gt;.kiotviet.vn</code>.</li>
          <li>Nhập cả ba vào ô bên dưới. Client Secret được <b>mã hóa khi lưu và không hiển thị lại</b>; muốn đổi chỉ cần nhập giá trị mới.</li>
        </ol>
      </Card>

      <Card size="small" className="ig-card" title={<span><ApiOutlined /> Kết nối KiotViet</span>} extra={<Tag color={STATUS_COLOR[conn.status]}>{STATUS_LABEL[conn.status] ?? conn.status}</Tag>}>
        {connected && (
          <Descriptions size="small" column={isMobile ? 1 : 3} className="ig-desc" style={{ marginBottom: 10 }}>
            <Descriptions.Item label="Retailer">{conn.retailer ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Client ID">{conn.clientId ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Client Secret">{conn.hasSecret ? <Tag color="green">Đã lưu</Tag> : <Tag color="red">Chưa có</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Kiểm tra lần cuối">{conn.lastTestAt ? dt(conn.lastTestAt) : '—'}</Descriptions.Item>
            <Descriptions.Item label="Nhập lần cuối">{conn.lastSyncAt ? dt(conn.lastSyncAt) : '—'}</Descriptions.Item>
            <Descriptions.Item label="Chi nhánh đã ánh xạ">{Object.keys(conn.branchMap ?? {}).length}</Descriptions.Item>
          </Descriptions>
        )}
        {conn.lastError && <Alert type="error" showIcon style={{ marginBottom: 10 }} message="Lỗi lần gần nhất" description={conn.lastError} />}
        <Form form={form} layout="vertical" className="ig-form" disabled={!manage} autoComplete="off">
          <div className="ig-form-grid">
            <Form.Item name="retailer" label="Retailer (tên gian hàng)" rules={[{ required: true, whitespace: true, message: 'Nhập tên gian hàng' }, { max: 100 }]}><Input placeholder="vd: tenmyphamcuaban" autoCapitalize="none" /></Form.Item>
            <Form.Item name="clientId" label="Client ID" rules={[{ required: true, whitespace: true, message: 'Nhập Client ID' }, { min: 8, message: 'Client ID tối thiểu 8 ký tự' }]} extra={connected && conn.clientId ? `Đã lưu (${conn.clientId}). Nhập lại khi muốn lưu thay đổi.` : undefined}><Input placeholder="Client ID từ KiotViet" autoCapitalize="none" /></Form.Item>
            <Form.Item name="clientSecret" label="Client Secret" rules={[{ required: !conn.hasSecret, message: 'Nhập Client Secret' }, { min: 8, message: 'Client Secret tối thiểu 8 ký tự' }]} extra={conn.hasSecret ? 'Đã lưu, nhập để thay đổi.' : 'Chỉ nhập một lần; được mã hóa khi lưu.'}><Input.Password placeholder={conn.hasSecret ? '••••••••' : 'Client Secret từ KiotViet'} autoComplete="new-password" /></Form.Item>
          </div>
        </Form>
        <div className="ig-actions ig-actions-wrap">
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!manage} onClick={save}>Lưu</Button>
          <Button icon={<ApiOutlined />} loading={testing} disabled={!manage || !connected || !conn.hasSecret} onClick={runTest}>Kiểm tra kết nối</Button>
          {connected && <Button danger icon={<DeleteOutlined />} disabled={!manage} onClick={remove}>Xóa kết nối</Button>}
        </div>
        {testError && <Alert type="error" showIcon style={{ marginTop: 10 }} message="Không kết nối được KiotViet" description={<span>{testError}<br /><span className="kv-hint">Kiểm tra lại Retailer, Client ID / Secret trong KiotViet (Thiết lập → Kết nối API) và chắc chắn ứng dụng đang bật.</span></span>} />}
        {test && (
          <div className="ig-branchmap">
            <Alert type="success" showIcon style={{ margin: '10px 0' }} message={`Kết nối thành công — ${test.branches.length} chi nhánh KiotViet`} description="Chọn kho của hệ thống sẽ nhận tồn kho (và chi nhánh nhận hóa đơn) cho từng chi nhánh KiotViet." />
            <div className="ig-map">
              {test.branches.map((b) => (
                <div key={b.id} className={`ig-map-row${branchMap[b.name] ? '' : ' missing'}`}>
                  <div className="ig-map-label">{b.name}{b.address && <div className="kv-hint">{b.address}</div>}</div>
                  <Select className="ig-map-select" value={branchMap[b.name]} allowClear placeholder="Dùng kho mặc định" disabled={!manage} onChange={(v) => setBranchMap((m) => ({ ...m, [b.name]: v }))}
                    options={test.warehouses.map((w) => ({ value: w.id, label: `${w.name} (${w.branch})` }))} />
                  <div className="ig-map-sample" />
                </div>
              ))}
            </div>
            {unmappedBranches.length > 0 && <div className="kv-hint" style={{ marginTop: 6 }}>Chi nhánh chưa ánh xạ sẽ nhận tồn vào "Kho mặc định" chọn ở phần nhập dữ liệu bên dưới.</div>}
            <div className="ig-actions"><Button icon={<SaveOutlined />} loading={savingMap} disabled={!manage} onClick={saveBranchMap}>Lưu ánh xạ chi nhánh</Button></div>
          </div>
        )}
      </Card>

      <Card size="small" className="ig-card" title={<span><CloudDownloadOutlined /> Nhập dữ liệu từ KiotViet</span>}>
        {!connected && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Lưu thông tin kết nối và kiểm tra kết nối trước khi nhập dữ liệu." />}
        {running ? (
          <div className="ig-running">
            <Spin size="large" />
            <div className="ig-running-title">Đang kéo dữ liệu từ KiotViet…</div>
            <div className="kv-hint">Đã chạy {Math.floor(elapsed / 60)} phút {elapsed % 60} giây. Với cửa hàng lớn có thể mất vài phút — đừng đóng trang này.</div>
            <div className="kv-hint">Thứ tự: Hàng hóa → Khách hàng → Nhà cung cấp → Hóa đơn.</div>
          </div>
        ) : (
          <>
            <div className="ig-opt">
              <div className="ig-opt-text"><div className="ig-opt-label">Loại dữ liệu</div><div className="kv-hint">Nên nhập Hàng hóa và Khách hàng trước Hóa đơn.</div></div>
              <div className="ig-opt-ctl"><Checkbox.Group className="ig-entities" value={entities} onChange={(v) => setEntities(v as ImportType[])} options={IMPORT_TYPE_OPTIONS} disabled={!manage} /></div>
            </div>
            {entities.includes('PRODUCTS') && (
              <>
                <div className="ig-opt">
                  <div className="ig-opt-text"><div className="ig-opt-label">Kho mặc định</div><div className="kv-hint">Nhận tồn của chi nhánh KiotViet chưa được ánh xạ.</div></div>
                  <div className="ig-opt-ctl"><Select value={impOpts.defaultWarehouseId} onChange={(v) => setImpOpts({ ...impOpts, defaultWarehouseId: v })} options={whOptions} style={{ width: '100%' }} placeholder="Chọn kho" disabled={!manage} /></div>
                </div>
                <div className="ig-opt">
                  <div className="ig-opt-text"><div className="ig-opt-label">Nhập tồn kho</div><div className="kv-hint">Đưa tồn từng chi nhánh về đúng số bằng phiếu điều chỉnh.</div></div>
                  <div className="ig-opt-ctl"><Switch checked={impOpts.importStock} onChange={(v) => setImpOpts({ ...impOpts, importStock: v })} disabled={!manage} /></div>
                </div>
              </>
            )}
            {(entities.includes('CUSTOMERS') || entities.includes('SUPPLIERS')) && (
              <div className="ig-opt">
                <div className="ig-opt-text"><div className="ig-opt-label">Đồng bộ công nợ về đúng số KiotViet</div><div className="kv-hint">Bản ghi đã có được điều chỉnh công nợ; lần đầu luôn ghi đầu kỳ.</div></div>
                <div className="ig-opt-ctl"><Switch checked={impOpts.syncDebt} onChange={(v) => setImpOpts({ ...impOpts, syncDebt: v })} disabled={!manage} /></div>
              </div>
            )}
            <div className="ig-opt">
              <div className="ig-opt-text"><div className="ig-opt-label">Cập nhật bản ghi đã có</div><div className="kv-hint">Tắt: chỉ thêm mới, giữ nguyên bản ghi trùng mã.</div></div>
              <div className="ig-opt-ctl"><Switch checked={impOpts.updateExisting} onChange={(v) => setImpOpts({ ...impOpts, updateExisting: v })} disabled={!manage} /></div>
            </div>
            {entities.includes('INVOICES') && (
              <>
                <div className="ig-opt">
                  <div className="ig-opt-text"><div className="ig-opt-label">Khoảng ngày hóa đơn</div><div className="kv-hint">Để trống để lấy toàn bộ lịch sử (có thể rất lâu).</div></div>
                  <div className="ig-opt-ctl"><DatePicker.RangePicker value={impOpts.range} onChange={(v) => setImpOpts({ ...impOpts, range: v as [Dayjs | null, Dayjs | null] | null })} format="DD/MM/YYYY" style={{ width: '100%' }} allowEmpty={[true, true]} placeholder={['Từ ngày', 'Đến ngày']} disabled={!manage} /></div>
                </div>
                <div className="ig-opt">
                  <div className="ig-opt-text"><div className="ig-opt-label">Chi nhánh mặc định cho hóa đơn</div><div className="kv-hint">Dùng khi chi nhánh KiotViet chưa ánh xạ.</div></div>
                  <div className="ig-opt-ctl"><Select value={impOpts.defaultBranchId} onChange={(v) => setImpOpts({ ...impOpts, defaultBranchId: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: '100%' }} placeholder="Chọn chi nhánh" disabled={!manage} /></div>
                </div>
              </>
            )}
            <div className="ig-actions">
              <Button type="primary" size="large" block={isMobile} icon={<CloudDownloadOutlined />} disabled={!manage || !connected || !conn.hasSecret || !entities.length} onClick={runImport}>Bắt đầu nhập từ KiotViet</Button>
            </div>
          </>
        )}
        {impError && <Alert type="error" showIcon style={{ marginTop: 10 }} message="Nhập từ KiotViet thất bại" description={<span>{impError}<br /><span className="kv-hint">Các loại dữ liệu đã nhập xong trước khi lỗi vẫn được giữ; xem tab Lịch sử nhập. Sửa lỗi rồi chạy lại — không tạo trùng.</span></span>} />}
      </Card>

      {impResult && (
        <>
          <div className="ig-results">
            {impResult.results.map((r) => (
              <Card key={r.entity} size="small" className="ig-card" title={`Kết quả: ${IMPORT_TYPE_LABEL[r.entity] ?? r.entity}`} extra={<Tag color={r.totals.failed ? 'orange' : 'green'}>{r.totals.failed ? `${r.totals.failed} lỗi` : 'OK'}</Tag>}>
                <ResultTiles totals={r.totals} type={r.entity} />
                <ErrorTable errors={r.errors ?? []} fileName={`loi-kiotviet-${r.entity.toLowerCase()}.csv`} />
              </Card>
            ))}
          </div>
          <h3 className="ig-h3">Đối soát sau khi nhập</h3>
          <ReconcileTiles data={impResult.reconcile} />
        </>
      )}
    </div>
  );
}

const cleanMap = (m: Record<string, string | undefined>): Record<string, string> => Object.fromEntries(Object.entries(m).filter((e): e is [string, string] => !!e[1]));
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** KiotViet branch name → our warehouse whose name or branch name matches. */
function guessWarehouse(branchName: string, warehouses: KiotVietTestResult['warehouses']): string | undefined {
  const n = norm(branchName);
  return (warehouses.find((w) => norm(w.branch) === n) ?? warehouses.find((w) => norm(w.name) === n) ?? warehouses.find((w) => n.includes(norm(w.branch)) || norm(w.branch).includes(n)))?.id;
}
