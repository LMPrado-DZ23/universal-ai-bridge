# ensure-node.ps1 — garante Node.js 22.12+/24 instalado, verificando integridade do MSI
# (SHA-256 do SHASUMS256.txt oficial + assinatura Authenticode). Fail-closed.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = "v22.12.0"
$MsiName = "node-$NodeVersion-x64.msi"
$Base = "https://nodejs.org/dist/$NodeVersion"

function Test-NodeVersion {
  try {
    $v = (& node --version) 2>$null
    if ($v -match '^v(\d+)\.(\d+)\.(\d+)') {
      $major=[int]$Matches[1]; $minor=[int]$Matches[2]
      return ($major -eq 22 -and $minor -ge 12) -or $major -eq 24 -or $major -ge 26
    }
  } catch {}
  return $false
}

if (Test-NodeVersion) { Write-Output "Node.js OK."; exit 0 }

Write-Output "Node.js 22.12+/24 ausente. Baixando $MsiName (verificado)..."
$msi = Join-Path $env:TEMP $MsiName
Invoke-WebRequest -Uri "$Base/$MsiName" -OutFile $msi -UseBasicParsing

# 1) SHA-256 contra o SHASUMS256.txt oficial (mesmo origin HTTPS).
$sha = Join-Path $env:TEMP "node-SHASUMS256.txt"
Invoke-WebRequest -Uri "$Base/SHASUMS256.txt" -OutFile $sha -UseBasicParsing
$expected = (Select-String -Path $sha -Pattern ([regex]::Escape($MsiName)) | Select-Object -First 1).Line.Split(' ')[0].Trim().ToLower()
if (-not $expected) { throw "Checksum de $MsiName não encontrado no SHASUMS256.txt." }
$actual = (Get-FileHash $msi -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { Remove-Item $msi -Force; throw "SHA-256 do Node NÃO confere (esperado $expected, obtido $actual)." }
Write-Output "SHA-256 do Node OK."

# 2) Assinatura Authenticode (defesa em profundidade).
$sig = Get-AuthenticodeSignature $msi
if ($sig.Status -ne 'Valid') {
  Remove-Item $msi -Force
  throw "Assinatura Authenticode do MSI do Node inválida: $($sig.Status)."
}
Write-Output "Assinatura do Node OK ($($sig.SignerCertificate.Subject))."

Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
Remove-Item $msi -Force -ErrorAction SilentlyContinue
if (Test-NodeVersion) { Write-Output "Node instalado e verificado." } else { throw "Falha ao instalar Node 22.12+/24." }
