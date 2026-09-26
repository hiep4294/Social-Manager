param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA "KODS\SocialManager"))
$ErrorActionPreference="Continue"
$root=[IO.Path]::GetFullPath($InstallDir)
$node=Join-Path $root "runtime\node\node.exe"
$git=Join-Path $root "runtime\git\cmd\git.exe"
$chrome=Join-Path $root "runtime\chrome\chrome.exe"
$fail=0;$warn=0
function P($m){Write-Host "[PASS] $m"}
function W($m){$script:warn++;Write-Host "[WARN] $m"}
function F($m){$script:fail++;Write-Host "[FAIL] $m"}

if(Test-Path $node){P "Node $(& $node --version)"}else{F "Thieu Node"}
if(Test-Path $git){P "$(& $git --version)"}else{F "Thieu MinGit"}
if(Test-Path $chrome){P "Chrome runtime"}else{F "Thieu Chrome"}
if(Test-Path (Join-Path $root ".env")){P ".env"}else{F "Thieu .env"}
if(Test-Path (Join-Path $root ".git")){P ".git auto-update"}else{W "Thieu .git"}

if(Test-Path $node){
  Push-Location $root
  try{
    & $node --input-type=module -e "import Database from 'better-sqlite3';const d=new Database(':memory:');d.prepare('select 1').get();d.close();console.log('SQLITE_NATIVE_OK')" 2>&1|ForEach-Object{Write-Host $_}
    if($LASTEXITCODE-eq 0){P "better-sqlite3"}else{F "better-sqlite3"}
    foreach($x in @("src\server.js","src\facebook-page-post-action.js","scripts\facebook-operator-agent-watchdog.mjs")){
      & $node --check $x 2>$null
      if($LASTEXITCODE-eq 0){P "Syntax $x"}else{F "Syntax $x"}
    }
    & $node "scripts\manage-facebook-operator-autostart.mjs" status 2>&1|ForEach-Object{Write-Host $_}
  }finally{Pop-Location}
}

try{$h=Invoke-RestMethod "http://127.0.0.1:3000/api/health" -TimeoutSec 3;if($h.ok){P "Web app dang chay"}}catch{W "Web app chua chay"}
$profile=Join-Path $root "data\facebook-browser-profile-bg"
if((Test-Path $profile)-and((Get-ChildItem $profile -Force -ErrorAction SilentlyContinue|Measure-Object).Count-gt 0)){P "Facebook profile co du lieu"}else{W "Chua login Facebook Operator"}

Write-Host "FAIL=$fail WARN=$warn"
if($fail-gt 0){exit 2}
