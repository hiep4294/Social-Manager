# KODS Social Manager - Windows Full Installer

## Da kem san
- Source stable day du.
- Node.js x64 + node_modules.
- MinGit cho auto-update.
- Chrome for Testing rieng cho Facebook Operator.
- Facebook Operator Watchdog/Supervisor/Runtime.
- Group Monitor, Food Network, Meta OAuth, MCP, Facebook/Instagram API, Chrome Extension.
- Doctor, Configure, Login Facebook, Start/Stop.

Bo cai KHONG chua cookie Facebook, token Meta, .env hay database cua may build.

## Cai bang EXE
1. Chay SocialManager-Setup-vX.Y.Z.exe.
2. Mo FIRST-RUN.txt trong %LOCALAPPDATA%\KODS\SocialManager.
3. Chay Login-Facebook-Operator.cmd.
4. Dang nhap Facebook thu cong, hoan tat 2FA/checkpoint, dong Chrome.
5. Chay Doctor-SocialManager.cmd.
6. Chay Start-SocialManager.cmd.

## Cai bang ZIP
Giai nen ZIP va chay SETUP.cmd.

## Meta OAuth
Chay Configure-SocialManager.cmd de nhap META_APP_ID va META_APP_SECRET.
Redirect local mac dinh:
http://127.0.0.1:3000/api/meta/oauth/callback

## Backup
Can backup:
- data\
- uploads\
- .env

Khuyen nghi login lai Facebook tren may moi thay vi copy browser profile.

## Tien ich
- Start-SocialManager.cmd
- Stop-SocialManager.cmd
- Login-Facebook-Operator.cmd
- Configure-SocialManager.cmd
- Doctor-SocialManager.cmd

## Yeu cau
Windows 10/11 x64 va Internet.
Khong can cai Node/npm/Git/Chrome truoc.
