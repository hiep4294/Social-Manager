$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'tools\kods-autocapture\content-v1.3.0.js'
$ext = Join-Path $env:LOCALAPPDATA 'KODS-PC-Control\extension'
$dst = Join-Path $ext 'content.js'
$manifest = Join-Path $ext 'manifest.json'

if (!(Test-Path $src)) { throw "Missing source: $src" }
if (!(Test-Path $dst)) { throw "KODS content.js not found: $dst" }
if (!(Test-Path $manifest)) { throw "KODS manifest.json not found: $manifest" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:LOCALAPPDATA ("KODS-PC-Control\backup-autocapture-" + $stamp)
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item $dst (Join-Path $backup 'content.js') -Force
Copy-Item $manifest (Join-Path $backup 'manifest.json') -Force

Copy-Item $src $dst -Force

$m = Get-Content $manifest -Raw | ConvertFrom-Json
$m.version = '1.3.0'
$m.description = 'Run marked PowerShell/CMD commands from ChatGPT through Chrome Native Messaging with robust AutoRun capture.'
$m | ConvertTo-Json -Depth 20 | Set-Content $manifest -Encoding UTF8

$node = (Get-Command node -ErrorAction Stop).Source
& $node --check $dst
if ($LASTEXITCODE -ne 0) {
  Copy-Item (Join-Path $backup 'content.js') $dst -Force
  Copy-Item (Join-Path $backup 'manifest.json') $manifest -Force
  throw 'KODS_AUTOCAPTURE_JS_CHECK_FAILED_ROLLBACK_OK'
}

$status = [ordered]@{
  ok = $true
  version = '1.3.0'
  installed_at = (Get-Date).ToString('o')
  extension = $ext
  backup = $backup
  content_sha256 = (Get-FileHash $dst -Algorithm SHA256).Hash
  next = 'Reload the ChatGPT tab once to activate KODS AutoRun 1.3.0'
}
$status | ConvertTo-Json | Set-Content (Join-Path $ext 'autocapture-upgrade.json') -Encoding UTF8

Write-Output 'KODS_AUTOCAPTURE_UPGRADE=OK'
Write-Output 'VERSION=1.3.0'
Write-Output "EXTENSION=$ext"
Write-Output "BACKUP=$backup"
Write-Output 'ACTIVATE=RELOAD_CHATGPT_TAB_ONCE'
