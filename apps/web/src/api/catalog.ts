import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Batch, Brand, Category, Paginated, PriceBook, Product, SearchHit, Unit, UploadedImage } from './types';

export interface ProductQuery { page?: number; pageSize?: number; search?: string; categoryId?: string; brandId?: string; type?: string; isActive?: string; stockStatus?: string; warehouseId?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }

export const catalogApi = {
  categories: () => http.get<Category[]>('/categories').then((r) => r.data),
  createCategory: (b: { name: string; parentId?: string }) => http.post<Category>('/categories', b).then((r) => r.data),
  updateCategory: (id: string, b: Partial<{ name: string; parentId: string | null; isActive: boolean }>) => http.patch<Category>(`/categories/${id}`, b).then((r) => r.data),
  deleteCategory: (id: string) => http.delete(`/categories/${id}`),
  brands: () => http.get<Brand[]>('/brands').then((r) => r.data),
  createBrand: (name: string) => http.post<Brand>('/brands', { name }).then((r) => r.data),
  deleteBrand: (id: string) => http.delete(`/brands/${id}`),
  units: () => http.get<Unit[]>('/units').then((r) => r.data),
  createUnit: (name: string) => http.post<Unit>('/units', { name }).then((r) => r.data),
  deleteUnit: (id: string) => http.delete(`/units/${id}`),

  products: (q: ProductQuery) => http.get<Paginated<Product>>('/products', { params: clean(q as any) }).then((r) => r.data),
  product: (id: string) => http.get<Product>(`/products/${id}`).then((r) => r.data),
  search: (q: string, warehouseId?: string) => http.get<SearchHit[]>('/products/search', { params: clean({ q, warehouseId }) }).then((r) => r.data),
  byBarcode: (barcode: string) => http.get<SearchHit>(`/products/by-barcode/${encodeURIComponent(barcode)}`).then((r) => r.data),
  createProduct: (b: any) => http.post<Product>('/products', b).then((r) => r.data),
  updateProduct: (id: string, b: any) => http.patch<Product>(`/products/${id}`, b).then((r) => r.data),
  deleteProduct: (id: string) => http.delete(`/products/${id}`),
  setActive: (id: string, active: boolean) => http.post<Product>(`/products/${id}/${active ? 'activate' : 'deactivate'}`).then((r) => r.data),
  exportXlsx: () => http.get('/products/export', { responseType: 'blob' }).then((r) => r.data as Blob),
  importTemplate: () => http.get('/products/import-template', { responseType: 'blob' }).then((r) => r.data as Blob),
  importXlsx: (file: File) => { const fd = new FormData(); fd.append('file', file); return http.post<{ created: number; failed: { row: number; error: string }[]; totalRows: number }>('/products/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data); },
  uploadImages: (files: File[]) => { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); return http.post<UploadedImage[]>('/uploads/images', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data); },
  deleteImage: (url: string) => http.delete('/uploads/images', { params: { url } }),
  batches: (variantId: string) => http.get<Batch[]>(`/variants/${variantId}/batches`).then((r) => r.data),
  createBatch: (variantId: string, b: { batchNo: string; mfgDate?: string; expiryDate?: string }) => http.post<Batch>(`/variants/${variantId}/batches`, b).then((r) => r.data),

  priceBooks: () => http.get<PriceBook[]>('/price-books').then((r) => r.data),
  priceBook: (id: string) => http.get<PriceBook>(`/price-books/${id}`).then((r) => r.data),
  createPriceBook: (b: any) => http.post<PriceBook>('/price-books', b).then((r) => r.data),
  updatePriceBook: (id: string, b: any) => http.patch<PriceBook>(`/price-books/${id}`, b).then((r) => r.data),
  setPriceBookItems: (id: string, items: { variantId: string; price: string; minQuantity?: string }[]) => http.put<PriceBook>(`/price-books/${id}/items`, { items }).then((r) => r.data),
};

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories, staleTime: 60_000 });
export const useBrands = () => useQuery({ queryKey: ['brands'], queryFn: catalogApi.brands, staleTime: 60_000 });
export const useUnits = () => useQuery({ queryKey: ['units'], queryFn: catalogApi.units, staleTime: 60_000 });
export const useProducts = (q: ProductQuery) => useQuery({ queryKey: ['products', q], queryFn: () => catalogApi.products(q), placeholderData: keepPreviousData });
export const useProduct = (id?: string) => useQuery({ queryKey: ['product', id], queryFn: () => catalogApi.product(id!), enabled: !!id });
export const useBatches = (variantId?: string) => useQuery({ queryKey: ['batches', variantId], queryFn: () => catalogApi.batches(variantId!), enabled: !!variantId });
export const usePriceBooks = () => useQuery({ queryKey: ['price-books'], queryFn: catalogApi.priceBooks });

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
export { useMutation };
