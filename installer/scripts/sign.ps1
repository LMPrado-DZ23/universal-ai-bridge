# sign.ps1 — assina o instalador com Authenticode SE um certificado for fornecido.
# No-op (sai 0) quando não há PFX: o build continua produzindo um .exe não assinado.
# Uso no CI: passe o PFX em base64 e a senha via secrets.
param(
  [Parameter(Mandatory = $true)][string]$File,
  [string]$PfxBase64 = "",
  [string]$Password = "",
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PfxBase64)) {
  Write-Host "Nenhum certificado fornecido (CODE_SIGN_PFX_BASE64 vazio): pulando assinatura."
  exit 0
}
if (-not (Test-Path $File)) { throw "Arquivo a assinar não encontrado: $File" }

$pfx = Join-Path $env:TEMP "uab-codesign.pfx"
[System.IO.File]::WriteAllBytes($pfx, [System.Convert]::FromBase64String($PfxBase64))

# Localiza o signtool.exe (Windows SDK) ou usa o do PATH.
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { $signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source }
if (-not $signtool) { throw "signtool.exe não encontrado (instale o Windows SDK)." }

try {
  & $signtool sign /f $pfx /p $Password /fd SHA256 /tr $TimestampUrl /td SHA256 $File
  if ($LASTEXITCODE -ne 0) { throw "signtool retornou $LASTEXITCODE" }
  & $signtool verify /pa $File | Out-Null
  Write-Host "Instalador assinado e verificado: $File"
}
finally {
  Remove-Item $pfx -Force -ErrorAction SilentlyContinue
}
