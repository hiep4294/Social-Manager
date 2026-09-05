# Social Manager V1.1

Web app quản lý và đăng nội dung marketing cho quán ăn, quán cà phê, cửa hàng và showroom.

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
- Dashboard responsive cho máy tính và điện thoại.
- Docker để triển khai VPS.

> TikTok, Zalo OA và Google Business Profile chưa nằm trong V1.1.

## Chạy nhanh

```bash
cp .env.example .env
npm install
npm start
```

Mở `http://localhost:3000`.

## Biến môi trường tối thiểu

```env
PORT=3000
SESSION_SECRET=mot-chuoi-ngau-nhien-dai
TOKEN_ENCRYPTION_KEY=mot-chuoi-ngau-nhien-khac
ADMIN_USER=admin
ADMIN_PASSWORD=doi-mat-khau-ngay
PUBLIC_BASE_URL=https://social.example.com
COOKIE_SECURE=true
```

`TOKEN_ENCRYPTION_KEY` phải được giữ ổn định. Nếu đổi khóa sau khi đã kết nối Meta, các token cũ sẽ không giải mã được và phải kết nối lại.

## Thiết lập Meta OAuth

Tạo Meta App và cấu hình:

```env
META_GRAPH_VERSION=v23.0
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=
META_CONFIG_ID=
META_OAUTH_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish
```

Nếu bỏ trống `META_REDIRECT_URI`, phần mềm tự dùng:

```text
PUBLIC_BASE_URL/api/meta/oauth/callback
```

Ví dụ:

```text
https://social.example.com/api/meta/oauth/callback
```

URI này phải được khai báo tương ứng trong cấu hình OAuth của Meta App.

`META_CONFIG_ID` là tùy chọn cho cấu hình Facebook Login for Business. Nếu App không dùng Config ID thì để trống.

### Luồng kết nối

1. Chọn thương hiệu/chi nhánh trên thanh trên cùng.
2. Vào **Kết nối MXH**.
3. Nhấn **Kết nối Facebook / Instagram**.
4. Đăng nhập Meta và cấp quyền.
5. Chọn Facebook Page cần gắn với thương hiệu/chi nhánh.
6. Nếu Page có Instagram Business/Creator liên kết, hệ thống kết nối Instagram cùng lúc.

Phần mềm chỉ lưu Page Access Token sau khi mã hóa; không trả token ra API giao diện.

## Instagram và ảnh

Instagram Content Publishing cần ảnh có URL mà Meta có thể truy cập. Vì vậy khi chạy trên VPS phải đặt `PUBLIC_BASE_URL` là HTTPS public domain thật. File upload được phục vụ tại `/uploads/...`.

## Nhiều thương hiệu / chi nhánh

Mô hình:

```text
Thương hiệu A
├─ Chi nhánh A1
└─ Chi nhánh A2

Thương hiệu B
└─ Chi nhánh B1
```

Mỗi mục có:

- Brand Kit riêng.
- Facebook Page riêng.
- Instagram riêng.
- Bài đăng và Calendar riêng.

Bài cũ vẫn được giữ nếu một thương hiệu/chi nhánh bị ẩn khỏi giao diện.

## Docker

```bash
docker compose up -d --build
```

Dữ liệu SQLite và ảnh upload được lưu trong volume `social_manager_data`.

## Cấu trúc

```text
Social-Manager/
├─ public/
│  └─ index.html
├─ src/
│  ├─ meta-oauth.js
│  ├─ security.js
│  ├─ server.js
│  └─ platforms/
│     ├─ facebook.js
│     └─ instagram.js
├─ .github/workflows/ci.yml
├─ .env.example
├─ .gitignore
├─ Dockerfile
├─ compose.yaml
└─ package.json
```

## Nguyên tắc

1. Dùng API chính thức; không dùng Selenium để giả lập đăng nhập.
2. App Secret và token không được commit lên GitHub.
3. OAuth dùng `state` và giới hạn thời gian phiên kết nối.
4. Một lỗi ở Facebook không làm mất trạng thái Instagram và ngược lại.
5. Mỗi nền tảng là adapter riêng để mở rộng sau này.
6. Một thương hiệu/chi nhánh hiện gắn tối đa 1 Facebook Page và 1 Instagram account.

## Roadmap tiếp theo

### V1.2
- Thư viện media riêng.
- Sửa/xóa bài chưa chạy.
- Kéo thả bài trực tiếp trên Calendar.
- Thống kê hiệu quả theo thương hiệu/chi nhánh.
- Lưu session vào persistent store thay cho MemoryStore khi triển khai nhiều process.

### V2
- TikTok Content Posting API.
- Zalo OA.
- Google Business Profile.
- AI tạo biến thể caption theo từng nền tảng, có bước duyệt trước khi đăng.
- Phân quyền nhiều nhân viên.
