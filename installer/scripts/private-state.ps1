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

function Write-BridgePrivateAtomic([string]$Path, [string]$Content) {
  $parent=Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temp=Join-Path $parent ('.private-'+[guid]::NewGuid().ToString('N'))
  try {
    $stream=[System.IO.File]::Open($temp,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
    $stream.Dispose()
    Set-BridgePrivate $temp
    $bytes=(New-Object System.Text.UTF8Encoding($false)).GetBytes($Content)
    $stream=[System.IO.File]::OpenWrite($temp)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if(Test-Path -LiteralPath $Path) {
      Set-BridgePrivate $Path
      [System.IO.File]::Replace($temp,$Path,$null)
    } else { [System.IO.File]::Move($temp,$Path) }
  } finally { if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force} }
}

function Assert-BridgePortsAvailable([int[]]$Ports) {
  $listeners=@()
  try {
    foreach($port in $Ports) {
      if($port -lt 1 -or $port -gt 65535){throw 'Porta fora do intervalo.'}
      $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$port)
      $listener.Server.ExclusiveAddressUse=$true
      $listener.Start(); $listeners+=,$listener
    }
  } catch { throw 'Porta MCP ou administrativa ocupada/invalida. Nenhum processo iniciado.' }
  finally { foreach($listener in $listeners){$listener.Stop()} }
}
