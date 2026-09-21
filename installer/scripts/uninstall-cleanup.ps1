# uninstall-cleanup.ps1 — chamado pelo desinstalador. Para tudo e remove a tarefa.
# NÃO apaga a pasta de dados do usuário (workspace/.env/audit) por padrão;
# use -PurgeData para remover também.
param([string]$DataDir = "", [switch]$PurgeData, [ValidatePattern("^UniversalAIBridge(?:-[A-Za-z0-9]+)?$")][string]$TaskName = "UniversalAIBridge")
$ErrorActionPreference = "Stop"


# Para processos.
& "$PSScriptRoot\stop-access.ps1" -DataDir $DataDir -TaskName $TaskName | Out-Null

# Remove a tarefa agendada.
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

if ($PurgeData -and $DataDir -and (Test-Path $DataDir)) {
  Remove-Item -Recurse -Force -LiteralPath $DataDir -ErrorAction Stop
  Write-Output "Pasta de dados removida: $DataDir"
} else {
  Write-Output "Limpeza concluida conforme identidades verificadas. Dados preservados em: $DataDir"
}
