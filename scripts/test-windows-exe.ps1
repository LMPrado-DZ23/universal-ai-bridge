# Runs the actual installer, only on disposable GitHub Actions Windows runners.
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows'){throw 'Disposable Windows Actions runner required.'}
$root=Split-Path -Parent $PSScriptRoot
$exe=Join-Path $root 'installer/Output/UniversalAI-Bridge-Setup.exe'
$install=Join-Path $env:RUNNER_TEMP ('Bridge EXE '+[guid]::NewGuid().ToString('N'))
$data=Join-Path $env:LOCALAPPDATA 'UniversalAIBridge'
if((Test-Path $data) -or (Get-ScheduledTask -TaskName 'UniversalAIBridge' -ErrorAction SilentlyContinue)){throw 'Existing bridge installation found; refusing test.'}
$evidence=Join-Path $root 'validation-artifacts'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
function Run-Exe([string]$File,[string[]]$Arguments,[string]$Phase,[int]$ExpectedExitCode=0) {
  Write-Output "EXE phase: $Phase"
  $p=Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  $null=$p.Handle
  if(-not $p.WaitForExit(180000)){$p.Kill();throw "EXE timeout: $Phase"}
  if($p.ExitCode -ne $ExpectedExitCode){throw "EXE failed: $Phase (exit $($p.ExitCode))."}
}
$completed=@()
try {
  $args=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',('/DIR="'+$install+'"'))
  Run-Exe $exe ($args+@('/LOG="'+(Join-Path $evidence 'exe-install.log')+'"')) 'install'
  $completed+='install'
  . (Join-Path $install 'scripts/private-state.ps1')
  $state=Get-Content (Join-Path $data 'state.json') -Raw | ConvertFrom-Json
  if(-not (Test-BridgeIdentity $state.nodeIdentity)){throw 'Installed bridge is not running.'}
  if($state.endpoint -or $state.tunnelIdentity -or (Test-Path (Join-Path $install 'bin/cloudflared.exe'))){throw 'Default local installation enabled a tunnel.'}
  & (Join-Path $install 'scripts/healthcheck.ps1') -DataDir $data -Mcp
  $task=Get-ScheduledTask -TaskName 'UniversalAIBridge'
  if($task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Interactive'){throw 'Task violates least privilege.'}
  $config=Join-Path $data '.env'
  $before=[IO.File]::ReadAllText($config)
  if($before -notmatch '(?m)^BRIDGE_CONNECTION=local\r?$'){throw 'Local mode not persisted.'}
  $marker=Join-Path $data 'workspace/keep.txt';[IO.File]::WriteAllText($marker,'user data survives')
  $completed+='authenticated MCP and limited scheduled task'
  Run-Exe $exe ($args+@('/LOG="'+(Join-Path $evidence 'exe-upgrade.log')+'"')) 'upgrade'
  if([IO.File]::ReadAllText($config) -cne $before -or [IO.File]::ReadAllText($marker) -cne 'user data survives'){throw 'Upgrade changed user configuration/data.'}
  & (Join-Path $install 'scripts/healthcheck.ps1') -DataDir $data -Mcp
  $completed+='upgrade'
  $uninstaller=(Get-ChildItem $install -Filter 'unins*.exe' | Select-Object -First 1).FullName
  Run-Exe $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="'+(Join-Path $evidence 'exe-uninstall.log')+'"')) 'uninstall'
  if(Get-ScheduledTask -TaskName 'UniversalAIBridge' -ErrorAction SilentlyContinue){throw 'Uninstall left scheduled task.'}
  if([IO.File]::ReadAllText($config) -cne $before -or [IO.File]::ReadAllText($marker) -cne 'user data survives'){throw 'Uninstall changed user data.'}
  if(Test-Path (Join-Path $install 'app/dist/index.js')){throw 'Uninstall left application.'}
  $completed+='uninstall preserves data'
  # A revoked credential must survive reinstall and make Setup fail, not report success.
  $revoked=[regex]::Replace($before,'(?m)^BRIDGE_TOKEN=.*$','BRIDGE_TOKEN=')
  Write-BridgePrivateAtomic $config $revoked
  Run-Exe $exe ($args+@('/LOG="'+(Join-Path $evidence 'exe-revoked-install.log')+'"')) 'revoked install rejected' 10
  if([IO.File]::ReadAllText($config) -cne $revoked){throw 'Failed reinstall changed revoked credentials.'}
  $completed+='unhealthy installation returns exit 10'
  $uninstaller=(Get-ChildItem $install -Filter 'unins*.exe' | Select-Object -First 1).FullName
  Run-Exe $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="'+(Join-Path $evidence 'exe-cleanup.log')+'"')) 'failed install cleanup'
  Write-Output 'PASS: actual EXE install, authenticated MCP, limited task, upgrade, uninstall and preserved user data.'
 } finally {
  $taskInfo=Get-ScheduledTaskInfo -TaskName 'UniversalAIBridge' -ErrorAction SilentlyContinue
  $taskState=Get-ScheduledTask -TaskName 'UniversalAIBridge' -ErrorAction SilentlyContinue
  @{lastTaskResult=$taskInfo.LastTaskResult;taskState=[string]$taskState.State;completed=$completed;interactiveWizardTested=$false;windows=[Environment]::OSVersion.VersionString;userInteractive=[Environment]::UserInteractive} | ConvertTo-Json | Set-Content (Join-Path $evidence 'exe-results.json') -Encoding UTF8
  # Never display credentials. Inno logs have no tokens in script arguments; redact defensively.
  Get-ChildItem $evidence -Filter 'exe-*.log' | ForEach-Object {
    $log=[IO.File]::ReadAllText($_.FullName)
    $log=[regex]::Replace($log,'(?i)[a-f0-9]{48,}','[redacted]')
    [IO.File]::WriteAllText($_.FullName,$log)
    if($completed.Count -lt 5){Get-Content $_.FullName -Tail 20 | Write-Output}
  }
  if(Test-Path (Join-Path $install 'scripts/stop-access.ps1')){& (Join-Path $install 'scripts/stop-access.ps1') -DataDir $data}
  Unregister-ScheduledTask -TaskName 'UniversalAIBridge' -Confirm:$false -ErrorAction SilentlyContinue
  # Data is intentionally kept for assertions; the hosted runner is discarded.
}
