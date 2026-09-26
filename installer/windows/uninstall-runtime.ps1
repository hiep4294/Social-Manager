param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA "KODS\SocialManager"))
$ErrorActionPreference="SilentlyContinue"
$root=[IO.Path]::GetFullPath($InstallDir)
$node=Join-Path $root "runtime\node\node.exe"
$e=[regex]::Escape($root)
Get-CimInstance Win32_Process|Where-Object{$_.Name-eq"node.exe"-and$_.CommandLine-match$e}|ForEach-Object{Stop-Process -Id $_.ProcessId -Force}
if(Test-Path $node){
  Push-Location $root
  & $node "scripts\manage-facebook-operator-autostart.mjs" remove|Out-Null
  Pop-Location
}else{
  schtasks.exe /Delete /TN "SocialManagerFacebookOperatorAgent" /F|Out-Null
}
Write-Host "Da dung dich vu. Script khong chu dong xoa data nguoi dung."
