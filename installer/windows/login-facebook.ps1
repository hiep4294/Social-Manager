param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA "KODS\SocialManager"))
$ErrorActionPreference="Stop"
$root=[IO.Path]::GetFullPath($InstallDir)
$node=Join-Path $root "runtime\node\node.exe"
$e=[regex]::Escape($root)

Get-CimInstance Win32_Process|Where-Object{$_.Name-eq"node.exe"-and$_.CommandLine-match$e-and$_.CommandLine-match"facebook-operator"}|ForEach-Object{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
Start-Sleep 1
Push-Location $root
try{
  Write-Host "Dang nhap Facebook thu cong, hoan tat 2FA/checkpoint, sau do dong Chrome."
  & $node "scripts\operator-login.mjs"
  if($LASTEXITCODE-ne 0){throw "Login loi"}
  & $node "scripts\manage-facebook-operator-autostart.mjs" install
  schtasks.exe /Run /TN "SocialManagerFacebookOperatorAgent"|Out-Null
}finally{Pop-Location}
Write-Host "Facebook Operator san sang"
