# stop-access.ps1 — PARADA DE EMERGÊNCIA. Encerra bridge e túnel e desativa
# o início automático. O acesso remoto cai imediatamente.
param([string]$DataDir = "")
$ErrorActionPreference = "SilentlyContinue"

$taskName = "UniversalAIBridge"

# Desativa a tarefa de logon.
Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null

# Mata SOMENTE os processos que o bridge registrou (nunca cloudflared/node de
# terceiros no computador). Se o state.json sumiu, não há o que matar com segurança.
$killed = 0
$statePath = if ($DataDir) { Join-Path $DataDir "state.json" } else { "" }
if ($statePath -and (Test-Path $statePath)) {
  try {
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    foreach ($procId in @($state.nodePid, $state.tunnelPid)) {
      if ($procId) {
        # taskkill /T encerra a árvore (filhos do processo do bridge).
        & taskkill /PID $procId /T /F 2>$null | Out-Null
        $killed++
      }
    }
  } catch {}
} else {
  Write-Output "Aviso: state.json ausente — nenhum PID registrado para encerrar."
}

Write-Output "Acesso interrompido: $killed processo(s) do bridge encerrado(s); inicio automatico desativado."
Write-Output "Para religar: reative a tarefa 'UniversalAIBridge' ou reinstale/execute o painel."
