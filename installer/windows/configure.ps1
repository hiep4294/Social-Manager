param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA "KODS\SocialManager"))
$ErrorActionPreference="Stop"
function SetV($t,$k,$v){$p="(?m)^"+[regex]::Escape($k)+"=.*$";$l="$k=$v";if([regex]::IsMatch($t,$p)){return [regex]::Replace($t,$p,[Text.RegularExpressions.MatchEvaluator]{param($m)$l})};return $t.TrimEnd()+[Environment]::NewLine+$l+[Environment]::NewLine}
function GetV($t,$k){$m=[regex]::Match($t,"(?m)^"+[regex]::Escape($k)+"=(.*)$");if($m.Success){return $m.Groups[1].Value.Trim()};return ""}
function Plain($s){$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}}

$root=[IO.Path]::GetFullPath($InstallDir)
$file=Join-Path $root ".env"
if(-not(Test-Path $file)){throw "Thieu .env"}
$t=Get-Content $file -Raw

$cur=GetV $t "ADMIN_USER";$v=Read-Host "ADMIN_USER [$cur]";if($v){$t=SetV $t "ADMIN_USER" $v}
$v=Plain(Read-Host "Mat khau Admin moi (Enter giu nguyen)" -AsSecureString);if($v){$t=SetV $t "ADMIN_PASSWORD" $v}
$cur=GetV $t "PUBLIC_BASE_URL";$v=Read-Host "PUBLIC_BASE_URL [$cur]";if($v){$t=SetV $t "PUBLIC_BASE_URL" $v.TrimEnd("/")}
$cur=GetV $t "META_APP_ID";$v=Read-Host "META_APP_ID [$cur]";if($v){$t=SetV $t "META_APP_ID" $v}
$v=Plain(Read-Host "META_APP_SECRET moi (Enter giu nguyen)" -AsSecureString);if($v){$t=SetV $t "META_APP_SECRET" $v}

[IO.File]::WriteAllText($file,$t,(New-Object Text.UTF8Encoding($false)))
$base=GetV $t "PUBLIC_BASE_URL"
Write-Host "Da luu. Redirect URI: $($base.TrimEnd('/'))/api/meta/oauth/callback"
