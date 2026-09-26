param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$StageDir,[Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference="Stop"
$r=[IO.Path]::GetFullPath($Root)
$s=[IO.Path]::GetFullPath($StageDir)
if(Test-Path $s){Remove-Item $s -Recurse -Force}
New-Item -ItemType Directory -Force -Path $s|Out-Null

& robocopy.exe $r $s /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD ".git" "node_modules" "runtime" "dist" "data" "uploads" /XF ".env" "FIRST-RUN.txt" "*.log" "*.bak" "*.bak-*" ".kods-*"|Out-Null
if($LASTEXITCODE-ge 8){throw "Copy source loi"}

foreach($d in @(".git","node_modules","runtime")){
  $src=Join-Path $r $d
  $dst=Join-Path $s $d
  if(-not(Test-Path $src)){throw "Thieu $src"}
  & robocopy.exe $src $dst /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP|Out-Null
  if($LASTEXITCODE-ge 8){throw "Copy $d loi"}
}

New-Item -ItemType Directory -Force -Path (Join-Path $s "data"),(Join-Path $s "uploads")|Out-Null
Copy-Item (Join-Path $r "installer\windows\launchers\*.cmd") $s -Force

$g=Join-Path $r "runtime\git\cmd\git.exe"
$c=(& $g -C $r rev-parse HEAD).Trim()
$m=@{
  product="KODS Social Manager"
  version=$Version
  git_commit=$c
  build_time_utc=(Get-Date).ToUniversalTime().ToString("o")
  platform="windows-x64"
  bundled=@("Node.js","MinGit","Chrome for Testing","node_modules")
}
[IO.File]::WriteAllText((Join-Path $s "BUILD-MANIFEST.json"),($m|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
Write-Host "STAGE_READY=$s"
