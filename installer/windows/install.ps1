param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA "KODS\SocialManager"))
$ErrorActionPreference="Stop"
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$target=[IO.Path]::GetFullPath($InstallDir)

Write-Host "KODS Social Manager Full Installer"
Write-Host "Nguon: $source"
Write-Host "Dich: $target"

if($source.TrimEnd("\")-ieq $target.TrimEnd("\")){
  & (Join-Path $source "installer\windows\post-install.ps1") -InstallDir $source
  exit $LASTEXITCODE
}

$existing=Test-Path $target
New-Item -ItemType Directory -Force -Path $target|Out-Null
$xd=@("data","uploads","dist")
if($existing){$xd+=".git"}

$args=@($source,$target,"/E","/COPY:DAT","/DCOPY:DAT","/R:2","/W:1","/NFL","/NDL","/NJH","/NJS","/NP","/XD")+$xd+@("/XF",".env","FIRST-RUN.txt","*.log","*.bak","*.bak-*",".kods-*")
& robocopy.exe @args|Out-Null
if($LASTEXITCODE-ge 8){throw "Robocopy loi $LASTEXITCODE"}

if(-not(Test-Path (Join-Path $target ".git"))-and(Test-Path (Join-Path $source ".git"))){
  & robocopy.exe (Join-Path $source ".git") (Join-Path $target ".git") /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP|Out-Null
  if($LASTEXITCODE-ge 8){throw "Copy .git loi"}
}

New-Item -ItemType Directory -Force -Path (Join-Path $target "data"),(Join-Path $target "uploads")|Out-Null

function Copy-TreeSafe([string]$Source,[string]$Destination){
  if(-not(Test-Path $Source)){return $false}
  New-Item -ItemType Directory -Force -Path $Destination|Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP|Out-Null
  if($LASTEXITCODE-ge 8){throw "Copy runtime loi: $Source -> $Destination"}
  return $true
}

$runtime=Join-Path $target "runtime"
$runtimeNode=Join-Path $runtime "node\node.exe"
$runtimeGit=Join-Path $runtime "git\cmd\git.exe"
$runtimeChrome=Join-Path $runtime "chrome\chrome.exe"

if(-not(Test-Path $runtimeNode)){
  $nodeCmd=Get-Command node.exe -ErrorAction SilentlyContinue
  if(-not $nodeCmd){throw "Khong tim thay Node de tao runtime"}
  $nodeDir=Split-Path $nodeCmd.Source -Parent
  [void](Copy-TreeSafe $nodeDir (Join-Path $runtime "node"))
}

if(-not(Test-Path $runtimeGit)){
  $gitCmd=Get-Command git.exe -ErrorAction SilentlyContinue
  if(-not $gitCmd){throw "Khong tim thay Git de tao runtime"}
  $gitCmdDir=Split-Path $gitCmd.Source -Parent
  $gitRoot=Split-Path $gitCmdDir -Parent
  [void](Copy-TreeSafe $gitRoot (Join-Path $runtime "git"))
}

if(-not(Test-Path $runtimeChrome)){
  $chromeCandidates=@()
  if($env:ProgramFiles){$chromeCandidates += (Join-Path $env:ProgramFiles "Google\Chrome\Application")}
  $pf86=[Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  if($pf86){$chromeCandidates += (Join-Path $pf86 "Google\Chrome\Application")}
  if($env:LOCALAPPDATA){$chromeCandidates += (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application")}
  $chromeDir=$chromeCandidates|Where-Object{Test-Path (Join-Path $_ "chrome.exe")}|Select-Object -First 1
  if(-not $chromeDir){throw "Khong tim thay Google Chrome de tao runtime"}
  [void](Copy-TreeSafe $chromeDir (Join-Path $runtime "chrome"))
}

foreach($requiredRuntime in @($runtimeNode,$runtimeGit,$runtimeChrome)){
  if(-not(Test-Path $requiredRuntime)){throw "Tao runtime that bai: $requiredRuntime"}
}

& (Join-Path $target "installer\windows\post-install.ps1") -InstallDir $target
if($LASTEXITCODE-ne 0){throw "Post-install loi"}
Write-Host "Hoan tat. Xem FIRST-RUN.txt trong $target"
