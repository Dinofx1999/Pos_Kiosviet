#!/usr/bin/env bash
# Bật tự động triển khai trên máy chủ (chạy bằng root, sau khi deploy.sh lần đầu đã thành công):
#   bash /opt/erp/scripts/deploy/install-autodeploy.sh
# Tắt: systemctl disable --now erp-autodeploy.timer
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[[ $EUID -eq 0 ]] || { echo "Hãy chạy bằng root"; exit 1; }
install -m 644 "$HERE/erp-autodeploy.service" /etc/systemd/system/erp-autodeploy.service
install -m 644 "$HERE/erp-autodeploy.timer" /etc/systemd/system/erp-autodeploy.timer
chmod +x "$HERE/autodeploy.sh" "$HERE/deploy.sh"
touch /var/log/erp-autodeploy.log
systemctl daemon-reload
systemctl enable --now erp-autodeploy.timer
echo "Đã bật: mỗi phút kiểm tra GitHub, có commit mới trên master sẽ tự deploy. Nhật ký: /var/log/erp-autodeploy.log"
systemctl list-timers erp-autodeploy.timer --no-pager | head -3
