# Quy trình tạo ảnh món ăn bằng ChatGPT

Tài liệu này chốt pipeline từ lúc Social Manager tạo yêu cầu món ăn đến khi có **ảnh final sẵn sàng để đăng**. Phần đăng Facebook bắt đầu sau trạng thái `COMPOSED` và không thuộc phạm vi tài liệu này.

## 1. Mục tiêu và điểm dừng

Điểm hoàn thành của pipeline ảnh là:

```text
FOOD_JOB_STATUS=COMPOSED
final_path tồn tại
ảnh final = 1080 x 1080
layout = chatgpt-food-poster-v3
```

Không coi việc ChatGPT vừa sinh ảnh là hoàn thành. Ảnh chỉ đạt khi đã được tải xuống, xác minh, import và chuẩn hóa vào kho Social Manager.

## 2. State machine chuẩn

```text
SCHEDULED
   |
   v
WAITING_IMAGE
   |
   v
generate_food_image
   |
   v
EXTENSION_QUEUED
   |
   v
PROCESSING
   |
   v
DONE + verified_download=true
   |
   v
IMAGE_READY
   |
   v
composeFinal()
   |
   v
COMPOSED
```

Nếu image operator thất bại, pipeline phải kết thúc ở trạng thái lỗi ảnh tương ứng; không được tự tạo bài Facebook để bù.

## 3. Khởi tạo food job

### Job theo lịch

Food Local Agent tự chọn món theo Page và ngày, sau đó tạo job `SCHEDULED`.

Job tự động trước giờ đã chọn phải chờ lịch:

```js
if (due.before && !job?.manual_run) return;
```

### Job thủ công

`scripts/food-post-now.mjs` tạo job có:

```json
{
  "manual_run": true,
  "status": "SCHEDULED"
}
```

Job manual phải chạy ngay, kể cả khi chưa tới giờ đăng tự động. Không được gọi `food-post-now` lần hai khi job ngày đó đã tồn tại.

## 4. Tạo image operator job

Food Agent tạo đúng một image attempt tại một thời điểm:

```text
foodimg-<date>-<page_key>-RIDxxx-a1
foodimg-<date>-<page_key>-RIDxxx-a2
...
```

Payload bắt buộc:

```text
action=generate_food_image
prompt=<prompt poster hoàn chỉnh>
recipe_code=RIDxxx
recipe_title=<tên món>
page_key=<page key>
```

Sau khi enqueue:

```text
food job = WAITING_IMAGE
```

Mỗi attempt có ID riêng để truy vết. Không ghi đè attempt cũ.

## 5. Bridge và Chrome Extension gate

Trước khi nhận job ảnh, runtime phải đạt:

```text
paired=true
extension_online=true
extension_version=2.1.3
expected_version=2.1.3
reload_required=false
```

`chrome-extension/bridge-client.js` và `chrome-extension/manifest.json` phải dùng cùng version.

Nếu version lệch, không coi extension là production-ready.

## 6. ChatGPT tạo poster

Extension mở ChatGPT và gửi prompt do Food Agent dựng.

Poster yêu cầu:

- ảnh vuông 1:1;
- tiêu đề Page chính xác;
- tên món chính xác;
- một subtitle chính xác;
- food photography chân thực, ánh sáng ấm;
- món ăn chiếm phần lớn nửa dưới;
- không người, không bàn tay;
- không watermark, không logo thương hiệu;
- không thêm chữ ngoài nội dung đã yêu cầu;
- typography tiếng Việt rõ và đúng dấu.

## 7. Xác minh file tải xuống

Image operator chỉ được chuyển `DONE` khi kết quả có:

```text
verified_download=true
download_path=<file thật>
download_bytes>0
download_mime=image/*
```

Food Agent còn kiểm tra:

- file nằm trong thư mục Downloads cho phép;
- file tồn tại;
- dung lượng tối thiểu theo config;
- ảnh có kích thước tối thiểu 512 x 512.

Sau đó ảnh được import thành:

```text
<RID>-<slug>/source.png
```

và metadata nguồn được gắn:

```text
layout=chatgpt-food-poster-v3
```

## 8. Chuẩn hóa ảnh final

`composeFinal()` không chèn thêm title/logo lên poster ChatGPT.

Nó chỉ chuẩn hóa:

```text
1080 x 1080
JPEG
quality=94
chromaSubsampling=4:4:4
fit=cover
```

Ảnh được lưu tại:

```text
<RID>-<slug>/final/<page_key>.jpg
```

Khi file final hợp lệ:

```text
food job = COMPOSED
```

Đây là điểm bàn giao sang pipeline đăng Facebook.

## 9. Invariant chống lỗi và đăng trùng

1. Một Page + một ngày chỉ có một food job chính.
2. Job manual đã tồn tại thì không chạy lại `food-post-now`.
3. Không enqueue `post_page` trước khi ảnh final đã có.
4. Mỗi lần tạo ảnh dùng attempt ID mới `-aN`.
5. Không dùng lại source legacy nếu metadata không phải `chatgpt-food-poster-v3`.
6. Operator `DONE` nhưng thiếu `verified_download` hoặc `download_path` được coi là lỗi.
7. Ảnh final phải đúng 1080 x 1080 trước khi chuyển sang bước đăng.

## 10. Acceptance gate

Pipeline tạo ảnh chỉ PASS khi đồng thời đạt:

```text
Bridge paired + online
extension_version == expected_version
image operator DONE
verified_download=true
source image tồn tại
food job IMAGE_READY
final image tồn tại
final image 1080 x 1080
food job COMPOSED
```

## 11. Bằng chứng runtime đã kiểm tra

Pipeline extension -> ChatGPT -> download đã được kiểm tra thực tế với:

```text
image operator status=DONE
verified_download=true
PNG 1254 x 1254
2,488,504 bytes
POST_PAGE_DELTA=0
```

Job manual cũng đã được kiểm tra sau khi sửa scheduler:

```text
manual_run=true
SCHEDULED -> WAITING_IMAGE
IMAGE_JOB_ID=foodimg-2026-09-27-hom-nay-an-gi-RID009-a1
IMAGE_OPERATOR_STATUS=PROCESSING
IMAGE_ATTEMPTS=1
```

Các bước đăng và verify Facebook được kiểm soát ở pipeline tiếp theo, không được dùng để che lỗi của pipeline ảnh.
