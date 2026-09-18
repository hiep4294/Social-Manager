param(
  [string]$PageUrl = 'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $env:LOCALAPPDATA 'KODS-PC-Control\extension'
$manifest = Join-Path $ext 'manifest.json'
$content = Join-Path $ext 'content.js'
$status = Join-Path $ext 'activation-status.json'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'

if (!(Test-Path $manifest)) { throw "Missing manifest: $manifest" }
if (!(Test-Path $content)) { throw "Missing content.js: $content" }
if (!(Test-Path $chrome)) { throw "Missing Chrome: $chrome" }

$m = Get-Content $manifest -Raw | ConvertFrom-Json
if ($m.version -ne '1.3.1') {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\upgrade-kods-autocapture-131.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'KODS 1.3.1 upgrade failed' }
}

$js = Get-Content $content -Raw
if ($js -notmatch "VERSION\s*=\s*'1\.3\.1'") {
  throw 'KODS content.js is not 1.3.1'
}

@{
  state='SCHEDULED'
  version='1.3.1'
  page_url=$PageUrl
  scheduled_at=(Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content $status -Encoding UTF8

$encodedPage = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PageUrl))
$worker = @"
\$ErrorActionPreference='SilentlyContinue'
\$root='$($root.Replace("'","''"))'
\$ext='$($ext.Replace("'","''"))'
\$status='$($status.Replace("'","''"))'
\$chrome='$($chrome.Replace("'","''"))'
\$page=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$encodedPage'))

Start-Sleep 7

@{
  state='RESTARTING_CHROME'
  version='1.3.1'
  page_url=\$page
  updated_at=(Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content \$status -Encoding UTF8

\$chromeProcs = Get-Process chrome -ErrorAction SilentlyContinue
foreach(\$p in \$chromeProcs){
  try { if(\$p.MainWindowHandle -ne 0){ [void]\$p.CloseMainWindow() } } catch {}
}
Start-Sleep 3
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

Start-Process \$chrome -ArgumentList '--restore-last-session','https://chatgpt.com/'
Start-Sleep 10

Get-CimInstance Win32_Process |
  Where-Object {
    \$_.Name -eq 'node.exe' -and
    \$_.CommandLine -match 'facebook-operator|page-complete-session|page-login-auto|page-complete\.mjs'
  } |
  ForEach-Object {
    Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep 2

Start-Process node -WorkingDirectory \$root -ArgumentList @(
  'scripts/page-complete-session.mjs',
  \$page
)

@{
  state='ACTIVE'
  version='1.3.1'
  page_url=\$page
  activated_at=(Get-Date).ToString('o')
  note='Chrome restarted from disk; Page completion resumed.'
} | ConvertTo-Json | Set-Content \$status -Encoding UTF8
"@

$workerPath = Join-Path $env:TEMP 'kods-activate-131-worker.ps1'
Set-Content $workerPath $worker -Encoding UTF8

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy','Bypass',
  '-File',$workerPath
)

Write-Output 'KODS_1_3_1_ACTIVATION=SCHEDULED'
Write-Output 'CHROME_FULL_RESTART=IN_7S'
Write-Output 'PAGE_RESUME=AFTER_CHROME_RESTART'
