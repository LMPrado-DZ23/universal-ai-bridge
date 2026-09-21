# Exercise installed scripts against a real bridge in a disposable staged layout.
# No public tunnel, signing credential, user data or global task is provisioned.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'installer/scripts/private-state.ps1')
$temp=Join-Path ([IO.Path]::GetTempPath()) ('bridge lifecycle '+[guid]::NewGuid().ToString('N'))
$install=Join-Path $temp 'Installed App'
$data=Join-Path $temp 'User Data'
$app=Join-Path $install 'app'
$link=Join-Path $app 'node_modules'
$owned=@()
function Free-Port {
  $socket=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  $socket.Start()
  try { return $socket.LocalEndpoint.Port } finally {$socket.Stop()}
}
function Invoke-Installed([string]$Script,[string[]]$Arguments=@(),[switch]$ExpectFailure) {
  $file=Join-Path $install ('scripts/'+$Script)
  $out=Join-Path $temp 'child.stdout';$err=Join-Path $temp 'child.stderr'
  $args=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$file+'"'))+$Arguments
  $p=Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  # Wait only for the script, not the long-lived bridge it starts.
  if(-not $p.WaitForExit(30000)){$p.Kill();throw "Installed script timed out: $Script"}
  if($ExpectFailure) {if($p.ExitCode -eq 0){throw "Expected rejection: $Script"}}
  elseif($p.ExitCode -ne 0){throw "Installed script failed: $Script (exit $($p.ExitCode)); child output withheld."}
}
function Read-State {return Get-Content (Join-Path $data 'state.json') -Raw | ConvertFrom-Json}
function Admin([string]$Path,[string]$Method='Post') {
  return Invoke-RestMethod -Uri "http://127.0.0.1:$adminPort/admin/$Path" -Method $Method -Headers @{'x-admin-secret'=$secret} -TimeoutSec 8 -UseBasicParsing
}
try {
  New-Item -ItemType Directory -Force -Path $app,$data | Out-Null
  Copy-Item (Join-Path $root 'installer/scripts') $install -Recurse
  foreach($name in @('dist','config','package.json')) {Copy-Item (Join-Path $root $name) $app -Recurse}
  # Dependencies are shared read-only by convention; application/scripts are actual copies.
  New-Item -ItemType Junction -Path $link -Target (Join-Path $root 'node_modules') | Out-Null
  $port=Free-Port;$adminPort=Free-Port
  while($adminPort -eq $port){$adminPort=Free-Port}
  Assert-BridgePortsAvailable @($port,$adminPort)
  $dataArgs=@('-DataDir',('"'+$data+'"'))
  $launchArgs=@('-InstallDir',('"'+$install+'"'))+$dataArgs+@('-NoTunnel')
  Invoke-Installed 'configure.ps1' ($dataArgs+@('-Port',[string]$port))
  $envPath=Join-Path $data '.env'
  Write-BridgePrivateAtomic $envPath ([IO.File]::ReadAllText($envPath)+"`nBRIDGE_ADMIN_PORT=$adminPort`n")
  $secret=(Select-String -LiteralPath $envPath -Pattern '^BRIDGE_ADMIN_SECRET=(.+)$').Matches[0].Groups[1].Value
  $original=[IO.File]::ReadAllText($envPath)
  # Own unrelated process: no blanket node/taskkill cleanup is permitted.
  $sentinel=Start-Process (Get-Command node).Source -ArgumentList @('-e','"setInterval(()=>{},1000)"') -PassThru -WindowStyle Hidden
  $sentinelIdentity=Get-BridgeIdentity $sentinel.Id;$owned+=,$sentinelIdentity
  Invoke-Installed 'launcher.ps1' $launchArgs
  $state=Read-State;$owned+=,$state.nodeIdentity
  if(-not (Test-BridgeIdentity $state.nodeIdentity)){throw 'Started process identity invalid.'}
  if($state.endpoint -or $state.tunnelIdentity){throw 'Local start created a public tunnel.'}
  Invoke-Installed 'healthcheck.ps1' ($dataArgs+@('-Mcp'))
  if((Admin 'status' 'Get').sessions -ne 0){throw 'Healthcheck leaked an MCP session.'}
  Invoke-Installed 'launcher.ps1' $launchArgs
  if((Read-State).nodePid -ne $state.nodePid){throw 'Duplicate launch changed process.'}
  Invoke-Installed 'configure.ps1' $dataArgs
  if([IO.File]::ReadAllText($envPath) -cne $original){throw 'Upgrade changed configuration.'}
  $rotated=Admin 'rotate'
  if($rotated.persistence -ne 'persisted'){throw 'Rotation was not persisted.'}
  Invoke-Installed 'stop-access.ps1' $dataArgs
  Invoke-Installed 'stop-access.ps1' $dataArgs
  if(Test-BridgeIdentity $state.nodeIdentity){throw 'Stop left the bridge alive.'}
  if(-not (Test-BridgeIdentity $sentinelIdentity)){throw 'Stop terminated unrelated process.'}
  Invoke-Installed 'launcher.ps1' $launchArgs
  $state=Read-State;$owned+=,$state.nodeIdentity
  Invoke-Installed 'healthcheck.ps1' ($dataArgs+@('-Mcp'))
  $revoked=Admin 'revoke'
  if($revoked.persistence -ne 'persisted'){throw 'Revocation was not persisted.'}
  Invoke-Installed 'stop-access.ps1' $dataArgs
  Invoke-Installed 'configure.ps1' $dataArgs
  Invoke-Installed 'launcher.ps1' $launchArgs -ExpectFailure
  if((Select-String -LiteralPath $envPath -Pattern '^BRIDGE_TOKEN=(.*)$').Matches[0].Groups[1].Value){throw 'Revoked token resurrected.'}
  # Tampered creation identity must never terminate another live process.
  $wrong=@{};foreach($key in $sentinelIdentity.Keys){$wrong[$key]=$sentinelIdentity[$key]};$wrong.created='2000-01-01T00:00:00Z'
  Write-BridgePrivateAtomic (Join-Path $data 'state.json') (@{nodeIdentity=$wrong} | ConvertTo-Json -Depth 5)
  Invoke-Installed 'stop-access.ps1' $dataArgs
  if(-not (Test-BridgeIdentity $sentinelIdentity)){throw 'Mismatched identity was accepted.'}
  Write-BridgePrivateAtomic (Join-Path $data 'state.json') '{invalid-json'
  Invoke-Installed 'stop-access.ps1' $dataArgs -ExpectFailure
  if(-not (Test-BridgeIdentity $sentinelIdentity)){throw 'Invalid state terminated unrelated process.'}
  Write-BridgePrivateAtomic (Join-Path $data 'state.json') (@{} | ConvertTo-Json)
  $preserved=[IO.File]::ReadAllText($envPath)
  Invoke-Installed 'uninstall-cleanup.ps1' $dataArgs
  Invoke-Installed 'uninstall-cleanup.ps1' $dataArgs
  if([IO.File]::ReadAllText($envPath) -cne $preserved){throw 'Uninstall changed user data.'}
  Write-Output 'PASS: installed lifecycle, authenticated MCP, session cleanup, duplicate launch, upgrade, rotation, restart, revocation, repeated stop/uninstall, external PID preservation.'
} finally {
  if(Test-Path (Join-Path $data 'state.json')){try {$owned+=,(Read-State).nodeIdentity}catch{}}
  foreach($identity in $owned){if($identity -and (Test-BridgeIdentity $identity)){& taskkill /PID $identity.pid /T /F 2>$null | Out-Null}}
  if(Test-Path $link){[IO.Directory]::Delete($link)}
  if(Test-Path $temp){Remove-Item -LiteralPath $temp -Recurse -Force}
}
