import { Alert, App, Button, Card, DatePicker, Empty, Select, Spin, Steps, Switch, Tag, Upload } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ArrowLeftOutlined, CheckCircleOutlined, FileExcelOutlined, InboxOutlined, ReloadOutlined, ShopOutlined, SolutionOutlined, TeamOutlined, UploadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { UploadFile } from 'antd/es/upload/interface';
import { integrationsApi, type ImportCommitResult, type ImportOptions, type ImportPreview, type ImportType } from '../../api/integrations';
import { errMsg } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses, useCan, useMe } from '../../store/auth';
import { ErrorTable, IMPORT_TYPE_LABEL, ResultTiles } from './shared';

interface TypeMeta { icon: ReactNode; hint: string; path: string }
const TYPE_META: Record<ImportType, TypeMeta> = {
  PRODUCTS: { icon: <ShopOutlined />, path: 'Hàng hóa → Danh mục → Xuất file', hint: 'Trong KiotViet vào Hàng hóa → Danh mục, bấm Xuất file. Chọn "Xuất file theo chi nhánh" nếu muốn tồn kho từng chi nhánh (file sẽ có nhiều cột "Tồn kho (<chi nhánh>)").' },
  CUSTOMERS: { icon: <TeamOutlined />, path: 'Khách hàng → Xuất file', hint: 'Trong KiotViet vào Khách hàng, bấm Xuất file. Cột "Nợ cần thu hiện tại" sẽ được đưa vào công nợ đầu kỳ.' },
  SUPPLIERS: { icon: <SolutionOutlined />, path: 'Đối tác → Nhà cung cấp → Xuất file', hint: 'Trong KiotViet vào Đối tác → Nhà cung cấp, bấm Xuất file. Cột "Nợ cần trả hiện tại" sẽ được đưa vào công nợ đầu kỳ.' },
  INVOICES: { icon: <FileExcelOutlined />, path: 'Giao dịch → Hóa đơn → Xuất file', hint: 'Trong KiotViet vào Giao dịch → Hóa đơn, chọn khoảng thời gian rồi bấm Xuất file (chọn "Xuất file chi tiết" để có dòng hàng hóa). Hãy nhập Hàng hóa và Khách hàng trước.' },
};
/** Which mapped fields a phone preview card shows. */
const CARD_FIELDS: Record<ImportType, string[]> = {
  PRODUCTS: ['code', 'name', 'category', 'sellPrice', 'stock', 'unit'],
  CUSTOMERS: ['code', 'name', 'phone', 'debt', 'groupName'],
  SUPPLIERS: ['code', 'name', 'phone', 'debt'],
  INVOICES: ['code', 'date', 'customerName', 'total', 'lineCode', 'lineQty'],
};
const TYPES = Object.keys(TYPE_META) as ImportType[];

interface Step1Options { defaultWarehouseId?: string; importStock: boolean; syncDebt: boolean; updateExisting: boolean; defaultBranchId?: string; invoicesFrom?: Dayjs | null }

export function ExcelImportTab() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const can = useCan();
  const me = useMe();
  const branchWarehouses = useBranchWarehouses();
  const currentBranchId = useAuthStore((s) => s.currentBranchId);
  const manage = can('integration.manage');

  const [step, setStep] = useState(0);
  const [type, setType] = useState<ImportType>('PRODUCTS');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [opts, setOpts] = useState<Step1Options>({ importStock: true, syncDebt: false, updateExisting: true });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [stockMap, setStockMap] = useState<Record<string, string | undefined>>({});
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);

  const warehouses = me?.warehouses ?? [];
  const branches = me?.branches ?? [];
  const defaultWarehouseId = (branchWarehouses.find((w) => w.isDefault) ?? branchWarehouses[0])?.id;
  useEffect(() => { setOpts((o) => ({ ...o, defaultWarehouseId: o.defaultWarehouseId ?? defaultWarehouseId, defaultBranchId: o.defaultBranchId ?? currentBranchId ?? branches[0]?.id })); }, [defaultWarehouseId, currentBranchId]);

  const file = fileList[0]?.originFileObj as File | undefined;
  const baseOptions = (): ImportOptions => {
    if (type === 'PRODUCTS') return { defaultWarehouseId: opts.defaultWarehouseId, importStock: opts.importStock, updateExisting: opts.updateExisting };
    if (type === 'INVOICES') return { defaultBranchId: opts.defaultBranchId, invoicesFrom: opts.invoicesFrom ? opts.invoicesFrom.startOf('day').toISOString() : undefined, updateExisting: opts.updateExisting };
    return { syncDebt: opts.syncDebt, updateExisting: opts.updateExisting };
  };

  const runPreview = async () => {
    if (!file) { message.warning('Hãy chọn file Excel (.xlsx) xuất từ KiotViet'); return; }
    setBusy('preview');
    try {
      const p = await integrationsApi.previewImport(file, type, baseOptions());
      setPreview(p);
      setMapping(p.mapping);
      const sm: Record<string, string | undefined> = {};
      for (const h of p.stockHeaders) sm[h] = guessWarehouse(h, warehouses) ?? opts.defaultWarehouseId;
      setStockMap(sm);
      setStep(1);
    } catch (e) { message.error(errMsg(e)); } finally { setBusy(null); }
  };

  const missingRequired = useMemo(() => (preview?.fields ?? []).filter((f) => f.required && !mapping[f.key]), [preview, mapping]);
  const multiStock = type === 'PRODUCTS' && (preview?.stockHeaders.length ?? 0) > 1;

  const runCommit = async () => {
    if (!preview) return;
    if (missingRequired.length) { message.warning(`Thiếu cột bắt buộc: ${missingRequired.map((f) => f.label).join(', ')}`); return; }
    const options: ImportOptions = { ...baseOptions() };
    if (multiStock && opts.importStock) options.stockColumns = Object.entries(stockMap).filter((e): e is [string, string] => !!e[1]).map(([header, warehouseId]) => ({ header, warehouseId }));
    setBusy('commit');
    try {
      const r = await integrationsApi.commitImport(preview.jobId, { mapping, options });
      setResult(r);
      setStep(2);
      ['products', 'categories', 'brands', 'customers', 'suppliers', 'invoices', 'import-jobs', 'integrations-reconcile', 'inventory', 'movements', 'debts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (r.failed) message.warning(`Đã nhập xong, ${r.failed} dòng lỗi`); else message.success('Đã nhập dữ liệu thành công');
    } catch (e) { message.error(errMsg(e)); } finally { setBusy(null); }
  };

  const reset = () => { setStep(0); setFileList([]); setPreview(null); setMapping({}); setStockMap({}); setResult(null); };

  return (
    <div className="ig-excel">
      <Steps size="small" current={step} responsive={false} labelPlacement={isMobile ? 'vertical' : 'horizontal'} className="ig-steps"
        items={[{ title: 'Chọn loại & file' }, { title: 'Kiểm tra cột' }, { title: 'Kết quả' }]} />

      {step === 0 && (
        <Spin spinning={busy === 'preview'} tip="Đang đọc file…">
          <Card size="small" title="1. Loại dữ liệu" className="ig-card">
            <div className="ig-type-grid">
              {TYPES.map((t) => (
                <button type="button" key={t} className={`ig-type${type === t ? ' on' : ''}`} onClick={() => { setType(t); setFileList([]); }}>
                  <span className="ig-type-ic">{TYPE_META[t].icon}</span>
                  <span className="ig-type-lb">{IMPORT_TYPE_LABEL[t]}</span>
                  <span className="ig-type-path">{TYPE_META[t].path}</span>
                </button>
              ))}
            </div>
            <Alert type="info" showIcon className="ig-hint" message={<span><b>Cách xuất file từ KiotViet:</b> {TYPE_META[type].hint}</span>} />
          </Card>

          <Card size="small" title="2. File Excel (.xlsx)" className="ig-card">
            <Upload.Dragger accept=".xlsx" maxCount={1} fileList={fileList} beforeUpload={() => false} onChange={({ fileList: fl }) => setFileList(fl.slice(-1))} disabled={!manage} className="ig-dragger">
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">{isMobile ? 'Chạm để chọn file' : 'Kéo thả hoặc bấm để chọn file'}</p>
              <p className="ant-upload-hint">File .xlsx xuất từ KiotViet, giữ nguyên dòng tiêu đề. Tối đa 50 MB.</p>
            </Upload.Dragger>
          </Card>

          <Card size="small" title="3. Tùy chọn" className="ig-card">
            <div className="ig-opts">
              {type === 'PRODUCTS' && (
                <>
                  <OptRow label="Kho nhận tồn kho" hint="Dùng khi file chỉ có một cột Tồn kho. Nhiều cột theo chi nhánh sẽ chọn ở bước sau.">
                    <Select value={opts.defaultWarehouseId} onChange={(v) => setOpts({ ...opts, defaultWarehouseId: v })} options={warehouses.map((w) => ({ value: w.id, label: whLabel(w.name, branches.find((b) => b.id === w.branchId)?.name) }))} placeholder="Chọn kho" style={{ width: '100%' }} />
                  </OptRow>
                  <OptRow label="Nhập tồn kho" hint="Tạo phiếu điều chỉnh đã ghi sổ đưa tồn về đúng số trong file.">
                    <Switch checked={opts.importStock} onChange={(v) => setOpts({ ...opts, importStock: v })} />
                  </OptRow>
                  <OptRow label="Cập nhật hàng đã có" hint="Tắt: chỉ thêm hàng chưa có, giữ nguyên hàng trùng mã.">
                    <Switch checked={opts.updateExisting} onChange={(v) => setOpts({ ...opts, updateExisting: v })} />
                  </OptRow>
                </>
              )}
              {(type === 'CUSTOMERS' || type === 'SUPPLIERS') && (
                <>
                  <OptRow label="Đồng bộ công nợ về đúng số trong file" hint="Lần đầu luôn ghi nợ đầu kỳ. Bật để điều chỉnh cả công nợ của bản ghi đã có.">
                    <Switch checked={opts.syncDebt} onChange={(v) => setOpts({ ...opts, syncDebt: v })} />
                  </OptRow>
                  <OptRow label="Cập nhật bản ghi đã có" hint="Khớp theo mã, không có mã thì khớp số điện thoại.">
                    <Switch checked={opts.updateExisting} onChange={(v) => setOpts({ ...opts, updateExisting: v })} />
                  </OptRow>
                </>
              )}
              {type === 'INVOICES' && (
                <>
                  <OptRow label="Chi nhánh mặc định" hint="Dùng khi file không có cột Chi nhánh hoặc tên không khớp.">
                    <Select value={opts.defaultBranchId} onChange={(v) => setOpts({ ...opts, defaultBranchId: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="Chọn chi nhánh" style={{ width: '100%' }} />
                  </OptRow>
                  <OptRow label="Bỏ qua hóa đơn trước ngày" hint="Để trống để nhập toàn bộ.">
                    <DatePicker value={opts.invoicesFrom ?? null} onChange={(v) => setOpts({ ...opts, invoicesFrom: v })} format="DD/MM/YYYY" style={{ width: '100%' }} placeholder="Không giới hạn" allowClear />
                  </OptRow>
                </>
              )}
            </div>
          </Card>

          <div className="ig-actions">
            <Button type="primary" size="large" icon={<UploadOutlined />} disabled={!file || !manage} loading={busy === 'preview'} onClick={runPreview}>Đọc file & kiểm tra cột</Button>
            {!manage && <span className="kv-hint">Bạn chỉ có quyền xem; cần quyền "integration.manage" để nhập dữ liệu.</span>}
          </div>
        </Spin>
      )}

      {step === 1 && preview && (
        <Spin spinning={busy === 'commit'} tip="Đang nhập dữ liệu… vui lòng không đóng trang">
          <Card size="small" className="ig-card" title={<span><FileExcelOutlined /> {preview.fileName ?? 'File'}</span>} extra={<Tag color="blue">{IMPORT_TYPE_LABEL[preview.type]}</Tag>}>
            <div className="ig-summary">
              <span><b>{preview.rowCount}</b> dòng dữ liệu</span>
              <span><b>{preview.headers.length}</b> cột trong file</span>
              <span><b>{Object.keys(mapping).length}</b> cột đã nhận diện</span>
              {preview.unmapped.length > 0 && <span className="muted"><b>{preview.unmapped.length}</b> cột chưa dùng</span>}
            </div>
            {missingRequired.length > 0
              ? <Alert type="error" showIcon message={`Chưa nhận diện được cột bắt buộc: ${missingRequired.map((f) => f.label).join(', ')}`} description="Chọn cột tương ứng trong file ở bảng bên dưới rồi mới bắt đầu nhập." />
              : <Alert type="success" showIcon message="Đã nhận diện đủ cột bắt buộc. Kiểm tra lại ánh xạ và dữ liệu mẫu rồi bấm Bắt đầu nhập." />}
          </Card>

          <Card size="small" title="Ánh xạ cột" className="ig-card" extra={<span className="kv-hint">Cột hệ thống ← cột trong file</span>}>
            <div className="ig-map">
              {preview.fields.map((f) => {
                const header = mapping[f.key];
                const sampleVal = header ? preview.sample[0]?.[header] : undefined;
                const missing = f.required && !header;
                return (
                  <div key={f.key} className={`ig-map-row${missing ? ' missing' : ''}`}>
                    <div className="ig-map-label">{f.label}{f.required && <span className="req"> *</span>}{missing && <Tag color="red" className="ig-map-tag">thiếu</Tag>}</div>
                    <Select className="ig-map-select" value={header} allowClear showSearch placeholder={f.required ? 'Chọn cột trong file' : 'Không nhập'} status={missing ? 'error' : undefined}
                      onChange={(v) => setMapping((m) => { const n = { ...m }; if (v) n[f.key] = v; else delete n[f.key]; return n; })}
                      options={preview.headers.map((h) => ({ value: h, label: h }))} disabled={!manage} />
                    <div className="ig-map-sample">{sampleVal ? <span title={sampleVal}>vd: {sampleVal}</span> : isMobile ? null : <span className="muted">—</span>}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {multiStock && (
            <Card size="small" title="Cột tồn kho → Kho nhận" className="ig-card" extra={<Switch size="small" checked={opts.importStock} onChange={(v) => setOpts({ ...opts, importStock: v })} checkedChildren="Nhập tồn" unCheckedChildren="Bỏ qua" />}>
              <div className="kv-hint" style={{ marginBottom: 8 }}>File có {preview.stockHeaders.length} cột tồn kho theo chi nhánh. Chọn kho nhận cho từng cột; để trống để bỏ qua cột đó.</div>
              <div className="ig-map">
                {preview.stockHeaders.map((h) => (
                  <div key={h} className="ig-map-row">
                    <div className="ig-map-label">{h}</div>
                    <Select className="ig-map-select" value={stockMap[h]} allowClear placeholder="Không nhập cột này" disabled={!opts.importStock || !manage} onChange={(v) => setStockMap((s) => ({ ...s, [h]: v }))}
                      options={warehouses.map((w) => ({ value: w.id, label: whLabel(w.name, branches.find((b) => b.id === w.branchId)?.name) }))} />
                    <div className="ig-map-sample">{preview.sample[0]?.[h] ? <span>vd: {preview.sample[0][h]}</span> : <span className="muted">—</span>}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {type === 'PRODUCTS' && !multiStock && preview.stockHeaders.length === 1 && opts.importStock && (
            <Alert type="info" showIcon className="ig-hint" message={<span>Cột <b>{preview.stockHeaders[0]}</b> sẽ được nhập vào kho <b>{whLabel(warehouses.find((w) => w.id === opts.defaultWarehouseId)?.name ?? '—', branches.find((b) => b.id === warehouses.find((w) => w.id === opts.defaultWarehouseId)?.branchId)?.name)}</b>.</span>} />
          )}

          <Card size="small" title={`Dữ liệu mẫu (${Math.min(10, preview.sample.length)} dòng đầu)`} className="ig-card">
            <SamplePreview preview={preview} mapping={mapping} isMobile={isMobile} />
          </Card>

          {preview.issues.length > 0 && (
            <Card size="small" className="ig-card">
              <ErrorTable errors={preview.issues} title={`Cảnh báo dữ liệu (${preview.issues.length}${preview.issues.length >= 50 ? '+' : ''}) — các dòng này có thể bị bỏ qua`} fileName="canh-bao-du-lieu.csv" />
            </Card>
          )}

          <div className="ig-actions ig-actions-split">
            <Button size="large" icon={<ArrowLeftOutlined />} onClick={() => { setStep(0); setPreview(null); }}>Quay lại</Button>
            <Button type="primary" size="large" icon={<CheckCircleOutlined />} disabled={missingRequired.length > 0 || !manage} loading={busy === 'commit'} onClick={runCommit}>Bắt đầu nhập</Button>
          </div>
        </Spin>
      )}

      {step === 2 && result && (
        <>
          <Card size="small" className="ig-card" title={<span><CheckCircleOutlined style={{ color: result.failed ? '#f59e0b' : '#15803d' }} /> Kết quả nhập {IMPORT_TYPE_LABEL[result.type]}</span>}>
            <ResultTiles totals={result} type={result.type} />
            {result.failed > 0 && <Alert type="warning" showIcon style={{ marginTop: 8 }} message={`${result.failed} dòng không nhập được. Sửa lại trong file rồi nhập lại — các dòng đã nhập sẽ được cập nhật, không tạo trùng.`} />}
            {result.failed === 0 && <Alert type="success" showIcon style={{ marginTop: 8 }} message="Tất cả các dòng đã được nhập. Bạn có thể nhập lại cùng file bất kỳ lúc nào, hệ thống sẽ cập nhật theo mã." />}
          </Card>
          {result.errors.length > 0 && <Card size="small" className="ig-card"><ErrorTable errors={result.errors} fileName={`loi-${result.type.toLowerCase()}.csv`} /></Card>}
          <div className="ig-actions ig-actions-split">
            <Button size="large" icon={<ReloadOutlined />} onClick={reset}>Nhập file khác</Button>
            <Link to="/integrations/reconcile"><Button type="primary" size="large" block>Đối soát số liệu</Button></Link>
          </div>
        </>
      )}
    </div>
  );
}

function OptRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="ig-opt">
      <div className="ig-opt-text"><div className="ig-opt-label">{label}</div>{hint && <div className="kv-hint">{hint}</div>}</div>
      <div className="ig-opt-ctl">{children}</div>
    </div>
  );
}

const whLabel = (name: string, branch?: string) => (branch ? `${name} (${branch})` : name);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** "Tồn kho (Chi nhánh trung tâm)" → warehouse whose name / branch name appears in the header. */
function guessWarehouse(header: string, warehouses: Array<{ id: string; name: string; branchName?: string; branch?: { name: string } }>): string | undefined {
  const h = norm(header);
  const hit = warehouses.find((w) => h.includes(norm(w.name))) ?? warehouses.find((w) => { const bn = w.branchName ?? w.branch?.name; return bn && h.includes(norm(bn)); });
  return hit?.id;
}

function SamplePreview({ preview, mapping, isMobile }: { preview: ImportPreview; mapping: Record<string, string>; isMobile: boolean }) {
  const mapped = preview.fields.filter((f) => mapping[f.key]);
  if (!preview.sample.length) return <Empty description="File không có dòng dữ liệu" />;
  if (!mapped.length) return <Empty description="Chưa ánh xạ cột nào" />;
  if (isMobile) {
    const keys = CARD_FIELDS[preview.type].filter((k) => mapping[k]);
    const show = (keys.length ? mapped.filter((f) => keys.includes(f.key)) : mapped).slice(0, 6);
    return (
      <div className="ig-sample-cards">
        {preview.sample.map((r) => (
          <div key={r.__row} className="ig-sample-card">
            <div className="ig-sample-row">Dòng {r.__row}</div>
            {show.map((f) => <div key={f.key} className="ig-sample-kv"><span className="k">{f.label}</span><span className="v">{r[mapping[f.key]] || <span className="muted">—</span>}</span></div>)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <Table size="small" rowKey="__row" pagination={false} dataSource={preview.sample} scroll={{ x: Math.max(600, 150 * (mapped.length + 1)) }}
      columns={[{ title: 'Dòng', dataIndex: '__row', width: 70, fixed: 'left', className: 'num' }, ...mapped.map((f) => ({ title: <span>{f.label}<div className="kv-hint" style={{ fontWeight: 400 }}>{mapping[f.key]}</div></span>, key: f.key, width: 150, ellipsis: true, render: (_: unknown, r: Record<string, string>) => r[mapping[f.key]] || <span className="muted">—</span> }))]} />
  );
}
