# Retail ERP / POS

Hệ thống quản lý bán hàng – kho – vận hành (phạm vi nghiệp vụ tương đương KiotViet), kiến trúc modular monolith:
NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis, frontend React 18 + Vite + Ant Design 5.

## Chạy nhanh (dev, macOS/Linux)

```bash
# 1. Yêu cầu: Node >= 20, pnpm 10, PostgreSQL 16, Redis
brew install postgresql@16 redis && brew services start postgresql@16 && brew services start redis
psql -d postgres -c "CREATE ROLE erp LOGIN PASSWORD 'erp' CREATEDB;" ; createdb -O erp retail_erp ; createdb -O erp retail_erp_test

# 2. Cài đặt & cấu hình
pnpm install
cp .env.example .env            # chỉnh DATABASE_URL / JWT_ACCESS_SECRET nếu cần
ln -sf ../../.env apps/api/.env

# 3. Database
pnpm --filter @erp/api prisma:generate
pnpm --filter @erp/api prisma:migrate:deploy
pnpm --filter @erp/api prisma:seed   # tenant "demo": admin / thukho / thungan – mật khẩu Admin@123

# 4. Chạy
pnpm dev:api     # http://localhost:3000/api/v1  – Swagger: http://localhost:3000/api/docs
pnpm dev:web     # http://localhost:5173
```

## Chạy bằng Docker Compose

```bash
docker compose up -d --build     # web: http://localhost:8080 · api: http://localhost:3000 · backup hàng ngày vào ./backups
```

## Kiểm thử

```bash
pnpm --filter @erp/api test:unit    # jest unit (costing, numbering, permissions)
pnpm --filter @erp/api test:int     # jest + supertest trên PostgreSQL thật (DATABASE_URL_TEST)
pnpm typecheck && pnpm lint && pnpm build
```

## Tài liệu
`docs/architecture.md` · `docs/modules.md` (bảng đối chiếu) · `docs/database.md` · `docs/business-rules.md` · `docs/api-contracts.md` · `docs/implementation-plan.md` · `docs/test-matrix.md` · `docs/progress.md` (trạng thái phiên làm việc).
