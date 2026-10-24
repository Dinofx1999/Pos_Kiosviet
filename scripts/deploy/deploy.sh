#!/usr/bin/env bash
# =====================================================================
#  Triển khai / cập nhật Retail ERP trên máy chủ (chạy bằng root hoặc sudo)
#    Lần đầu:   bash deploy.sh git@github.com:<tai-khoan>/<ten-repo>.git
#    Cập nhật:  bash /opt/erp/scripts/deploy/deploy.sh
#  Làm gì: clone / git pull nhánh $BRANCH → pnpm install → build shared + API + web
#          → prisma migrate deploy + bổ sung quyền cho vai trò mặc định → chép web vào nginx
#          → khởi động lại erp-api → kiểm tra API trả lời.
#  Biến tùy chọn: APP_DIR (/opt/erp) · APP_USER (erp) · WEB_ROOT (/var/www/erp) · BRANCH (master) · SKIP_INSTALL=1
# =====================================================================
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/erp}
APP_USER=${APP_USER:-erp}
WEB_ROOT=${WEB_ROOT:-/var/www/erp}
BRANCH=${BRANCH:-master}
REPO_URL=${1:-${REPO_URL:-}}

if [[ $EUID -ne 0 ]]; then echo "Hãy chạy bằng root (hoặc sudo bash $0)"; exit 1; fi
log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
as_app() { runuser -u "$APP_USER" -- bash -lc "set -euo pipefail; export NODE_OPTIONS=--max-old-space-size=1536 CI=true; $*"; }
with_env() { echo "set -a; . $APP_DIR/.env; set +a; cd $APP_DIR; $*"; }

# ---------- 1. lấy code ----------
if [[ ! -d "$APP_DIR/.git" ]]; then
  [[ -n "$REPO_URL" ]] || { echo "Lần đầu cần địa chỉ kho: bash $0 git@github.com:<tai-khoan>/<ten-repo>.git"; exit 1; }
  log "Clone $REPO_URL (nhánh $BRANCH) vào $APP_DIR"
  as_app "git clone --branch '$BRANCH' '$REPO_URL' '$APP_DIR'"
  as_app "cd '$APP_DIR' && git config pull.ff only"
else
  log "Cập nhật code (git pull --ff-only, nhánh $BRANCH)"
  as_app "cd '$APP_DIR' && git fetch --all --prune && git checkout -q '$BRANCH' && git pull --ff-only"
fi
as_app "cd '$APP_DIR' && git log -1 --format='   phiên bản: %h %ad %s' --date=short"
[[ -f "$APP_DIR/.env" ]] || { echo "Thiếu $APP_DIR/.env – hãy chạy setup-ubuntu.sh trước"; exit 1; }

# ---------- 2. cài phụ thuộc ----------
if [[ -z "${SKIP_INSTALL:-}" ]]; then
  log "pnpm install (lần đầu mất vài phút trên máy 1 vCPU)"
  as_app "cd '$APP_DIR' && pnpm install --frozen-lockfile"
fi

# ---------- 3. build ----------
log "Build packages/shared + API"
as_app "cd '$APP_DIR' && pnpm --filter @erp/shared build"
as_app "cd '$APP_DIR/apps/api' && pnpm prisma:generate && pnpm build"
log "Build web (VITE_API_URL=/api/v1)"
as_app "$(with_env "cd apps/web && VITE_API_URL=\${VITE_API_URL:-/api/v1} pnpm build")"

# ---------- 4. cơ sở dữ liệu ----------
log "Prisma migrate deploy + bổ sung quyền cho vai trò mặc định"
as_app "$(with_env "cd apps/api && pnpm prisma:migrate:deploy && pnpm prisma:sync-roles")"

# ---------- 5. phát hành web + khởi động lại API ----------
log "Chép web vào $WEB_ROOT"
rsync -a --delete "$APP_DIR/apps/web/dist/" "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"
log "Khởi động lại erp-api"
systemctl restart erp-api
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/docs-json >/dev/null 2>&1; then
    HOST=$(grep -E '^CORS_ORIGINS=' "$APP_DIR/.env" | cut -d= -f2 | cut -d, -f1)
    log "Xong. API đang chạy; mở ${HOST:-http://<ip-may-chu>} trên trình duyệt."
    systemctl --no-pager --lines=0 status erp-api | head -3
    exit 0
  fi
  sleep 2
done
echo "API chưa trả lời sau 40 giây – xem nhật ký: journalctl -u erp-api -n 100 --no-pager"
exit 1
