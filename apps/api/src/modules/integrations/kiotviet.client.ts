import { Errors } from '../../common/errors/app-error';

/**
 * Minimal KiotViet Public API client (https://developer.kiotviet.vn). OAuth2 client-credentials; every request carries the
 * `Retailer` header. Base URLs are overridable through env so tests can point at a local mock.
 */
export interface KiotVietCredentials { retailer: string; clientId: string; clientSecret: string }
export interface KvPage<T> { total: number; pageSize: number; data: T[]; removedIds?: number[] }
export interface KvBranch { id: number; branchName: string; address?: string; contactNumber?: string; retailerId?: number }
export interface KvCategory { categoryId: number; categoryName: string; parentId?: number | null; children?: KvCategory[] }
export interface KvInventory { branchId: number; branchName?: string; cost?: number; onHand?: number; reserved?: number; minQuantity?: number; maxQuantity?: number }
export interface KvProduct { id: number; code: string; name: string; fullName?: string; categoryId?: number; categoryName?: string; allowsSale?: boolean; basePrice?: number; unit?: string; masterProductId?: number | null; masterUnitId?: number | null; masterCode?: string; conversionValue?: number; isActive?: boolean; hasVariants?: boolean; barCode?: string; tradeMarkName?: string; weight?: number; description?: string; images?: string[]; attributes?: Array<{ attributeName: string; attributeValue: string }>; inventories?: KvInventory[] }
export interface KvCustomer { id: number; code: string; name: string; gender?: boolean | null; birthDate?: string; contactNumber?: string; address?: string; locationName?: string; wardName?: string; email?: string; organization?: string; comments?: string; taxCode?: string; debt?: number; totalPoint?: number; groups?: string; isActive?: boolean }
export interface KvSupplier { id: number; code: string; name: string; contactNumber?: string; email?: string; address?: string; locationName?: string; wardName?: string; organization?: string; taxCode?: string; comments?: string; groups?: string; debt?: number; isActive?: boolean }
export interface KvInvoiceDetail { productId?: number; productCode: string; productName?: string; quantity: number; price: number; discount?: number; subTotal?: number; note?: string }
export interface KvInvoice { id: number; code: string; purchaseDate: string; branchId?: number; branchName?: string; soldByName?: string; customerCode?: string; customerName?: string; total: number; totalPayment?: number; discount?: number; status?: number; statusValue?: string; description?: string; invoiceDetails?: KvInvoiceDetail[] }

const TOKEN_URL = () => process.env.KIOTVIET_TOKEN_URL ?? 'https://id.kiotviet.vn/connect/token';
const API_URL = () => (process.env.KIOTVIET_API_URL ?? 'https://public.kiotapi.com').replace(/\/$/, '');
const PAGE = 100;

export class KiotVietClient {
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly creds: KiotVietCredentials, private readonly fetchImpl: typeof fetch = fetch) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const body = new URLSearchParams({ scopes: 'PublicApi', grant_type: 'client_credentials', client_id: this.creds.clientId, client_secret: this.creds.clientSecret });
    const res = await this.fetchImpl(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw Errors.conflict('KIOTVIET_AUTH_FAILED', `KiotViet từ chối đăng nhập (HTTP ${res.status}) — kiểm tra Client ID / Secret`, { status: res.status });
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    if (!json.access_token) throw Errors.conflict('KIOTVIET_AUTH_FAILED', 'KiotViet không trả access token');
    this.token = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) * 1000) };
    return json.access_token;
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(API_URL() + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    const token = await this.accessToken();
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Retailer: this.creds.retailer, Accept: 'application/json' } });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); return this.get<T>(path, params); }
    if (!res.ok) throw Errors.conflict('KIOTVIET_REQUEST_FAILED', `KiotViet trả lỗi HTTP ${res.status} cho ${path}`, { status: res.status, path });
    return (await res.json()) as T;
  }

  /** Walks every page of a list endpoint (KiotViet paginates with pageSize / currentItem). */
  private async all<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}, max = 200_000): Promise<T[]> {
    const out: T[] = [];
    let current = 0;
    for (;;) {
      const page = await this.get<KvPage<T>>(path, { ...params, pageSize: PAGE, currentItem: current });
      const data = page.data ?? [];
      out.push(...data);
      current += data.length;
      if (!data.length || data.length < PAGE || current >= (page.total ?? Infinity) || out.length >= max) break;
    }
    return out;
  }

  branches() { return this.all<KvBranch>('/branches'); }
  categories() { return this.all<KvCategory>('/categories', { hierachicalData: true }); }
  products() { return this.all<KvProduct>('/products', { includeInventory: true, includePricebook: false, orderBy: 'id', orderDirection: 'Asc' }); }
  customers() { return this.all<KvCustomer>('/customers', { includeTotal: true, orderBy: 'id', orderDirection: 'Asc' }); }
  suppliers() { return this.all<KvSupplier>('/suppliers', { includeTotal: true, orderBy: 'id', orderDirection: 'Asc' }); }
  invoices(fromPurchaseDate?: string, toPurchaseDate?: string) { return this.all<KvInvoice>('/invoices', { includePayment: false, includeInvoiceDelivery: false, fromPurchaseDate, toPurchaseDate, orderBy: 'purchaseDate', orderDirection: 'Asc' }); }
}
