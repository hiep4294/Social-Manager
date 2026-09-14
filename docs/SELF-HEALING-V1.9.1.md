# Social Manager V1.9.1 - Self-healing

- Tự retry có giới hạn cho lỗi mạng/browser tạm thời.
- Không retry tự động với login, CAPTCHA, 2FA, checkpoint, quyền hạn hoặc giao diện Facebook không nhận diện được.
- Tự đồng bộ lại trạng thái Food Network khi job được requeue.
- Tự dọn file upload tạm cũ.
- Chạy SQLite quick_check định kỳ và chỉ ghi chẩn đoán nếu có vấn đề.
- Supervisor dùng crash backoff để tránh restart loop và rollback code/dependency nếu cập nhật lỗi.
- Mọi thay đổi production vẫn đi qua CI trên main rồi mới phát hành stable.
