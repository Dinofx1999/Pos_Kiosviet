/**
 * Bảng tự thích ứng: máy tính dùng nguyên Table của antd; điện thoại (≤ 767px) hiển thị mỗi dòng thành một thẻ.
 * Thay thế trực tiếp `Table` của antd (cùng props, cùng `Table.Summary`), nên các màn danh sách chỉ cần đổi import.
 *
 * Thẻ được dựng từ chính `columns` (dùng lại `render` của từng cột):
 *   - cột đầu tiên = tiêu đề thẻ; cột không có tiêu đề (nút thao tác) = hàng nút cuối thẻ;
 *   - các cột còn lại = lưới "nhãn / giá trị" hai cột, giá trị rỗng được ẩn.
 * Có thể chỉnh từng cột bằng `mobile`: 'title' | 'subtitle' | 'right' | 'badge' | 'image' | 'full' | 'actions' | 'hide'.
 * Dòng mở rộng (`expandable`) mở ngay trong thẻ khi chạm; `onRow().onClick` vẫn chạy; phân trang giữ nguyên hành vi.
 */
import { Empty, Pagination, Spin, Table } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnGroupType, ColumnType, ColumnsType } from 'antd/es/table';
import type { AnyObject } from 'antd/es/_util/type';
import { DownOutlined } from '@ant-design/icons';
import { isValidElement, useEffect, useMemo, useState, type Key, type MouseEvent, type ReactNode } from 'react';
import { useIsMobile } from '../hooks/useMedia';
import './ResponsiveTable.css';

export type MobileSlot = 'title' | 'subtitle' | 'right' | 'badge' | 'image' | 'full' | 'field' | 'actions' | 'hide';

declare module 'antd/es/table/interface' {
  interface ColumnType<RecordType = AnyObject> {
    /** Vị trí của cột trong thẻ trên điện thoại (xem ResponsiveTable). */
    mobile?: MobileSlot;
    /** Cách hiển thị riêng trên điện thoại (thay `render`); trả null để ẩn. */
    mobileRender?: (value: any, record: RecordType, index: number) => ReactNode;
  }
}

type Leaf<T> = ColumnType<T> & { label: ReactNode };

const textOf = (title: unknown): ReactNode => (typeof title === 'function' ? null : (title as ReactNode));

function flatten<T>(cols: ColumnsType<T>, prefix?: ReactNode): Leaf<T>[] {
  const out: Leaf<T>[] = [];
  for (const c of cols) {
    if (!c || (c as { hidden?: boolean }).hidden) continue;
    const label = textOf(c.title);
    const children = (c as ColumnGroupType<T>).children;
    if (children?.length) out.push(...flatten(children, label));
    else out.push({ ...(c as ColumnType<T>), label: prefix && label ? <>{prefix} · {label}</> : label });
  }
  return out;
}

const plain = (n: ReactNode) => (typeof n === 'string' ? n.trim().toLowerCase() : '');

/**
 * Vị trí mặc định của các cột trong thẻ (khi cột không ghi `mobile`):
 * cột "#" / "STT" ẩn; tiêu đề = cột đầu tiên còn lại, nhưng cặp "Mã …" + "Tên …" liền nhau → tên làm tiêu đề, mã làm dòng phụ;
 * cột "Thành tiền" / "Tổng tiền" / "Tổng cộng" sang bên phải; cột không có tiêu đề = nút thao tác; còn lại vào lưới.
 */
function autoSlots<T>(leaves: Leaf<T>[]): MobileSlot[] {
  const slots: Array<MobileSlot | undefined> = leaves.map((c) => c.mobile);
  leaves.forEach((c, i) => { if (!slots[i] && ['#', 'stt'].includes(plain(c.label))) slots[i] = 'hide'; });
  if (!slots.includes('title')) {
    const first = leaves.findIndex((c, i) => !slots[i] && plain(c.label) !== '' && c.label !== undefined && c.label !== null);
    if (first >= 0) {
      const next = first + 1;
      if (next < leaves.length && !slots[next] && plain(leaves[first].label).startsWith('mã') && plain(leaves[next].label).startsWith('tên')) { slots[next] = 'title'; slots[first] = 'subtitle'; }
      else slots[first] = 'title';
    }
  }
  if (!slots.includes('right')) {
    const r = leaves.findIndex((c, i) => !slots[i] && ['thành tiền', 'tổng tiền', 'tổng cộng'].includes(plain(c.label)));
    if (r >= 0) slots[r] = 'right';
  }
  return leaves.map((c, i) => slots[i] ?? (c.label === undefined || c.label === null || c.label === '' ? 'actions' : 'field'));
}

function valueAt(record: AnyObject, dataIndex: unknown): unknown {
  if (dataIndex === undefined || dataIndex === null || dataIndex === '') return undefined;
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  let v: unknown = record;
  for (const k of path) v = v == null ? undefined : (v as Record<string, unknown>)[k as string];
  return v;
}

function cell<T>(col: ColumnType<T>, record: T, index: number): ReactNode {
  const raw = valueAt(record as AnyObject, col.dataIndex);
  const out = col.mobileRender ? col.mobileRender(raw, record, index) : col.render ? col.render(raw, record, index) : raw;
  // render có thể trả {children, props} (kiểu rc-table cũ)
  if (out && typeof out === 'object' && !isValidElement(out) && 'children' in (out as object)) return (out as { children: ReactNode }).children;
  if (typeof out === 'boolean') return out ? 'Có' : '';
  return out as ReactNode;
}

const isEmpty = (v: ReactNode) => v === null || v === undefined || v === '' || v === false || v === '—' || (Array.isArray(v) && v.length === 0);

function keyOf<T>(rowKey: TableProps<T>['rowKey'], record: T, index: number): Key {
  if (typeof rowKey === 'function') return rowKey(record, index) as Key;
  const k = (record as AnyObject)[(rowKey as string) ?? 'key'];
  return (k ?? index) as Key;
}

function MobileCards<T extends AnyObject>(props: TableProps<T>) {
  const { dataSource, columns = [], rowKey = 'key', loading, pagination, expandable, onRow, onChange, locale, summary, title, footer, className, rowClassName } = props;
  const leaves = useMemo(() => flatten(columns as ColumnsType<T>), [columns]);
  const slots = useMemo(() => autoSlots(leaves), [leaves]);

  const all = useMemo(() => [...(dataSource ?? [])], [dataSource]);
  const serverSide = !!(pagination && typeof pagination === 'object' && pagination.total !== undefined && pagination.current !== undefined);
  const [localPage, setLocalPage] = useState(1);
  const [localSize, setLocalSize] = useState(pagination && typeof pagination === 'object' && pagination.pageSize ? pagination.pageSize : 10);
  useEffect(() => { if (!serverSide && (localPage - 1) * localSize >= all.length && localPage > 1) setLocalPage(1); }, [all.length, localPage, localSize, serverSide]);
  const rows = pagination === false || serverSide ? all : all.slice((localPage - 1) * localSize, localPage * localSize);

  const [open, setOpen] = useState<Set<Key>>(new Set());
  useEffect(() => { if (expandable?.expandedRowKeys) setOpen(new Set(expandable.expandedRowKeys)); }, [expandable?.expandedRowKeys]);
  const toggle = (k: Key, record: T) => {
    const next = new Set(open);
    const willOpen = !next.has(k);
    if (willOpen) next.add(k); else next.delete(k);
    if (!expandable?.expandedRowKeys) setOpen(next);
    expandable?.onExpand?.(willOpen, record);
    expandable?.onExpandedRowsChange?.(Array.from(next));
  };

  const pg = pagination && typeof pagination === 'object' ? pagination : {};
  const total = serverSide ? pg.total ?? 0 : all.length;
  const current = serverSide ? pg.current ?? 1 : localPage;
  const pageSize = serverSide ? pg.pageSize ?? 10 : localSize;
  const changePage = (page: number, size: number) => {
    if (!serverSide) { setLocalPage(page); setLocalSize(size); }
    pg.onChange?.(page, size);
    onChange?.({ ...pg, current: page, pageSize: size }, {}, {}, { action: 'paginate', currentDataSource: all });
  };

  const empty = locale?.emptyText;
  const spinning = typeof loading === 'object' ? !!loading.spinning : !!loading;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className={`rt-list ${className ?? ''}`}>
      {title && <div className="rt-caption">{title(rows)}</div>}
      <Spin spinning={spinning}>
        {rows.length === 0 && !spinning && <div className="rt-empty">{typeof empty === 'function' ? empty() : empty ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu" />}</div>}
        {rows.length === 0 && spinning && <div className="rt-empty" style={{ minHeight: 80 }} />}
        {rows.map((record, i) => {
          const k = keyOf(rowKey, record, i);
          const parts: Record<'title' | 'subtitle' | 'right' | 'badge' | 'image' | 'actions', ReactNode[]> = { title: [], subtitle: [], right: [], badge: [], image: [], actions: [] };
          const fields: Array<{ label: ReactNode; value: ReactNode; full: boolean; key: string }> = [];
          leaves.forEach((c, ci) => {
            const slot = slots[ci];
            if (slot === 'hide') return;
            const v = cell(c, record, i);
            if (isEmpty(v)) return;
            const key = String(c.key ?? (Array.isArray(c.dataIndex) ? c.dataIndex.join('.') : c.dataIndex) ?? ci);
            if (slot === 'field' || slot === 'full') fields.push({ label: c.label, value: v, full: slot === 'full' || (!c.width && !!c.ellipsis), key });
            else parts[slot].push(<span key={key}>{v}</span>);
          });
          const canExpand = !!expandable?.expandedRowRender && (expandable.rowExpandable ? expandable.rowExpandable(record) : true);
          const isOpen = canExpand && open.has(k);
          const rowProps = onRow?.(record, i) ?? {};
          const tap = (e: MouseEvent<HTMLDivElement>) => {
            rowProps.onClick?.(e);
            if (canExpand && expandable?.expandRowByClick !== false) toggle(k, record);
          };
          const clickable = !!rowProps.onClick || canExpand;
          const extra = typeof rowClassName === 'function' ? rowClassName(record, i, 0) : rowClassName ?? '';
          return (
            <div key={k} className={`rt-card${isOpen ? ' rt-open' : ''}${clickable ? ' rt-click' : ''}${extra ? ` ${extra}` : ''}`} onClick={tap} onDoubleClick={rowProps.onDoubleClick}>
              <div className="rt-head">
                {parts.image.length > 0 && <div className="rt-img">{parts.image}</div>}
                <div className="rt-main">
                  <div className="rt-title">{parts.title}{parts.badge.length > 0 && <span className="rt-badges">{parts.badge}</span>}</div>
                  {parts.subtitle.map((s, si) => <div className="rt-sub" key={si}>{s}</div>)}
                </div>
                {parts.right.length > 0 && <div className="rt-right">{parts.right}</div>}
                {canExpand && <DownOutlined className="rt-chev" />}
              </div>
              {fields.length > 0 && (
                <div className="rt-fields">
                  {fields.map((f) => <div key={f.key} className={`rt-f${f.full ? ' rt-full' : ''}`}><span className="rt-l">{f.label}</span><span className="rt-v">{f.value}</span></div>)}
                </div>
              )}
              {parts.actions.length > 0 && <div className="rt-actions" onClick={stop}>{parts.actions}</div>}
              {isOpen && <div className="rt-expanded" onClick={stop}>{expandable!.expandedRowRender!(record, i, 0, true)}</div>}
            </div>
          );
        })}
      </Spin>
      {summary && all.length > 0 && (
        <Table className="rt-summary" size="small" showHeader={false} pagination={false} dataSource={[]} columns={columns} summary={() => summary(all)} scroll={{ x: 'max-content' }} />
      )}
      {pagination !== false && total > pageSize && (
        <div className="rt-pager">
          <Pagination simple size="small" current={current} pageSize={pageSize} total={total} onChange={changePage} />
          {pg.showTotal && <span className="rt-total">{pg.showTotal(total, [(current - 1) * pageSize + 1, Math.min(current * pageSize, total)])}</span>}
        </div>
      )}
      {pagination !== false && total <= pageSize && pg.showTotal && total > 0 && <div className="rt-pager"><span className="rt-total">{pg.showTotal(total, [1, total])}</span></div>}
      {footer && <div className="rt-caption">{footer(rows)}</div>}
    </div>
  );
}

function ResponsiveTable<T extends AnyObject>(props: TableProps<T> & { forceTable?: boolean }) {
  const isMobile = useIsMobile();
  const { forceTable, ...rest } = props;
  if (isMobile && !forceTable) return <MobileCards<T> {...rest} />;
  return <Table<T> {...rest} />;
}

ResponsiveTable.Summary = Table.Summary;
ResponsiveTable.EXPAND_COLUMN = Table.EXPAND_COLUMN;
ResponsiveTable.SELECTION_COLUMN = Table.SELECTION_COLUMN;

export default ResponsiveTable;
