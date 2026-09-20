# ensure-cloudflared.ps1 — baixa o cloudflared.exe para {InstallDir}\bin se faltar.
param([Parameter(Mandatory = $true)][string]$InstallDir)
$ErrorActionPreference = "Stop"

$bin = Join-Path $InstallDir "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $bin "cloudflared.exe"

if (Test-Path $exe) {
  Write-Output "cloudflared ja presente."
  exit 0
}

$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
Write-Output "Baixando cloudflared de $url ..."
Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
Write-Output "cloudflared salvo em $exe"
