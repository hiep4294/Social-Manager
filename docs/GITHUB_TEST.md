# Chạy và kiểm thử Social Manager trực tiếp trên GitHub

Mục tiêu của giai đoạn này: hoàn thiện và kiểm thử V1.1 trên GitHub trước, chưa cần VPS hay máy cục bộ.

## Cách 1 - GitHub Codespaces (dùng để nhìn và thao tác giao diện)

1. Mở repository `hiep4294/Social-Manager`.
2. Chọn **Code** -> **Codespaces** -> **Create codespace on main**.
3. Chờ `postCreateCommand` chạy `npm install` xong.
4. Trong Terminal chạy:

```bash
npm run demo
```

5. GitHub tự forward port `3000`. Chọn **Open in Browser** nếu preview không tự mở.

Đăng nhập demo:

```text
User: admin
Password: admin123
```

`npm run demo` bật `DEMO_MODE=true`. Facebook/Instagram được mô phỏng hoàn toàn, không gửi bài thật và không cần Meta App ID/Secret. Có thể dùng để kiểm tra:

- đăng nhập;
- tạo nhiều thương hiệu;
- tạo chi nhánh;
- template;
- tạo bài Facebook/Instagram;
- đăng ngay/hẹn giờ;
- scheduler;
- trạng thái PUBLISHED;
- lịch tháng/tuần;
- lịch sử bài đăng;
- giao diện responsive.

## Cách 2 - GitHub Actions (kiểm thử tự động)

Mỗi lần push lên `main`, workflow `CI` chạy:

```text
npm install
syntax check backend
syntax check frontend JavaScript
npm run test:smoke
```

Smoke test chạy trong thư mục tạm riêng, không sửa database thật trong repository. Nó khởi động server thật và kiểm tra end-to-end:

```text
health
login + session
multi-brand
branch
render template
create post
Facebook demo publish
Instagram demo publish
scheduler
calendar
Meta config endpoint
```

Chỉ coi một phiên bản là đạt để chuyển sang VPS/máy cục bộ khi workflow `CI` xanh.

## Kiểm thử Meta thật

`DEMO_MODE` chỉ dùng kiểm thử logic. Việc OAuth và đăng bài Meta thật cần App ID/App Secret và callback HTTPS hợp lệ. Phần này thực hiện sau khi V1.1 chạy ổn định trong Codespaces/CI.

## Lệnh hữu ích

```bash
npm run demo
npm run test:smoke
npm start
```

- `npm run demo`: chạy toàn bộ workflow với Facebook/Instagram giả lập.
- `npm run test:smoke`: kiểm thử tự động end-to-end trong môi trường cách ly.
- `npm start`: chạy chế độ thật, dùng cấu hình `.env`.
