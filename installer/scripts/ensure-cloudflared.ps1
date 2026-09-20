# ensure-cloudflared.ps1 — baixa o cloudflared.exe e VERIFICA a assinatura
# Authenticode (assinado pela Cloudflare) antes de instalar. Fail-closed.
# Version: por padrão "latest"; pode ser fixada (ex.: -Version "2024.12.2").
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [string]$Version = "latest"
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$bin = Join-Path $InstallDir "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $bin "cloudflared.exe"

if (Test-Path $exe) {
  $existing = Get-AuthenticodeSignature $exe
  if ($existing.Status -eq 'Valid') { Write-Output "cloudflared já presente e assinado."; exit 0 }
  Write-Output "cloudflared presente sem assinatura válida; rebaixando."
  Remove-Item $exe -Force
}

$url = if ($Version -eq "latest") {
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
} else {
  "https://github.com/cloudflare/cloudflared/releases/download/$Version/cloudflared-windows-amd64.exe"
}
Write-Output "Baixando cloudflared ($Version)..."
$tmp = Join-Path $env:TEMP "cloudflared-dl.exe"
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing

$sig = Get-AuthenticodeSignature $tmp
if ($sig.Status -ne 'Valid') {
  Remove-Item $tmp -Force
  throw "Assinatura Authenticode do cloudflared inválida: $($sig.Status)."
}
$subject = $sig.SignerCertificate.Subject
if ($subject -notmatch 'Cloudflare') {
  Remove-Item $tmp -Force
  throw "cloudflared assinado por editor inesperado: $subject"
}
Move-Item $tmp $exe -Force
Write-Output "cloudflared verificado e instalado ($subject)."
