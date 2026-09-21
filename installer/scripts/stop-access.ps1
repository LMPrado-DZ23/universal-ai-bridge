# stop-access.ps1 — PARADA DE EMERGÊNCIA. Encerra bridge e túnel e desativa
# o início automático. O acesso remoto cai imediatamente.
param([string]$DataDir = "", [ValidatePattern("^UniversalAIBridge(?:-[A-Za-z0-9]+)?$")][string]$TaskName = "UniversalAIBridge")
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "private-state.ps1")


# Desativa a tarefa de logon.
Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null

# Mata SOMENTE os processos que o bridge registrou (nunca cloudflared/node de
# terceiros no computador). Se o state.json sumiu, não há o que matar com segurança.
$killed = 0
$statePath = if ($DataDir) { Join-Path $DataDir "state.json" } else { "" }
if ($statePath -and (Test-Path $statePath)) {
  try {
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    foreach ($identity in @($state.nodeIdentity, $state.tunnelIdentity)) {
      if (Test-BridgeIdentity $identity) {
        & taskkill /PID $identity.pid /T /F 2>$null | Out-Null
        if($LASTEXITCODE -eq 0){$killed++}
        elseif(Test-BridgeIdentity $identity){throw 'Processo identificado nao foi encerrado.'}
      } elseif ($identity) { Write-Warning 'Processo ausente ou identidade mudou; PID nao encerrado.' }
    }
  } catch { throw 'Parada incompleta: estado invalido ou falha ao encerrar processo identificado. Nenhum PID sem identidade foi encerrado.' }
} else {
  Write-Output "Aviso: state.json ausente — nenhum PID registrado para encerrar."
}

Write-Output "Resultado da parada: $killed processo(s) do bridge encerrado(s); inicio automatico desativado."
Write-Output "Para religar: reative a tarefa 'UniversalAIBridge' ou reinstale/execute o painel."
