# Social Manager V1.2.1

[▶ Mở Social Manager bằng GitHub Codespaces](https://codespaces.new/hiep4294/Social-Manager?quickstart=1)

[🔐 Cấu hình Codespaces Secrets](https://github.com/hiep4294/Social-Manager/settings/secrets/codespaces)

Web app quản lý và đăng nội dung marketing cho quán ăn, quán cà phê, cửa hàng và showroom.

## Bắt đầu nhanh để test Facebook thật

1. Bấm **Mở Social Manager bằng GitHub Codespaces** ở đầu trang.
2. Trước khi chạy live, vào **Cấu hình Codespaces Secrets** và tạo `META_APP_ID`, `META_APP_SECRET`.
3. Trong Terminal Codespace chạy:

```bash
npm run codespace
```

4. Copy dòng `Meta OAuth redirect URI` mà terminal in ra và khai báo trong Meta App.
5. Mở Social Manager -> **Kết nối MXH** -> kết nối Facebook -> chọn Page.
6. Tạo bài `xin chào`, chọn Facebook và để trống thời gian để đăng ngay.

> Không gửi `META_APP_SECRET` vào chat và không commit secret vào repository.

## Chức năng hiện tại

- 1 tài khoản Admin.
- Nhiều **thương hiệu** và **chi nhánh** trong cùng hệ thống.
- Mỗi thương hiệu/chi nhánh có tên, slogan, địa chỉ, điện thoại, giờ mở cửa và link bản đồ riêng.
- Kết nối Facebook Page + Instagram Business/Creator bằng **Meta OAuth** từ nút trên giao diện.
- Mỗi thương hiệu/chi nhánh có kết nối mạng xã hội riêng.
- Access Token được mã hóa trước khi lưu SQLite.
- Soạn một bài và chọn Facebook/Instagram.
- Đăng ngay hoặc hẹn giờ.
- Calendar marketing dạng **tháng / tuần**.
- Upload ảnh lên server.
- Template nội dung tự điền dữ liệu theo thương hiệu đang chọn.
- Lịch sử và trạng thái từng nền tảng: `PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`.
- Retry bài lỗi.
- Scheduler có cơ chế mở lại job bị kẹt sau khi server bị dừng đột ngột.
- MCP endpoint để ChatGPT/agent gọi `list_brands`, `list_facebook_accounts`, `post_to_facebook`, `get_post_status`.
- Dashboard responsive cho máy tính và điện thoại.
- Docker để triển khai VPS sau khi kiểm thử xong.

> TikTok, Zalo OA và Google Business Profile chưa nằm trong V1.2.

## Quy trình phát triển hiện tại

Ưu tiên kiểm thử trên GitHub trước:

```text
GitHub source
  -> GitHub Actions CI
  -> Codespaces chạy giao diện thật
  -> Meta OAuth thật
  -> thử 1 bài Facebook thật
  -> ổn định mới đưa VPS / máy local
```

## Chạy demo không đăng thật

```bash
npm install
npm run demo
```

Đăng nhập demo:

```text
admin / admin123
```

`DEMO_MODE=true` nên Facebook/Instagram chỉ được mô phỏng.

## Kiểm thử tự động

```bash
npm test
```

Bao gồm:

- Facebook adapter.
- Meta OAuth URL, state, scope, token exchange, Page discovery và lỗi Meta.
- MCP control cho ChatGPT.
- End-to-end smoke test: login, brand/branch, post, scheduler, calendar.

## Kiểm thử Facebook thật bằng GitHub Codespaces

Repo đã có `.devcontainer/devcontainer.json` và script `npm run codespace`.

### 1. Tạo Codespace

Trong GitHub:

```text
Code -> Codespaces -> Create codespace on main
```

Hoặc dùng link một chạm ở đầu README.

Port `3000` được cấu hình public để callback OAuth có URL HTTPS.

### 2. Thêm Codespaces secrets

Trong GitHub repo/account Codespaces secrets, thêm:

```text
META_APP_ID
META_APP_SECRET
```

Có thể thêm cố định các giá trị sau để giữ session/token qua lần restart:

```text
SESSION_SECRET
TOKEN_ENCRYPTION_KEY
ADMIN_PASSWORD
```

Không commit các secret này vào repo.

### 3. Chạy LIVE mode

Trong terminal Codespace:

```bash
npm run codespace
```

Script tự tính URL dạng:

```text
https://<codespace-name>-3000.<codespaces-forwarding-domain>
```

và in ra chính xác Meta Redirect URI:

```text
https://<codespace-name>-3000.<codespaces-forwarding-domain>/api/meta/oauth/callback
```

### 4. Cấu hình Meta App

Đưa đúng Redirect URI mà terminal in ra vào cấu hình OAuth của Meta App.

Biến môi trường Meta:

```env
META_GRAPH_VERSION=v23.0
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=
META_CONFIG_ID=
META_OAUTH_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish
```

`META_GRAPH_VERSION` là cấu hình, không hard-code logic vào adapter. Khi Meta yêu cầu version khác chỉ cần thay biến này.

### 5. Kết nối Facebook

Trong Social Manager:

1. Chọn thương hiệu/chi nhánh.
2. Vào **Kết nối MXH**.
3. Nhấn **Kết nối Facebook / Instagram**.
4. Đăng nhập Meta và cấp quyền.
5. Chọn Facebook Page.
6. Sau khi kết nối thành công, tạo bài Facebook nội dung `xin chào` và để thời gian trống để đăng ngay.

Khi `DEMO_MODE=false`, adapter gọi Graph API thật và lưu `external_id` Facebook trả về.

## Chạy local/VPS sau này

```bash
cp .env.example .env
npm install
npm start
```

Các biến tối thiểu:

```env
PORT=3000
SESSION_SECRET=mot-chuoi-ngau-nhien-dai
TOKEN_ENCRYPTION_KEY=mot-chuoi-ngau-nhien-khac
ADMIN_USER=admin
ADMIN_PASSWORD=doi-mat-khau-ngay
PUBLIC_BASE_URL=https://social.example.com
COOKIE_SECURE=true
DEMO_MODE=false
```

`TOKEN_ENCRYPTION_KEY` phải được giữ ổn định. Nếu đổi khóa sau khi đã kết nối Meta, token cũ sẽ không giải mã được và phải OAuth lại.

## Nhiều thương hiệu / chi nhánh

```text
Thương hiệu A
├─ Chi nhánh A1
└─ Chi nhánh A2

Thương hiệu B
└─ Chi nhánh B1
```

Mỗi mục có Brand Kit, Facebook Page, Instagram, bài đăng và Calendar riêng.

## Docker

```bash
docker compose up -d --build
```

Dữ liệu SQLite và ảnh upload được lưu trong Docker volumes.

## Nguyên tắc

1. Dùng API chính thức; không dùng Selenium để giả lập đăng nhập Facebook.
2. App Secret và token không commit lên GitHub.
3. OAuth dùng `state` và giới hạn thời gian phiên kết nối.
4. Token được mã hóa trước khi ghi SQLite.
5. Một lỗi Facebook không làm mất trạng thái Instagram và ngược lại.
6. Một thương hiệu/chi nhánh hiện gắn tối đa 1 Facebook Page và 1 Instagram account.
7. Live Facebook test chỉ thực hiện sau khi người dùng tự cấp quyền OAuth cho Meta App.

## Roadmap

### V1.3
- Sửa/xóa bài chưa chạy.
- Kéo thả bài trực tiếp trên Calendar.
- Thư viện media.
- Persistent session store.
- Audit log lệnh MCP/ChatGPT.
- Xác nhận mục tiêu trước các thao tác đăng hàng loạt.

### V2
- TikTok Content Posting API.
- Zalo OA.
- Google Business Profile.
- AI tạo biến thể caption theo từng nền tảng, có bước duyệt trước khi đăng.
- Phân quyền nhiều nhân viên.
