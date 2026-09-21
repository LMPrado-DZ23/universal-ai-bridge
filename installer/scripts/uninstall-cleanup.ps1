# uninstall-cleanup.ps1 — chamado pelo desinstalador. Para tudo e remove a tarefa.
# NÃO apaga a pasta de dados do usuário (workspace/.env/audit) por padrão;
# use -PurgeData para remover também.
param([string]$DataDir = "", [switch]$PurgeData)
$ErrorActionPreference = "SilentlyContinue"

$taskName = "UniversalAIBridge"

# Para processos.
& "$PSScriptRoot\stop-access.ps1" -DataDir $DataDir | Out-Null

# Remove a tarefa agendada.
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

if ($PurgeData -and $DataDir -and (Test-Path $DataDir)) {
  Remove-Item -Recurse -Force -Path $DataDir -ErrorAction SilentlyContinue
  Write-Output "Pasta de dados removida: $DataDir"
} else {
  Write-Output "Tarefa removida e processos encerrados. Dados preservados em: $DataDir"
}
