# Social Manager V1.5 - Facebook automation

## Muc tieu

V1.5 tach Facebook thanh hai lop:

1. **Meta Graph API**: dang bai Page, doc comment Page, tra loi comment Page.
2. **Facebook Browser Operator**: tao Page, tao Group, tham gia Group, dang bai Group, binh luan Group.

Browser Operator chi dung tren tai khoan Facebook cua chu he thong. He thong khong bypass CAPTCHA, 2FA, checkpoint, security check hoac gioi han cua Facebook.

## Page auto reply

Codespaces bat `PAGE_AUTO_REPLY_ENABLED=true` va `PAGE_AUTO_REPLY_MODE=safe`.

- LOW: tu dong tra loi.
- MEDIUM: luu vao `community_inbox`, khong tu dong tra loi.
- HIGH: luu vao `community_inbox`, khong tu dong tra loi.

Can reconnect Facebook OAuth sau khi V1.5 duoc cap nhat de token co them:

- `pages_manage_engagement`
- `pages_read_user_content`

## Browser Operator

Cac action:

- `create_page`
- `create_group`
- `join_group`
- `post_group`
- `comment_group`

### One-time login tren may Windows

```bash
npm install
npm run operator:login
```

Chrome mo bang profile rieng trong `data/facebook-browser-profile`. Dang nhap Facebook thu cong, xu ly 2FA/checkpoint neu co, sau do dong Chrome.

Chay agent:

```bash
npm run operator:agent
```

Agent doc cung file lenh GitHub ma ChatGPT/Social Manager dang dung. Vi vay lenh `facebook_operator` do ChatGPT ghi vao repo se duoc may co Chrome thuc thi.

## Lenh bridge mau

### Tao Page

```json
{
  "id": "fbop-create-page-001",
  "action": "facebook_operator",
  "brand_id": 1,
  "operator_action": "create_page",
  "payload": {
    "name": "KODS Cua Cuon Ha Noi",
    "category": "Local business",
    "bio": "Giai phap cua cuon va cua chong chay"
  }
}
```

### Tao Group

```json
{
  "id": "fbop-create-group-001",
  "action": "facebook_operator",
  "brand_id": 1,
  "operator_action": "create_group",
  "payload": {
    "name": "Hoi ky thuat cua cuon Viet Nam",
    "privacy": "PUBLIC",
    "description": "Trao doi ky thuat, lap dat va an toan cua cuon"
  }
}
```

### Tham gia Group

```json
{
  "id": "fbop-join-group-001",
  "action": "facebook_operator",
  "operator_action": "join_group",
  "payload": {
    "group_url": "https://www.facebook.com/groups/..."
  }
}
```

### Dang bai Group

```json
{
  "id": "fbop-post-group-001",
  "action": "facebook_operator",
  "operator_action": "post_group",
  "payload": {
    "group_url": "https://www.facebook.com/groups/...",
    "message": "Noi dung bai viet"
  }
}
```

### Binh luan Group

```json
{
  "id": "fbop-comment-group-001",
  "action": "facebook_operator",
  "operator_action": "comment_group",
  "payload": {
    "post_url": "https://www.facebook.com/groups/.../posts/...",
    "message": "Noi dung binh luan"
  }
}
```

### Tra loi comment Page qua API chinh thuc

```json
{
  "id": "fb-reply-page-001",
  "action": "reply_facebook_comment",
  "brand_id": 1,
  "comment_id": "FACEBOOK_COMMENT_ID",
  "message": "Cam on anh/chi. KODS da ghi nhan yeu cau."
}
```

## Trang thai Browser Operator

Browser Operator co the tra ve:

- `DONE`: da thuc hien.
- `QUEUED`: dang cho.
- `WAITING_USER`: can login, CAPTCHA, 2FA, checkpoint hoac chua co Chrome.
- `NEEDS_REVIEW`: Facebook thay doi giao dien/selector hoac flow can nguoi kiem tra.
- `FAILED`: loi ky thuat.

V1.5 khong co co che stealth, proxy xoay IP, CAPTCHA solver hoac bypass he thong bao mat Facebook.
