# Facebook Operator + OAuth Page engagement

## 1. Facebook Operator on Windows

Facebook Operator is only for actions Meta does not expose reliably through the Graph API, such as creating a Page/Group, joining a Group, posting to a Group and Group monitoring.

It uses a persistent local Chrome profile. Social Manager does not store the Facebook password in GitHub or in the application database.

### Requirements

- Windows machine that stays online while Operator is needed.
- Google Chrome installed.
- Node.js 22 recommended.
- Repository `hiep4294/Social-Manager` cloned locally.
- Facebook account that is allowed to create/manage the relevant Page/Group.

### First setup

Open PowerShell or Command Prompt inside the Social-Manager folder:

```bash
npm install
npm run operator:login
```

A dedicated Chrome window opens using the profile under:

```text
data/facebook-browser-profile
```

Log in to Facebook manually. Complete 2FA, checkpoint or security confirmation yourself if Facebook requests it. Do not automate or bypass those checks.

After the Facebook home page is fully visible, close the dedicated Chrome window. The authenticated browser profile remains local on that machine.

### Run the Operator Agent

```bash
npm run operator:agent
```

Keep that terminal running. The agent receives Social Manager operator commands and executes them with the saved Chrome profile.

The agent can process actions such as:

- create_page
- create_group
- join_group
- post_group
- comment_group
- remember_asset
- monitor_group
- stop_monitor_group
- scan_group

### Group Monitor cadence

V1.6.1 is deliberately conservative:

- New Group monitors default to 600 seconds = 10 minutes.
- Minimum allowed interval is 300 seconds = 5 minutes.
- Existing monitors below 5 minutes are automatically raised to 5 minutes.
- Recommended normal Group: 600 seconds.
- Recommended important Group: 300 seconds.

The scheduler only checks which monitor is due once per minute; that does not mean Facebook itself is scanned once per minute.

### Optional .env settings on the Operator machine

```env
FB_OPERATOR_ENABLED=true
FB_OPERATOR_HEADLESS=false
FB_OPERATOR_BROWSER_PATH=
FB_OPERATOR_PROFILE_DIR=
FB_OPERATOR_LOCALE=vi-VN
FB_OPERATOR_POLL_MS=10000
FB_OPERATOR_MIN_DELAY_MS=8000
FB_OPERATOR_COMMAND_POLL_ENABLED=true
FB_OPERATOR_COMMAND_POLL_MS=5000
GROUP_MONITOR_ENABLED=true
GROUP_MONITOR_SCHEDULER_MS=60000
GROUP_MONITOR_MAX_REPLIES_PER_SCAN=2
GROUP_MONITOR_REPLY_DELAY_MS=8000
```

Leave `FB_OPERATOR_BROWSER_PATH` blank if Chrome is installed in the normal Windows location. If Chrome cannot be detected, set for example:

```env
FB_OPERATOR_BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### Normal startup after the first login

```bash
npm run operator:agent
```

You normally do not need to run `operator:login` again unless the Facebook session expires, Facebook signs the account out, or a security checkpoint invalidates the saved session.

### What happens on CAPTCHA / 2FA / checkpoint

The job is stopped and marked `WAITING_USER` or `NEEDS_REVIEW`. Social Manager does not try to bypass Facebook security checks. Run:

```bash
npm run operator:login
```

Complete the Facebook confirmation manually, close Chrome, and then restart:

```bash
npm run operator:agent
```

## 2. Reconnect Facebook OAuth for Page comments and auto-reply

The existing Facebook Page connection used posting permissions first. Page comment reading/reply needs these additional permissions:

```text
pages_manage_engagement
pages_read_user_content
```

The complete Social Manager Page permission set is:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
pages_manage_engagement
pages_read_user_content
```

### Confirm Social Manager configuration

The local `.env` / Codespace environment should use:

```env
META_OAUTH_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement,pages_read_user_content
```

Do not paste `META_APP_SECRET`, Page access tokens or Facebook passwords into chat.

### Confirm Meta App callback

For the current Codespace the callback must exactly match the URL shown by Social Manager at startup, for example:

```text
https://<codespace>-3000.app.github.dev/api/meta/oauth/callback
```

The host must also be present under the Meta App domain configuration. A new Codespace can have a new hostname, so update the Meta App domain and callback if the hostname changes.

### Reconnect from Social Manager

1. Open Social Manager in the Codespace URL.
2. Log in as the Social Manager admin.
3. Open the social connection section for the intended brand/branch.
4. Disconnect the old Facebook Page connection if the UI still shows the old permission session.
5. Choose Connect Facebook / Meta again.
6. Facebook opens the consent dialog.
7. Continue with the Facebook account that manages the intended Page.
8. Grant the requested Page permissions.
9. Return to Social Manager.
10. Select the correct Facebook Page and complete the connection.

After reconnecting, the newly issued Page token is encrypted in the Social Manager SQLite database.

### Verify the granted scope set

Open the Social Manager endpoint while logged in:

```text
/api/meta/config
```

The `scopes` array should include:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
pages_manage_engagement
pages_read_user_content
```

This verifies what Social Manager requests. The real Facebook consent/session still needs to be re-authorized after changing the scope list.

### Verify Page auto-reply

When Codespace starts, look for a log similar to:

```text
Page auto reply: ON / safe mode
```

Low-risk comments can be answered automatically. Medium/high-risk messages are stored for review instead of being posted automatically.

Examples treated conservatively include complaints, refunds, equipment failures, accidents, injury, fire, compensation, legal threats or law-enforcement references.

## 3. Recommended operating model

Use the official Graph API for Page publishing and Page engagement. Use Browser Operator only for actions without a supported Graph API path, primarily Page/Group creation and Group operations.

For Group monitoring, keep the normal cadence at 10 minutes and only use 5 minutes for groups that genuinely need faster responses. This reduces unnecessary browser activity and Facebook checkpoint risk.
