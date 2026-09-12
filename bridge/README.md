# Facebook command bridge

Trong giai đoạn kiểm thử GitHub Codespaces, ChatGPT ghi một lệnh vào `bridge/facebook-command.json`. Codespace đọc lệnh, lưu vào SQLite rồi thực hiện bằng Facebook Page OAuth đã kết nối.

## Đăng ngay

```json
{
  "id": "fb-20260912-001",
  "action": "post_facebook",
  "brand_id": 1,
  "message": "xin chào",
  "idempotency_key": "request-20260912-001"
}
```

## Đăng kèm ảnh công khai

```json
{
  "id": "fb-20260912-002",
  "action": "post_facebook",
  "brand_id": 1,
  "message": "Ảnh sản phẩm mới",
  "image_url": "https://example.com/photo.jpg",
  "idempotency_key": "request-20260912-002"
}
```

`image_url` phải là URL HTTP/HTTPS công khai để Meta có thể tải ảnh.

## Hẹn giờ

```json
{
  "id": "fb-20260912-003",
  "action": "post_facebook",
  "brand_id": 1,
  "message": "Bài lúc 19h",
  "scheduled_at": "2026-09-12T19:00:00+07:00",
  "idempotency_key": "request-20260912-003"
}
```

Lệnh hẹn giờ được lưu vào SQLite ngay khi Codespace đọc được file. Sau đó file GitHub có thể được thay bằng lệnh khác mà lịch cũ vẫn còn trong hàng đợi.

## Chống đăng trùng

- `id` là khóa duy nhất của command.
- `idempotency_key` là khóa chống lặp ở cấp yêu cầu.
- Nếu cùng `id` hoặc `idempotency_key` được gửi lại, bridge bỏ qua thay vì đăng thêm một bài.
- Lệnh lỗi được đánh dấu `FAILED` và không tự động retry để tránh trường hợp Meta đã nhận bài nhưng phản hồi mạng bị gián đoạn.

## Trạng thái

Khi chạy Codespace, trạng thái gần nhất có tại `/bridge-status.json` và Terminal sẽ ghi `queued`, `published` hoặc `failed`.

> Bridge GitHub là cơ chế thử nghiệm. Vì repo hiện public, không dùng nó cho nội dung nhạy cảm. Khi chuyển VPS, nên dùng MCP/API có xác thực thay cho file lệnh public.
