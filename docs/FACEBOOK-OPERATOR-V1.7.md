# Facebook Operator V1.7

## Mục tiêu

Windows Agent là Browser Operator cho Facebook Group. Page vẫn ưu tiên Meta Graph API. Agent không bypass login, CAPTCHA, 2FA hoặc checkpoint.

## Luồng lệnh

`bridge/operator-queue.json` là queue dành cho Windows Agent. Mỗi lệnh mới phải có `id`, `action=facebook_operator`, `operator_action`, `issued_at`, `expires_at` và `payload`.

Ví dụ:

```json
{
  "id": "fbop-example-001",
  "action": "facebook_operator",
  "operator_action": "like_group_post",
  "issued_at": "2026-09-13T15:00:00.000Z",
  "expires_at": "2026-09-13T15:15:00.000Z",
  "payload": {
    "group_name": "Group 1353837944687586"
  }
}
```

Queue giữ được nhiều lệnh. Agent lưu receipt trong SQLite nên cùng `id` không được thực hiện lại. Lệnh quá hạn hoặc quá cũ bị từ chối. Legacy single-command poller mặc định OFF.

## Safety

- Group phải được `remember_group` trước khi thực hiện hành động khác.
- Có rate limit theo action.
- Comment/Post/Like là action riêng; Like bài không được dùng selector của comment.
- Checkpoint/login luôn chuyển sang `WAITING_USER` hoặc `NEEDS_REVIEW`.

## Reliability

- Heartbeat: `public/agent-health.json`.
- Command state: `public/operator-command-status.json`.
- Browser worker state: `public/facebook-operator-status.json`.
- Dashboard local: `/agent-health.html` khi Social Manager server chạy trên cùng máy.
- Job `PROCESSING` bị treo quá lease sẽ được requeue; quá số attempt sẽ chuyển `FAILED`.
- SQLite backup định kỳ vào `data/backups`, giữ số bản cấu hình.

## Windows startup

Auto-start ưu tiên Windows Task Scheduler ở logon và chạy watchdog ẩn. Nếu Task Scheduler không tạo được, hệ thống fallback sang `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`.

Watchdog khởi động Supervisor và tự dựng lại Supervisor nếu process chết. Supervisor tiếp tục tự dựng lại runtime nếu runtime chết.

## Auto update

Production Agent theo branch `stable`, không theo mọi commit trên `main`.

Luồng release:

`main -> CI PASS -> fast-forward stable -> Windows Agent fetch stable -> npm test -> apply -> restart`

Nếu test tại máy Windows thất bại, Supervisor rollback về commit cũ.

## Giới hạn còn lại

Agent ghi kết quả đầy đủ vào SQLite/status file cục bộ. Để ChatGPT nhận trạng thái Windows trực tiếp mà không cần người dùng gửi log, cần thêm một authenticated result relay/webhook. Không đưa token hoặc secret vào repository public.
