function Set-BridgePrivate([string]$Path) {
  $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true,$false)
  foreach($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Get-BridgeIdentity([int]$ProcessId) {
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
  if(-not $proc -or -not $proc.ExecutablePath -or -not $proc.CommandLine){throw 'Identidade de processo indisponivel.'}
  return @{ pid=$ProcessId; path=$proc.ExecutablePath; commandLine=$proc.CommandLine; created=$proc.CreationDate.ToUniversalTime().ToString('o') }
}
function Test-BridgeIdentity($Identity) {
  if(-not $Identity -or -not $Identity.pid){return $false}
  try {
    $current=Get-BridgeIdentity ([int]$Identity.pid)
    return $current.path -eq $Identity.path -and $current.commandLine -ceq $Identity.commandLine -and $current.created -eq $Identity.created
  } catch {return $false}
}
