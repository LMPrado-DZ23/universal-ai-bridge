$ErrorActionPreference='Stop'
# Parse all scripts without executing installers.
Get-ChildItem -Path installer -Recurse -Filter '*.ps1' | ForEach-Object {
  $tokens=$null; $errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors) | Out-Null
  if($errors.Count){throw "PowerShell parse error: $($_.Name): $errors"}
}
. (Join-Path $PSScriptRoot '../installer/scripts/private-state.ps1')
$temp=Join-Path ([System.IO.Path]::GetTempPath()) ('bridge-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  & (Join-Path $PSScriptRoot '../installer/scripts/configure.ps1') -DataDir $temp
  $before=Get-Content (Join-Path $temp '.env') -Raw
  if($before -notmatch '(?m)^BRIDGE_CONNECTION=local\r?$'){throw 'New installation did not default to local.'}
  & (Join-Path $PSScriptRoot '../installer/scripts/ensure-cloudflared.ps1') -InstallDir $temp -DataDir $temp
  if(Test-Path (Join-Path $temp 'bin/cloudflared.exe')){throw 'Local mode downloaded a tunnel binary.'}
  & (Join-Path $PSScriptRoot '../installer/scripts/configure.ps1') -DataDir $temp
  if($before -cne (Get-Content (Join-Path $temp '.env') -Raw)){throw 'Configure is not idempotent.'}
  $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl=Get-Acl (Join-Path $temp '.env')
  if(-not $acl.AreAccessRulesProtected){throw 'ACL inherits permissions.'}
  foreach($rule in $acl.Access){if($rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'Unexpected ACL principal.'}}
  $identity=Get-BridgeIdentity $PID
  if(-not (Test-BridgeIdentity $identity)){throw 'Own process identity not recognized.'}
  $identity.created='2000-01-01T00:00:00Z'
  if(Test-BridgeIdentity $identity){throw 'Reused PID would be accepted.'}
  # A revoked credential and custom options must survive upgrade configuration.
  $custom="BRIDGE_TOKEN=`nBRIDGE_APPROVAL=human_local`nBRIDGE_PORT=8787`nCUSTOM_SETTING=keep`n"
  Write-BridgePrivateAtomic (Join-Path $temp '.env') $custom
  & (Join-Path $PSScriptRoot '../installer/scripts/configure.ps1') -DataDir $temp
  if([System.IO.File]::ReadAllText((Join-Path $temp '.env')) -cne $custom){throw 'Upgrade changed persisted configuration/revocation.'}
  # Actual socket conflict, not a mocked health response.
  $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
  $listener.Start()
  try {
    $port=$listener.LocalEndpoint.Port
    $blocked=$false
    try { Assert-BridgePortsAvailable @($port) } catch {$blocked=$true}
    if(-not $blocked){throw 'Occupied port was accepted.'}
  } finally {$listener.Stop()}
  Assert-BridgePortsAvailable @($port)
  # A real unsigned script must be refused by the production release gate.
  $blocked=$false
  try { & (Join-Path $PSScriptRoot '../installer/scripts/assert-release.ps1') -File $PSCommandPath -Production } catch {$blocked=$true}
  if(-not $blocked){throw 'Unsigned production artifact accepted.'}
  & (Join-Path $PSScriptRoot '../installer/scripts/assert-release.ps1') -File $PSCommandPath
  # Rename failure must retain destination and remove private temporary files.
  $directory=Join-Path $temp 'directory'; New-Item -ItemType Directory $directory | Out-Null
  $blocked=$false
  try {Write-BridgePrivateAtomic $directory 'test'} catch {$blocked=$true}
  if(-not $blocked){throw 'Expected atomic replacement failure.'}
  if(Get-ChildItem -LiteralPath $temp -Filter '.private-*' -Force){throw 'Temporary credential file leaked.'}
  # Corrupted local cloudflared is rejected before use, without downloading.
  $bin=Join-Path $temp 'bin';New-Item -ItemType Directory -Path $bin | Out-Null
  [System.IO.File]::WriteAllBytes((Join-Path $bin 'cloudflared.exe'),[byte[]](1,2,3))
  $blocked=$false
  try {& (Join-Path $PSScriptRoot '../installer/scripts/ensure-cloudflared.ps1') -InstallDir $temp} catch {$blocked=$true}
  if(-not $blocked){throw 'Corrupted cloudflared accepted.'}
  Write-Output 'PASS: parsing, idempotence, ACL, PID identity, revocation upgrade, port conflict, unsigned gate, atomic cleanup.'
} finally {Remove-Item $temp -Recurse -Force}
