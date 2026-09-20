# ensure-node.ps1 — garante Node.js 22+ instalado. Usa winget; se não houver,
# baixa o MSI oficial e instala silenciosamente. Requer privilégio de admin.
$ErrorActionPreference = "Stop"

function Get-NodeMajor {
  try {
    $v = (& node --version) 2>$null
    if ($v -match 'v(\d+)\.') { return [int]$Matches[1] }
  } catch {}
  return 0
}

$major = Get-NodeMajor
if ($major -ge 22) {
  Write-Output "Node.js OK (v$major)."
  exit 0
}

Write-Output "Node.js 22+ nao encontrado (atual: $major). Instalando..."

# 1) Tenta winget.
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
  try {
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ((Get-NodeMajor) -ge 22) { Write-Output "Node instalado via winget."; exit 0 }
  } catch { Write-Output "winget falhou: $_" }
}

# 2) Fallback: MSI oficial.
$msiUrl = "https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi"
$msi = Join-Path $env:TEMP "node-v22-x64.msi"
Write-Output "Baixando Node MSI de $msiUrl ..."
Invoke-WebRequest -Uri $msiUrl -OutFile $msi -UseBasicParsing
Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

if ((Get-NodeMajor) -ge 22) { Write-Output "Node instalado via MSI." } else { throw "Falha ao instalar Node 22+." }
