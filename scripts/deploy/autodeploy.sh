#!/usr/bin/env bash
# =====================================================================
#  Tự động triển khai: chạy định kỳ (systemd timer erp-autodeploy, mỗi 2 phút).
#  Nếu GitHub có commit mới trên nhánh $BRANCH so với bản đang chạy → gọi deploy.sh,
#  ghi nhật ký vào /var/log/erp-autodeploy.log. Không có gì mới → thoát im lặng.
# =====================================================================
set -euo pipefail
APP_DIR=${APP_DIR:-/opt/erp}
APP_USER=${APP_USER:-erp}
BRANCH=${BRANCH:-master}
LOG=${LOG:-/var/log/erp-autodeploy.log}

[[ -d "$APP_DIR/.git" ]] || exit 0
cd "$APP_DIR"
# fetch có giới hạn thời gian: GitHub/SSH treo thì bỏ qua lượt này thay vì chặn lượt sau
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3"
timeout 60 runuser -u "$APP_USER" -- env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git fetch -q origin "$BRANCH" || { echo "$(date '+%F %T') fetch thất bại / quá 60 giây – sẽ thử lại" >> "$LOG"; exit 0; }
LOCAL=$(runuser -u "$APP_USER" -- git rev-parse HEAD)
REMOTE=$(runuser -u "$APP_USER" -- git rev-parse "origin/$BRANCH")
[[ "$LOCAL" != "$REMOTE" ]] || exit 0

{
  echo "===== $(date '+%F %T') có code mới: ${LOCAL:0:7} → ${REMOTE:0:7}"
  if bash "$APP_DIR/scripts/deploy/deploy.sh"; then
    echo "===== $(date '+%F %T') triển khai xong ${REMOTE:0:7}"
  else
    echo "===== $(date '+%F %T') TRIỂN KHAI LỖI (xem phía trên); sẽ thử lại ở lần kiểm tra sau"
  fi
} >> "$LOG" 2>&1
