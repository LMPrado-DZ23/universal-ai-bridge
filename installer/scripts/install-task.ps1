# install-task.ps1 — cria a Tarefa Agendada que inicia o bridge no logon do usuário
# e (opcionalmente) a executa agora. Roda no contexto do usuário (não SYSTEM),
# para que o workspace fique no perfil dele.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [switch]$RunNow
)
$ErrorActionPreference = "Stop"

$taskName = "UniversalAIBridge"
$launcher = Join-Path $InstallDir "scripts\launcher.ps1"
$psArgs = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -InstallDir `"$InstallDir`" -DataDir `"$DataDir`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Tarefa '$taskName' registrada (inicia no logon)."

if ($RunNow) {
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Tarefa iniciada agora."
}
