# Triển khai lên máy chủ Ubuntu 22.04 (VPS 1 vCPU · 1,25 GB RAM · 30 GB)

Cách chạy **không dùng Docker** (nhẹ hơn cho máy 1,25 GB RAM): PostgreSQL 16, Redis, Node 22 và nginx cài thẳng trên Ubuntu; API chạy bằng systemd, web là tệp tĩnh do nginx phục vụ và proxy `/api`, `/uploads` về API. Mọi thứ đã được gói thành hai script trong `scripts/deploy/`:

| Tệp | Dùng khi nào |
|---|---|
| `scripts/deploy/setup-ubuntu.sh` | Chạy **một lần** trên máy chủ mới: cài phần mềm, tạo user `erp`, database, `/opt/erp/.env` (tự sinh mật khẩu và khóa bí mật), nginx, systemd, tường lửa, sao lưu hằng đêm, khóa SSH để kéo code từ GitHub |
| `scripts/deploy/deploy.sh` | Lần đầu (clone) và **mỗi lần cập nhật**: kéo code, cài phụ thuộc, build, chạy migration, phát hành web, khởi động lại API |
| `scripts/deploy/erp-api.service`, `scripts/deploy/nginx-erp.conf` | Mẫu cấu hình systemd và nginx mà setup dùng |
| `scripts/deploy/install-autodeploy.sh` (+ `autodeploy.sh`, `erp-autodeploy.service/.timer`) | Bật tự động kéo code và deploy mỗi khi có commit mới trên `master` |

Kho GitHub của dự án: `https://github.com/Dinofx1999/Pos_Kiosviet` (nhánh `master`, đã có remote `origin` trong máy Mac).

---

## Bước 0 – Trên máy Mac: đưa code mới nhất lên GitHub

Mỗi lần có thay đổi (kể cả bây giờ, vì các sửa đổi trang Tổng quan chưa commit):

```bash
cd /Users/phivunguyen/Desktop/Project_Cosmetic && git add -A && git commit -m "Trang chủ mobile mới, API /dashboard/home, script triển khai Ubuntu" && git push origin master
```

Kiểm tra trên GitHub thấy thư mục `scripts/deploy/` là được.

## Bước 1 – Đăng nhập máy chủ lần đầu

Từ Terminal trên Mac (mật khẩu root lấy trong trang quản trị VPS, bấm biểu tượng sao chép):

```bash
ssh root@180.93.241.253
```

Lần đầu sẽ hỏi “Are you sure you want to continue connecting?” → gõ `yes`. Nên đổi ngay mật khẩu root bằng lệnh `passwd` (gõ mật khẩu mới hai lần).

Khuyến nghị (không bắt buộc): tạo khóa SSH trên Mac để đăng nhập không cần mật khẩu:

```bash
ssh-keygen -t ed25519 -C "mac" -f ~/.ssh/id_ed25519 -N "" 2>/dev/null; ssh-copy-id root@180.93.241.253
```

## Bước 2 – Chép script cài đặt lên máy chủ và chạy

Vì kho GitHub ở chế độ riêng tư, máy chủ chưa kéo code được; ta chép riêng thư mục script lên trước. **Trên Mac:**

```bash
scp -r /Users/phivunguyen/Desktop/Project_Cosmetic/scripts/deploy root@180.93.241.253:/root/deploy
```

**Trên máy chủ** (đang ở phiên `ssh root@...`):

```bash
bash /root/deploy/setup-ubuntu.sh
```

Script chạy khoảng 5–10 phút. Cuối cùng nó in ra **một dòng khóa công khai** bắt đầu bằng `ssh-ed25519 …` (deploy key của máy chủ). Nếu lỡ mất, in lại bằng `cat /home/erp/.ssh/id_ed25519.pub`.

## Bước 3 – Cho máy chủ quyền đọc kho GitHub

Trên trình duyệt: GitHub → repo `Pos_Kiosviet` → **Settings → Deploy keys → Add deploy key** → Title: `VPS erp`, Key: dán dòng `ssh-ed25519 …` ở trên, **không** tick “Allow write access” → Add key.

(Thay thế: nếu bạn để kho ở chế độ công khai thì bỏ qua bước này và dùng địa chỉ `https://github.com/Dinofx1999/Pos_Kiosviet.git` ở bước 4.)

## Bước 4 – Triển khai lần đầu

Trên máy chủ:

```bash
bash /root/deploy/deploy.sh git@github.com:Dinofx1999/Pos_Kiosviet.git
```

Script sẽ clone về `/opt/erp`, `pnpm install` (lần đầu 3–6 phút trên 1 vCPU), build shared/API/web, chạy `prisma migrate deploy`, chép web vào `/var/www/erp`, khởi động `erp-api` và báo “Xong. API đang chạy”.

Mở trình duyệt: **http://180.93.241.253** → màn hình đăng nhập. Bấm **Đăng ký gian hàng mới** để tạo cửa hàng của bạn (tài khoản tạo ra là chủ gian hàng). Trên điện thoại, mở cùng địa chỉ rồi “Thêm vào màn hình chính”.

## Tự động triển khai khi push code (khuyến nghị)

Sau khi deploy lần đầu thành công, bật bộ hẹn giờ trên máy chủ:

```bash
bash /opt/erp/scripts/deploy/install-autodeploy.sh
```

Từ đó cứ mỗi 2 phút máy chủ kiểm tra nhánh `master` trên GitHub; có commit mới là tự chạy `deploy.sh` (nhật ký `/var/log/erp-autodeploy.log`, xem nhanh: `tail -f /var/log/erp-autodeploy.log`). Push từ Mac xong khoảng 3–8 phút là bản mới lên web. Tắt: `systemctl disable --now erp-autodeploy.timer`.

## Mỗi lần cập nhật sau này (khi không bật tự động)

1. Trên Mac: `git add -A && git commit -m "…" && git push`
2. Trên máy chủ: `ssh root@180.93.241.253` rồi

```bash
bash /opt/erp/scripts/deploy/deploy.sh
```

Thời gian ngừng dịch vụ chỉ vài giây lúc khởi động lại API. Nếu chỉ đổi code (không thêm thư viện) có thể chạy nhanh hơn với `SKIP_INSTALL=1 bash /opt/erp/scripts/deploy/deploy.sh`.

## Vận hành

| Việc | Lệnh trên máy chủ |
|---|---|
| Xem API đang chạy / nhật ký | `systemctl status erp-api` · `journalctl -u erp-api -f` |
| Khởi động lại API | `systemctl restart erp-api` |
| Xem nhật ký nginx | `tail -f /var/log/nginx/error.log` |
| Cấu hình (mật khẩu DB, khóa bí mật, CORS) | `nano /opt/erp/.env` rồi `systemctl restart erp-api` |
| Sao lưu DB thủ công | `sudo -u postgres pg_dump retail_erp \| gzip > /var/backups/erp/tay-$(date +%F).sql.gz` |
| Khôi phục DB | `gunzip -c /var/backups/erp/<tệp>.sql.gz \| sudo -u postgres psql retail_erp` (dừng API trước: `systemctl stop erp-api`) |
| Bộ nhớ | `free -h` (có swap 2 GB); nếu build web bị “killed” vì thiếu RAM: `SKIP_INSTALL=1` chạy lại, hoặc tăng swap |
| Ảnh sản phẩm | `/var/lib/erp/uploads` (nên gộp vào sao lưu: `tar czf /var/backups/erp/uploads-$(date +%F).tgz /var/lib/erp/uploads`) |

Tệp `/opt/erp/.env` do setup sinh ra chứa: `DATABASE_URL`, `REDIS_URL`, `API_PORT`, `CORS_ORIGINS` (origin của web, ví dụ `http://180.93.241.253`; thêm domain thì nối bằng dấu phẩy), `JWT_ACCESS_SECRET`, `APP_ENCRYPTION_KEY` (mã hóa Client Secret KiotViet – **không đổi** sau khi đã lưu kết nối), `PLATFORM_ADMIN_KEY` (header `x-platform-key` cho API `/platform/*`), `UPLOAD_DIR`.

## Trạng thái máy chủ thật (24/10/2026)

- `setup-ubuntu.sh` và `deploy.sh` đã chạy thành công trên 180.93.241.253; API `erp-api` active, web phục vụ tại **http://baoancosmetic.com.vn** (DNS tenten: A `@`, `*`, `mail` → IP; CNAME `www`).
- nginx `server_name baoancosmetic.com.vn www.baoancosmetic.com.vn`; `CORS_ORIGINS` đã có cả http/https của hai tên này và IP.
- Tự động triển khai đã bật (`erp-autodeploy.timer`, 2 phút/lần). Lỗi gặp lần đầu: `.gitignore` có `uploads/` nên thiếu thư mục mã nguồn `apps/api/src/modules/uploads` trên GitHub → đã sửa thành `/uploads/` và `/apps/api/uploads/`.
- HTTPS đã bật (certbot 24/10/2026, chứng chỉ Let's Encrypt hết hạn 22/01/2027, tự gia hạn bằng `certbot.timer`); HTTP tự chuyển sang **https://baoancosmetic.com.vn**. Tài khoản Let's Encrypt đăng ký không kèm email; muốn nhận thư báo gia hạn: `certbot update_account --email <email>`.

## Thêm tên miền và HTTPS (khi có domain)

1. Trỏ bản ghi A của domain về `180.93.241.253`.
2. Trên máy chủ: sửa `server_name _;` thành `server_name ten-mien.vn;` trong `/etc/nginx/sites-available/erp`, rồi:

```bash
apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d ten-mien.vn --redirect
```

3. Thêm `https://ten-mien.vn` vào `CORS_ORIGINS` trong `/opt/erp/.env` và `systemctl restart erp-api`.

Chưa có domain thì dùng HTTP qua IP vẫn chạy đủ chức năng, nhưng mật khẩu đi qua mạng không mã hóa – nên dùng domain + HTTPS càng sớm càng tốt.

## Giới hạn của cấu hình 1 vCPU / 1,25 GB

Đủ cho một cửa hàng vài chục nghìn giao dịch; API được giới hạn heap 512 MB, PostgreSQL và Redis dùng mặc định. Khi mở thêm chi nhánh hoặc nhập lịch sử KiotViet rất lớn (hàng trăm nghìn hóa đơn), nâng lên 2 GB RAM. Build trên máy chủ dùng swap nên chậm (vài phút) nhưng không cần máy khác.
