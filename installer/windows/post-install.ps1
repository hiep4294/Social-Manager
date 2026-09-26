param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference="Stop"

function New-RandomText([int]$Length=48){
  $chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes=New-Object byte[] $Length
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $s=New-Object Text.StringBuilder
  foreach($b in $bytes){[void]$s.Append($chars[$b%$chars.Length])}
  return $s.ToString()
}

function Set-EnvValue([string]$Text,[string]$Key,[string]$Value){
  $p="(?m)^"+[regex]::Escape($Key)+"=.*$"
  $line="$Key=$Value"
  if([regex]::IsMatch($Text,$p)){
    return [regex]::Replace($Text,$p,[Text.RegularExpressions.MatchEvaluator]{param($m)$line})
  }
  return $Text.TrimEnd()+[Environment]::NewLine+$line+[Environment]::NewLine
}

function Write-Utf8([string]$Path,[string]$Text){
  [IO.File]::WriteAllText($Path,$Text,(New-Object Text.UTF8Encoding($false)))
}

$root=[IO.Path]::GetFullPath($InstallDir)
$node=Join-Path $root "runtime\node\node.exe"
$git=Join-Path $root "runtime\git\cmd\git.exe"
$chrome=Join-Path $root "runtime\chrome\chrome.exe"
$example=Join-Path $root ".env.example"
$envFile=Join-Path $root ".env"

foreach($x in @($node,$git,$chrome,$example)){
  if(-not(Test-Path $x)){throw "Thieu runtime: $x"}
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "data"),(Join-Path $root "uploads")|Out-Null

$fresh=-not(Test-Path $envFile)
if($fresh){
  $t=Get-Content $example -Raw
  $pwd="SM-"+(New-RandomText 14)
  $t=Set-EnvValue $t "SESSION_SECRET" (New-RandomText 64)
  $t=Set-EnvValue $t "TOKEN_ENCRYPTION_KEY" (New-RandomText 64)
  $t=Set-EnvValue $t "MCP_API_TOKEN" (New-RandomText 56)
  $t=Set-EnvValue $t "ADMIN_USER" "admin"
  $t=Set-EnvValue $t "ADMIN_PASSWORD" $pwd
  $t=Set-EnvValue $t "PORT" "3000"
  $t=Set-EnvValue $t "PUBLIC_BASE_URL" "http://127.0.0.1:3000"
  $t=Set-EnvValue $t "COOKIE_SECURE" "false"
  $t=Set-EnvValue $t "DEMO_MODE" "false"
}else{
  $t=Get-Content $envFile -Raw
  $pwd=$null
}

$t=Set-EnvValue $t "FB_OPERATOR_ENABLED" "true"
$t=Set-EnvValue $t "FB_OPERATOR_HEADLESS" "true"
$t=Set-EnvValue $t "FB_OPERATOR_BROWSER_PATH" ($chrome.Replace("\","/"))
$t=Set-EnvValue $t "FB_OPERATOR_PROFILE_DIR" ((Join-Path $root "data\facebook-browser-profile-bg").Replace("\","/"))
$t=Set-EnvValue $t "FB_OPERATOR_COMMAND_POLL_ENABLED" "true"
$t=Set-EnvValue $t "FB_OPERATOR_RELIABILITY_ENABLED" "true"
$t=Set-EnvValue $t "OPERATOR_SELF_HEALING_ENABLED" "true"
$t=Set-EnvValue $t "FB_AGENT_AUTO_UPDATE" "true"
$t=Set-EnvValue $t "FB_AGENT_UPDATE_REPOSITORY" "hiep4294/Social-Manager"
$t=Set-EnvValue $t "FB_AGENT_UPDATE_BRANCH" "stable"
$t=Set-EnvValue $t "FB_AGENT_AUTOSTART" "true"
$t=Set-EnvValue $t "GROUP_MONITOR_ENABLED" "true"
$t=Set-EnvValue $t "FOOD_NETWORK_AUTO_ENABLED" "false"
Write-Utf8 $envFile $t

Push-Location $root
try{
  & $node "scripts\manage-facebook-operator-autostart.mjs" install
  if($LASTEXITCODE-ne 0){throw "Auto-start loi"}
}finally{Pop-Location}

try{schtasks.exe /Run /TN "SocialManagerFacebookOperatorAgent"|Out-Null}catch{}

$desktop=[Environment]::GetFolderPath("Desktop")
$programs=[Environment]::GetFolderPath("Programs")
$menu=Join-Path $programs "KODS Social Manager"
New-Item -ItemType Directory -Force -Path $menu|Out-Null
$shell=New-Object -ComObject WScript.Shell

foreach($i in @(
  @((Join-Path $desktop "Social Manager.lnk"),"Start-SocialManager.cmd"),
  @((Join-Path $menu "Social Manager.lnk"),"Start-SocialManager.cmd"),
  @((Join-Path $menu "Dang nhap Facebook Operator.lnk"),"Login-Facebook-Operator.cmd"),
  @((Join-Path $menu "Cau hinh Social Manager.lnk"),"Configure-SocialManager.cmd"),
  @((Join-Path $menu "Kiem tra Social Manager.lnk"),"Doctor-SocialManager.cmd")
)){
  $sc=$shell.CreateShortcut($i[0])
  $sc.TargetPath=Join-Path $root $i[1]
  $sc.WorkingDirectory=$root
  $sc.IconLocation=$chrome
  $sc.Save()
}

if($fresh){
$info=@"
KODS SOCIAL MANAGER

URL: http://127.0.0.1:3000
Tai khoan: admin
Mat khau: $pwd

BUOC FACEBOOK:
1. Mo Login-Facebook-Operator.cmd
2. Dang nhap Facebook thu cong va hoan tat 2FA/checkpoint
3. Dong Chrome khi da vao Facebook binh thuong
4. Chay Doctor-SocialManager.cmd

META Redirect URI:
http://127.0.0.1:3000/api/meta/oauth/callback

Khong chia se .env, database hoac Facebook profile.
"@
  Write-Utf8 (Join-Path $root "FIRST-RUN.txt") $info
}

$state=@{
  installed_at=(Get-Date).ToString("o")
  install_dir=$root
  node=(& $node --version)
  git=(& $git --version)
  browser=$chrome
  update_branch="stable"
}
Write-Utf8 (Join-Path $root "data\install-state.json") ($state|ConvertTo-Json -Depth 4)
Write-Host "CAI DAT THANH CONG: $root"
