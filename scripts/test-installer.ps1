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
  Write-Output 'PASS: PowerShell parsing, configure idempotence, private ACL, PID identity.'
} finally {Remove-Item $temp -Recurse -Force}
