param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA "KODS\SocialManager"))
$root=[IO.Path]::GetFullPath($InstallDir)
$e=[regex]::Escape($root)
$p=Get-CimInstance Win32_Process|Where-Object{$_.Name-eq"node.exe"-and$_.CommandLine-match$e-and$_.CommandLine-match"src[\\/]server\.js"}
foreach($x in $p){Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue;Write-Host "Stopped $($x.ProcessId)"}
if(-not$p){Write-Host "Web app khong chay"}
