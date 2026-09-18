$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'tools\kods-autocapture\content-v1.3.1.js'
$ext = Join-Path $env:LOCALAPPDATA 'KODS-PC-Control\extension'
$dst = Join-Path $ext 'content.js'
$manifest = Join-Path $ext 'manifest.json'
if (!(Test-Path $src)) { throw "Missing source: $src" }
if (!(Test-Path $dst)) { throw "Missing KODS content.js: $dst" }
if (!(Test-Path $manifest)) { throw "Missing KODS manifest.json: $manifest" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:LOCALAPPDATA ("KODS-PC-Control\backup-autocapture-" + $stamp)
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item $dst (Join-Path $backup 'content.js') -Force
Copy-Item $manifest (Join-Path $backup 'manifest.json') -Force
Copy-Item $src $dst -Force

$m = Get-Content $manifest -Raw | ConvertFrom-Json
$m.version = '1.3.1'
$m.description = 'KODS PC Control AutoRun with stable run-id replay protection.'
$m | ConvertTo-Json -Depth 20 | Set-Content $manifest -Encoding UTF8

$node = (Get-Command node -ErrorAction Stop).Source
& $node --check $dst
if ($LASTEXITCODE -ne 0) {
  Copy-Item (Join-Path $backup 'content.js') $dst -Force
  Copy-Item (Join-Path $backup 'manifest.json') $manifest -Force
  throw 'KODS_1_3_1_JS_CHECK_FAILED_ROLLBACK_OK'
}

Write-Output 'KODS_AUTOCAPTURE_UPGRADE=OK'
Write-Output 'VERSION=1.3.1'
Write-Output 'REPLAY_KEY=RUN_ID'
Write-Output "BACKUP=$backup"
