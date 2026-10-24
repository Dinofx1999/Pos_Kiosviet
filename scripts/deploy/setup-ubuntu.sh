#!/usr/bin/env bash
# =====================================================================
#  Cài đặt máy chủ Ubuntu 22.04 cho Retail ERP (chạy MỘT LẦN, bằng root)
#    bash setup-ubuntu.sh
#  Làm gì: swap 2 GB · Node 22 + pnpm · PostgreSQL 16 · Redis · nginx · user "erp"
#          · thư mục /opt/erp · file /opt/erp/.env với khóa bí mật sinh ngẫu nhiên
#          · dịch vụ systemd erp-api · tường lửa ufw (22/80/443) · sao lưu DB hằng đêm
#          · khóa SSH (deploy key) để kéo code từ GitHub
#  Có thể chạy lại an toàn: bước nào đã xong sẽ được bỏ qua.
#  Tùy biến bằng biến môi trường: APP_DIR, APP_USER, DB_NAME, DB_USER, DB_PASS, PUBLIC_HOST, PNPM_VERSION
# =====================================================================
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/erp}
APP_USER=${APP_USER:-erp}
WEB_ROOT=${WEB_ROOT:-/var/www/erp}
UPLOAD_DIR=${UPLOAD_DIR:-/var/lib/erp/uploads}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/erp}
DB_NAME=${DB_NAME:-retail_erp}
DB_USER=${DB_USER:-erp}
DB_PASS=${DB_PASS:-$(openssl rand -hex 16)}
PNPM_VERSION=${PNPM_VERSION:-10.34.8}
PUBLIC_HOST=${PUBLIC_HOST:-$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')}
HERE=$(cd "$(dirname "$0")" && pwd)

if [[ $EUID -ne 0 ]]; then echo "Hãy chạy bằng root (hoặc sudo bash $0)"; exit 1; fi
log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# ---------- 1. swap (máy 1,25 GB RAM cần swap để build) ----------
if ! swapon --show | grep -q '^/swapfile'; then
  log "Tạo swap 2 GB"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null; grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  log "Swap đã có"
fi

# ---------- 2. gói hệ thống ----------
log "Cài gói hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg lsb-release nginx redis-server ufw rsync unzip openssl

# ---------- 3. PostgreSQL 16 (kho chính thức của PostgreSQL) ----------
if ! command -v psql >/dev/null || ! psql --version | grep -q ' 16'; then
  log "Cài PostgreSQL 16"
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y && apt-get install -y postgresql-16
fi
systemctl enable --now postgresql redis-server nginx

# ---------- 4. Node 22 + pnpm ----------
if ! command -v node >/dev/null || [[ $(node -v | cut -c2-3) -lt 20 ]]; then
  log "Cài Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "Kích hoạt pnpm $PNPM_VERSION"
corepack enable
corepack prepare "pnpm@$PNPM_VERSION" --activate

# ---------- 5. user & thư mục ----------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Tạo user $APP_USER"
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$UPLOAD_DIR" /home/"$APP_USER"/.ssh
install -d -o www-data -g www-data "$WEB_ROOT"
install -d -o postgres -g postgres "$BACKUP_DIR"
chmod 700 /home/"$APP_USER"/.ssh

# ---------- 6. cơ sở dữ liệu ----------
log "Tạo role/database PostgreSQL ($DB_USER / $DB_NAME)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASS';"
  DB_PASS_SET=1
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
fi

# ---------- 7. file .env (chỉ tạo khi chưa có) ----------
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Tạo $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# ---- Retail ERP – môi trường production (sinh bởi setup-ubuntu.sh $(date +%F)) ----
NODE_ENV=production
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public
REDIS_URL=redis://127.0.0.1:6379
API_PORT=3000
API_PREFIX=api
# origin của web (không có dấu / cuối); thêm domain sau này: http://ip,https://ten-mien.vn
CORS_ORIGINS=http://$PUBLIC_HOST
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL_DAYS=30
# mã hóa Client Secret KiotViet và các bí mật tích hợp (đổi = mất các bí mật đã lưu)
APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
# khóa quản trị nền tảng (header x-platform-key cho /platform/*)
PLATFORM_ADMIN_KEY=$(openssl rand -hex 24)
LOG_LEVEL=info
OUTBOX_POLL_INTERVAL_MS=2000
UPLOAD_DIR=$UPLOAD_DIR
# web gọi API cùng origin qua nginx
VITE_API_URL=/api/v1
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
else
  log "$ENV_FILE đã có – giữ nguyên"
  if [[ -n "${DB_PASS_SET:-}" ]]; then echo "LƯU Ý: role DB vừa tạo với mật khẩu mới; hãy cập nhật DATABASE_URL trong $ENV_FILE (mật khẩu: $DB_PASS)"; fi
fi

# ---------- 8. deploy key để kéo code từ GitHub ----------
KEY=/home/$APP_USER/.ssh/id_ed25519
if [[ ! -f "$KEY" ]]; then
  log "Tạo khóa SSH cho $APP_USER"
  sudo -u "$APP_USER" ssh-keygen -q -t ed25519 -N '' -C "erp-deploy@$(hostname)" -f "$KEY"
fi
sudo -u "$APP_USER" bash -c "ssh-keyscan -t ed25519 github.com 2>/dev/null >> /home/$APP_USER/.ssh/known_hosts; sort -u -o /home/$APP_USER/.ssh/known_hosts /home/$APP_USER/.ssh/known_hosts"

# ---------- 9. nginx ----------
log "Cấu hình nginx"
sed -e "s#__WEB_ROOT__#$WEB_ROOT#g" "$HERE/nginx-erp.conf" > /etc/nginx/sites-available/erp
ln -sf /etc/nginx/sites-available/erp /etc/nginx/sites-enabled/erp
rm -f /etc/nginx/sites-enabled/default
[[ -f "$WEB_ROOT/index.html" ]] || echo '<h1>Retail ERP – đang triển khai, hãy chạy deploy.sh</h1>' > "$WEB_ROOT/index.html"
nginx -t && systemctl reload nginx

# ---------- 10. systemd ----------
log "Cài dịch vụ systemd erp-api"
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__APP_USER__#$APP_USER#g" "$HERE/erp-api.service" > /etc/systemd/system/erp-api.service
systemctl daemon-reload
systemctl enable erp-api >/dev/null

# ---------- 11. tường lửa ----------
log "Tường lửa: mở SSH, 80, 443"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ---------- 12. sao lưu DB hằng đêm (giữ 14 ngày) ----------
cat > /etc/cron.d/erp-backup <<EOF
0 2 * * * postgres pg_dump $DB_NAME | gzip > $BACKUP_DIR/$DB_NAME-\$(date +\%F).sql.gz && find $BACKUP_DIR -name '*.sql.gz' -mtime +14 -delete
EOF
chmod 644 /etc/cron.d/erp-backup

# ---------- xong ----------
PUBKEY=$(cat "$KEY.pub")
cat <<EOF

=====================================================================
 Cài đặt xong.  Địa chỉ web sau khi deploy: http://$PUBLIC_HOST
 - Thư mục code:   $APP_DIR   (user $APP_USER)
 - Cấu hình:       $ENV_FILE  (đã sinh mật khẩu DB và các khóa bí mật – giữ kín)
 - Ảnh tải lên:    $UPLOAD_DIR
 - Sao lưu DB:     $BACKUP_DIR (02:00 hằng đêm)

 BƯỚC TIẾP THEO – cho máy chủ quyền đọc kho GitHub:
   GitHub → repo → Settings → Deploy keys → Add deploy key (chỉ cần Read), dán khóa này:

$PUBKEY

 Sau đó chạy:
   bash $HERE/deploy.sh git@github.com:<tai-khoan>/<ten-repo>.git
=====================================================================
EOF
