# Quy trình đăng Facebook bằng Direct Playwright

Tài liệu này chốt quy trình **đã kiểm chứng thực tế** để Social Manager đăng bài Facebook Page kèm ảnh sau khi pipeline ảnh món ăn đã tạo xong file final.

## 1. Kiến trúc đã chốt

```text
Food Local Agent
  -> generate_food_image
  -> Chrome Extension + ChatGPT
  -> verified_download
  -> source.png
  -> composeFinal()
  -> final/<page_key>.jpg (1080 x 1080)
  -> post_page job
  -> Facebook Operator
  -> Direct Playwright
  -> Chrome profile rieng, cua so off-screen
  -> Facebook Page composer
  -> upload local_image_path
  -> ComposerStoryCreateMutation
  -> verify post_id + media
  -> VERIFIED
```

Nguyên tắc kiến trúc:

- Chrome Extension chỉ xử lý `generate_food_image`.
- `post_page` và `create_page` không đi qua Extension bridge.
- Facebook được điều khiển trực tiếp bằng Playwright.
- Ảnh Facebook ưu tiên lấy từ `payload.local_image_path`, không phụ thuộc localhost asset bridge.
- Chrome Facebook dùng persistent profile riêng: `data/facebook-browser-profile-bg`.
- Runtime Facebook chạy `headless=false` nhưng cửa sổ được đưa ra ngoài màn hình bằng `--window-position=-32000,-32000`.

## 2. Điều kiện trước khi đăng

Chỉ chuyển sang Facebook khi:

```text
image operator = DONE
verified_download = true
source image hop le
final_path ton tai
final image = 1080 x 1080
food job >= COMPOSED
publish.enabled = true
```

Không enqueue bài Facebook nếu file final chưa hợp lệ.

## 3. Tạo post job

Food Agent chỉ tạo một `post_page` job cho Page/ngày/recipe tương ứng.

Payload quan trọng:

```text
page_url
page_name
message
local_image_path
image_url
asset_token
```

Trong kiến trúc Direct Playwright, `local_image_path` là nguồn ảnh ưu tiên.

Invariant chống trùng:

1. Một Page + một ngày chỉ có một food job chính.
2. Không tạo post job mới nếu `post_job_id` đã tồn tại.
3. Job đã `VERIFIED` không được đăng lại.
4. Nếu lần trước có bằng chứng đã bấm Post nhưng chưa xác minh được kết quả, không tự retry.

## 4. Mở Facebook bằng Direct Playwright

Facebook Operator mở Chrome bằng:

```text
profile = data/facebook-browser-profile-bg
headless = false
window-position = -32000,-32000
viewport = 1440 x 980
locale = vi-VN
```

Đây là Chrome thật với session Facebook đã đăng nhập, nhưng cửa sổ nằm ngoài vùng màn hình người dùng.

Trước khi thao tác:

- mở đúng `page_url`;
- chờ DOM/render ổn định;
- kiểm tra login/checkpoint/2FA/CAPTCHA;
- nếu Facebook yêu cầu xác minh người dùng thì dừng ở `WAITING_USER`, không bypass.

## 5. Dedupe trước khi đăng

Trước khi mở composer, operator tìm bài đã tồn tại bằng `dedupe_marker`.

Với bài có ảnh, chỉ coi là bài cũ hợp lệ khi:

```text
marker khop
AND
article co media that
```

Không được coi text trùng nhưng thiếu ảnh là thành công.

Nếu tìm thấy bài đã tồn tại kèm media:

```text
verified = true
already_present = true
```

và không đăng lần hai.

## 6. Mở composer

Operator tìm nút tạo bài bằng nhiều selector/label Facebook có thể dùng, ví dụ:

```text
Bạn đang nghĩ gì
Chia sẻ suy nghĩ
Tạo bài viết
Viết bài
Create post
Write a post
What's on your mind
```

Không kiểm tra đúng một lần rồi fail. Phải chờ Facebook render composer.

Sau khi click:

- tìm dialog đang hiển thị;
- tìm editor `contenteditable`/textbox/textarea thực;
- loại vùng comment;
- nhập `payload.message`.

Nếu chưa bấm nút Post mà composer/editor lỗi:

```text
clicked_post = false
status = NEEDS_REVIEW
```

trường hợp này chưa có side effect đăng bài.

## 7. Gắn ảnh

Nguồn ưu tiên:

```text
payload.local_image_path
```

Nếu file local tồn tại, operator dùng trực tiếp file đó.

Quy trình:

1. tìm nút `Ảnh/video` / `Photo/video` trong composer;
2. chờ `filechooser`;
3. `setFiles(local_image_path)`;
4. nếu filechooser không xuất hiện, chỉ fallback sang `input[type=file]` bên trong active composer;
5. chờ media preview thật.

Ảnh chỉ được coi là attach thành công khi có tín hiệu attachment + preview đủ lớn và không còn progress/busy trong hai lần kiểm tra liên tiếp.

Nếu ảnh chưa attach ổn định, dừng trước nút Post.

## 8. Tiếp -> Đăng

Facebook Page có thể dùng luồng hai bước:

```text
Composer
  -> Tiếp / Next
  -> Đăng / Post
```

Operator:

- bấm `Tiếp` nếu xuất hiện;
- chờ media xử lý;
- tìm nút `Đăng/Post` đang visible + enabled.

Không bấm một button Post bất kỳ ngoài composer phù hợp.

## 9. Bằng chứng publish chính

Ngay trước khi click Post, operator đăng ký listener cho:

```text
POST /api/graphql
fb_api_req_friendly_name = ComposerStoryCreateMutation
```

Sau đó mới click Post.

Có thể xuất hiện dialog phụ như `Call now/Gọi ngay`; operator dismiss bằng `Lúc khác/Not now/Later` rồi tiếp tục chờ mutation.

Một bài yêu cầu ảnh chỉ được công nhận khi request publish có media reference, ví dụ:

```text
attachments -> photo
hoac
photo_ids
```

Sau response, kiểm tra:

```text
HTTP ok
GraphQL errors = none
post_id ton tai neu Facebook tra ve
story_id ton tai neu Facebook tra ve
request co media reference neu bai yeu cau anh
```

## 10. Xác minh bài sau khi publish

Ưu tiên xác minh trực tiếp bằng `post_id`.

Operator dựng permalink từ Page/actor + `post_id`, sau đó kiểm tra article:

```text
dedupe marker khop
AND
media ton tai
```

Nếu direct URL chưa xác minh được do feed Facebook trễ, mới fallback về Page feed với retry có giới hạn.

Thành công chuẩn:

```text
verified = true
media_verified = true
verification_source = DIRECT_POST_ID
```

## 11. State machine sau khi thành công

Khi xác minh thành công:

```text
facebook_operator_jobs.status = DONE
result.clicked_post = true
result.verified = true
result.post_id = <Facebook post id>
result.post_url = <verified URL>

food job.status = VERIFIED
food job.post_ref = post_id/post_url

state.last_post_date = ngay dang
state.last_post_ref = post_ref
recipe.used = true
recipe.posted_date = ngay dang
recipe.post_ref = post_ref
```

## 12. Quy tắc retry an toàn

### Lỗi trước khi click Post

```text
clicked_post = false
```

Có thể sửa nguyên nhân rồi retry đúng job cũ, sau khi kiểm tra không có bài trùng.

### Đã click Post nhưng chưa verify

```text
clicked_post = true
verified = false
```

Phải chuyển sang trạng thái cần xác minh.

**Không tự đăng lại.**

Trước mọi retry phải kiểm tra Facebook thực tế bằng marker/post ID/feed để tránh tạo bài trùng.

## 13. Bằng chứng live đã đạt

Lần kiểm thử production RID009 đã đạt:

```text
final image bytes = 627933
final image = 1080 x 1080
ComposerStoryCreateMutation = success
mutation_has_media_reference = true
post_id = 122110344327481989
media_verified = true
verification_source = DIRECT_POST_ID
POST_STATUS = DONE
FOOD_STATUS = VERIFIED
STATE_LAST_POST_DATE = 2026-09-27
POST_JOB_COUNT = 1
```

Người vận hành sau đó xác nhận trực tiếp: **bài đã xuất hiện thành công trên Fanpage và có kèm ảnh**.

Đây là acceptance evidence cuối cùng cho quy trình Direct Playwright.

## 14. Acceptance gate chuẩn cho các bài sau

Một bài chỉ được tính là thành công khi đồng thời:

```text
final image ton tai va hop le
chi co mot post job logic
Facebook Page dung dich
ComposerStoryCreateMutation thanh cong
mutation co media reference neu bai co anh
post_id/story evidence hop le
article sau publish co marker
article sau publish co media
operator status = DONE
result.verified = true
food job = VERIFIED
state last_post_date duoc cap nhat
```

Không dùng riêng các dấu hiệu sau để kết luận thành công:

- job row đã tồn tại;
- đã click nút Post;
- composer đóng;
- HTTP request bất kỳ đã chạy;
- text xuất hiện nhưng không có ảnh.

## 15. Phạm vi của Extension và Facebook Operator

### Chrome Extension

Chỉ:

```text
generate_food_image
```

### Direct Playwright Facebook Operator

Xử lý:

```text
post_page
create_page / thao tac Facebook duoc cho phep
Facebook Page verification
```

Mục tiêu là giảm phụ thuộc:

```text
Extension -> Bridge -> Facebook
```

và thay bằng:

```text
Social Manager -> Direct Playwright -> Facebook
```

cho phần đăng Facebook.
