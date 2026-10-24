# Kiến trúc hệ thống — Retail ERP / POS

> Phạm vi: hệ thống quản lý bán hàng – kho – vận hành tương đương nhóm tính năng KiotViet, thiết kế độc lập.
> Cập nhật: 2026-10-24

## 1. Tổng quan

Kiến trúc **Modular Monolith**: một backend NestJS duy nhất, chia theo *business domain* (module), giao tiếp trong tiến trình qua service/DI và sự kiện (Transactional Outbox). Mỗi module sở hữu bảng dữ liệu của mình; module khác chỉ truy cập qua service công khai của module đó (không truy vấn chéo bảng). Khi cần, một module có thể tách ra service riêng vì ranh giới dữ liệu và API đã rõ.

```
┌────────────────────────────┐        ┌───────────────────────────────────────────┐
│  apps/web (React + AntD)   │  HTTPS │  apps/api (NestJS modular monolith)       │
│  - Quản trị (KiotViet-like)│──────▶ │  /api/v1/*  REST + OpenAPI                │
│  - POS (keyboard/barcode)  │  WS/SSE│  Guards: JWT → Tenant → Permission → Branch│
└────────────────────────────┘        │  Modules: auth, org, users, roles, audit,  │
                                      │   catalog, inventory, purchasing, sales,   │
                                      │   payments, pricing, reports, crm, saas…   │
                                      │  Infra: Prisma(PG) · Redis · BullMQ ·      │
                                      │   Outbox · Idempotency · Numbering · CLS   │
                                      └──────────────┬──────────────┬─────────────┘
                                                     │              │
                                         ┌───────────▼───┐   ┌──────▼──────┐
                                         │ PostgreSQL 16 │   │  Redis 7    │
                                         │ (source of    │   │ (queues,    │
                                         │  truth)       │   │  cache)     │
                                         └───────────────┘   └─────────────┘
```

## 2. Cấu trúc repository

```
.
├── apps/
│   ├── api/                 NestJS backend
│   │   ├── prisma/          schema.prisma, migrations/, seed.ts
│   │   ├── src/
│   │   │   ├── common/      decorators, guards, filters, interceptors, pagination, decimal utils, errors
│   │   │   ├── infra/       prisma (tenant-scoped client), cls (request context), audit, numbering,
│   │   │   │                idempotency, outbox, redis
│   │   │   └── modules/     auth, tenants, branches, warehouses, users, roles, settings,
│   │   │                    catalog (categories/brands/units/products/price-books),
│   │   │                    inventory (balances/movements/reservations/documents), dashboard
│   │   └── test/            integration tests (supertest + Postgres thật)
│   └── web/                 React 18 + Vite + Ant Design 5 + TanStack Query + Zustand
├── packages/shared/         permission catalogue, enums, hằng số dùng chung FE/BE
├── docker/                  nginx config
├── scripts/                 backup.sh
├── docs/                    tài liệu kiến trúc, nghiệp vụ, tiến độ
└── docker-compose.yml       postgres, redis, api, web(nginx), backup
```

## 3. Công nghệ

| Lớp | Lựa chọn | Lý do |
|---|---|---|
| Frontend | React 18, TypeScript, Vite, Ant Design 5, React Router 6, TanStack Query 5, Zustand | Bộ UI quản trị hoàn chỉnh, data-table/forms mạnh, cache server-state chuẩn |
| Backend | Node 20+, NestJS 11, TypeScript strict | DI, module boundary rõ, guards/interceptors cho cross-cutting |
| ORM | Prisma 6 + PostgreSQL 16 | Migration có kiểm soát, Decimal chính xác, raw SQL cho `SELECT … FOR UPDATE` |
| Queue | BullMQ + Redis | Job nền (outbox publisher, reconciliation, backup, webhook retry) |
| Auth | JWT access (15 phút) + refresh token xoay vòng (hash SHA-256 lưu DB, 30 ngày) | Thu hồi được, phát hiện tái sử dụng |
| API docs | @nestjs/swagger → `/api/docs` | OpenAPI 3 |
| Hạ tầng | Docker Compose, Nginx reverse proxy, GitHub Actions CI | |

## 4. Multi-tenant

* Mô hình **shared database, shared schema**: mọi bảng nghiệp vụ có `tenant_id` và các index/unique đều bắt đầu bằng `tenant_id`.
* `tenant_id` được lấy từ JWT, đặt vào request context (AsyncLocalStorage qua `nestjs-cls`).
* Prisma client được **mở rộng** (`$extends`) để tự động chèn `tenant_id` vào mọi `findMany/findFirst/update/delete/create/count/aggregate` của các model tenant-scoped. Service vẫn truyền `tenantId` tường minh cho raw SQL. Đây là 2 lớp bảo vệ độc lập.
* Cấu hình theo tenant lưu ở `tenant_settings` (key/value JSON), ví dụ `inventory.allowNegativeStock`.

## 5. Bảo mật & phân quyền

* `JwtAuthGuard` → xác thực; `PermissionsGuard` → kiểm tra `@RequirePermission('inventory.document.post')`; `BranchAccessService.assertBranch()` → giới hạn chi nhánh/kho được thao tác.
* Permission là chuỗi ổn định (xem `packages/shared/src/permissions.ts`); vai trò là tập permission; `*` = toàn quyền (owner/admin).
* Mật khẩu: bcrypt cost 10. Lịch sử đăng nhập (thành công/thất bại) lưu `login_history`.
* Helmet, CORS whitelist, rate-limit đăng nhập (throttler).

## 6. Toàn vẹn dữ liệu (xem thêm `business-rules.md`)

* Mọi thao tác ghi sổ chạy trong **một transaction** Prisma (interactive), khóa hàng theo thứ tự xác định (`variant` → `stock_balance`) để tránh deadlock.
* **Idempotency**: header `Idempotency-Key` trên các POST tạo chứng từ; khóa `(tenant, scope, key)`; phản hồi được lưu và phát lại.
* **Optimistic lock**: cột `version` trên chứng từ; **pessimistic lock** (`FOR UPDATE`) trên số dư tồn và dòng sequence.
* **Transactional Outbox**: sự kiện nghiệp vụ ghi cùng transaction vào `outbox_events`; publisher nền phát sau commit (EventEmitter nội bộ → webhook/queue về sau).
* **Audit log** cho mọi thao tác tạo/sửa/ghi sổ/hủy.
* Chứng từ đã ghi sổ **không sửa/xóa**; dùng chứng từ đảo (REVERSAL) hoặc điều chỉnh.

## 7. Luồng request điển hình (ghi sổ phiếu nhập kho)

```
POST /api/v1/inventory/documents/:id/post   (Idempotency-Key: …)
 └─ JwtAuthGuard → PermissionsGuard(inventory.document.post) → IdempotencyInterceptor
    └─ InventoryPostingService.post()
        tx { lock document (FOR UPDATE) → assert DRAFT
             sort lines by (variantId,batchKey)
             for each line: lock variant → upsert+lock balance → validate (âm kho?) →
                            update balance → compute avg cost → insert movement + cost ledger
             update document POSTED (version+1) → audit log → outbox event }
    └─ response cached under idempotency key
```

## 8. Môi trường chạy

* Dev: `pnpm install` → `.env` → `pnpm --filter @erp/api prisma:migrate:dev` → `pnpm dev`.
* Prod: `docker compose up -d --build` (api tự `migrate deploy`, web qua nginx :8080, backup hàng ngày vào `./backups`).
