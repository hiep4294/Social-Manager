$ErrorActionPreference = 'Continue'
param([string]$PageUrl='https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr')

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Output 'ORCHESTRATOR=START'
Write-Output "HEAD=$(git rev-parse --short HEAD)"

# Keep the persistent Facebook profile single-writer.
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -and
    $_.CommandLine -match 'facebook-operator|page-complete-session|page-login-auto|page-complete\.mjs'
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep 1

& node (Join-Path $root 'scripts\page-complete-session.mjs') $PageUrl
$pageExit = $LASTEXITCODE

Write-Output "PAGE_RUN_EXIT=$pageExit"
$status = Join-Path $root 'public\page-complete-session.json'
$log = Join-Path $root 'data\page-complete-session.log'
if (Test-Path $status) {
  Write-Output '===PAGE_STATUS==='
  Get-Content $status -Raw
}
if (Test-Path $log) {
  Write-Output '===PAGE_LOG_TAIL==='
  Get-Content $log -Tail 18
}

# Ensure the on-disk KODS extension is 1.3.1.
$upgrade = Join-Path $root 'scripts\upgrade-kods-autocapture-131.ps1'
if (Test-Path $upgrade) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $upgrade
}

# Reload Chrome only after this KODS command has had time to return its result.
$worker = @'
Start-Sleep 8
$chrome = Get-Process chrome -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1
if ($chrome) {
  try {
    $w = New-Object -ComObject WScript.Shell
    [void]$w.AppActivate($chrome.Id)
    Start-Sleep 1
    $w.SendKeys('^l')
    Start-Sleep 1
    $w.SendKeys('chrome://restart')
    $w.SendKeys('{ENTER}')
  } catch {}
}
'@
$workerPath = Join-Path $env:TEMP 'kods-reload-chrome-131.ps1'
Set-Content $workerPath $worker -Encoding UTF8
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',$workerPath
)

Write-Output 'KODS_1_3_1_RELOAD=SCHEDULED_8S'
Write-Output 'ORCHESTRATOR=DONE'
