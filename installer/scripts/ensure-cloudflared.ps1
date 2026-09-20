# Pinned release and checksum from https://github.com/cloudflare/cloudflared/releases/tag/2025.8.1
param([Parameter(Mandatory=$true)][string]$InstallDir, [ValidateSet('2025.8.1')][string]$Version='2025.8.1')
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$expected='b5d598b00cc3a28cabc5812d9f762819334614bae452db4e7f23eefe7b081556'
$bin=Join-Path $InstallDir 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe=Join-Path $bin 'cloudflared.exe'
function Assert-Cloudflared([string]$Path) {
  if ((Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Checksum cloudflared nao corresponde a versao fixada.' }
  $sig=Get-AuthenticodeSignature $Path
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(?i)(?:^|,\s*)(?:O|CN)="?Cloudflare,? Inc\.?"?(?:,|$)') {
    throw 'Assinatura/editor Cloudflare nao verificavel. Instalacao interrompida; nenhum fallback.'
  }
}
if (Test-Path $exe) { Assert-Cloudflared $exe; Write-Output 'cloudflared existente verificado.'; exit 0 }
$tmp=Join-Path $bin ('.cloudflared-'+[guid]::NewGuid().ToString('N')+'.exe')
try {
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/download/$Version/cloudflared-windows-amd64.exe" -OutFile $tmp -UseBasicParsing
  Assert-Cloudflared $tmp
  Move-Item $tmp $exe
  Write-Output "cloudflared $Version verificado."
} finally { if(Test-Path $tmp){Remove-Item $tmp -Force} }
