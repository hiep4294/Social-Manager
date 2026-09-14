# Food Network V1.8

## Mục tiêu

- 24 Fanpage về ẩm thực trong 365 ngày.
- Nhịp tạo Page: xấp xỉ 1 Page mỗi 15,2 ngày.
- Khi Page hoạt động: 1 bài/ngày/Page.
- Mỗi bài gồm công thức nấu ăn + prompt ảnh món ăn vuông 1:1.
- Trong cùng một ngày, 24 Page không dùng trùng cùng một món.

## 24 Page

1. Bếp Nhà Việt Mỗi Ngày
2. Mâm Cơm Gia Đình
3. Cơm Nhà 30 Phút
4. Bếp Mẹ Nấu
5. Hôm Nay Ăn Gì
6. Món Ngon Dễ Làm
7. Bữa Cơm Ấm Nhà
8. Bếp Nhỏ Mỗi Ngày
9. Ăn Vặt Tại Nhà
10. Quà Chiều Dễ Làm
11. Món Vặt Cuối Tuần
12. Bếp Ăn Chơi
13. Món Chay Ngon
14. Bếp Chay Mỗi Ngày
15. Chay Dễ Nấu
16. Rau Củ Ngon Lành
17. Hải Sản Ngon Nhà Làm
18. Bún Phở Mì Tại Nhà
19. Món Nhậu Tại Gia
20. Bếp Món Nước
21. Món Nướng Cuối Tuần
22. Món Chiên Giòn Ngon
23. Bánh Ngon Dễ Làm
24. Đồ Uống & Tráng Miệng

## Nội dung

`src/food-network-core.js` chứa:

- blueprint 24 Page;
- thư viện công thức;
- thuật toán chọn món không trùng trong ngày;
- nội dung chuẩn gồm giới thiệu, nguyên liệu, cách làm, mẹo nhỏ, hashtag;
- prompt ảnh food photography 1:1, không chữ, không logo, không người.

## Lập kế hoạch

Chạy:

```bash
npm run food:plan
```

Mặc định hệ thống tạo kế hoạch 365 ngày và ghi:

- `data/food-network-plan.json`: toàn bộ kế hoạch;
- `public/food-network-status.json`: trạng thái tóm tắt cho dashboard;
- `/food-network.html`: dashboard đọc trạng thái tóm tắt.

Có thể đặt ngày bắt đầu:

```bash
FOOD_NETWORK_START_DATE=2026-09-14T00:00:00+07:00 npm run food:plan
```

Hoặc số ngày cần tạo kế hoạch:

```bash
FOOD_NETWORK_PLAN_DAYS=90 npm run food:plan
```

`npm start` và `npm run codespace` tự chạy planner trước khi khởi động app.

## Trạng thái triển khai

V1.8 cố ý để `publishing=APPROVAL_REQUIRED` và `image_status=NEEDS_DISH_IMAGE`.

Lý do: tạo Page thật, ảnh món ăn thật và đăng lên Facebook là các bước tác động ra hệ thống bên ngoài. Cần kết nối Page và nguồn ảnh trước khi chuyển sang chế độ tự động. Không dùng ảnh giả món, không tự bỏ qua checkpoint/CAPTCHA/2FA.

## Bước tiếp theo

V1.8.1 có thể thêm ba phần sau sau khi chọn nguồn ảnh và cách duyệt:

1. Page Creation Queue: lấy lịch 24 Page và đưa từng Page đến bước tạo khi đến hạn.
2. Dish Image Provider: tạo ảnh món ăn đúng prompt và trả URL ảnh.
3. Publishing Approval: duyệt theo bài hoặc duyệt theo batch; sau khi duyệt mới đưa vào `posts/post_targets` để Graph API đăng đúng lịch.

Khuyến nghị production: giữ chế độ duyệt batch thay vì đăng không giám sát hoàn toàn, đặc biệt trong giai đoạn 4-8 Page đầu để kiểm tra chất lượng nội dung, ảnh và phản hồi của Facebook.
