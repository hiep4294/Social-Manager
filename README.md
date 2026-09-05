# Social Manager V1

Web app quản lý và đăng nội dung marketing cho quán ăn, quán cà phê, cửa hàng và showroom.

## V1 có gì

- 1 tài khoản Admin.
- Hồ sơ thương hiệu: tên, slogan, địa chỉ, điện thoại, giờ mở cửa, link bản đồ.
- Soạn một bài và chọn nhiều nền tảng.
- Đăng ngay hoặc hẹn giờ.
- Upload ảnh lên server.
- Template nội dung theo mô hình quán ăn/cửa hàng.
- Lịch sử từng bài và trạng thái từng nền tảng: `PENDING`, `PUBLISHED`, `FAILED`.
- Retry bài lỗi.
- Facebook Page qua Meta Graph API.
- Instagram Business/Creator qua Instagram Graph API.
- Dashboard responsive dùng trên web máy tính/điện thoại.
- Docker để triển khai lên VPS.

> TikTok, Zalo OA và Google Business Profile được để ở roadmap sau V1 để tránh phụ thuộc nhiều quy trình duyệt API ngay từ đầu.

## Chạy nhanh

```bash
cp .env.example .env
npm install
npm start
```

Mở `http://localhost:3000`.

Tài khoản mặc định lấy từ `.env`:

```env
ADMIN_USER=admin
ADMIN_PASSWORD=change-me-now
```

## Kết nối Facebook / Instagram

Không đưa access token vào source code hoặc commit lên GitHub. Điền vào `.env` trên máy/VPS:

```env
META_GRAPH_VERSION=v23.0
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
INSTAGRAM_USER_ID=
INSTAGRAM_ACCESS_TOKEN=
```

`META_GRAPH_VERSION` là cấu hình để có thể thay đổi phiên bản Graph API mà không phải sửa code.

Instagram yêu cầu ảnh có URL công khai. Khi dùng upload nội bộ, đặt:

```env
PUBLIC_BASE_URL=https://social.example.com
```

để server tạo URL công khai cho file trong `/uploads`.

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
│  ├─ server.js
│  └─ platforms/
│     ├─ facebook.js
│     └─ instagram.js
├─ .env.example
├─ .gitignore
├─ Dockerfile
├─ compose.yaml
└─ package.json
```

## Nguyên tắc V1

1. Dùng API chính thức; không dùng Selenium để giả lập đăng nhập mạng xã hội.
2. Token chỉ nằm trong biến môi trường của server.
3. Mỗi nền tảng là một adapter riêng để dễ bổ sung TikTok/Zalo/Google Business sau này.
4. Một bài có nhiều `target`; lỗi Facebook không làm mất trạng thái Instagram và ngược lại.
5. Scheduler có khóa trạng thái để hạn chế đăng trùng khi worker quét lại.

## Roadmap

### V1.1
- Calendar tuần/tháng.
- Thư viện media riêng.
- Nhiều Brand/chi nhánh.
- Thống kê số bài thành công/thất bại theo nền tảng.

### V2
- TikTok Content Posting API.
- Zalo OA.
- Google Business Profile.
- AI tạo biến thể caption theo từng nền tảng, nhưng luôn có bước duyệt trước khi đăng.
- Phân quyền nhiều nhân viên.
