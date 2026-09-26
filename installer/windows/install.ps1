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
& (Join-Path $target "installer\windows\post-install.ps1") -InstallDir $target
if($LASTEXITCODE-ne 0){throw "Post-install loi"}
Write-Host "Hoan tat. Xem FIRST-RUN.txt trong $target"
