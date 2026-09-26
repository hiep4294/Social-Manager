param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA "KODS\SocialManager"))
$ErrorActionPreference="Stop"
$root=[IO.Path]::GetFullPath($InstallDir)
$node=Join-Path $root "runtime\node\node.exe"
$envFile=Join-Path $root ".env"
$data=Join-Path $root "data"
New-Item -ItemType Directory -Force -Path $data|Out-Null
$port=3000
if(Test-Path $envFile){$m=[regex]::Match((Get-Content $envFile -Raw),"(?m)^PORT=(\d+)");if($m.Success){$port=[int]$m.Groups[1].Value}}
$url="http://127.0.0.1:$port"
$ready=$false
try{$h=Invoke-RestMethod "$url/api/health" -TimeoutSec 2;$ready=[bool]$h.ok}catch{}
if(-not $ready){
  Start-Process -FilePath $node -ArgumentList @("src/server.js") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data "web-runtime.log") -RedirectStandardError (Join-Path $data "web-runtime-error.log")|Out-Null
  for($i=0;$i-lt 40;$i++){Start-Sleep -Milliseconds 500;try{$h=Invoke-RestMethod "$url/api/health" -TimeoutSec 2;if($h.ok){$ready=$true;break}}catch{}}
}
if(-not $ready){throw "Web khong khoi dong. Xem data\web-runtime-error.log"}
Start-Process $url
Write-Host $url
