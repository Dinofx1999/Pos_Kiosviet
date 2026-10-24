import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { CashbookService } from '../finance/cashbook.service';
import { CustomersService } from '../sales/customers.service';
import { SalesReportsService } from '../sales/sales-reports.service';
import { PurchasingReportsService } from '../purchasing/purchasing-reports.service';
import { ReportExportQueryDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';

type Cell = string | number | Date | null | undefined;
const num = (v: Prisma.Decimal | string | number | null | undefined) => (v === null || v === undefined ? null : Number(v.toString()));

/** Xuất Excel các báo cáo (Module 10): một sheet dữ liệu + dòng tổng, định dạng số Việt Nam. */
@Injectable()
export class ReportsExcelService {
  constructor(private readonly reports: ReportsService, private readonly sales: SalesReportsService, private readonly cashbook: CashbookService, private readonly customers: CustomersService, private readonly suppliers: PurchasingReportsService) {}

  private sheet(wb: ExcelJS.Workbook, title: string, headers: Array<{ header: string; key: string; width?: number; money?: boolean }>, rows: Array<Record<string, Cell>>, totals?: Record<string, Cell>) {
    const ws = wb.addWorksheet(title.slice(0, 31));
    ws.columns = headers.map((h) => ({ header: h.header, key: h.key, width: h.width ?? 16 }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
    for (const r of rows) ws.addRow(r);
    if (totals) { const tr = ws.addRow({ ...totals }); tr.font = { bold: true }; }
    headers.forEach((h, i) => { if (h.money) ws.getColumn(i + 1).numFmt = '#,##0.##'; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  }

  async export(user: RequestUser, q: ReportExportQueryDto): Promise<{ buffer: Buffer; filename: string }> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Retail ERP';
    const big = { page: 1, pageSize: 10000, sortDir: 'desc' as const };
    const stamp = new Date().toISOString().slice(0, 10);
    let filename = `bao-cao-${q.type}-${stamp}.xlsx`;
    if (q.type === 'nxt') {
      const r = await this.reports.nxt(user, { ...big, from: q.from, to: q.to, warehouseId: q.warehouseId, branchId: q.branchId, categoryId: q.categoryId, search: q.search, hideEmpty: q.hideEmpty ?? 'true' } as never);
      this.sheet(wb, 'Nhập xuất tồn', [{ header: 'Mã hàng', key: 'sku', width: 14 }, { header: 'Tên hàng', key: 'name', width: 36 }, { header: 'Nhóm', key: 'category', width: 18 }, { header: 'ĐVT', key: 'unit', width: 8 }, { header: 'Tồn đầu', key: 'openingQty', money: true }, { header: 'Giá trị đầu', key: 'openingValue', money: true }, { header: 'Nhập', key: 'inQty', money: true }, { header: 'Giá trị nhập', key: 'inValue', money: true }, { header: 'Xuất', key: 'outQty', money: true }, { header: 'Giá trị xuất', key: 'outValue', money: true }, { header: 'Tồn cuối', key: 'closingQty', money: true }, { header: 'Giá trị cuối', key: 'closingValue', money: true }],
        r.data.map((x) => ({ sku: x.sku, name: x.name, category: x.category, unit: x.unit, openingQty: num(x.openingQty), openingValue: num(x.openingValue), inQty: num(x.inQty), inValue: num(x.inValue), outQty: num(x.outQty), outValue: num(x.outValue), closingQty: num(x.closingQty), closingValue: num(x.closingValue) })),
        { sku: 'TỔNG', openingQty: num(r.totals.openingQty), openingValue: num(r.totals.openingValue), inQty: num(r.totals.inQty), inValue: num(r.totals.inValue), outQty: num(r.totals.outQty), outValue: num(r.totals.outValue), closingQty: num(r.totals.closingQty), closingValue: num(r.totals.closingValue) });
      filename = `nhap-xuat-ton-${stamp}.xlsx`;
    } else if (q.type === 'slow-movers') {
      const r = await this.reports.slowMovers(user, { ...big, days: q.days, warehouseId: q.warehouseId, branchId: q.branchId, categoryId: q.categoryId, search: q.search } as never);
      this.sheet(wb, 'Hàng tồn lâu', [{ header: 'Mã hàng', key: 'sku', width: 14 }, { header: 'Tên hàng', key: 'name', width: 36 }, { header: 'Nhóm', key: 'category', width: 18 }, { header: 'Tồn', key: 'onHand', money: true }, { header: 'Giá vốn', key: 'costPrice', money: true }, { header: 'Giá trị tồn', key: 'value', money: true }, { header: 'Bán lần cuối', key: 'lastSaleAt', width: 20 }, { header: 'Số ngày chưa bán', key: 'daysSinceSale' }, { header: 'Nhập lần cuối', key: 'lastReceiptAt', width: 20 }],
        r.data.map((x) => ({ sku: x.sku, name: x.name, category: x.category, onHand: num(x.onHand), costPrice: num(x.costPrice), value: num(x.value), lastSaleAt: x.lastSaleAt, daysSinceSale: x.daysSinceSale, lastReceiptAt: x.lastReceiptAt })));
      filename = `hang-ton-lau-${r.days}-ngay-${stamp}.xlsx`;
    } else if (q.type === 'top-products') {
      const r = await this.reports.topProducts(user, { ...big, from: q.from, to: q.to, branchId: q.branchId, categoryId: q.categoryId, search: q.search, by: q.by, order: q.order ?? 'desc' } as never);
      this.sheet(wb, 'Hàng bán chạy', [{ header: 'Mã hàng', key: 'sku', width: 14 }, { header: 'Tên hàng', key: 'name', width: 36 }, { header: 'Nhóm', key: 'category', width: 18 }, { header: 'SL bán', key: 'quantity', money: true }, { header: 'SL trả', key: 'returnedQuantity', money: true }, { header: 'Doanh thu', key: 'revenue', money: true }, { header: 'Giá vốn', key: 'cost', money: true }, { header: 'Lợi nhuận', key: 'profit', money: true }, { header: 'Số HĐ', key: 'invoices' }],
        r.data.map((x) => ({ sku: x.sku, name: x.name, category: x.category, quantity: num(x.quantity), returnedQuantity: num(x.returnedQuantity), revenue: num(x.revenue), cost: num(x.cost), profit: num(x.profit), invoices: x.invoices })));
      filename = `hang-ban-chay-${stamp}.xlsx`;
    } else if (q.type === 'profit') {
      const r = await this.reports.profit(user, { from: q.from, to: q.to, branchId: q.branchId, groupBy: 'month' });
      this.sheet(wb, 'Lãi lỗ', [{ header: 'Kỳ', key: 'period', width: 14 }, { header: 'Số HĐ', key: 'invoices' }, { header: 'Doanh thu', key: 'revenue', money: true }, { header: 'Trả hàng', key: 'refunds', money: true }, { header: 'Doanh thu thuần', key: 'netRevenue', money: true }, { header: 'Giá vốn', key: 'cogs', money: true }, { header: 'Lợi nhuận gộp', key: 'grossProfit', money: true }, { header: 'Thu khác', key: 'otherIncome', money: true }, { header: 'Chi phí khác', key: 'otherExpense', money: true }, { header: 'Thất thoát / hàng hỏng', key: 'losses', money: true }, { header: 'Chi phí giao hàng', key: 'shippingCost', money: true }, { header: 'Lợi nhuận ròng', key: 'netProfit', money: true }],
        r.byPeriod.map((x) => ({ period: x.period.toISOString().slice(0, 7), invoices: x.invoices, revenue: num(x.revenue), refunds: num(x.refunds), netRevenue: num(x.netRevenue), cogs: num(x.cogs), grossProfit: num(x.grossProfit), otherIncome: num(x.otherIncome), otherExpense: num(x.otherExpense), losses: num(x.losses), shippingCost: num(x.shippingCost), netProfit: num(x.netProfit) })),
        { period: 'TỔNG', invoices: r.totals.invoices, revenue: num(r.totals.revenue), refunds: num(r.totals.refunds), netRevenue: num(r.totals.netRevenue), cogs: num(r.totals.cogs), grossProfit: num(r.totals.grossProfit), otherIncome: num(r.totals.otherIncome), otherExpense: num(r.totals.otherExpense), losses: num(r.totals.losses), shippingCost: num(r.totals.shippingCost), netProfit: num(r.totals.netProfit) });
      this.sheet(wb, 'Chi phí theo loại', [{ header: 'Loại chi', key: 'name', width: 30 }, { header: 'Số tiền', key: 'amount', money: true }], r.expenseByCategory.map((x) => ({ name: x.name, amount: num(x.amount) })));
      filename = `lai-lo-${stamp}.xlsx`;
    } else if (q.type === 'valuation') {
      const r = await this.reports.valuation(user, { warehouseId: q.warehouseId, branchId: q.branchId, groupBy: ((q.groupBy ?? q.by) as never) ?? 'category' });
      this.sheet(wb, 'Giá trị tồn kho', [{ header: 'Nhóm', key: 'name', width: 30 }, { header: 'Số mặt hàng', key: 'skus' }, { header: 'Số lượng', key: 'quantity', money: true }, { header: 'Giá trị vốn', key: 'value', money: true }, { header: 'Giá trị bán', key: 'retail', money: true }, { header: 'Lãi tiềm năng', key: 'potentialMargin', money: true }],
        r.rows.map((x) => ({ name: x.name, skus: x.skus, quantity: num(x.quantity), value: num(x.value), retail: num(x.retail), potentialMargin: num(x.potentialMargin) })),
        { name: 'TỔNG', skus: r.totals.skus, quantity: num(r.totals.quantity), value: num(r.totals.value), retail: num(r.totals.retail) });
      filename = `gia-tri-ton-kho-${stamp}.xlsx`;
    } else if (q.type === 'sales') {
      const r = await this.sales.summary(user, { from: q.from, to: q.to, branchId: q.branchId, groupBy: 'day' } as never);
      this.sheet(wb, 'Doanh thu theo ngày', [{ header: 'Ngày', key: 'period', width: 14 }, { header: 'Số HĐ', key: 'invoices' }, { header: 'Doanh thu', key: 'revenue', money: true }, { header: 'Giá vốn', key: 'cost', money: true }, { header: 'Lợi nhuận gộp', key: 'grossProfit', money: true }, { header: 'Giảm giá', key: 'discount', money: true }, { header: 'Đã thu', key: 'paid', money: true }],
        r.byPeriod.map((x) => ({ period: new Date(x.period).toISOString().slice(0, 10), invoices: x.invoices, revenue: num(x.revenue), cost: num(x.cost), grossProfit: num(x.grossProfit), discount: num(x.discount), paid: num(x.paid) })),
        { period: 'TỔNG', invoices: r.totals.invoices, revenue: num(r.totals.revenue), cost: num(r.totals.cost), grossProfit: num(r.totals.grossProfit), discount: num(r.totals.discount), paid: num(r.totals.paid) });
      this.sheet(wb, 'Theo nhân viên', [{ header: 'Nhân viên', key: 'name', width: 24 }, { header: 'Số HĐ', key: 'invoices' }, { header: 'Doanh thu', key: 'revenue', money: true }, { header: 'Lợi nhuận gộp', key: 'grossProfit', money: true }], r.bySeller.map((x) => ({ name: x.name, invoices: x.invoices, revenue: num(x.revenue), grossProfit: num(x.grossProfit) })));
      this.sheet(wb, 'Theo hàng hóa', [{ header: 'Mã hàng', key: 'sku', width: 14 }, { header: 'Tên hàng', key: 'name', width: 36 }, { header: 'SL', key: 'quantity', money: true }, { header: 'Doanh thu', key: 'revenue', money: true }, { header: 'Giá vốn', key: 'cost', money: true }, { header: 'Lợi nhuận gộp', key: 'grossProfit', money: true }], (r.byProduct as Array<Record<string, unknown>>).map((x) => ({ sku: x.sku as string, name: x.name as string, quantity: num(x.quantity as never), revenue: num(x.revenue as never), cost: num(x.cost as never), grossProfit: num(x.grossProfit as never) })));
      filename = `doanh-thu-${stamp}.xlsx`;
    } else if (q.type === 'cashbook') {
      if (!q.accountId) throw Errors.validation('Chọn quỹ (accountId) để xuất sổ quỹ');
      const r = await this.cashbook.cashbook(user, { ...big, accountId: q.accountId, from: q.from, to: q.to } as never) as { account: { name: string } | null; openingBalance: Prisma.Decimal | null; data: Array<Record<string, unknown>>; totalIn?: Prisma.Decimal; totalOut?: Prisma.Decimal; closingBalance?: Prisma.Decimal };
      this.sheet(wb, `Sổ quỹ ${r.account?.name ?? ''}`, [{ header: 'Mã phiếu', key: 'code', width: 12 }, { header: 'Ngày', key: 'paymentDate', width: 20 }, { header: 'Đối tượng / Loại', key: 'party', width: 30 }, { header: 'Phương thức', key: 'method', width: 14 }, { header: 'Thu', key: 'in', money: true }, { header: 'Chi', key: 'out', money: true }, { header: 'Tồn quỹ', key: 'balanceAfter', money: true }, { header: 'Ghi chú', key: 'note', width: 30 }],
        [...r.data].reverse().map((x) => ({ code: x.code as string, paymentDate: x.paymentDate as Date, party: (x.partyName as string) ?? (x.categoryName as string) ?? '', method: x.method as string, in: x.direction === 'IN' ? num(x.amount as never) : null, out: x.direction === 'OUT' ? num(x.amount as never) : null, balanceAfter: num(x.balanceAfter as never), note: x.note as string })),
        { code: 'TỔNG', in: num(r.totalIn), out: num(r.totalOut), balanceAfter: num(r.closingBalance) });
      filename = `so-quy-${stamp}.xlsx`;
    } else if (q.type === 'customer-debt') {
      const r = await this.customers.debt(user);
      this.sheet(wb, 'Công nợ khách hàng', [{ header: 'Mã KH', key: 'code', width: 12 }, { header: 'Khách hàng', key: 'name', width: 30 }, { header: 'Điện thoại', key: 'phone', width: 14 }, { header: 'Nhóm', key: 'groupName', width: 14 }, { header: 'Công nợ', key: 'balance', money: true }],
        (r.customers as Array<Record<string, unknown>>).map((x) => ({ code: x.code as string, name: x.name as string, phone: x.phone as string, groupName: (x.groupName as string) ?? '', balance: num(x.balance as never) })),
        { code: 'TỔNG', balance: num(r.total as never) });
      filename = `cong-no-khach-hang-${stamp}.xlsx`;
    } else if (q.type === 'supplier-debt') {
      const r = await this.suppliers.debt(user);
      this.sheet(wb, 'Công nợ nhà cung cấp', [{ header: 'Mã NCC', key: 'code', width: 12 }, { header: 'Nhà cung cấp', key: 'name', width: 30 }, { header: 'Điện thoại', key: 'phone', width: 14 }, { header: 'Công nợ', key: 'balance', money: true }],
        ((r as unknown as Record<string, unknown>).suppliers as Array<Record<string, unknown>>).map((x) => ({ code: x.code as string, name: x.name as string, phone: x.phone as string, balance: num(x.balance as never) })),
        { code: 'TỔNG', balance: num(r.total as never) });
      filename = `cong-no-nha-cung-cap-${stamp}.xlsx`;
    }
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename };
  }
}
