# stop-access.ps1 — PARADA DE EMERGÊNCIA. Encerra bridge e túnel e desativa
# o início automático. O acesso remoto cai imediatamente.
param([string]$DataDir = "")
$ErrorActionPreference = "SilentlyContinue"

$taskName = "UniversalAIBridge"

# Desativa a tarefa de logon.
Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null

# Mata processos pelos PIDs registrados, se houver.
if ($DataDir -and (Test-Path (Join-Path $DataDir "state.json"))) {
  try {
    $state = Get-Content (Join-Path $DataDir "state.json") -Raw | ConvertFrom-Json
    foreach ($procId in @($state.nodePid, $state.tunnelPid)) {
      if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}

# Rede de segurança: encerra qualquer cloudflared e node do bridge remanescente.
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "app\\dist\\index.js" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Output "Acesso interrompido: bridge e tunel encerrados, inicio automatico desativado."
Write-Output "Para religar: reative a tarefa 'UniversalAIBridge' ou reinstale/execute o painel."
