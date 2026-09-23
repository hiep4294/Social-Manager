# Food image library

Chế độ bán tự động:

1. Workflow chọn món + tạo caption.
2. Nếu chưa có ảnh, workflow dừng an toàn với `status=AWAITING_IMAGE`.
3. Tạo ảnh món ăn bằng ChatGPT trong cuộc trò chuyện.
4. Lưu ảnh vào đúng thư mục/tên file bên dưới.
5. Chạy lại dry-run. Hệ thống sẽ resize 1080x1080, chèn nhận diện Page bằng Sharp rồi mới đăng khi `publish=true`.

## Quy ước thư mục

- Hôm Nay Ăn Gì?: `content/food-images/hom-nay-an-gi/`
- Món Ngon Mỗi Ngày: `content/food-images/mon-ngon-moi-ngay/`

## Quy ước tên file

Tên file theo recipe ID:

- Recipe 3 -> `RID003.jpg`
- Recipe 10 -> `RID010.jpg`
- Recipe 16 -> `RID016.jpg`

Chấp nhận: `.jpg`, `.jpeg`, `.png`, `.webp`.

## Chuẩn ảnh nguồn từ ChatGPT

- Ưu tiên ảnh vuông 1:1, tối thiểu 1024x1024.
- Món ăn hoàn chỉnh là chủ thể chính.
- Không chèn chữ, logo hoặc watermark trong ảnh nguồn.
- Nên để khoảng trống tương đối ở góc trái trên và vùng trái dưới để hệ thống chèn nhận diện.
- Hệ thống sẽ tự chèn tên món và nhận diện Page; không cần sửa ảnh thủ công.

## Fail-safe

Không có đúng ảnh cho recipe đang chọn => không đăng Facebook và không đánh dấu recipe là đã dùng.
