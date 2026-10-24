#!/usr/bin/env bash
# =====================================================================
#  Triển khai / cập nhật Retail ERP trên máy chủ (chạy bằng root hoặc sudo)
#    Lần đầu:   bash deploy.sh git@github.com:<tai-khoan>/<ten-repo>.git
#    Cập nhật:  bash /opt/erp/scripts/deploy/deploy.sh
#  Làm gì: clone / git pull nhánh $BRANCH → pnpm install → build shared + API + web
#          → prisma migrate deploy + bổ sung quyền cho vai trò mặc định → chép web vào nginx
#          → khởi động lại erp-api → kiểm tra API trả lời.
#  Chỉ build phần có thay đổi so với lần deploy trước (.deployed): web-only ≈ 1 phút, API-only ≈ 2 phút.
#  Biến tùy chọn: APP_DIR (/opt/erp) · APP_USER (erp) · WEB_ROOT (/var/www/erp) · BRANCH (master) · SKIP_INSTALL=1 · FORCE=1 (build lại tất cả)
# =====================================================================
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/erp}
APP_USER=${APP_USER:-erp}
WEB_ROOT=${WEB_ROOT:-/var/www/erp}
BRANCH=${BRANCH:-master}
REPO_URL=${1:-${REPO_URL:-}}

if [[ $EUID -ne 0 ]]; then echo "Hãy chạy bằng root (hoặc sudo bash $0)"; exit 1; fi
# không cho hai lần deploy chạy chồng nhau (tay + tự động)
exec 9>/run/lock/erp-deploy.lock
flock -n 9 || { echo "Đang có một lần triển khai khác chạy – thử lại sau."; exit 1; }
log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
as_app() { runuser -u "$APP_USER" -- bash -lc "set -euo pipefail; export NODE_OPTIONS=--max-old-space-size=1536 CI=true; $*"; }
with_env() { echo "set -a; . $APP_DIR/.env; set +a; cd $APP_DIR; $*"; }

# ---------- 1. lấy code ----------
if [[ ! -d "$APP_DIR/.git" ]]; then
  [[ -n "$REPO_URL" ]] || { echo "Lần đầu cần địa chỉ kho: bash $0 git@github.com:<tai-khoan>/<ten-repo>.git"; exit 1; }
  log "Lấy code $REPO_URL (nhánh $BRANCH) vào $APP_DIR"
  # $APP_DIR đã có .env do setup tạo nên không clone thẳng được: khởi tạo kho tại chỗ rồi fetch + checkout
  as_app "cd '$APP_DIR' && git init -q && (git remote get-url origin >/dev/null 2>&1 || git remote add origin '$REPO_URL') && git fetch -q origin '$BRANCH' && git checkout -q -B '$BRANCH' 'origin/$BRANCH' && git config pull.ff only"
else
  log "Cập nhật code (git pull --ff-only, nhánh $BRANCH)"
  as_app "cd '$APP_DIR' && git fetch --all --prune && git checkout -q '$BRANCH' && git pull --ff-only"
fi
as_app "cd '$APP_DIR' && git log -1 --format='   phiên bản: %h %ad %s' --date=short"
[[ -f "$APP_DIR/.env" ]] || { echo "Thiếu $APP_DIR/.env – hãy chạy setup-ubuntu.sh trước"; exit 1; }

# ---------- chỉ làm những bước có thay đổi (so với bản deploy thành công trước, lưu ở .deployed) ----------
NEW_REV=$(as_app "cd '$APP_DIR' && git rev-parse HEAD")
PREV_REV=$(cat "$APP_DIR/.deployed" 2>/dev/null || true)
changed() { # changed <đường dẫn...> → 0 nếu có tệp thay đổi trong các đường dẫn đó
  [[ -n "$PREV_REV" ]] || return 0
  [[ -n "${FORCE:-}" ]] && return 0
  as_app "cd '$APP_DIR' && git diff --quiet '$PREV_REV' '$NEW_REV' -- $*" && return 1 || return 0
}
DO_INSTALL=0; DO_API=0; DO_WEB=0
changed pnpm-lock.yaml package.json pnpm-workspace.yaml apps/api/package.json apps/web/package.json packages/shared/package.json && DO_INSTALL=1
changed apps/api packages/shared pnpm-lock.yaml && DO_API=1
changed apps/web packages/shared pnpm-lock.yaml && DO_WEB=1
[[ -n "${SKIP_INSTALL:-}" ]] && DO_INSTALL=0
[[ ! -d "$APP_DIR/apps/api/dist" ]] && DO_API=1
[[ ! -f "$WEB_ROOT/index.html" || ! -d "$APP_DIR/apps/web/dist" ]] && DO_WEB=1
log "Kế hoạch: cài phụ thuộc=$DO_INSTALL · API=$DO_API · web=$DO_WEB (${PREV_REV:0:7} → ${NEW_REV:0:7})"

# ---------- 2. cài phụ thuộc ----------
if [[ $DO_INSTALL -eq 1 ]]; then
  log "pnpm install (lần đầu mất vài phút trên máy 1 vCPU)"
  as_app "cd '$APP_DIR' && pnpm install --frozen-lockfile"
fi

# ---------- 3. build ----------
if [[ $DO_API -eq 1 || $DO_WEB -eq 1 ]]; then
  log "Build packages/shared"
  as_app "cd '$APP_DIR' && pnpm --filter @erp/shared build"
fi
if [[ $DO_API -eq 1 ]]; then
  log "Build API"
  as_app "cd '$APP_DIR/apps/api' && pnpm prisma:generate && pnpm build"
fi
if [[ $DO_WEB -eq 1 ]]; then
  log "Build web (VITE_API_URL=/api/v1)"
  as_app "$(with_env "cd apps/web && VITE_API_URL=\${VITE_API_URL:-/api/v1} pnpm build")"
fi

# ---------- 4. cơ sở dữ liệu ----------
if [[ $DO_API -eq 1 ]]; then
  log "Prisma migrate deploy + bổ sung quyền cho vai trò mặc định"
  as_app "$(with_env "cd apps/api && pnpm prisma:migrate:deploy && pnpm prisma:sync-roles")"
fi

# ---------- 5. phát hành web + khởi động lại API ----------
if [[ $DO_WEB -eq 1 ]]; then
  log "Chép web vào $WEB_ROOT"
  rsync -a --delete "$APP_DIR/apps/web/dist/" "$WEB_ROOT/"
  chown -R www-data:www-data "$WEB_ROOT"
fi
if [[ $DO_API -eq 1 ]]; then
  log "Khởi động lại erp-api"
  systemctl restart erp-api
else
  systemctl is-active --quiet erp-api || systemctl start erp-api
fi
echo "$NEW_REV" > "$APP_DIR/.deployed"
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
